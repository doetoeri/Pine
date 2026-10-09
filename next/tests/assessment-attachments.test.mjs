import test from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.window = new EventTarget();
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
const { validateAttachment, scopedAttachment, previewAttachment, withDeadline, MAX_ATTACHMENT_SIZE, FILE_CHUNK_SIZE } = await import("../assessments/attachments.js");
const { ContentServiceV2 } = await import("../admin/content-service-v2.js");
const { assessmentDue, coverflowMarkup } = await import("../assessments/coverflow.js");
const jpg = () => new File([new Uint8Array([255, 216, 255, 224, 0, 16])], "안내문.jpg", { type: "image/jpeg" });
const pdf = () => new File(["%PDF-1.7\nworksheet"], "학습지팩.pdf", { type: "application/pdf" });

function harness() {
  const documents = new Map(), deleted = [], writes = [], legacyFiles = new Map();
  let rejectAssignment = false, rejectChunk = false, allowed = true;
  const api = {
    storage: {}, db: {}, serverTimestamp: () => 1,
    Bytes: { fromUint8Array: bytes => ({ toUint8Array: () => bytes }) },
    doc: (...args) => { const parts = args[0] === api.db ? args.slice(1) : [args[0].path || args[0], ...args.slice(1)]; if (parts.length === 1) parts.push(crypto.randomUUID()); const path = parts.join("/"); return { path, id: parts.at(-1) }; },
    ref: (_storage, fullPath) => ({ fullPath }),
    deleteObject: async ref => { deleted.push(ref.fullPath); legacyFiles.delete(ref.fullPath); },
    getBlob: async ref => legacyFiles.get(ref.fullPath),
    getDoc: async ref => ({ exists: () => documents.has(ref.path), data: () => documents.get(ref.path) }),
    writeBatch: () => {
      const pending = [];
      return {
        set: (ref, value) => pending.push(["set", ref, value]), update: (ref, value) => pending.push(["update", ref, value]), delete: ref => pending.push(["delete", ref]),
        commit: async () => {
          if (rejectAssignment && pending.some(([,ref]) => ref.path.includes("/classAssignments/"))) throw new Error("permission-denied");
          if (rejectChunk && pending.some(([action,ref]) => action === "set" && ref.path.includes("/assessmentFileChunks/"))) throw new Error("chunk-failed");
          for (const [action, ref, value] of pending) {
            if (action === "delete") { deleted.push(ref.path); documents.delete(ref.path); }
            else { writes.push({ path: ref.path, value }); documents.set(ref.path, action === "update" ? { ...documents.get(ref.path), ...value } : value); }
          }
        },
      };
    },
  };
  const repository = { api, ensureUser: async () => ({ uid: "operator", displayName: "관리자" }), collectionRef: name => `schools/gochon-high/${name}`, documentRef: (collection, id) => api.doc(api.db, "schools", "gochon-high", collection, id) };
  const gateway = { repository, start: async () => {}, snapshot: () => ({ profile: { classKey: "1-8" }, canArchiveContent: allowed, data: { classAssignments: [...documents].filter(([path]) => /\/classAssignments\/[^/]+$/.test(path)).map(([path, value]) => ({ id: path.split("/").at(-1), ...value })) } }) };
  return { service: new ContentServiceV2(gateway), gateway, documents, writes, deleted, legacyFiles, files: () => [...documents].filter(([path]) => /\/assessmentFiles\/[^/]+$/.test(path)), failAssignment: () => { rejectAssignment = true; }, failChunk: () => { rejectChunk = true; }, deny: () => { allowed = false; } };
}

test("both slots accept PDFs and supported images using bytes rather than unreliable mobile MIME/name", async () => {
  for (const slot of ["noticeAttachment", "worksheetPack"]) {
    assert.equal(await validateAttachment(slot, jpg()), "image/jpeg");
    assert.equal(await validateAttachment(slot, pdf()), "application/pdf");
    assert.equal(await validateAttachment(slot, new File(["%PDF-1.7\n"], "provider-file", { type: "" })), "application/pdf");
    assert.equal(await validateAttachment(slot, new File([new Uint8Array([137,80,78,71,13,10,26,10])], "screenshot.png")), "image/png");
    assert.equal(await validateAttachment(slot, new File(["GIF89a"], "animation.gif")), "image/gif");
    assert.equal(await validateAttachment(slot, new File(["RIFFxxxxWEBP"], "image.webp")), "image/webp");
    await assert.rejects(validateAttachment(slot, new File(["wrong"], "fake.pdf")), /실제 파일 형식/);
    await assert.rejects(validateAttachment(slot, new File([], "empty.pdf")), /선택/);
    await assert.rejects(validateAttachment(slot, new File([new Uint8Array(MAX_ATTACHMENT_SIZE + 1)], "large.pdf")), /10MB/);
  }
});

test("swapped JPG/PDF slots publish with assignment and audit; a text-only edit preserves both", async () => {
  const h = harness(), progress = [];
  const saved = await h.service.save("classAssignments", { title: "미술 수행" }, { noticeFile: pdf(), packFile: jpg(), fileConfirmed: true, onProgress: p => progress.push(p) });
  assert.equal(h.files().length, 2);
  assert.equal(saved.record.noticeAttachment.contentType, "application/pdf");
  assert.equal(saved.record.worksheetPack.contentType, "image/jpeg");
  assert.equal(saved.record.noticeAttachment.backend, "firestore");
  assert.ok(h.files().every(([,data]) => data.state === "ready"));
  const audit = h.writes.find(x => x.path.includes("/changeLogs/"));
  assert.equal(audit.value.after.worksheetPack.fileId, saved.record.worksheetPack.fileId);
  assert.ok(progress.some(p => p.phase === "upload" && p.transferred === p.totalBytes));
  const edited = await h.service.save("classAssignments", { title: "새 제목" }, { id: saved.id });
  assert.deepEqual(edited.record.noticeAttachment, saved.record.noticeAttachment);
  assert.deepEqual(edited.record.worksheetPack, saved.record.worksheetPack);
  assert.equal(h.deleted.length, 0);
  const preview = await previewAttachment(h.gateway, saved.id, "noticeAttachment");
  assert.equal(preview.contentType, "application/pdf");
  assert.equal(await (await fetch(preview.url)).text(), await pdf().text());
  preview.revoke();
});

