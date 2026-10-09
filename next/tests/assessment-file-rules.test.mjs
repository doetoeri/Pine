import test from "node:test";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch, Bytes, collection, serverTimestamp } from "firebase/firestore";
const PROJECT = "pincon-assessment-files-test", SCHOOL = "gochon-high", ID = "test-assessment-file-0001";
let env;
const path = file => `schools/${SCHOOL}/assessmentFiles/${file || ID}`;
const assignmentPath = `schools/${SCHOOL}/classAssignments/a1`;
const metadata = extra => ({ backend: "firestore", fileId: ID, classKey: "1-8", recordId: "a1", fileName: "안내문.pdf", contentType: "application/pdf", fileSize: 3, chunkCount: 1, slot: "noticeAttachment", state: "staging", createdAtMs: 1000, ...extra });
const assignment = extra => ({ title: "수행평가", classKey: "1-8", type: "assessment", subject: "미술", dueDate: "", dueAtMs: 0, description: "", dateType: "undecided", verificationStatus: "review", published: true, deleted: false, recoveryRelevant: true, announcedDate: "2026-10-09", createdAtMs: 1000, updatedAtMs: 1000, ...extra });
function db(uid) { return uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore(); }
async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const database = context.firestore();
    for (const [uid, level, classes, enabled] of [["operator","class",["1-8"],true],["other","class",["1-7"],true],["disabled","class",["1-8"],false]]) await setDoc(doc(database, `schools/${SCHOOL}/roles/${uid}`), { level, classKeys: classes, enabled });
  });
}
async function staged() {
  const database = db("operator");
  await setDoc(doc(database, path()), metadata());
  await setDoc(doc(database, path()+"/assessmentFileChunks/0"), { data: Bytes.fromUint8Array(new Uint8Array([1,2,3])) });
  return database;
}
async function publish(database, extra = {}) {
  const batch = writeBatch(database);
  batch.set(doc(database, assignmentPath), assignment({ noticeAttachment: metadata(), ...extra }));
  batch.update(doc(database, path()), { state: "ready" });
  return batch.commit();
}
test.before(async () => { env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { host: "127.0.0.1", port: Number(process.env.FIRESTORE_EMULATOR_HOST?.split(":").at(-1) || 8089), rules: await readFile(new URL("../../firestore.rules", import.meta.url), "utf8") } }); });
test.beforeEach(seed);
test.after(async () => env?.cleanup());

