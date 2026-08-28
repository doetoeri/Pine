import { firestore } from "../../lib/firebase.mjs";
import { corsHeaders, requireProfile } from "../../lib/class-accounts.mjs";
import { canManagePhone, dateKey, phoneStatus, safeText } from "../../lib/class-operations.mjs";
import {
  appendOpsAudit,
  classSettings,
  classUsers,
  document,
  phoneStateId,
  phoneStates,
} from "../../lib/class-ops-store.mjs";
import { jsonBody, sendJson } from "../../lib/request.mjs";

function assertPhoneManager(allowed) {
  if (!allowed) throw Object.assign(new Error("phone-management-denied"), { status: 403 });
}

function statusCounts(users, states) {
  const map = new Map(states.map((item) => [item.userUid, item]));
  const counts = {
    total: users.length,
    submitted: 0,
    notSubmitted: 0,
    notBrought: 0,
    teacherApproved: 0,
    absent: 0,
    earlyLeave: 0,
    checkRequired: 0,
    returned: 0,
    notReturned: 0,
  };
  for (const user of users) {
    const state = map.get(user.uid);
    const status = state?.status || "NOT_SUBMITTED";
    if (status === "SUBMITTED") counts.submitted += 1;
    else if (status === "NOT_BROUGHT") counts.notBrought += 1;
    else if (status === "TEACHER_APPROVED") counts.teacherApproved += 1;
    else if (status === "ABSENT") counts.absent += 1;
    else if (status === "EARLY_LEAVE") counts.earlyLeave += 1;
    else if (status === "CHECK_REQUIRED") counts.checkRequired += 1;
    else counts.notSubmitted += 1;
    if (state?.returned === true) counts.returned += 1;
  }
  counts.notReturned = Math.max(0, counts.submitted - counts.returned);
  return counts;
}

async function view(actor, date) {
  const allowed = await canManagePhone(actor);
  assertPhoneManager(allowed);
  const [users, states, settings, sessionSnapshot] = await Promise.all([
    classUsers(actor.classKey),
    phoneStates(actor.classKey, date),
    classSettings(actor.classKey),
    document("phoneSessions", `${actor.classKey}_${date}`).get(),
  ]);
  const map = new Map(states.map((item) => [item.userUid, item]));
  return {
    date,
    policy: settings.phoneMovementPolicy,
    session: sessionSnapshot.exists ? { id: sessionSnapshot.id, ...sessionSnapshot.data() } : null,
    counts: statusCounts(users, states),
    students: users.map((user) => ({
      uid: user.uid,
      studentNumber: user.studentNumber,
      name: user.name,
      number: user.number,
      state: map.get(user.uid) || {
        status: "NOT_SUBMITTED",
        submittedAtMs: null,
        returned: false,
        returnedAtMs: null,
      },
    })),
  };
}

async function bulkSubmit(actor, date) {
  assertPhoneManager(await canManagePhone(actor));
  const users = await classUsers(actor.classKey);
  const existing = await phoneStates(actor.classKey, date);
  const byUid = new Map(existing.map((item) => [item.userUid, item]));
  const now = Date.now();
  const batch = firestore().batch();
  let changed = 0;
  for (const user of users) {
    const before = byUid.get(user.uid);
    if (["ABSENT", "NOT_BROUGHT", "TEACHER_APPROVED", "EARLY_LEAVE"].includes(before?.status)) continue;
    const id = phoneStateId(actor.classKey, date, user.uid);
    batch.set(document("phoneStates", id), {
      schemaVersion: 1,
      classKey: actor.classKey,
      date,
      userUid: user.uid,
      studentNumber: user.studentNumber,
      name: safeText(user.name, 30),
      number: Number(user.number || 0),
      status: "SUBMITTED",
      submittedAtMs: before?.submittedAtMs || now,
      verifiedByUid: actor.uid,
      verifiedByName: safeText(actor.name, 30),
      returned: before?.returned === true,
      returnedAtMs: before?.returnedAtMs || null,
      updatedAtMs: now,
    }, { merge: true });
    changed += 1;
  }
  await batch.commit();
  await appendOpsAudit({ actor, action: "PHONE_BULK_SUBMIT", collectionName: "phoneStates", recordId: `${actor.classKey}_${date}`, after: { classKey: actor.classKey, date, changed }, note: `전체 제출 처리 ${changed}명` });
  return view(actor, date);
}

