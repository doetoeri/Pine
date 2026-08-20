import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const SCHOOL_ID = "gochon-high";
const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || "studio-2803086992-2d4cf.firebasestorage.app";
const DEFAULT_PREFERENCES = Object.freeze({
  assessmentTomorrow: true,
  assessmentToday: true,
  importantPreparation: true,
  timetableChange: true,
  eventStart: true,
  pollClosing: true,
  urgentAnnouncement: true,
});

const TRASH_COLLECTIONS = Object.freeze([
  "announcements",
  "classAssignments",
  "events",
  "polls",
  "supplies",
  "supplyLoans",
  "lostItems",
  "resources",
  "patchNotes",
  "patchNoteDrafts",
]);

function kstParts(now = new Date()) {
  const shifted = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return {
    date: shifted.toISOString().slice(0, 10),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function addDays(date, amount) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + amount);
  return next.toISOString().slice(0, 10);
}

function dateFromMs(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return new Date(amount + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function inWindow(hour, minute, startHour, endHour) {
  const current = hour * 60 + minute;
  return current >= startHour * 60 && current < endHour * 60;
}

async function queryRows(collection, field, operator, value) {
  const snapshot = await collection.where(field, operator, value).get();
  return snapshot.docs.map((document) => ({ id: document.id, ref: document.ref, ...document.data() }));
}

async function classKeysWithSubscriptions(root) {
  const snapshot = await root.collection("pushSubscriptions").where("enabled", "==", true).get();
  return {
    documents: snapshot.docs,
    classKeys: [...new Set(snapshot.docs.map((document) => document.data().classKey).filter(Boolean))],
  };
}

function preferenceFor(item) {
  return item.preference || "urgentAnnouncement";
}

async function sendGrouped({ messaging, subscriptionDocs, items, title, link }) {
  const groups = new Map();
  for (const document of subscriptionDocs) {
    const data = document.data();
    const preferences = { ...DEFAULT_PREFERENCES, ...(data.preferences || {}) };
    const allowed = items.filter((item) => preferences[preferenceFor(item)] !== false);
    if (!allowed.length) continue;
    const body = allowed.slice(0, 5).map((item) => item.line).join("\n");
    const key = digest(body);
    const group = groups.get(key) || { body, documents: [] };
    group.documents.push(document);
    groups.set(key, group);
  }

  let sent = 0;
  for (const group of groups.values()) {
    for (let index = 0; index < group.documents.length; index += 500) {
      const batch = group.documents.slice(index, index + 500);
      const response = await messaging.sendEachForMulticast({
        tokens: batch.map((document) => document.data().token),
        data: {
          title,
          body: group.body,
          tag: `pincon-class-ops-${digest(`${title}:${group.body}`)}`,
          link,
        },
        webpush: { headers: { Urgency: items.some((item) => item.urgent) ? "high" : "normal" } },
      });
      sent += response.successCount;
      await Promise.all(response.responses.flatMap((result, responseIndex) => {
        const code = result.error?.code || "";
        return code.includes("registration-token-not-registered") || code.includes("invalid-registration-token")
          ? [batch[responseIndex].ref.delete()]
          : [];
      }));
    }
  }
  return sent;
}

async function sendOnce({ root, messaging, classKey, key, title, items, subscriptionDocs }) {
  if (!items.length) return 0;
  const receiptRef = root.collection("notificationReceipts").doc(`${classKey}-${digest(key)}`);
  if ((await receiptRef.get()).exists) return 0;
  const sent = await sendGrouped({
    messaging,
    subscriptionDocs: subscriptionDocs.filter((document) => document.data().classKey === classKey),
    items,
    title,
    link: "https://pincon.app/?class-ops=1",
  });
  await receiptRef.set({
    classKey,
    key,
    title,
    lines: items.map((item) => item.line),
    sent,
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: Date.now(),
  });
  return sent;
}

export async function dispatchClassOpsNotifications({ db, messaging, now = new Date() }) {
  const root = db.collection("schools").doc(SCHOOL_ID);
  const { documents: subscriptionDocs, classKeys } = await classKeysWithSubscriptions(root);
  if (!classKeys.length) return { classes: 0, sent: 0, windows: [] };

  const clock = kstParts(now);
  const tomorrow = addDays(clock.date, 1);
  const morning = inWindow(clock.hour, clock.minute, 6, 9);
  const evening = inWindow(clock.hour, clock.minute, 18, 22);
  let sent = 0;
  const windows = [];

  for (const classKey of classKeys) {
    const [assignments, events, polls, announcements] = await Promise.all([
      queryRows(root.collection("classAssignments"), "classKey", "==", classKey),
      queryRows(root.collection("events"), "classKey", "==", classKey),
      queryRows(root.collection("polls"), "classKey", "==", classKey),
      queryRows(root.collection("announcements"), "classKey", "==", classKey),
    ]);

    if (morning) {
      const items = assignments.filter((item) => !item.deleted && item.dueDate === clock.date).flatMap((item) => {
        if (item.type === "assessment" || item.type === "exam") return [{ preference: "assessmentToday", line: `${item.subject ? `${item.subject} ` : ""}${item.title}`, urgent: true }];
        if (item.type === "preparation" && item.important) return [{ preference: "importantPreparation", line: `준비물: ${item.title}`, urgent: true }];
        return [];
      });
      items.push(...events.filter((item) => !item.deleted && item.status === "open" && (item.date || dateFromMs(item.startsAtMs)) === clock.date).map((item) => ({ preference: "eventStart", line: `행사: ${item.title}` })));
      sent += await sendOnce({ root, messaging, classKey, key: `morning:${clock.date}:${items.map((item) => item.line).join("|")}`, title: "오늘 우리 반", items, subscriptionDocs });
      if (items.length) windows.push(`${classKey}:morning`);
    }

    if (evening) {
      const items = assignments.filter((item) => !item.deleted && item.dueDate === tomorrow).flatMap((item) => {
        if (item.type === "assessment" || item.type === "exam") return [{ preference: "assessmentTomorrow", line: `${item.subject ? `${item.subject} ` : ""}${item.title}` }];
        if (item.type === "preparation" && item.important) return [{ preference: "importantPreparation", line: `준비물: ${item.title}` }];
        return [];
      });
      items.push(...polls.filter((item) => !item.deleted && item.official === true && item.status === "open" && dateFromMs(item.closesAtMs) === tomorrow).map((item) => ({ preference: "pollClosing", line: `투표 마감: ${item.question}` })));
      sent += await sendOnce({ root, messaging, classKey, key: `evening:${clock.date}:${items.map((item) => item.line).join("|")}`, title: "내일 우리 반", items, subscriptionDocs });
      if (items.length) windows.push(`${classKey}:evening`);
    }

    const recentUrgent = announcements.filter((item) => !item.deleted && item.priority === "urgent" && Number(item.createdAtMs || 0) >= now.getTime() - 90 * 60 * 1000);
    for (const item of recentUrgent) {
      sent += await sendOnce({
        root,
        messaging,
        classKey,
        key: `urgent:${item.id}:${item.updatedAtMs || item.createdAtMs}`,
        title: "회장 긴급 공지",
        items: [{ preference: "urgentAnnouncement", line: item.title, urgent: true }],
        subscriptionDocs,
      });
    }
  }

  return { classes: classKeys.length, sent, windows };
}

export async function closeExpiredClassOps({ db, now = new Date() }) {
  const root = db.collection("schools").doc(SCHOOL_ID);
  const nowMs = now.getTime();
  const definitions = [
    { collection: "events", deadline: "endsAtMs", extra: { acceptingResponses: false } },
    { collection: "polls", deadline: "closesAtMs", extra: {} },
  ];
  const writer = db.bulkWriter();
  const closed = { events: 0, polls: 0 };
  for (const definition of definitions) {
    const snapshot = await root.collection(definition.collection).where("status", "==", "open").limit(250).get();
    for (const document of snapshot.docs) {
      const data = document.data();
      const deadline = Number(data[definition.deadline] || 0);
      if (data.deleted || !deadline || deadline >= nowMs) continue;
      const after = { status: "closed", ...definition.extra, updatedAtMs: nowMs, updatedAt: FieldValue.serverTimestamp() };
      writer.update(document.ref, after);
      writer.set(root.collection("changeLogs").doc(), {
        classKey: data.classKey,
        collection: definition.collection,
        documentId: document.id,
        action: "update",
        label: `${data.title || data.question || "학급 운영 항목"} 자동 마감`,
        before: { title: data.title || "", question: data.question || "", status: data.status, [definition.deadline]: deadline },
        after: { title: data.title || "", question: data.question || "", status: "closed", [definition.deadline]: deadline },
        actorUid: "system",
        actorName: "PinCon 자동화",
        createdAtMs: nowMs,
        createdAt: FieldValue.serverTimestamp(),
      });
      closed[definition.collection] += 1;
    }
  }
  await writer.close();
  return closed;
}

export async function purgeExpiredClassOpsTrash({ db, now = new Date(), retentionDays = 30 }) {
  const cutoff = now.getTime() - retentionDays * 86_400_000;
  const root = db.collection("schools").doc(SCHOOL_ID);
  const writer = db.bulkWriter();
  const storagePaths = [];
  let deleted = 0;
  let deletedResponses = 0;
  for (const name of TRASH_COLLECTIONS) {
    const snapshot = await root.collection(name).where("deletedAtMs", "<", cutoff).limit(200).get();
    for (const document of snapshot.docs) {
      if (document.data().deleted !== true) continue;
      if (document.data().storagePath) storagePaths.push(document.data().storagePath);
      if (name === "events") {
        const responses = await root.collection("eventResponses").where("eventId", "==", document.id).get();
        for (const response of responses.docs) {
          writer.delete(response.ref);
          deletedResponses += 1;
        }
      }
      if (name === "polls") {
        const votes = await document.ref.collection("votes").get();
        for (const vote of votes.docs) {
          writer.delete(vote.ref);
          deletedResponses += 1;
        }
      }
      if (name === "supplies") {
        const [reports, loans] = await Promise.all([
          root.collection("supplyReports").where("supplyId", "==", document.id).get(),
          root.collection("supplyLoans").where("supplyId", "==", document.id).get(),
        ]);
        for (const related of [...reports.docs, ...loans.docs]) {
          writer.delete(related.ref);
          deletedResponses += 1;
        }
      }
      writer.delete(document.ref);
      deleted += 1;
    }
  }
  await writer.close();
  if (storagePaths.length) {
    const bucket = getStorage().bucket(STORAGE_BUCKET);
    await Promise.all(storagePaths.map((path) => bucket.file(path).delete({ ignoreNotFound: true })));
  }
  return { retentionDays, deleted, deletedFiles: storagePaths.length, deletedResponses };
}