test("only an enabled operator for the file class can stage uploads", async () => {
  for (const uid of [null, "student", "other", "disabled"]) await assertFails(setDoc(doc(db(uid), path()), metadata()));
  await assertSucceeds(setDoc(doc(db("operator"), path()), metadata()));
  await assertSucceeds(getDoc(doc(db("operator"), path())));
});
test("metadata rejects oversized files, untrusted types and forged chunk counts", async () => {
  const database = db("operator");
  for (const extra of [{ fileSize: 10485761, chunkCount: 21 }, { contentType: "text/html" }, { fileSize: 524289, chunkCount: 1 }, { fileId: "different" }, { state: "ready" }]) await assertFails(setDoc(doc(database, path()), metadata(extra)));
});
test("staged file bytes remain private and cannot be published without an assignment reference", async () => {
  const database = await staged();
  await assertFails(getDoc(doc(db("student"), path())));
  await assertFails(getDoc(doc(db("student"), path()+"/assessmentFileChunks/0")));
  await assertFails(updateDoc(doc(database, path()), { state: "ready" }));
  await assertFails(updateDoc(doc(database, path()), { classKey: "1-7" }));
});
test("an atomic assignment reference enables authenticated previews; unlinking hides bytes", async () => {
  const database = await staged();
  await assertSucceeds(publish(database));
  await assertSucceeds(getDoc(doc(db("student"), path())));
  await assertSucceeds(getDoc(doc(db("student"), path()+"/assessmentFileChunks/0")));
  await assertFails(getDoc(doc(db(null), path()+"/assessmentFileChunks/0")));
  await assertSucceeds(updateDoc(doc(database, assignmentPath), { noticeAttachment: null }));
  await assertFails(getDoc(doc(db("student"), path()+"/assessmentFileChunks/0")));
});
test("unpublished assignments cannot expose their attached files", async () => {
  const database = await staged();
  await assertSucceeds(publish(database, { published: false }));
  await assertFails(getDoc(doc(db("student"), path())));
  await assertSucceeds(getDoc(doc(database, path()+"/assessmentFileChunks/0")));
});
test("chunks require bounded bytes and cannot be changed after upload", async () => {
  const database = db("operator");
  await setDoc(doc(database, path()), metadata());
  await assertFails(setDoc(doc(database, path()+"/assessmentFileChunks/0"), { data: "script" }));
  await assertFails(setDoc(doc(database, path()+"/assessmentFileChunks/20"), { data: Bytes.fromUint8Array(new Uint8Array([1])) }));
  await assertFails(setDoc(doc(database, path()+"/assessmentFileChunks/0"), { data: Bytes.fromUint8Array(new Uint8Array(524289)) }));
  await assertSucceeds(setDoc(doc(database, path()+"/assessmentFileChunks/0"), { data: Bytes.fromUint8Array(new Uint8Array([1,2,3])) }));
  await assertFails(updateDoc(doc(database, path()+"/assessmentFileChunks/0"), { data: Bytes.fromUint8Array(new Uint8Array([4])) }));
});
test("only the scoped operator can clean staged or obsolete files", async () => {
  const database = await staged();
  await assertFails(deleteDoc(doc(db("student"), path())));
  await assertFails(deleteDoc(doc(db("other"), path()+"/assessmentFileChunks/0")));
  const batch = writeBatch(database); batch.delete(doc(database, path()+"/assessmentFileChunks/0")); batch.delete(doc(database, path()));
  await assertSucceeds(batch.commit());
});


test("real Firebase SDK saves both attachments, publishes audit and reconstructs a multipart preview", async () => {
  globalThis.window = new EventTarget();
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
  const { ContentServiceV2 } = await import("../admin/content-service-v2.js");
  const { previewAttachment } = await import("../assessments/attachments.js");
  const database = db("operator");
  const api = { db: database, doc, collection, serverTimestamp, writeBatch, getDoc, Bytes };
  let rows = [];
  const repository = { api, ensureUser: async () => ({ uid: "operator" }), collectionRef: name => collection(database, "schools", SCHOOL, name), documentRef: (name, id) => doc(database, "schools", SCHOOL, name, id) };
  const gateway = { repository, start: async () => {}, snapshot: () => ({ profile: { classKey: "1-8" }, canArchiveContent: true, data: { classAssignments: rows } }) };
  const bytes = new Uint8Array(524288 * 2 + 53); bytes.set([255,216,255]);
  for (let i = 3; i < bytes.length; i++) bytes[i] = i % 253;
  const saved = await new ContentServiceV2(gateway).save("classAssignments", { title: "실제 SDK 파일 검증", subject: "미술" }, { noticeFile: new File(["%PDF-1.7\nworksheet"], "안내문.pdf"), packFile: new File([bytes], "학습지.jpg"), fileConfirmed: true });
  rows = [{ id: saved.id, ...saved.record }];
  const studentApi = { ...api, db: db("student") };
  gateway.repository = { ...repository, api: studentApi, ensureUser: async () => ({ uid: "student" }) };
  const preview = await previewAttachment(gateway, saved.id, "worksheetPack");
  const actual = new Uint8Array(await (await fetch(preview.url)).arrayBuffer()); preview.revoke();
  if (actual.length !== bytes.length || actual.some((b, i) => b !== bytes[i])) throw new Error("Binary preview differs from upload");
});
