import { firestore, firebaseMessaging } from "../../lib/firebase.mjs";
import {
  SCHOOL_ID,
  assertSameClass,
  corsHeaders,
  isClassOperator,
  profileForUid,
  publicProfile,
  requireProfileOrLegacy,
} from "../../lib/class-accounts.mjs";
import { jsonBody, sendJson } from "../../lib/request.mjs";

const collection = () => firestore().collection(`schools/${SCHOOL_ID}/personalNotifications`);
const announcements = () => firestore().collection(`schools/${SCHOOL_ID}/announcements`);
const users = () => firestore().collection(`schools/${SCHOOL_ID}/users`);
const subscriptions = () => firestore().collection(`schools/${SCHOOL_ID}/pushSubscriptions`);

function text(value, max) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function priority(value) {
  const normalized = String(value || "normal").toLowerCase();
  return ["normal", "important", "urgent"].includes(normalized) ? normalized : "normal";
}

function publicNotification(doc) {
  const data = typeof doc.data === "function" ? doc.data() : doc;
  return {
    id: doc.id || data.id || "",
    title: text(data.title, 100),
    body: text(data.body, 800),
    priority: priority(data.priority),
    important: data.important === true,
    createdAtMs: Number(data.createdAtMs || 0),
    updatedAtMs: Number(data.updatedAtMs || data.createdAtMs || 0),
    classKey: String(data.classKey || ""),
  };
}

async function listOwn(profile) {
  const snapshot = await collection()
    .where("targetUid", "==", profile.uid)
    .where("classKey", "==", profile.classKey)
    .limit(80)
    .get();
  return snapshot.docs
    .map(publicNotification)
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
}

async function activeRecipients(classKey) {
  const snapshot = await users().where("classKey", "==", classKey).limit(100).get();
  return snapshot.docs
    .map((doc) => publicProfile({ id: doc.id, ...doc.data() }))
    .filter((item) => item && item.uid && item.status === "ACTIVE")
    .sort((a, b) => Number(a.number || 0) - Number(b.number || 0));
}

async function listRecipients(actor) {
  if (!isClassOperator(actor)) throw Object.assign(new Error("class-operator-required"), { status: 403 });
  return activeRecipients(actor.classKey);
}

async function migrateLegacy(actor) {
  if (!isClassOperator(actor)) return 0;
  const legacy = await announcements()
    .where("classKey", "==", actor.classKey)
    .where("personalNotification", "==", true)
    .limit(80)
    .get();
  if (legacy.empty) return 0;

  const recipientSnapshot = await users().where("classKey", "==", actor.classKey).limit(80).get();
  const byStudentNumber = new Map(recipientSnapshot.docs.map((doc) => {
    const data = doc.data();
    return [String(data.studentNumber || ""), { uid: doc.id, ...data }];
  }));

  const batch = firestore().batch();
  let moved = 0;
  for (const doc of legacy.docs) {
    const data = doc.data();
    const target = byStudentNumber.get(String(data.targetStudentNumber || ""));
    if (!target?.uid) continue;
    const privateRef = collection().doc(`legacy-${doc.id}`);
    batch.set(privateRef, {
      schoolId: SCHOOL_ID,
      classKey: actor.classKey,
      targetUid: target.uid,
      targetStudentNumber: target.studentNumber,
      title: text(data.title, 100),
      body: text(data.body, 800),
      priority: priority(data.priority),
      important: data.important === true || priority(data.priority) !== "normal",
      createdAtMs: Number(data.createdAtMs || Date.now()),
      updatedAtMs: Number(data.updatedAtMs || data.createdAtMs || Date.now()),
      createdByUid: String(data.createdByUid || data.authorUid || actor.uid),
      migratedFromAnnouncementId: doc.id,
    }, { merge: true });
    batch.delete(doc.ref);
    moved += 1;
  }
  if (moved) await batch.commit();
  return moved;
}

function notificationRecord(actor, target, body, broadcastId = "") {
  const title = text(body.title, 100);
  if (!title) throw Object.assign(new Error("title-required"), { status: 400 });
  const message = text(body.body, 800);
  const level = priority(body.priority);
  const now = Date.now();
  return {
    schoolId: SCHOOL_ID,
    classKey: actor.classKey,
    targetUid: target.uid,
    targetStudentNumber: target.studentNumber || "",
    title,
    body: message,
    priority: level,
    important: level !== "normal",
    createdAtMs: now,
    updatedAtMs: now,
    createdByUid: actor.uid,
    createdByName: text(actor.name, 40),
    broadcast: Boolean(broadcastId),
    broadcastId,
  };
}

