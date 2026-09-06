import { createHash, randomUUID } from "node:crypto";
import { firebaseAuth, firestore } from "../../lib/firebase.mjs";
import {
  SCHOOL_ID,
  appendAccountAudit,
  assertSameClass,
  corsHeaders,
  isAccountAdmin,
  profileForUid,
  requireProfileOrLegacy,
  syncCompatibilityRole,
} from "../../lib/class-accounts.mjs";
import { jsonBody, sendJson } from "../../lib/request.mjs";

const REQUEST_WINDOW_MS = 10 * 60_000;
const REQUEST_LIMIT = 5;
const PRIVILEGED_ROLES = new Set(["ADMIN", "TEACHER", "CLASS_PRESIDENT"]);
const students = () => firestore().collection(`schools/${SCHOOL_ID}/students`);
const studentRef = (studentNumber) => students().doc(studentNumber);
const requests = () => firestore().collection(`schools/${SCHOOL_ID}/pinResetRequests`);
const requestRef = (studentNumber) => requests().doc(studentNumber);
const sessions = () => firestore().collection(`schools/${SCHOOL_ID}/enrollmentSessions`);
const sessionRef = (sessionId) => sessions().doc(sessionId);
const userRef = (uid) => firestore().doc(`schools/${SCHOOL_ID}/users/${uid}`);
const rateRef = (key) => firestore().doc(`schools/${SCHOOL_ID}/enrollmentRateLimits/${key}`);

function text(value, max = 160) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function validStudentNumber(value) {
  return /^\d{5}$/.test(String(value || "").trim());
}

function requesterIp(req) {
  return text(req?.headers?.["x-forwarded-for"] || req?.headers?.["x-real-ip"] || "unknown", 120).split(",")[0].trim();
}

async function rateLimit(req, clientId) {
  const client = text(clientId, 80);
  if (!client) throw Object.assign(new Error("client-id-required"), { status: 400 });
  const bucket = Math.floor(Date.now() / REQUEST_WINDOW_MS);
  const digest = createHash("sha256").update(`${requesterIp(req)}|${client}|pin-reset|${bucket}`).digest("hex");
  await firestore().runTransaction(async (tx) => {
    const ref = rateRef(digest);
    const snap = await tx.get(ref);
    const count = Number(snap.data()?.count || 0);
    if (count >= REQUEST_LIMIT) throw Object.assign(new Error("too-many-attempts"), { status: 429 });
    tx.set(ref, {
      count: count + 1,
      bucket,
      action: "pin-reset-request",
      expiresAtMs: (bucket + 2) * REQUEST_WINDOW_MS,
      updatedAtMs: Date.now(),
    }, { merge: true });
  });
}

async function requireAdmin(req) {
  const { profile } = await requireProfileOrLegacy(req, { legacyLevels: ["school", "president", "class", "grade"] });
  if (!isAccountAdmin(profile)) throw Object.assign(new Error("account-admin-required"), { status: 403 });
  return profile;
}

function privileged(profile) {
  return Array.isArray(profile?.roles) && profile.roles.some((role) => PRIVILEGED_ROLES.has(role));
}

async function publicRequest(req, body) {
  const studentNumber = text(body.studentNumber, 12);
  if (!validStudentNumber(studentNumber)) throw Object.assign(new Error("invalid-student-number"), { status: 400 });
  await rateLimit(req, body.clientId);

  const snap = await studentRef(studentNumber).get();
  if (snap.exists) {
    const student = snap.data();
    if (student.activated === true && student.uid && student.accountStatus !== "DISABLED") {
      const now = Date.now();
      await requestRef(studentNumber).set({
        schemaVersion: 1,
        schoolId: SCHOOL_ID,
        studentNumber,
        classKey: student.classKey,
        grade: student.grade,
        classNumber: student.classNumber,
        number: student.number,
        name: student.name,
        status: "PENDING",
        requestedAtMs: now,
        updatedAtMs: now,
      }, { merge: true });
    }
  }

  // 존재 여부를 노출하지 않는다. 등록되지 않은 학번도 동일한 응답을 받는다.
  return { ok: true, message: "관리자에게 PIN 초기화 요청을 전달했습니다." };
}

async function listRequests(actor) {
  let query = requests().where("status", "==", "PENDING").limit(100);
  if (actor.classKey) query = query.where("classKey", "==", actor.classKey);
  const snap = await query.get();
  const rows = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((item) => {
      try { assertSameClass(actor, item); return true; } catch { return false; }
    })
    .sort((a, b) => Number(a.number || 0) - Number(b.number || 0));
  return { requests: rows, count: rows.length, serverNowMs: Date.now() };
}

