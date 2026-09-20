import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import {
  candidateIndexForSlot,
  conditionFor,
  currentSlot,
  dailyBudget,
  digest,
  eligibleForSlot,
  kstDate,
  notificationId,
  plannedSlotIndexes,
  sequenceFor,
} from "./notification-frequency-core.mjs";

const SCHOOL_ID = "gochon-high";
const EXPERIMENT_ID = "notification-frequency";
const UI_EXPERIMENT_ID = "pincon-next-ui";
const MAX_SEND_ATTEMPTS = 3;

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

function eventRecord({
  anonymousParticipant, config, condition, period, type, notificationId: id, category, targetRoute = "", slotIndex = -1, now,
}) {
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
    properties: {
      notificationId: id,
      condition,
      category,
      period: Number(period || 0),
      targetRoute,
      slotIndex: Number(slotIndex),
    },
  };
}

function canonicalSubscriptions(documents = []) {
  const byOwner = new Map();
  for (const document of documents) {
    const data = document.data();
    const uid = String(data?.ownerUid || "");
    if (!uid || data?.enabled !== true || data?.preferences?.notificationExperiment === false) continue;
    const current = byOwner.get(uid);
    const currentMs = Number(current?.data()?.updatedAtMs || 0);
    const nextMs = Number(data?.updatedAtMs || 0);
    if (!current || nextMs > currentMs || (nextMs === currentMs && document.id > current.id)) {
      byOwner.set(uid, document);
    }
  }
  return [...byOwner.values()];
}

function isInvalidTokenError(error) {
  const code = String(error?.code || "");
  return code.includes("registration-token-not-registered")
    || code.includes("invalid-registration-token");
}

