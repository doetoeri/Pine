import { createHash, randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { firebaseAuth, firestore } from "../../lib/firebase.mjs";
import {
  SCHOOL_ID,
  appendAccountAudit,
  assertSameClass,
  corsHeaders,
  isAccountAdmin,
  normalizeProfile,
  publicProfile,
  requireProfileOrLegacy,
  studentEmail,
  syncCompatibilityRole,
} from "../../lib/class-accounts.mjs";
import { jsonBody, sendJson } from "../../lib/request.mjs";

const SESSION_DURATIONS = new Set([5, 10, 15, 30]);
const CLAIM_LEASE_MS = 120_000;
const RATE_WINDOW_MS = 5 * 60_000;
const RATE_LIMIT = 14;
const PRIVILEGED_ROLES = new Set(["ADMIN", "TEACHER", "CLASS_PRESIDENT"]);

const students = () => firestore().collection(`schools/${SCHOOL_ID}/students`);
const studentRef = (studentNumber) => students().doc(studentNumber);
const sessions = () => firestore().collection(`schools/${SCHOOL_ID}/enrollmentSessions`);
const sessionRef = (sessionId) => sessions().doc(sessionId);
const userRef = (uid) => firestore().doc(`schools/${SCHOOL_ID}/users/${uid}`);
const users = () => firestore().collection(`schools/${SCHOOL_ID}/users`);
const rateRef = (key) => firestore().doc(`schools/${SCHOOL_ID}/enrollmentRateLimits/${key}`);

function text(value, max = 160) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function validStudentNumber(value) {
  return /^\d{5}$/.test(String(value || "").trim());
}

function validPin(pin, studentNumber = "") {
  const value = String(pin || "");
  if (!/^\d{6,12}$/.test(value)) return false;
  if (/^(\d)\1+$/.test(value)) return false;
  if (["123456", "654321", "012345", "987654"].includes(value)) return false;
  if (studentNumber && (value === studentNumber || value.includes(studentNumber))) return false;
  return true;
}

function classKey(grade, classNumber) {
  const g = Number(grade);
  const c = Number(classNumber);
  if (!Number.isInteger(g) || g < 1 || g > 3 || !Number.isInteger(c) || c < 1 || c > 10) {
    throw Object.assign(new Error("invalid-class"), { status: 400 });
  }
  return `${g}-${c}`;
}

function requesterIp(req) {
  return text(req?.headers?.["x-forwarded-for"] || req?.headers?.["x-real-ip"] || "unknown", 120).split(",")[0].trim();
}

async function rateLimitPublic(req, clientId, action) {
  const client = text(clientId, 80);
  if (!client) throw Object.assign(new Error("client-id-required"), { status: 400 });
  const bucket = Math.floor(Date.now() / RATE_WINDOW_MS);
  const digest = createHash("sha256").update(`${requesterIp(req)}|${client}|${action}|${bucket}`).digest("hex");
  const ref = rateRef(digest);
  await firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = Number(snap.data()?.count || 0);
    if (count >= RATE_LIMIT) throw Object.assign(new Error("too-many-attempts"), { status: 429 });
    tx.set(ref, {
      count: count + 1,
      bucket,
      action,
      expiresAtMs: (bucket + 2) * RATE_WINDOW_MS,
      updatedAtMs: Date.now(),
    }, { merge: true });
  });
}

async function requireAccountAdmin(req) {
  const { profile } = await requireProfileOrLegacy(req, { legacyLevels: ["school", "president", "class", "grade"] });
  if (!isAccountAdmin(profile)) throw Object.assign(new Error("account-admin-required"), { status: 403 });
  return profile;
}

function studentPublic(doc) {
  return {
    studentNumber: doc.studentNumber,
    name: doc.name,
    grade: doc.grade,
    classNumber: doc.classNumber,
    number: doc.number,
    classKey: doc.classKey,
    activated: doc.activated === true,
    accountStatus: doc.accountStatus || (doc.activated ? "ACTIVE" : "PENDING"),
    activatedAtMs: Number(doc.activatedAtMs || 0),
  };
}