async function setStatus(actor, body, date) {
  assertPhoneManager(await canManagePhone(actor));
  const userUid = safeText(body.userUid, 128);
  const userSnapshot = await document("users", userUid).get();
  if (!userSnapshot.exists) throw Object.assign(new Error("student-not-found"), { status: 404 });
  const user = { uid: userSnapshot.id, ...userSnapshot.data() };
  if (user.classKey !== actor.classKey || user.status !== "ACTIVE") throw Object.assign(new Error("class-scope-denied"), { status: 403 });
  const status = phoneStatus(body.status);
  const id = phoneStateId(actor.classKey, date, user.uid);
  const ref = document("phoneStates", id);
  const snapshot = await ref.get();
  const before = snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
  const now = Date.now();
  const after = {
    schemaVersion: 1,
    classKey: actor.classKey,
    date,
    userUid: user.uid,
    studentNumber: user.studentNumber,
    name: safeText(user.name, 30),
    number: Number(user.number || 0),
    status,
    submittedAtMs: status === "SUBMITTED" ? (before?.submittedAtMs || now) : null,
    statusNote: safeText(body.note, 120),
    verifiedByUid: actor.uid,
    verifiedByName: safeText(actor.name, 30),
    returned: status === "SUBMITTED" ? before?.returned === true : false,
    returnedAtMs: status === "SUBMITTED" ? before?.returnedAtMs || null : null,
    updatedAtMs: now,
  };
  await ref.set(after, { merge: false });
  await appendOpsAudit({ actor, action: "PHONE_STATUS_SET", collectionName: "phoneStates", recordId: id, before, after });
  return { id, ...after };
}

async function startReturn(actor, date) {
  assertPhoneManager(await canManagePhone(actor));
  const id = `${actor.classKey}_${date}`;
  const ref = document("phoneSessions", id);
  const beforeSnapshot = await ref.get();
  const before = beforeSnapshot.exists ? { id: beforeSnapshot.id, ...beforeSnapshot.data() } : null;
  const after = {
    schemaVersion: 1,
    classKey: actor.classKey,
    date,
    phase: "RETURN",
    returnStartedAtMs: Date.now(),
    returnStartedByUid: actor.uid,
    returnStartedByName: safeText(actor.name, 30),
    updatedAtMs: Date.now(),
  };
  await ref.set(after, { merge: true });
  await appendOpsAudit({ actor, action: "PHONE_RETURN_START", collectionName: "phoneSessions", recordId: id, before, after });
  return view(actor, date);
}

async function markReturned(actor, body, date) {
  assertPhoneManager(await canManagePhone(actor));
  const userUid = safeText(body.userUid, 128);
  const id = phoneStateId(actor.classKey, date, userUid);
  const ref = document("phoneStates", id);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw Object.assign(new Error("phone-state-not-found"), { status: 404 });
  const before = { id: snapshot.id, ...snapshot.data() };
  if (before.classKey !== actor.classKey || before.status !== "SUBMITTED") throw Object.assign(new Error("phone-return-not-applicable"), { status: 409 });
  const returned = body.returned !== false;
  const after = {
    ...before,
    returned,
    returnedAtMs: returned ? Date.now() : null,
    returnVerifiedByUid: actor.uid,
    returnVerifiedByName: safeText(actor.name, 30),
    updatedAtMs: Date.now(),
  };
  delete after.id;
  await ref.set(after, { merge: false });
  await appendOpsAudit({ actor, action: returned ? "PHONE_RETURNED" : "PHONE_RETURN_UNDO", collectionName: "phoneStates", recordId: id, before, after });
  return { id, ...after };
}

export default async function phone(req, res) {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return sendJson(res, 204, {}, headers);
  try {
    const { profile: actor } = await requireProfile(req);
    const url = new URL(req.url || "/", "https://pincon.invalid");
    const rawDate = req.method === "GET" ? url.searchParams.get("date") : "";
    if (req.method === "GET") {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate || "") ? rawDate : dateKey();
      return sendJson(res, 200, await view(actor, date), headers);
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "method-not-allowed" }, headers);
    const body = await jsonBody(req);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || "") ? body.date : dateKey();
    const action = String(body.action || "").toUpperCase();
    let result;
    if (action === "BULK_SUBMIT") result = await bulkSubmit(actor, date);
    else if (action === "SET_STATUS") result = await setStatus(actor, body, date);
    else if (action === "START_RETURN") result = await startReturn(actor, date);
    else if (action === "MARK_RETURNED") result = await markReturned(actor, body, date);
    else throw Object.assign(new Error("unsupported-action"), { status: 400 });
    return sendJson(res, 200, result, headers);
  } catch (error) {
    return sendJson(res, error?.status || 500, { error: error?.message || "phone-operation-failed" }, headers);
  }
}
