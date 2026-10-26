import test from "node:test";
import assert from "node:assert/strict";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import * as firestoreApi from "firebase/firestore";
import { ExperimentPlatform } from "../experiment/experiment-service.js";
import { studyDefaults } from "../experiment/notification-study.js";

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

test("career v3 starts independently of retired UI promotion and keeps active UI tests isolated", async () => {
  const admin = env.authenticatedContext("admin").firestore();
  const ref = doc(admin, `schools/${SCHOOL}/experiments/notification-frequency`);
  await assertSucceeds(setDoc(ref, config("notification-frequency", "ACTIVE", "admin", { version: 3, studyMode: "career-v3" })));
  await env.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), `schools/${SCHOOL}/experiments/pincon-next-ui`), config("pincon-next-ui", "ACTIVE", "admin")));
  await assertFails(setDoc(ref, config("notification-frequency", "ACTIVE", "admin", { version: 4, studyMode: "career-v3" })));
});

test("school admin may create an anonymous participant for an absent student, other students cannot", async () => {
  const admin = env.authenticatedContext("admin").firestore(), student = env.authenticatedContext("student").firestore();
  const data = { schemaVersion: 1, anonymousParticipant: "participant_absent_12345678901234", createdAtMs: 1 };
  await assertSucceeds(setDoc(doc(admin, `schools/${SCHOOL}/experimentParticipants/absent`), data));
  await assertFails(setDoc(doc(student, `schools/${SCHOOL}/experimentParticipants/another`), data));
});

test("readiness and archived runs cannot leak to other participants or accept client writes", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `schools/${SCHOOL}/notificationStudyDevices/student`), { pushRegistered: true });
    await setDoc(doc(context.firestore(), `schools/${SCHOOL}/experimentRuntime/notification-frequency`), { status: "ok" });
    await setDoc(doc(context.firestore(), `schools/${SCHOOL}/experiments/notification-frequency/runs/v2`), { private: "archive" });
  });
  const student = env.authenticatedContext("student").firestore(), other = env.authenticatedContext("other").firestore();
  const admin = env.authenticatedContext("admin").firestore();
  await assertSucceeds(getDoc(doc(student, `schools/${SCHOOL}/notificationStudyDevices/student`)));
  await assertFails(getDoc(doc(other, `schools/${SCHOOL}/notificationStudyDevices/student`)));
  await assertFails(setDoc(doc(admin, `schools/${SCHOOL}/notificationStudyDevices/student`), { pushRegistered: false }));
  await assertFails(getDoc(doc(student, `schools/${SCHOOL}/experimentRuntime/notification-frequency`)));
  await assertSucceeds(getDoc(doc(admin, `schools/${SCHOOL}/experimentRuntime/notification-frequency`)));
  await assertFails(getDoc(doc(student, `schools/${SCHOOL}/experiments/notification-frequency/runs/v2`)));
});

test("career surveys must match the current version and the student's assigned condition", async () => {
  const path = `schools/${SCHOOL}/experiments/notification-frequency`;
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, path), config("notification-frequency", "ACTIVE", "admin", { version: 3, studyMode: "career-v3" }));
    await setDoc(doc(db, `schools/${SCHOOL}/experimentParticipants/student`), { schemaVersion: 1, anonymousParticipant: "participant_survey_12345678901234", createdAtMs: 1 });
    await setDoc(doc(db, `${path}/assignments/student`), { experimentVersion: 3, sequence: ["LOW", "MID", "HIGH"] });
  });
  const db = env.authenticatedContext("student").firestore();
  const response = { schemaVersion: 1, anonymousParticipant: "participant_survey_12345678901234", experimentVersion: 3,
    period: 1, condition: "LOW", usefulnessScore: 3, annoyanceScore: 2, increasedUseScore: 2,
    continueScore: 4, preferredDailyCount: "1", submittedAtMs: 1 };
  await assertSucceeds(setDoc(doc(db, `${path}/participants/student/surveyResponses/v3-period-1`), response));
  await assertFails(setDoc(doc(db, `${path}/participants/student/surveyResponses/v2-period-1`), { ...response, experimentVersion: 2 }));
  await assertFails(setDoc(doc(db, `${path}/participants/student/surveyResponses/wrong-condition`), { ...response, condition: "HIGH" }));
});

test("the actual admin service prepares all 34 students atomically, starts, reads, saves notes and pauses under real rules", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all(Array.from({ length: 34 }, (_, i) => setDoc(doc(db, `schools/${SCHOOL}/users/uid-${i}`), {
      uid: `uid-${i}`, status: "ACTIVE", classKey: "1-8", name: `test ${i}`,
    })));
  });
  globalThis.window ||= { addEventListener() {} };
  const platform = new ExperimentPlatform();
  const db = env.authenticatedContext("admin").firestore();
  platform.user = { uid: "admin" };
  platform.api = { ...firestoreApi, db };
  platform.accountTransport = async () => ({ accounts: Array.from({ length: 34 }, (_, i) => ({
    uid: `uid-${i}`, status: "ACTIVE", classKey: "1-8", name: `test ${i}`,
  })) });
  // The service selects SCHOOL at import time. Provide a scoped API wrapper for
  // this isolated emulator project, never production Firebase.
  platform.api.doc = (db, ...parts) => firestoreApi.doc(db, ...parts.map((part) => part === "gochon-high" ? SCHOOL : part));
  platform.api.collection = (db, ...parts) => firestoreApi.collection(db, ...parts.map((part) => part === "gochon-high" ? SCHOOL : part));
  const roster = await platform.adminStudyRoster();
  assert.equal(roster.length, 34);
  const prepared = await platform.adminPrepareNotificationStudy(studyDefaults(), roster, 0);
  assert.equal(prepared.version, 3); assert.equal(prepared.participantCount, 34);
  await platform.adminSetNotificationStudyState("ACTIVE", prepared.version);
  const bundle = await platform.adminReadNotificationStudy();
  assert.equal(bundle.assignments.length, 34); assert.equal(bundle.config.status, "ACTIVE"); assert.equal(bundle.flag.enabled, true);
  await platform.adminSaveStudyNotes({ hypothesis: "나의 가설" }, 3);
  await platform.adminSetNotificationStudyState("PAUSED", 3);
  const paused = await platform.adminReadNotificationStudy();
  assert.equal(paused.config.status, "PAUSED"); assert.equal(paused.flag.enabled, false);
  assert.equal(paused.notes.hypothesis, "나의 가설");
});
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