async function lookup(req, body) {
  const sessionId = text(body.sessionId, 100);
  const studentNumber = text(body.studentNumber, 12);
  if (!sessionId || !validStudentNumber(studentNumber)) throw Object.assign(new Error("invalid-lookup"), { status: 400 });
  await rateLimitPublic(req, body.clientId, "lookup");
  const [sessionSnap, studentSnap] = await Promise.all([sessionRef(sessionId).get(), studentRef(studentNumber).get()]);
  if (!sessionSnap.exists) throw Object.assign(new Error("session-unavailable"), { status: 410 });
  const session = sessionSnap.data();
  const now = Date.now();
  if (session.active !== true || Number(session.expiresAtMs || 0) < now) throw Object.assign(new Error("session-unavailable"), { status: 410 });
  if (!studentSnap.exists) throw Object.assign(new Error("student-not-found"), { status: 404 });
  const student = studentSnap.data();
  if (student.classKey !== session.classKey) throw Object.assign(new Error("student-not-found"), { status: 404 });
  if (session.allowedStudentNumber && session.allowedStudentNumber !== studentNumber) {
    throw Object.assign(new Error("student-not-found"), { status: 404 });
  }
  return { student: studentPublic(student), expiresAtMs: Number(session.expiresAtMs || 0) };
}