async function sendPushToClass(actor, body) {
  const snapshot = await subscriptions()
    .where("classKey", "==", actor.classKey)
    .where("enabled", "==", true)
    .get();
  const docs = snapshot.docs.filter((doc) => text(doc.data()?.token, 4096));
  if (!docs.length) return { pushSent: 0, pushFailed: 0 };

  const title = text(body.title, 100);
  const message = text(body.body, 800);
  const level = priority(body.priority);
  let pushSent = 0;
  let pushFailed = 0;

  for (let index = 0; index < docs.length; index += 500) {
    const batch = docs.slice(index, index + 500);
    const response = await firebaseMessaging().sendEachForMulticast({
      tokens: batch.map((doc) => doc.data().token),
      data: {
        title,
        body: message,
        tag: `pincon-class-broadcast-${Date.now()}`,
        link: "https://pincon.app/next/#today",
        priority: level,
        broadcast: "true",
      },
      webpush: { headers: { Urgency: level === "urgent" ? "high" : "normal" } },
    });
    pushSent += response.successCount;
    pushFailed += response.failureCount;
    await Promise.all(response.responses.flatMap((result, responseIndex) => {
      const code = result.error?.code || "";
      return code.includes("registration-token-not-registered") || code.includes("invalid-registration-token")
        ? [batch[responseIndex].ref.delete().catch(() => {})]
        : [];
    }));
  }
  return { pushSent, pushFailed };
}

async function sendOne(actor, body) {
  if (!isClassOperator(actor)) throw Object.assign(new Error("class-operator-required"), { status: 403 });
  const targetUid = text(body.targetUid, 128);
  if (!targetUid) throw Object.assign(new Error("target-required"), { status: 400 });
  const target = await profileForUid(targetUid);
  if (!target || target.status !== "ACTIVE") throw Object.assign(new Error("target-not-found"), { status: 404 });
  assertSameClass(actor, target);

  const record = notificationRecord(actor, target, body);
  const ref = collection().doc();
  await ref.set(record);
  return { notification: publicNotification({ id: ref.id, ...record }), recipient: publicProfile(target) };
}

async function sendAll(actor, body) {
  if (!isClassOperator(actor)) throw Object.assign(new Error("class-operator-required"), { status: 403 });
  const targets = await activeRecipients(actor.classKey);
  if (!targets.length) throw Object.assign(new Error("no-active-recipients"), { status: 404 });
  const broadcastId = `class-${actor.classKey}-${Date.now().toString(36)}`;
  const db = firestore();
  const batch = db.batch();
  for (const target of targets) {
    const ref = collection().doc();
    batch.set(ref, notificationRecord(actor, target, body, broadcastId));
  }
  await batch.commit();

  let push = { pushSent: 0, pushFailed: 0 };
  try {
    push = await sendPushToClass(actor, body);
  } catch (error) {
    console.warn("[PinCon] class broadcast push failed", error);
  }

  return {
    broadcastId,
    recipients: targets.length,
    ...push,
  };
}

export default async function personalNotifications(req, res) {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return sendJson(res, 204, {}, headers);
  try {
    const { profile } = await requireProfileOrLegacy(req);
    if (req.method === "GET") {
      const url = new URL(req.url || "/", "https://pincon.invalid");
      if (url.searchParams.get("mode") === "recipients") {
        const migrated = await migrateLegacy(profile);
        return sendJson(res, 200, { recipients: await listRecipients(profile), migrated }, headers);
      }
      return sendJson(res, 200, { notifications: await listOwn(profile) }, headers);
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "method-not-allowed" }, headers);
    const body = await jsonBody(req);
    const mode = String(body.mode || "one").toLowerCase();
    if (mode === "all") return sendJson(res, 200, await sendAll(profile, body), headers);
    return sendJson(res, 200, await sendOne(profile, body), headers);
  } catch (error) {
    return sendJson(res, error?.status || 500, { error: error?.message || "personal-notification-failed" }, headers);
  }
}
