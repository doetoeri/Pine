import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import {
  conditionFor,
  currentSlot,
  dailyBudget,
  digest,
  eligibleForSlot,
  kstDate,
  notificationId,
  sequenceFor,
} from "./notification-frequency-core.mjs";

const SCHOOL_ID = "gochon-high";
const EXPERIMENT_ID = "notification-frequency";
const UI_EXPERIMENT_ID = "pincon-next-ui";

function addDays(date, amount) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0,10);
}

async function ensureParticipant(root, uid) {
  const ref = root.collection("experimentParticipants").doc(uid);
  const snap = await ref.get();
  if (snap.exists && String(snap.data()?.anonymousParticipant || "").startsWith("participant_")) {
    return snap.data().anonymousParticipant;
  }
  const anonymousParticipant = `participant_${randomUUID().replaceAll("-","").slice(0,24)}`;
  await ref.set({ schemaVersion: 1, anonymousParticipant, createdAtMs: Date.now() }, { merge: false });
  return anonymousParticipant;
}

async function ensureAssignment(root, uid, anonymousParticipant, config) {
  const ref = root.collection("experiments").doc(EXPERIMENT_ID).collection("assignments").doc(uid);
  const snap = await ref.get();
  const version = Number(config.version || 1);
  if (snap.exists && Number(snap.data()?.experimentVersion || 0) === version && Array.isArray(snap.data()?.sequence)) {
    return snap.data();
  }
  const generated = sequenceFor(uid, EXPERIMENT_ID, version);
  const record = {
    schemaVersion: 1,
    sequence: generated.sequence,
    sequenceIndex: generated.index,
    assignedAtMs: Date.now(),
    experimentVersion: version,
    anonymousParticipant,
  };
  await ref.set(record, { merge: false });
  return record;
}

async function experimentReady(root) {
  const [notification, flag, ui] = await Promise.all([
    root.collection("experiments").doc(EXPERIMENT_ID).get(),
    root.collection("experimentFlags").doc("notification_experiment").get(),
    root.collection("experiments").doc(UI_EXPERIMENT_ID).get(),
  ]);
  const config = notification.exists ? { id: notification.id, ...notification.data() } : null;
  const enabled = flag.exists ? flag.data()?.enabled !== false : false;
  const uiDone = ui.exists && ui.data()?.status === "COMPLETED" && ui.data()?.promotedVariant === "next";
  return { config, enabled, uiDone };
}

function candidateDate(item = {}) {
  const raw = item.dueDate || item.date || item.startsOn || "";
  const match = String(raw).match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] || "";
}

async function classCandidates(root, classKey, date) {
  const tomorrow = addDays(date, 1);
  const [assignmentsSnap, eventsSnap, noticesSnap] = await Promise.all([
    root.collection("classAssignments").where("classKey","==",classKey).get(),
    root.collection("events").where("classKey","==",classKey).get(),
    root.collection("announcements").where("classKey","==",classKey).get(),
  ]);

  const rows = [];
  for (const doc of assignmentsSnap.docs) {
    const item = doc.data();
    if (item.deleted || item.published === false) continue;
    const due = candidateDate(item);
    if (![date,tomorrow].includes(due)) continue;
    const category = item.type === "preparation" ? "materials" : "assignment";
    rows.push({
      key: `assignment:${doc.id}`,
      category,
      title: category === "materials" ? "준비물 확인" : "수행평가 확인",
      body: [item.subject, item.title].filter(Boolean).join(" · ").slice(0,220),
      targetRoute: "schedule",
      due,
    });
  }
  for (const doc of eventsSnap.docs) {
    const item = doc.data();
    if (item.deleted || item.status === "draft") continue;
    const due = candidateDate(item);
    if (![date,tomorrow].includes(due)) continue;
    rows.push({
      key: `event:${doc.id}`,
      category: "class_notice",
      title: "학급 일정 확인",
      body: String(item.title || item.question || "다가오는 학급 일정").slice(0,220),
      targetRoute: "classroom",
      due,
    });
  }
  for (const doc of noticesSnap.docs) {
    const item = doc.data();
    if (item.deleted || item.priority === "urgent" || item.priority === "critical") continue;
    const createdAtMs = Number(item.createdAtMs || 0);
    if (createdAtMs < Date.now() - 24 * 60 * 60 * 1000) continue;
    rows.push({
      key: `notice:${doc.id}`,
      category: "class_notice",
      title: "새 학급 공지",
      body: String(item.title || "새 공지가 있습니다.").slice(0,220),
      targetRoute: "classroom",
      due: date,
    });
  }
  return rows.sort((a,b) => String(a.due).localeCompare(String(b.due)) || a.key.localeCompare(b.key));
}