async function createResetSession(actor, student) {
  const id = randomUUID();
  const now = Date.now();
  const durationMinutes = 10;
  const data = {
    schemaVersion: 1,
    schoolId: SCHOOL_ID,
    grade: student.grade,
    classNumber: student.classNumber,
    classKey: student.classKey,
    active: true,
    durationMinutes,
    allowedStudentNumber: student.studentNumber,
    createdAtMs: now,
    updatedAtMs: now,
    expiresAtMs: now + durationMinutes * 60_000,
    createdByUid: actor.uid,
    source: "PIN_RESET_REQUEST",
  };
  await sessionRef(id).set(data);
  return { session: { id, ...data }, joinUrl: `https://pincon.app/next/join/?session=${encodeURIComponent(id)}` };
}

async function approve(actor, studentNumber) {
  const [studentSnap, requestSnap] = await Promise.all([studentRef(studentNumber).get(), requestRef(studentNumber).get()]);
  if (!studentSnap.exists || !requestSnap.exists || requestSnap.data()?.status !== "PENDING") {
    throw Object.assign(new Error("reset-request-not-found"), { status: 404 });
  }
  const student = { studentNumber, ...studentSnap.data() };
  assertSameClass(actor, student);
  const uid = text(student.uid || student.existingUid, 128);
  if (!uid) throw Object.assign(new Error("account-not-found"), { status: 404 });
  const profile = await profileForUid(uid);
  if (profile && privileged(profile)) throw Object.assign(new Error("privileged-account-protected"), { status: 409 });

  await firebaseAuth().updateUser(uid, { disabled: true });
  await firebaseAuth().revokeRefreshTokens(uid).catch(() => {});
  const now = Date.now();
  await userRef(uid).set({ status: "DISABLED", mustChangePin: true, updatedAtMs: now, updatedByUid: actor.uid }, { merge: true });
  await studentRef(studentNumber).set({
    activated: false,
    uid: "",
    existingUid: uid,
    accountStatus: "PENDING",
    claimState: "READY",
    claimNonce: "",
    claimAttemptId: "",
    claimLeaseUntilMs: 0,
    updatedAtMs: now,
    updatedByUid: actor.uid,
  }, { merge: true });
  if (profile) await syncCompatibilityRole({ ...profile, status: "DISABLED" }, actor.uid);

  const resetSession = await createResetSession(actor, student);
  await requestRef(studentNumber).set({
    status: "APPROVED",
    decidedAtMs: now,
    decidedByUid: actor.uid,
    resetSessionId: resetSession.session.id,
    resetExpiresAtMs: resetSession.session.expiresAtMs,
    updatedAtMs: now,
  }, { merge: true });
  await appendAccountAudit({
    actor,
    action: "PIN_RESET_REQUEST_APPROVED",
    targetUid: uid,
    before: profile,
    after: profile ? { ...profile, status: "DISABLED", mustChangePin: true } : null,
    metadata: { studentNumber, sessionId: resetSession.session.id },
  });
  return { ok: true, studentNumber, ...resetSession };
}

async function reject(actor, studentNumber) {
  const snap = await requestRef(studentNumber).get();
  if (!snap.exists || snap.data()?.status !== "PENDING") throw Object.assign(new Error("reset-request-not-found"), { status: 404 });
  assertSameClass(actor, snap.data());
  const now = Date.now();
  await requestRef(studentNumber).set({ status: "REJECTED", decidedAtMs: now, decidedByUid: actor.uid, updatedAtMs: now }, { merge: true });
  await appendAccountAudit({ actor, action: "PIN_RESET_REQUEST_REJECTED", targetUid: studentNumber, metadata: { studentNumber } });
  return { ok: true, studentNumber };
}

export default async function pinResetRequests(req, res) {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return sendJson(res, 204, {}, headers);
  if (req.method !== "POST") return sendJson(res, 405, { error: "method-not-allowed" }, headers);
  try {
    const body = await jsonBody(req);
    const action = text(body.action, 40);
    if (action === "request") return sendJson(res, 200, await publicRequest(req, body), headers);

    const actor = await requireAdmin(req);
    if (action === "list") return sendJson(res, 200, await listRequests(actor), headers);
    if (action === "approve") return sendJson(res, 200, await approve(actor, text(body.studentNumber, 12)), headers);
    if (action === "reject") return sendJson(res, 200, await reject(actor, text(body.studentNumber, 12)), headers);
    return sendJson(res, 400, { error: "unsupported-pin-reset-action" }, headers);
  } catch (error) {
    const status = Number(error?.status || 500);
    const safe = status >= 500 ? "pin-reset-request-failed" : String(error?.message || "pin-reset-request-failed");
    return sendJson(res, status, { error: safe }, headers);
  }
}
