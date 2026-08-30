import { firestore } from "../../lib/firebase.mjs";
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

async function listRecipients(actor) {
  if (!isClassOperator(actor)) throw Object.assign(new Error("class-operator-required"), { status: 403 });
  const snapshot = await firestore().collection(`schools/${SCHOOL_ID}/users`)
    .where("classKey", "==", actor.classKey)
    .limit(80)
    .get();
  return snapshot.docs
    .map((doc) => publicProfile({ id: doc.id, ...doc.data() }))
    .filter((item) => item && item.status === "ACTIVE")
    .sort((a, b) => Number(a.number || 0) - Number(b.number || 0));
}

async function sendOne(actor, body) {
  if (!isClassOperator(actor)) throw Object.assign(new Error("class-operator-required"), { status: 403 });
  const targetUid = text(body.targetUid, 128);
  if (!targetUid) throw Object.assign(new Error("target-required"), { status: 400 });
  const target = await profileForUid(targetUid);
  if (!target || target.status !== "ACTIVE") throw Object.assign(new Error("target-not-found"), { status: 404 });
  assertSameClass(actor, target);

  const title = text(body.title, 100);
  if (!title) throw Object.assign(new Error("title-required"), { status: 400 });
  const message = text(body.body, 800);
  const level = priority(body.priority);
  const now = Date.now();
  const ref = collection().doc();
  const record = {
    schoolId: SCHOOL_ID,
    classKey: actor.classKey,
    targetUid: target.uid,
    targetStudentNumber: target.studentNumber,
    title,
    body: message,
    priority: level,
    important: level !== "normal",
    createdAtMs: now,
    updatedAtMs: now,
    createdByUid: actor.uid,
  };
  await ref.set(record);
  return { notification: publicNotification({ id: ref.id, ...record }), recipient: publicProfile(target) };
}

export default async function personalNotifications(req, res) {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return sendJson(res, 204, {}, headers);
  try {
    const { profile } = await requireProfileOrLegacy(req);
    if (req.method === "GET") {
      const url = new URL(req.url || "/", "https://pincon.invalid");
      if (url.searchParams.get("mode") === "recipients") {
        return sendJson(res, 200, { recipients: await listRecipients(profile) }, headers);
      }
      return sendJson(res, 200, { notifications: await listOwn(profile) }, headers);
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "method-not-allowed" }, headers);
    const body = await jsonBody(req);
    return sendJson(res, 200, await sendOne(profile, body), headers);
  } catch (error) {
    return sendJson(res, error?.status || 500, { error: error?.message || "personal-notification-failed" }, headers);
  }
}
