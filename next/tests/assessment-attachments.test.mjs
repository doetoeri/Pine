import test from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.window = new EventTarget();
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
const { validateAttachment, scopedAttachment, previewAttachment, MAX_ATTACHMENT_SIZE } = await import("../assessments/attachments.js");
const { ContentServiceV2 } = await import("../admin/content-service-v2.js");
const { assessmentDue, coverflowMarkup } = await import("../assessments/coverflow.js");
const jpg = () => new File([new Uint8Array([255, 216, 255, 224, 0, 16])], "안내문.jpg", { type: "image/jpeg" });
const pdf = () => new File(["%PDF-1.7\nworksheet"], "학습지팩.pdf", { type: "application/pdf" });

function harness() {
  const records = new Map(), files = new Map(), deleted = [], writes = [];
  let rejectCommit = false, allowed = true;
  const api = {
    storage: {}, db: {}, serverTimestamp: () => 1,
    doc: collection => ({ id: "a1", collection }),
    ref: (_storage, fullPath) => ({ fullPath }),
    uploadBytes: async (ref, file, metadata) => { files.set(ref.fullPath, { file, metadata }); return { ref }; },
    deleteObject: async ref => { deleted.push(ref.fullPath); files.delete(ref.fullPath); },
    getBlob: async ref => files.get(ref.fullPath)?.file,
    getDoc: async ref => ({ exists: () => records.has(ref.id), data: () => records.get(ref.id) }),
    writeBatch: () => {
      const pending = [];
      return { set: (ref, value) => pending.push([ref, value]), commit: async () => { if (rejectCommit) throw new Error("permission-denied"); for (const [ref, value] of pending) { writes.push(value); if (ref.collection === "classAssignments") records.set(ref.id, value); } } };
    },
  };
  const repository = { api, ensureUser: async () => ({ uid: "operator", displayName: "관리자" }), collectionRef: name => name, documentRef: (collection, id) => ({ collection, id }) };
  const gateway = { repository, start: async () => {}, snapshot: () => ({ profile: { classKey: "1-8" }, canArchiveContent: allowed, data: { classAssignments: [...records].map(([id, value]) => ({ id, ...value })) } }) };
  return { service: new ContentServiceV2(gateway), gateway, records, files, deleted, writes, failCommit: () => { rejectCommit = true; }, deny: () => { allowed = false; } };
}

test("attachment validation rejects disguised, empty, wrong-extension and oversized files before uploads", async () => {
  assert.equal(await validateAttachment("noticeAttachment", jpg()), "image/jpeg");
  assert.equal(await validateAttachment("worksheetPack", pdf()), "application/pdf");
  await assert.rejects(validateAttachment("noticeAttachment", new File(["%PDF-1.7"], "fake.jpg")), /실제 파일 형식/);
  await assert.rejects(validateAttachment("worksheetPack", new File(["%PDF-1.7"], "wrong.txt")), /PDF/);
  await assert.rejects(validateAttachment("worksheetPack", new File([], "empty.pdf")), /선택/);
  await assert.rejects(validateAttachment("worksheetPack", new File([new Uint8Array(MAX_ATTACHMENT_SIZE + 1)], "large.pdf")), /10MB/);
});

test("assignment save commits both file slots and audit metadata, and a text-only edit preserves them", async () => {
  const h = harness();
  const saved = await h.service.save("classAssignments", { title: "미술 수행", subject: "미술" }, { noticeFile: jpg(), packFile: pdf(), fileConfirmed: true });
  assert.equal(h.files.size, 2);
  assert.equal(saved.record.noticeAttachment.contentType, "image/jpeg");
  assert.equal(saved.record.worksheetPack.contentType, "application/pdf");
  assert.equal(h.writes.at(-1).after.worksheetPack.storagePath, saved.record.worksheetPack.storagePath);
  const edited = await h.service.save("classAssignments", { title: "새 제목", subject: "미술" }, { id: saved.id });
  assert.deepEqual(edited.record.noticeAttachment, saved.record.noticeAttachment);
  assert.deepEqual(edited.record.worksheetPack, saved.record.worksheetPack);
  assert.equal(h.deleted.length, 0);
  const preview = await previewAttachment(h.gateway, saved.id, "worksheetPack");
  assert.match(preview.url, /^blob:/); preview.revoke();
});

test("Firestore failure rolls back new uploads while retaining the previous document and files", async () => {
  const h = harness();
  const old = await h.service.save("classAssignments", { title: "원래 수행" }, { noticeFile: jpg(), fileConfirmed: true });
  h.failCommit();
  await assert.rejects(h.service.save("classAssignments", { title: "변경 수행" }, { id: old.id, noticeFile: jpg(), packFile: pdf(), fileConfirmed: true }));
  assert.equal(h.files.size, 1);
  assert.ok(h.files.has(old.record.noticeAttachment.storagePath));
  assert.equal(h.records.get(old.id).title, "원래 수행");
  assert.equal(h.service.busy, false);
});

test("replacement and unlink remove obsolete files only after the record commits", async () => {
  const h = harness();
  const old = await h.service.save("classAssignments", { title: "수행" }, { noticeFile: jpg(), packFile: pdf(), fileConfirmed: true });
  const updated = await h.service.save("classAssignments", { title: "수행" }, { id: old.id, noticeFile: jpg(), removePack: true, fileConfirmed: true });
  assert.notEqual(updated.record.noticeAttachment.storagePath, old.record.noticeAttachment.storagePath);
  assert.equal(updated.record.worksheetPack, null);
  assert.equal(h.files.size, 1);
  assert.deepEqual(new Set(h.deleted), new Set([old.record.noticeAttachment.storagePath, old.record.worksheetPack.storagePath]));
});

test("read-only users and missing file confirmation cannot upload, and foreign paths cannot be previewed", async () => {
  const h = harness(); h.deny();
  await assert.rejects(h.service.save("classAssignments", { title: "수행" }, { noticeFile: jpg(), fileConfirmed: true }), /권한/);
  assert.equal(h.files.size, 0);
  const h2 = harness();
  await assert.rejects(h2.service.save("classAssignments", { title: "수행" }, { noticeFile: jpg() }), /공유 권한/);
  assert.equal(h2.files.size, 0);
  assert.throws(() => scopedAttachment({ storagePath: "class-resources/gochon-high/1-7/a1/file.jpg", contentType: "image/jpeg" }, "noticeAttachment", "1-8", "a1"), /현재 수행평가/);
});

test("coverflow dates use Korea time and titles are escaped without adding sample assessments", () => {
  assert.equal(assessmentDue("2026-10-09", Date.parse("2026-10-08T16:00:00Z")), "D-DAY");
  assert.equal(assessmentDue("2026-10-08", Date.parse("2026-10-08T16:00:00Z")), "마감 지남");
  assert.equal(assessmentDue(""), "미정");
  assert.match(coverflowMarkup([], "1-8"), /등록된 수행평가가 없습니다/);
  const markup = coverflowMarkup([{ id: "a1", title: '<img src=x onerror="boom()">', detailKey: "a1" }], "1-8");
  assert.doesNotMatch(markup, /<img src=x/);
  assert.match(markup, /&lt;img/);
});