function eventRecord({ anonymousParticipant, config, condition, type, notificationId: id, category, now }) {
  return {
    schemaVersion: 1,
    eventId: `server_${digest(`${type}:${id}`,28)}`,
    anonymousParticipant,
    experimentId: EXPERIMENT_ID,
    experimentVersion: Number(config.version || 1),
    variant: condition,
    eventType: type,
    timestampMs: now.getTime(),
    sessionId: "server-notification",
    deviceCategory: "server",
    properties: { notificationId: id, condition, category },
  };
}

export async function dispatchNotificationFrequencyExperiment({ db, messaging, now = new Date() }) {
  const root = db.collection("schools").doc(SCHOOL_ID);
  const ready = await experimentReady(root);
  if (!ready.config || !ready.enabled || !ready.uiDone || ready.config.status !== "ACTIVE") {
    return { active: false, sent: 0, reason: !ready.uiDone ? "ui-experiment-not-completed" : "inactive" };
  }

  const period = conditionFor(["LOW","MID","HIGH"], ready.config, now);
  const slot = currentSlot(now);
  if (period.phase !== "EXPERIMENT" || !slot) {
    return { active: true, sent: 0, phase: period.phase, slot: slot?.index ?? null };
  }

  const subscriptions = await root.collection("pushSubscriptions").where("enabled","==",true).get();
  const owned = subscriptions.docs.filter((doc) => Boolean(doc.data()?.ownerUid));
  const byClass = new Map();
  for (const doc of owned) {
    const classKey = String(doc.data()?.classKey || "");
    const list = byClass.get(classKey) || [];
    list.push(doc);
    byClass.set(classKey, list);
  }

  const date = kstDate(now);
  let sent = 0;
  let scheduled = 0;
  const candidateCache = new Map();

  for (const [classKey, docs] of byClass) {
    const candidates = candidateCache.get(classKey) || await classCandidates(root, classKey, date);
    candidateCache.set(classKey, candidates);
    if (!candidates.length) continue;

    for (const subscription of docs) {
      const uid = subscription.data().ownerUid;
      const participant = await ensureParticipant(root, uid);
      const assignment = await ensureAssignment(root, uid, participant, ready.config);
      const state = conditionFor(assignment.sequence, ready.config, now);
      const condition = state.condition;
      if (!condition || !eligibleForSlot(condition, slot, ready.config)) continue;

      const budget = dailyBudget(condition, ready.config);
      const candidate = candidates[Math.min(slot.index, candidates.length - 1)];
      if (!candidate) continue;

      const id = notificationId({
        anonymousParticipant: participant,
        date,
        period: state.period,
        slotIndex: slot.index,
        candidateKey: candidate.key,
      });
      const receipt = root.collection("notificationExperimentReceipts").doc(id);
      if ((await receipt.get()).exists) continue;

      const scheduledAtMs = now.getTime();
      const metadata = {
        notificationId: id,
        anonymousParticipant: participant,
        experimentId: EXPERIMENT_ID,
        experimentVersion: Number(ready.config.version || 1),
        period: state.period,
        condition,
        category: candidate.category,
        priority: "normal",
        experimentEligible: true,
        targetRoute: candidate.targetRoute,
        createdAtMs: scheduledAtMs,
        scheduledAtMs,
        dailyBudget: budget,
      };

      const batch = db.batch();
      batch.set(root.collection("experimentNotifications").doc(id), metadata);
      batch.set(root.collection("experimentEvents").doc(`server_${digest(`notification_scheduled:${id}`,28)}`),
        eventRecord({ anonymousParticipant: participant, config: ready.config, condition, type: "notification_scheduled", notificationId: id, category: candidate.category, now }));
      batch.set(receipt, { ...metadata, status: "scheduled", createdAt: FieldValue.serverTimestamp() });
      await batch.commit();
      scheduled += 1;

      try {
        await messaging.send({
          token: subscription.data().token,
          data: {
            title: candidate.title,
            body: candidate.body || "PinCon에서 확인해 주세요.",
            tag: id,
            link: `https://pincon.app/next/#${candidate.targetRoute}`,
            route: candidate.targetRoute,
            notificationId: id,
            experimentId: EXPERIMENT_ID,
            condition,
            category: candidate.category,
            targetRoute: candidate.targetRoute,
            scheduledAtMs: String(scheduledAtMs),
          },
          webpush: { headers: { Urgency: "normal" } },
        });
        sent += 1;
        await Promise.all([
          receipt.set({ status: "fcm-accepted", sentAtMs: Date.now() }, { merge: true }),
          root.collection("experimentEvents").doc(`server_${digest(`notification_sent:${id}`,28)}`).set(
            eventRecord({ anonymousParticipant: participant, config: ready.config, condition, type: "notification_sent", notificationId: id, category: candidate.category, now: new Date() }),
          ),
        ]);
      } catch (error) {
        await receipt.set({ status: "send-failed", errorCode: String(error?.code || "unknown").slice(0,80), failedAtMs: Date.now() }, { merge: true });
      }
    }
  }

  return { active: true, phase: period.phase, period: period.period, slot: slot.index, participants: owned.length, scheduled, sent };
}
