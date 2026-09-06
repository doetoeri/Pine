import test from "node:test";
import assert from "node:assert/strict";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = process.env.GCLOUD_PROJECT || "pincon-enrollment-test";
const app = getApps().find((item) => item.name === "enrollment-concurrency-test")
  || initializeApp({ projectId: PROJECT_ID }, "enrollment-concurrency-test");
const db = getFirestore(app);
const school = "gochon-high";

function sessionRef(id) {
  return db.doc(`schools/${school}/enrollmentSessions/${id}`);
}
function studentRef(id) {
  return db.doc(`schools/${school}/students/${id}`);
}

async function reserve(sessionId, studentNumber, attemptId) {
  const sRef = sessionRef(sessionId);
  const stRef = studentRef(studentNumber);
  const now = Date.now();
  return db.runTransaction(async (tx) => {
    const [sessionSnap, studentSnap] = await Promise.all([tx.get(sRef), tx.get(stRef)]);
    if (!sessionSnap.exists || !studentSnap.exists) throw new Error("registration-not-available");
    const session = sessionSnap.data();
    const student = studentSnap.data();
    if (session.active !== true || Number(session.expiresAtMs || 0) < now) throw new Error("session-unavailable");
    if (session.classKey !== student.classKey) throw new Error("registration-not-available");
    if (student.activated === true && student.uid) throw new Error("already-activated");
    const leaseActive = student.claimState === "CLAIMING" && Number(student.claimLeaseUntilMs || 0) >= now;
    if (leaseActive) throw new Error("activation-in-progress");
    tx.set(stRef, {
      claimState: "CLAIMING",
      claimAttemptId: attemptId,
      claimLeaseUntilMs: now + 120_000,
      updatedAtMs: now,
    }, { merge: true });
    return { studentNumber, attemptId };
  });
}

async function seedSession(sessionId, { expiresOffsetMs = 15 * 60_000 } = {}) {
  const now = Date.now();
  await sessionRef(sessionId).set({
    schoolId: school,
    grade: 1,
    classNumber: 8,
    classKey: "1-8",
    active: true,
    createdAtMs: now,
    expiresAtMs: now + expiresOffsetMs,
  });
}

async function seedStudent(studentNumber, number) {
  await studentRef(studentNumber).set({
    studentNumber,
    name: `테스트${number}`,
    grade: 1,
    classNumber: 8,
    classKey: "1-8",
    number,
    activated: false,
    uid: "",
    accountStatus: "PENDING",
    claimState: "READY",
    claimLeaseUntilMs: 0,
  });
}

test("34 students can reserve different student numbers concurrently", async () => {
  const sessionId = `session-34-${Date.now()}`;
  await seedSession(sessionId);
  const ids = Array.from({ length: 34 }, (_, index) => `18${String(index + 1).padStart(3, "0")}`);
  await Promise.all(ids.map((id, index) => seedStudent(id, index + 1)));
  const results = await Promise.all(ids.map((id, index) => reserve(sessionId, id, `attempt-${index + 1}`)));
  assert.equal(results.length, 34);
  assert.equal(new Set(results.map((item) => item.studentNumber)).size, 34);
});

test("two concurrent reservations for one student number yield exactly one winner", async () => {
  const sessionId = `session-race-${Date.now()}`;
  const studentNumber = "18901";
  await seedSession(sessionId);
  await seedStudent(studentNumber, 1);
  const settled = await Promise.allSettled([
    reserve(sessionId, studentNumber, "attempt-a"),
    reserve(sessionId, studentNumber, "attempt-b"),
  ]);
  assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(settled.filter((item) => item.status === "rejected").length, 1);
  const snap = await studentRef(studentNumber).get();
  assert.equal(snap.data()?.claimState, "CLAIMING");
  assert.ok(["attempt-a", "attempt-b"].includes(snap.data()?.claimAttemptId));
});

test("expired session is rejected using server-side test time", async () => {
  const sessionId = `session-expired-${Date.now()}`;
  const studentNumber = "18902";
  await seedSession(sessionId, { expiresOffsetMs: -1000 });
  await seedStudent(studentNumber, 2);
  await assert.rejects(() => reserve(sessionId, studentNumber, "attempt-expired"), /session-unavailable/);
});