function deterministicUid(studentNumber) {
  return `pincon-${SCHOOL_ID}-${studentNumber}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120);
}

function isPrivileged(profile) {
  return Array.isArray(profile?.roles) && profile.roles.some((role) => PRIVILEGED_ROLES.has(role));
}

async function provisionAuth(student, pin) {
  const email = studentEmail(student.studentNumber);
  let uid = text(student.existingUid || student.uid, 128);
  let created = false;
  if (uid) {
    const profileSnap = await userRef(uid).get();
    if (profileSnap.exists && isPrivileged(profileSnap.data())) {
      throw Object.assign(new Error("privileged-account-protected"), { status: 409 });
    }
    await firebaseAuth().updateUser(uid, { password: pin, disabled: false, displayName: student.name || student.studentNumber });
    await firebaseAuth().revokeRefreshTokens(uid).catch(() => {});
    return { uid, created };
  }

  try {
    const byEmail = await firebaseAuth().getUserByEmail(email);
    const profileSnap = await userRef(byEmail.uid).get();
    if (profileSnap.exists && profileSnap.data()?.studentNumber !== student.studentNumber) {
      throw Object.assign(new Error("student-number-conflict"), { status: 409 });
    }
    if (profileSnap.exists && isPrivileged(profileSnap.data())) {
      throw Object.assign(new Error("privileged-account-protected"), { status: 409 });
    }
    uid = byEmail.uid;
    await firebaseAuth().updateUser(uid, { password: pin, disabled: false, displayName: student.name || student.studentNumber });
    await firebaseAuth().revokeRefreshTokens(uid).catch(() => {});
    return { uid, created };
  } catch (error) {
    if (error?.code && error.code !== "auth/user-not-found") throw error;
  }

  uid = deterministicUid(student.studentNumber);
  try {
    await firebaseAuth().createUser({
      uid,
      email,
      password: pin,
      displayName: student.name || student.studentNumber,
      disabled: false,
      emailVerified: false,
    });
    created = true;
  } catch (error) {
    if (error?.code !== "auth/uid-already-exists") throw error;
    await firebaseAuth().updateUser(uid, { password: pin, disabled: false, displayName: student.name || student.studentNumber });
  }
  return { uid, created };
}

async function activate(req, body) {
  const sessionId = text(body.sessionId, 100);
  const studentNumber = text(body.studentNumber, 12);
  const pin = String(body.pin || "");
  const attemptId = text(body.attemptId, 100) || randomUUID();
  if (!sessionId || !validStudentNumber(studentNumber) || !validPin(pin, studentNumber)) {
    throw Object.assign(new Error("invalid-activation"), { status: 400 });
  }
  await rateLimitPublic(req, body.clientId, "activate");

  const sRef = studentRef(studentNumber);
  const eRef = sessionRef(sessionId);
  const nonce = randomUUID();
  let reservedStudent;
  const now = Date.now();
  await firestore().runTransaction(async (tx) => {
    const [sessionSnap, studentSnap] = await Promise.all([tx.get(eRef), tx.get(sRef)]);
    if (!sessionSnap.exists || !studentSnap.exists) throw Object.assign(new Error("registration-not-available"), { status: 409 });
    const session = sessionSnap.data();
    const student = studentSnap.data();
    if (session.active !== true || Number(session.expiresAtMs || 0) < now) throw Object.assign(new Error("session-unavailable"), { status: 410 });
    if (student.classKey !== session.classKey) throw Object.assign(new Error("registration-not-available"), { status: 409 });
    if (session.allowedStudentNumber && session.allowedStudentNumber !== studentNumber) throw Object.assign(new Error("registration-not-available"), { status: 409 });
    if (student.activated === true && student.uid) {
      if (student.lastActivationAttemptId === attemptId) {
        reservedStudent = { ...student, alreadyCompleted: true };
        return;
      }
      throw Object.assign(new Error("already-activated"), { status: 409 });
    }
    const leaseActive = student.claimState === "CLAIMING" && Number(student.claimLeaseUntilMs || 0) >= now;
    if (leaseActive) throw Object.assign(new Error("activation-in-progress"), { status: 409 });
    reservedStudent = student;
    tx.set(sRef, {
      claimState: "CLAIMING",
      claimNonce: nonce,
      claimAttemptId: attemptId,
      claimLeaseUntilMs: now + CLAIM_LEASE_MS,
      updatedAtMs: now,
    }, { merge: true });
  });

  if (reservedStudent?.alreadyCompleted) {
    const customToken = await firebaseAuth().createCustomToken(reservedStudent.uid, { pinconEnrollment: true });
    return { customToken, account: publicProfile(reservedStudent), recovered: true };
  }

  let authResult = null;
  try {
    authResult = await provisionAuth({ ...reservedStudent, studentNumber }, pin);
    const profile = normalizeProfile({
      studentNumber,
      name: reservedStudent.name,
      grade: reservedStudent.grade,
      classNumber: reservedStudent.classNumber,
      number: reservedStudent.number,
      roles: ["STUDENT"],
      subjectRoles: [],
      status: "ACTIVE",
      mustChangePin: false,
    }, { uid: authResult.uid });
    const completedAt = Date.now();
    await firestore().runTransaction(async (tx) => {
      const snap = await tx.get(sRef);
      if (!snap.exists || snap.data()?.claimNonce !== nonce || snap.data()?.claimAttemptId !== attemptId) {
        throw new Error("activation-claim-lost");
      }
      tx.set(userRef(authResult.uid), {
        ...profile,
        createdAtMs: Number(snap.data()?.createdAtMs || completedAt),
        updatedAtMs: completedAt,
        createdByUid: authResult.uid,
        updatedByUid: authResult.uid,
        registrationSource: "CLASS_ENROLLMENT_V1",
      }, { merge: true });
      tx.set(sRef, {
        ...studentPublic({ ...snap.data(), activated: true, accountStatus: "ACTIVE", activatedAtMs: completedAt }),
        uid: authResult.uid,
        existingUid: authResult.uid,
        activated: true,
        accountStatus: "ACTIVE",
        activatedAtMs: completedAt,
        claimState: "CLAIMED",
        claimNonce: "",
        claimAttemptId: "",
        claimLeaseUntilMs: 0,
        lastActivationAttemptId: attemptId,
        updatedAtMs: completedAt,
      }, { merge: true });
    });
    await syncCompatibilityRole(profile, authResult.uid);
    await appendAccountAudit({ actor: profile, action: "CLASS_ENROLLMENT_ACTIVATED", targetUid: profile.uid, after: profile, metadata: { sessionId, studentNumber } });
    const customToken = await firebaseAuth().createCustomToken(authResult.uid, { pinconEnrollment: true });
    return { customToken, account: publicProfile(profile) };
  } catch (error) {
    if (authResult?.created && authResult.uid) await firebaseAuth().deleteUser(authResult.uid).catch(() => {});
    await firestore().runTransaction(async (tx) => {
      const snap = await tx.get(sRef);
      if (!snap.exists || snap.data()?.claimNonce !== nonce) return;
      tx.set(sRef, { claimState: "READY", claimNonce: "", claimAttemptId: "", claimLeaseUntilMs: 0, updatedAtMs: Date.now() }, { merge: true });
    }).catch(() => {});
    throw error;
  }
}

async function findExistingUser(studentNumber) {
  const snap = await users().where("studentNumber", "==", studentNumber).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { uid: doc.id, ...doc.data() };
}

function normalizeRosterRow(raw) {
  const studentNumber = text(raw.studentNumber, 12);
  const name = text(raw.name, 30);
  const grade = Number(raw.grade);
  const classNumber = Number(raw.classNumber);
  const number = Number(raw.number);
  if (!validStudentNumber(studentNumber) || !name || !Number.isInteger(number) || number < 1 || number > 60) {
    throw new Error("invalid-roster-row");
  }
  return { studentNumber, name, grade, classNumber, number, classKey: classKey(grade, classNumber) };
}

async function rosterImport(actor, body) {
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length || rows.length > 80) throw Object.assign(new Error("invalid-roster"), { status: 400 });
  const prepared = [];
  const seen = new Set();
  for (const raw of rows) {
    try {
      const row = normalizeRosterRow(raw);
      assertSameClass(actor, row);
      if (seen.has(row.studentNumber)) throw new Error("duplicate-student-number-in-csv");
      seen.add(row.studentNumber);
      const [existingStudentSnap, existingUser] = await Promise.all([studentRef(row.studentNumber).get(), findExistingUser(row.studentNumber)]);
      const existingStudent = existingStudentSnap.exists ? existingStudentSnap.data() : null;
      const conflict = Boolean(existingStudent && (
        existingStudent.name !== row.name || Number(existingStudent.grade) !== row.grade || Number(existingStudent.classNumber) !== row.classNumber || Number(existingStudent.number) !== row.number
      ));
      prepared.push({ ok: true, row, existingStudent, existingUser, conflict });
    } catch (error) {
      prepared.push({ ok: false, raw, error: String(error?.message || "invalid-roster-row") });
    }
  }
  const preview = {
    requested: rows.length,
    valid: prepared.filter((x) => x.ok).length,
    errors: prepared.filter((x) => !x.ok).length,
    conflicts: prepared.filter((x) => x.ok && x.conflict).length,
    existing: prepared.filter((x) => x.ok && (x.existingStudent || x.existingUser)).length,
    new: prepared.filter((x) => x.ok && !x.existingStudent && !x.existingUser).length,
    rows: prepared.map((item) => item.ok ? { ...item.row, conflict: item.conflict, existing: Boolean(item.existingStudent || item.existingUser) } : { ok: false, error: item.error, studentNumber: text(item.raw?.studentNumber, 12), name: text(item.raw?.name, 30) }),
  };
  if (body.commit !== true) return { preview };
  if (preview.errors) throw Object.assign(new Error("roster-has-errors"), { status: 400, preview });
  if (preview.conflicts && body.confirmConflicts !== true) throw Object.assign(new Error("roster-conflicts-require-confirmation"), { status: 409, preview });

  const now = Date.now();
  for (const item of prepared) {
    const { row, existingStudent, existingUser } = item;
    const uid = text(existingStudent?.uid || existingStudent?.existingUid || existingUser?.uid, 128);
    const activated = Boolean(uid && (existingStudent?.activated === true || existingUser));
    await studentRef(row.studentNumber).set({
      ...row,
      activated,
      uid: activated ? uid : "",
      existingUid: uid || "",
      accountStatus: activated ? (existingUser?.status || existingStudent?.accountStatus || "ACTIVE") : "PENDING",
      claimState: activated ? "CLAIMED" : "READY",
      claimNonce: "",
      claimAttemptId: "",
      claimLeaseUntilMs: 0,
      createdAtMs: Number(existingStudent?.createdAtMs || now),
      updatedAtMs: now,
      updatedByUid: actor.uid,
    }, { merge: true });
  }
  await appendAccountAudit({ actor, action: "ENROLLMENT_ROSTER_IMPORT", targetUid: actor.uid, metadata: { requested: String(rows.length), conflicts: String(preview.conflicts) } });
  return { preview, committed: true };
}

async function startSession(actor, body) {
  const grade = Number(body.grade);
  const classNumber = Number(body.classNumber);
  const key = classKey(grade, classNumber);
  assertSameClass(actor, { classKey: key });
  const durationMinutes = SESSION_DURATIONS.has(Number(body.durationMinutes)) ? Number(body.durationMinutes) : 15;
  const allowedStudentNumber = text(body.allowedStudentNumber, 12);
  if (allowedStudentNumber && !validStudentNumber(allowedStudentNumber)) throw Object.assign(new Error("invalid-student-number"), { status: 400 });
  if (allowedStudentNumber) {
    const snap = await studentRef(allowedStudentNumber).get();
    if (!snap.exists || snap.data()?.classKey !== key) throw Object.assign(new Error("student-not-found"), { status: 404 });
  }
  const id = randomUUID();
  const now = Date.now();
  const data = {
    schemaVersion: 1,
    schoolId: SCHOOL_ID,
    grade,
    classNumber,
    classKey: key,
    active: true,
    durationMinutes,
    allowedStudentNumber: allowedStudentNumber || "",
    createdAtMs: now,
    updatedAtMs: now,
    expiresAtMs: now + durationMinutes * 60_000,
    createdByUid: actor.uid,
  };
  await sessionRef(id).set(data);
  await appendAccountAudit({ actor, action: allowedStudentNumber ? "INDIVIDUAL_ENROLLMENT_SESSION_START" : "CLASS_ENROLLMENT_SESSION_START", targetUid: id, metadata: { classKey: key, durationMinutes: String(durationMinutes), allowedStudentNumber } });
  return { session: { id, ...data }, joinUrl: `https://pincon.app/next/join/?session=${encodeURIComponent(id)}` };
}