function canRetryReceipt(data = {}) {
  if (!data || !Object.keys(data).length) return true;
  if (data.status === "fcm-accepted" || data.status === "permanent-failure") return false;
  return Number(data.attemptCount || 0) < MAX_SEND_ATTEMPTS;
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
  const targetClassKeys = new Set(
    (Array.isArray(ready.config.targetClassKeys) ? ready.config.targetClassKeys : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  );
  const eligibleSubscriptions = canonicalSubscriptions(subscriptions.docs)
    .filter((document) => !targetClassKeys.size || targetClassKeys.has(String(document.data()?.classKey || "")));
  const date = kstDate(now);
  const candidateCache = new Map();
  let sent = 0;
  let scheduled = 0;
  let retried = 0;
  let failed = 0;
  let invalidTokens = 0;
  let skippedNoCandidate = 0;

  for (const subscription of eligibleSubscriptions) {
    const sub = subscription.data();
    const uid = String(sub.ownerUid || "");
    const classKey = String(sub.classKey || "");
    if (!uid || !classKey || !sub.token) continue;

    const participant = await ensureParticipant(root, uid);
    const assignment = await ensureAssignment(root, uid, participant, ready.config);
    const state = conditionFor(assignment.sequence, ready.config, now);
    const condition = state.condition;
    if (!condition || !eligibleForSlot(condition, slot, ready.config, {
      anonymousParticipant: participant,
      date,
      period: state.period,
    })) continue;

    let candidates = candidateCache.get(classKey);
    if (!candidates) {
      candidates = await classCandidates(root, classKey, date);
      candidateCache.set(classKey, candidates);
    }
    const candidateIndex = candidateIndexForSlot({
      anonymousParticipant: participant,
      date,
      period: state.period,
      condition,
      slotIndex: slot.index,
      candidateCount: candidates.length,
      config: ready.config,
    });
    if (candidateIndex < 0) {
      skippedNoCandidate += 1;
      continue;
    }
    const candidate = candidates[candidateIndex];
    if (!candidate) {
      skippedNoCandidate += 1;
      continue;
    }

    const id = notificationId({
      anonymousParticipant: participant,
      date,
      period: state.period,
      slotIndex: slot.index,
      candidateKey: candidate.key,
    });
    const receipt = root.collection("notificationExperimentReceipts").doc(id);
    const receiptSnap = await receipt.get();
    const priorReceipt = receiptSnap.exists ? receiptSnap.data() : null;
    if (!canRetryReceipt(priorReceipt)) continue;

    const scheduledAtMs = Number(priorReceipt?.scheduledAtMs || now.getTime());
    const attemptCount = Number(priorReceipt?.attemptCount || 0) + 1;
    const budget = dailyBudget(condition, ready.config);
    const plannedSlots = plannedSlotIndexes({
      anonymousParticipant: participant,
      date,
      period: state.period,
      condition,
      config: ready.config,
    });
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
      slotIndex: slot.index,
      plannedSlots,
      dailyBudget: budget,
      candidateKey: candidate.key,
    };

    if (!receiptSnap.exists) {
      const batch = db.batch();
      batch.set(root.collection("experimentNotifications").doc(id), metadata);
      batch.set(
        root.collection("experimentEvents").doc(`server_${digest(`notification_scheduled:${id}`,28)}`),
        eventRecord({
          anonymousParticipant: participant,
          config: ready.config,
          condition,
          period: state.period,
          type: "notification_scheduled",
          notificationId: id,
          category: candidate.category,
          targetRoute: candidate.targetRoute,
          slotIndex: slot.index,
          now,
        }),
      );
      batch.set(receipt, {
        ...metadata,
        status: "scheduled",
        attemptCount: 0,
        createdAt: FieldValue.serverTimestamp(),
      });
      await batch.commit();
      scheduled += 1;
    } else {
      retried += 1;
    }

    const attemptedAtMs = Date.now();
    await receipt.set({
      status: "sending",
      attemptCount,
      lastAttemptAtMs: attemptedAtMs,
    }, { merge: true });

    try {
      await messaging.send({
        token: sub.token,
        data: {
          title: candidate.title,
          body: candidate.body || "PinCon에서 확인해 주세요.",
          tag: id,
          link: `https://pincon.app/next/#${candidate.targetRoute}`,
          route: candidate.targetRoute,
          notificationId: id,
          experimentId: EXPERIMENT_ID,
          condition,
          period: String(state.period),
          category: candidate.category,
          targetRoute: candidate.targetRoute,
          scheduledAtMs: String(scheduledAtMs),
          sentAtMs: String(attemptedAtMs),
          slotIndex: String(slot.index),
        },
        webpush: { headers: { Urgency: "normal", TTL: "3600" } },
      });
      sent += 1;
      const acceptedAt = new Date();
      await Promise.all([
        receipt.set({
          status: "fcm-accepted",
          sentAtMs: attemptedAtMs,
          acceptedAtMs: acceptedAt.getTime(),
          errorCode: FieldValue.delete(),
        }, { merge: true }),
        root.collection("experimentEvents").doc(`server_${digest(`notification_sent:${id}`,28)}`).set(
          eventRecord({
            anonymousParticipant: participant,
            config: ready.config,
            condition,
            period: state.period,
            type: "notification_sent",
            notificationId: id,
            category: candidate.category,
            targetRoute: candidate.targetRoute,
            slotIndex: slot.index,
            now: acceptedAt,
          }),
        ),
      ]);
    } catch (error) {
      failed += 1;
      const errorCode = String(error?.code || "unknown").slice(0,80);
      const permanent = isInvalidTokenError(error);
      if (permanent) {
        invalidTokens += 1;
        await subscription.ref.delete().catch(() => {});
      }
      await Promise.all([
        receipt.set({
          status: permanent ? "permanent-failure" : "send-failed",
          errorCode,
          failedAtMs: Date.now(),
          attemptCount,
        }, { merge: true }),
        root.collection("experimentEvents").doc(`server_${digest(`fcm_failure:${id}:a${attemptCount}`,28)}`).set(
          eventRecord({
            anonymousParticipant: participant,
            config: ready.config,
            condition,
            period: state.period,
            type: "fcm_failure",
            notificationId: id,
            category: candidate.category,
            targetRoute: candidate.targetRoute,
            slotIndex: slot.index,
            now: new Date(),
          }),
        ),
      ]);
    }
  }

  return {
    active: true,
    phase: period.phase,
    period: period.period,
    slot: slot.index,
    rawSubscriptions: subscriptions.size,
    targetClassKeys: [...targetClassKeys],
    participants: eligibleSubscriptions.length,
    scheduled,
    sent,
    retried,
    failed,
    invalidTokens,
    skippedNoCandidate,
  };
}