test("large binary files reconstruct exactly across chunk groups, without leaking bytes into public records", async () => {
  const h = harness();
  const bytes = new Uint8Array(FILE_CHUNK_SIZE * 5 + 51); bytes.set([255,216,255]); for (let i = 3; i < bytes.length; i++) bytes[i] = i % 253;
  const saved = await h.service.save("classAssignments", { title: "큰 이미지" }, { noticeFile: new File([bytes], "large.jpg"), fileConfirmed: true });
  assert.equal(saved.record.noticeAttachment.chunkCount, 6);
  assert.ok(!JSON.stringify(saved.record).includes('"data"'));
  const preview = await previewAttachment(h.gateway, saved.id, "noticeAttachment");
  assert.deepEqual(new Uint8Array(await (await fetch(preview.url)).arrayBuffer()), bytes); preview.revoke();
});

test("failed assignment or chunk writes clean staged files and keep previous attachments", async () => {
  const h = harness();
  const old = await h.service.save("classAssignments", { title: "원래 수행" }, { noticeFile: jpg(), fileConfirmed: true });
  h.failAssignment();
  await assert.rejects(h.service.save("classAssignments", { title: "변경 수행" }, { id: old.id, noticeFile: pdf(), packFile: jpg(), fileConfirmed: true }));
  assert.equal(h.files().length, 1);
  assert.equal(h.files()[0][1].fileId, old.record.noticeAttachment.fileId);
  assert.equal(h.gateway.snapshot().data.classAssignments[0].title, "원래 수행");
  assert.equal(h.service.busy, false);
  const h2 = harness(); h2.failChunk();
  await assert.rejects(h2.service.save("classAssignments", { title: "실패" }, { noticeFile: jpg(), fileConfirmed: true }), /chunk-failed/);
  assert.equal(h2.documents.size, 0);
});

test("replacement and unlink remove old files only after publication", async () => {
  const h = harness();
  const old = await h.service.save("classAssignments", { title: "수행" }, { noticeFile: jpg(), packFile: pdf(), fileConfirmed: true });
  const updated = await h.service.save("classAssignments", { title: "수행" }, { id: old.id, noticeFile: pdf(), removePack: true, fileConfirmed: true });
  assert.notEqual(updated.record.noticeAttachment.fileId, old.record.noticeAttachment.fileId);
  assert.equal(updated.record.worksheetPack, null);
  assert.equal(h.files().length, 1);
});

test("read-only, unconfirmed, offline and foreign-class uploads are rejected before file writes", async () => {
  const h = harness(); h.deny();
  await assert.rejects(h.service.save("classAssignments", { title: "수행" }, { noticeFile: jpg(), fileConfirmed: true }), /권한/); assert.equal(h.documents.size, 0);
  const h2 = harness();
  await assert.rejects(h2.service.save("classAssignments", { title: "수행" }, { noticeFile: jpg() }), /공유 권한/); assert.equal(h2.documents.size, 0);
  navigator.onLine = false;
  try { await assert.rejects(h2.service.save("classAssignments", { title: "수행" }, { noticeFile: jpg(), fileConfirmed: true }), /인터넷/); } finally { navigator.onLine = true; }
  assert.equal(h2.documents.size, 0);
  const saved = await h2.service.save("classAssignments", { title: "수행" }, { noticeFile: jpg(), fileConfirmed: true });
  assert.throws(() => scopedAttachment(saved.record.noticeAttachment, "noticeAttachment", "1-7", saved.id), /현재 수행평가/);
  const metaPath = h2.files()[0][0]; h2.documents.set(metaPath, { ...h2.documents.get(metaPath), state: "staging" });
  await assert.rejects(previewAttachment(h2.gateway, saved.id, "noticeAttachment"), /파일 정보/);
});

test("legacy Storage attachments remain supported and stalled requests have a bounded deadline", async () => {
  const h = harness(), path = "class-resources/gochon-high/1-8/old/file.jpg";
  h.documents.set("schools/gochon-high/classAssignments/old", { title: "기존", published: true, noticeAttachment: { storagePath: path, contentType: "image/jpeg", fileSize: jpg().size, fileName: "기존.jpg" } }); h.legacyFiles.set(path, jpg());
  const preview = await previewAttachment(h.gateway, "old", "noticeAttachment"); assert.equal(preview.contentType, "image/jpeg"); preview.revoke();
  await assert.rejects(withDeadline(new Promise(() => {}), "연결 지연", 5), { code: "attachment/timeout" });
});

test("coverflow dates use Korea time and titles are escaped without adding sample assessments", () => {
  assert.equal(assessmentDue("2026-10-09", Date.parse("2026-10-08T16:00:00Z")), "D-DAY");
  assert.equal(assessmentDue("2026-10-08", Date.parse("2026-10-08T16:00:00Z")), "마감 지남");
  assert.equal(assessmentDue(""), "미정");
  assert.match(coverflowMarkup([], "1-8"), /등록된 수행평가가 없습니다/);
  const markup = coverflowMarkup([{ id: "a1", title: '<img src=x onerror="boom()">', detailKey: "a1" }], "1-8");
  assert.doesNotMatch(markup, /<img src=x/); assert.match(markup, /&lt;img/);
});