async function sessionStatus(actor, body) {
  const id = text(body.sessionId, 100);
  const snap = await sessionRef(id).get();
  if (!snap.exists) throw Object.assign(new Error("session-not-found"), { status: 404 });
  const session = { id: snap.id, ...snap.data() };
  assertSameClass(actor, session);
  const rosterSnap = await students().where("classKey", "==", session.classKey).limit(80).get();
  const roster = rosterSnap.docs.map((doc) => studentPublic(doc.data())).sort((a, b) => a.number - b.number);
  return {
    session,
    roster,
    total: roster.length,
    completed: roster.filter((x) => x.activated).length,
    pending: roster.filter((x) => !x.activated).length,
    serverNowMs: Date.now(),
  };
}

async function mutateSession(actor, body, mode) {
  const id = text(body.sessionId, 100);
  const ref = sessionRef(id);
  const snap = await ref.get();
  if (!snap.exists) throw Object.assign(new Error("session-not-found"), { status: 404 });
  const session = snap.data();
  assertSameClass(actor, session);
  const now = Date.now();
  const patch = mode === "end"
    ? { active: false, endedAtMs: now, updatedAtMs: now }
    : { active: true, expiresAtMs: Math.max(Number(session.expiresAtMs || now), now) + (SESSION_DURATIONS.has(Number(body.minutes)) ? Number(body.minutes) : 5) * 60_000, updatedAtMs: now };
  await ref.set(patch, { merge: true });
  return sessionStatus(actor, { sessionId: id });
}

