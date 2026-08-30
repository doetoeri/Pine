import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from "firebase/firestore";

const PROJECT_ID = "pincon-production-rbac-rules-test";
const SCHOOL_ID = "gochon-high";
const CLASS_KEY = "1-8";
const SERVER_ONLY_COLLECTIONS = [
  "users",
  "accountAudit",
  "classDepartments",
  "onePersonRoles",
  "classOpsSettings",
  "cleaningAssignments",
  "cleaningRequests",
  "cleaningExemptions",
  "phoneStates",
  "phoneSessions",
  "subjectEntries",
  "classOpsAudit",
  "personalNotifications",
];

let env;

const rolePath = (uid) => `schools/${SCHOOL_ID}/roles/${uid}`;
const privatePath = (collection, id = "private-1") => `schools/${SCHOOL_ID}/${collection}/${id}`;

async function seed() {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, rolePath("school-admin")), { enabled: true, level: "school", classKeys: [] }),
      setDoc(doc(db, rolePath("president")), { enabled: true, level: "president", classKeys: [CLASS_KEY] }),
      setDoc(doc(db, rolePath("student")), { enabled: false, level: "viewer", classKeys: [CLASS_KEY] }),
      ...SERVER_ONLY_COLLECTIONS.map((collection) => setDoc(doc(db, privatePath(collection)), {
        classKey: CLASS_KEY,
        userUid: "student",
        targetUid: "student",
        status: "ACTIVE",
        createdAtMs: 1,
        updatedAtMs: 1,
      })),
    ]);
  });
}

test.before(async () => {
  const rules = await readFile(new URL("../../firestore.rules", import.meta.url), "utf8");
  env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules } });
});

test.after(async () => {
  await env?.cleanup();
});

test.beforeEach(async () => {
  await env.clearFirestore();
  await seed();
});

test("student operations collections are inaccessible directly from the browser for every role", async () => {
  for (const uid of ["student", "president", "school-admin"]) {
    const db = env.authenticatedContext(uid).firestore();
    for (const collection of SERVER_ONLY_COLLECTIONS) {
      await assertFails(getDoc(doc(db, privatePath(collection))));
      await assertFails(setDoc(doc(db, privatePath(collection, `${uid}-write`)), {
        classKey: CLASS_KEY,
        userUid: uid,
        targetUid: uid,
        createdAtMs: 2,
        updatedAtMs: 2,
      }));
    }
  }
});

test("unauthenticated clients cannot read or write student operations collections", async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, privatePath("users"))));
  await assertFails(getDoc(doc(db, privatePath("personalNotifications"))));
  await assertFails(setDoc(doc(db, privatePath("phoneStates", "public-write")), { classKey: CLASS_KEY }));
  await assertFails(setDoc(doc(db, privatePath("personalNotifications", "public-write")), { classKey: CLASS_KEY, targetUid: "student" }));
});

test("legacy role documents remain self-readable while role mutation stays school-admin only", async () => {
  const presidentDb = env.authenticatedContext("president").firestore();
  const adminDb = env.authenticatedContext("school-admin").firestore();

  await assertSucceeds(getDoc(doc(presidentDb, rolePath("president"))));
  await assertFails(getDoc(doc(presidentDb, rolePath("school-admin"))));
  await assertFails(updateDoc(doc(presidentDb, rolePath("student")), { enabled: true }));
  await assertSucceeds(updateDoc(doc(adminDb, rolePath("student")), { enabled: true }));
});
