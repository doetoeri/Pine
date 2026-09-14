import test from "node:test";
import assert from "node:assert/strict";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

const PROJECT_ID = "pincon-experiment-rules-test";
const SCHOOL = "test-school";
let env;

const role = (level, classKeys = []) => ({ level, classKeys, enabled: true });
const config = (id, status, uid, extra = {}) => ({
  id, status, version: 1, stableVariant: "legacy", promotedVariant: "",
  rolloutPercent: 0, updatedAtMs: Date.now(), updatedBy: uid, ...extra,
});

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT_ID });
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, `schools/${SCHOOL}/roles/admin`), role("school"));
    await setDoc(doc(db, `schools/${SCHOOL}/roles/student`), role("editor", ["1-8"]));
  });
});

test.after(async () => { await env.cleanup(); });
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, `schools/${SCHOOL}/roles/admin`), role("school"));
    await setDoc(doc(db, `schools/${SCHOOL}/roles/student`), role("editor", ["1-8"]));
  });
});

test("only school admin can configure experiments", async () => {
  const admin = env.authenticatedContext("admin").firestore();
  const student = env.authenticatedContext("student").firestore();
  await assertFails(setDoc(doc(student, `schools/${SCHOOL}/experiments/pincon-next-ui`), config("pincon-next-ui","DRAFT","student")));
  await assertSucceeds(setDoc(doc(admin, `schools/${SCHOOL}/experiments/pincon-next-ui`), config("pincon-next-ui","DRAFT","admin")));
});

test("participant assignment is self-created once and sticky", async () => {
  const student = env.authenticatedContext("student").firestore();
  await assertSucceeds(setDoc(doc(student, `schools/${SCHOOL}/experimentParticipants/student`), {
    schemaVersion: 1,
    anonymousParticipant: "participant_1234567890abcdef12345678",
    createdAtMs: 1,
  }));
  const assignmentRef = doc(student, `schools/${SCHOOL}/experiments/pincon-next-ui/assignments/student`);
  await assertSucceeds(setDoc(assignmentRef, {
    schemaVersion: 1, variant: "legacy", bucket: 1234, assignedAtMs: 2,
    experimentVersion: 1, anonymousParticipant: "participant_1234567890abcdef12345678",
  }));
  await assertFails(setDoc(assignmentRef, {
    schemaVersion: 1, variant: "next", bucket: 1234, assignedAtMs: 3,
    experimentVersion: 1, anonymousParticipant: "participant_1234567890abcdef12345678",
  }));
});

test("admin can preassign before participant activation but student cannot", async () => {
  const admin = env.authenticatedContext("admin").firestore();
  const student = env.authenticatedContext("student").firestore();
  const adminRef = doc(admin, `schools/${SCHOOL}/experiments/pincon-next-ui/assignments/future-student`);
  const studentRef = doc(student, `schools/${SCHOOL}/experiments/pincon-next-ui/assignments/student`);

  await assertSucceeds(setDoc(adminRef, {
    schemaVersion: 1, variant: "next", bucket: 4321, assignedAtMs: 1,
    experimentVersion: 1, anonymousParticipant: "", assignmentSource: "controlled",
  }));

  await assertFails(setDoc(studentRef, {
    schemaVersion: 1, variant: "next", bucket: 4321, assignedAtMs: 1,
    experimentVersion: 1, anonymousParticipant: "", assignmentSource: "controlled",
  }));
});

test("public beta enrollment is allowed only while Canary beta is open", async () => {
  const admin = env.authenticatedContext("admin").firestore();
  const student = env.authenticatedContext("student").firestore();
  const uiRef = doc(admin, `schools/${SCHOOL}/experiments/pincon-next-ui`);
  const betaRef = doc(student, `schools/${SCHOOL}/experiments/pincon-next-ui/betaEnrollments/student`);

  await assertSucceeds(setDoc(uiRef, config("pincon-next-ui","CANARY","admin",{ publicBetaEnabled:true, publicBetaStartedAtMs:1 })));
  await assertSucceeds(setDoc(betaRef, {
    schemaVersion: 1, enabled: true, experimentVersion: 1, joinedAtMs: 2, updatedAtMs: 2,
  }));

  await assertSucceeds(setDoc(uiRef, config("pincon-next-ui","ACTIVE","admin",{ publicBetaEnabled:false, activeStartedAtMs:3 })));
  await assertFails(setDoc(betaRef, {
    schemaVersion: 1, enabled: true, experimentVersion: 1, joinedAtMs: 2, updatedAtMs: 4,
  }));
  await assertSucceeds(setDoc(betaRef, {
    schemaVersion: 1, enabled: false, experimentVersion: 1, joinedAtMs: 2, updatedAtMs: 5,
  }));
});

test("research event accepts anonymous participant but rejects identity fields", async () => {
  const student = env.authenticatedContext("student").firestore();
  await setDoc(doc(student, `schools/${SCHOOL}/experimentParticipants/student`), {
    schemaVersion: 1, anonymousParticipant: "participant_1234567890abcdef12345678", createdAtMs: 1,
  });
  const base = {
    schemaVersion: 1, eventId: "event_ok", anonymousParticipant: "participant_1234567890abcdef12345678",
    experimentId: "pincon-next-ui", experimentVersion: 1, variant: "legacy",
    eventType: "session_start", timestampMs: 10, sessionId: "session_1",
    deviceCategory: "mobile", properties: { route: "today", cohort: "public-beta" },
  };
  await assertSucceeds(setDoc(doc(student, `schools/${SCHOOL}/experimentEvents/event_ok`), base));
  await assertFails(setDoc(doc(student, `schools/${SCHOOL}/experimentEvents/event_bad`), {
    ...base, eventId: "event_bad", displayName: "학생 이름",
  }));
});

test("notification experiment cannot run until Next UI is completed and experiments stay mutually exclusive", async () => {
  const admin = env.authenticatedContext("admin").firestore();
  const notificationRef = doc(admin, `schools/${SCHOOL}/experiments/notification-frequency`);
  await assertFails(setDoc(notificationRef, config("notification-frequency","ACTIVE","admin",{ stableVariant:"next", startDate:"2026-09-14" })));

  const uiRef = doc(admin, `schools/${SCHOOL}/experiments/pincon-next-ui`);
  await assertSucceeds(setDoc(uiRef, config("pincon-next-ui","COMPLETED","admin",{ stableVariant:"next", promotedVariant:"next", rolloutPercent:100 })));
  await assertSucceeds(setDoc(notificationRef, config("notification-frequency","ACTIVE","admin",{ stableVariant:"next", startDate:"2026-09-14" })));

  await assertFails(setDoc(uiRef, config("pincon-next-ui","ACTIVE","admin",{ stableVariant:"legacy", allocation:{ nextPercent:50 } })));
  assert.equal((await getDoc(notificationRef)).data().status, "ACTIVE");
});