async function studentAdminAction(actor, body) {
  const studentNumber = text(body.studentNumber, 12);
  const snap = await studentRef(studentNumber).get();
  if (!snap.exists) throw Object.assign(new Error("student-not-found"), { status: 404 });
  const student = snap.data();
  assertSameClass(actor, student);
  const action = text(body.studentAction, 40);
  if (action === "disable") {
    if (student.uid) {
      const profileSnap = await userRef(student.uid).get();
      if (profileSnap.exists && isPrivileged(profileSnap.data())) throw Object.assign(new Error("privileged-account-protected"), { status: 409 });
      await firebaseAuth().updateUser(student.uid, { disabled: true });
      await userRef(student.uid).set({ status: "DISABLED", updatedAtMs: Date.now(), updatedByUid: actor.uid }, { merge: true });
    }
    await studentRef(studentNumber).set({ accountStatus: "DISABLED", updatedAtMs: Date.now(), updatedByUid: actor.uid }, { merge: true });
    return { ok: true };
  }
  if (["reset", "allow-enrollment"].includes(action)) {
    if (student.uid) {
      const profileSnap = await userRef(student.uid).get();
      if (profileSnap.exists && isPrivileged(profileSnap.data())) throw Object.assign(new Error("privileged-account-protected"), { status: 409 });
      await firebaseAuth().updateUser(student.uid, { disabled: true }).catch(() => {});
      await firebaseAuth().revokeRefreshTokens(student.uid).catch(() => {});
      await userRef(student.uid).set({ status: "DISABLED", mustChangePin: true, updatedAtMs: Date.now(), updatedByUid: actor.uid }, { merge: true });
    }
    await studentRef(studentNumber).set({ activated: false, accountStatus: "PENDING", claimState: "READY", claimNonce: "", claimAttemptId: "", claimLeaseUntilMs: 0, existingUid: student.uid || student.existingUid || "", uid: "", updatedAtMs: Date.now(), updatedByUid: actor.uid }, { merge: true });
    return startSession(actor, { grade: student.grade, classNumber: student.classNumber, durationMinutes: Number(body.durationMinutes) || 10, allowedStudentNumber: studentNumber });
  }
  throw Object.assign(new Error("unsupported-student-action"), { status: 400 });
}

async function qr(req, res) {
  const url = new URL(req.url || "/", "https://pincon.invalid");
  const sessionId = text(url.searchParams.get("session"), 100);
  const snap = await sessionRef(sessionId).get();
  if (!snap.exists || snap.data()?.active !== true || Number(snap.data()?.expiresAtMs || 0) < Date.now()) {
    res.statusCode = 404;
    res.end("not found");
    return;
  }
  const joinUrl = `https://pincon.app/next/join/?session=${encodeURIComponent(sessionId)}`;
  const svg = await QRCode.toString(joinUrl, { type: "svg", margin: 1, width: 320, errorCorrectionLevel: "M" });
  res.statusCode = 200;
  res.setHeader("content-type", "image/svg+xml; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(svg);
}

export default async function enrollment(req, res) {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return sendJson(res, 204, {}, headers);
  const url = new URL(req.url || "/", "https://pincon.invalid");
  if (req.method === "GET" && url.searchParams.get("action") === "qr") return qr(req, res);
  if (req.method !== "POST") return sendJson(res, 405, { error: "method-not-allowed" }, headers);

  try {
    const body = await jsonBody(req);
    const action = text(body.action, 60);
    if (action === "lookup") return sendJson(res, 200, await lookup(req, body), headers);
    if (action === "activate") return sendJson(res, 200, await activate(req, body), headers);

    const actor = await requireAccountAdmin(req);
    if (action === "roster-import") return sendJson(res, 200, await rosterImport(actor, body), headers);
    if (action === "session-start") return sendJson(res, 200, await startSession(actor, body), headers);
    if (action === "session-status") return sendJson(res, 200, await sessionStatus(actor, body), headers);
    if (action === "session-end") return sendJson(res, 200, await mutateSession(actor, body, "end"), headers);
    if (action === "session-extend") return sendJson(res, 200, await mutateSession(actor, body, "extend"), headers);
    if (action === "student-action") return sendJson(res, 200, await studentAdminAction(actor, body), headers);
    return sendJson(res, 400, { error: "unsupported-enrollment-action" }, headers);
  } catch (error) {
    const status = Number(error?.status || 500);
    const safe = status >= 500 ? "enrollment-failed" : String(error?.message || "enrollment-failed");
    const extra = error?.preview ? { preview: error.preview } : {};
    return sendJson(res, status, { error: safe, ...extra }, headers);
  }
}
