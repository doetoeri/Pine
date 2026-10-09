import { SCHOOL } from "../../pincon-class-ops-data.js";

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
export const FILE_CHUNK_SIZE = 512 * 1024;
export const ATTACHMENT_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/gif,.pdf,.jpg,.jpeg,.png,.webp,.gif";
export const ATTACHMENT_TYPES = Object.freeze(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"]);
export const ATTACHMENT_SLOTS = Object.freeze({ noticeAttachment: { label: "안내문" }, worksheetPack: { label: "학습지팩" } });

export function withDeadline(promise, message, ms = 30000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => { const error = new Error(message); error.code = "attachment/timeout"; reject(error); }, ms); })]).finally(() => clearTimeout(timer));
}

export async function validateAttachment(slot, file) {
  const spec = ATTACHMENT_SLOTS[slot];
  if (!spec || !(file instanceof File) || !file.size) throw new Error("첨부할 파일을 선택해 주세요.");
  if (file.size > MAX_ATTACHMENT_SIZE) throw new Error(`${spec.label}은 10MB 이하만 올릴 수 있습니다.`);
  const bytes = new Uint8Array(await withDeadline(file.slice(0, 16).arrayBuffer(), "파일을 읽지 못했어요. 파일을 다시 선택해 주세요."));
  const text = new TextDecoder().decode(bytes);
  if (text.startsWith("%PDF-")) return "application/pdf";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if ([137,80,78,71,13,10,26,10].every((value, i) => bytes[i] === value)) return "image/png";
  if (text.startsWith("GIF87a") || text.startsWith("GIF89a")) return "image/gif";
  if (text.startsWith("RIFF") && text.slice(8, 12) === "WEBP") return "image/webp";
  throw new Error(`${spec.label}은 PDF 또는 JPG·PNG·WebP·GIF 이미지로 올려 주세요. 실제 파일 형식을 확인해 주세요.`);
}

function checkScope(classKey, recordId) {
  if (!/^[1-3]-(?:[1-9]|10)$/.test(classKey) || !recordId || /[\/\\]/.test(recordId)) throw new Error("수행평가와 학급 정보를 확인해 주세요.");
}
function filePrefix(classKey, recordId) { checkScope(classKey, recordId); return `class-resources/${SCHOOL.id}/${classKey}/${recordId}/`; }
function fileRef(repository, id) { return repository.api.doc(repository.api.db, "schools", SCHOOL.id, "assessmentFiles", id); }
function chunkRef(repository, id, index) { return repository.api.doc(fileRef(repository, id), "assessmentFileChunks", String(index)); }

export function scopedAttachment(value, slot, classKey, recordId) {
  if (!value) return null;
  checkScope(classKey, recordId);
  if (!ATTACHMENT_SLOTS[slot] || !ATTACHMENT_TYPES.includes(value.contentType)) throw new Error("지원하지 않는 첨부 파일입니다.");
  const shared = { fileName: String(value.fileName || ATTACHMENT_SLOTS[slot].label).slice(0, 160), contentType: value.contentType, fileSize: Number(value.fileSize) || 0 };
  if (value.backend === "firestore") {
    if (!/^[a-zA-Z0-9-]{20,80}$/.test(value.fileId || "") || value.classKey !== classKey || value.recordId !== recordId || shared.fileSize <= 0 || shared.fileSize > MAX_ATTACHMENT_SIZE || value.chunkCount !== Math.ceil(shared.fileSize / FILE_CHUNK_SIZE)) throw new Error("현재 수행평가의 첨부 파일이 아닙니다.");
    return { ...shared, backend: "firestore", fileId: value.fileId, chunkCount: value.chunkCount, classKey, recordId };
  }
  if (!String(value.storagePath || "").startsWith(filePrefix(classKey, recordId))) throw new Error("현재 수행평가의 첨부 파일이 아닙니다.");
  return { ...shared, storagePath: String(value.storagePath).slice(0, 600) };
}

async function removeFiles(repository, files) {
  await Promise.allSettled(files.map(async file => {
    if (file.backend !== "firestore") return withDeadline(repository.api.deleteObject(repository.api.ref(repository.api.storage, file.storagePath)), "기존 첨부 정리 지연", 5000);
    const batch = repository.api.writeBatch(repository.api.db);
    for (let i = 0; i < file.chunkCount; i++) batch.delete(chunkRef(repository, file.fileId, i));
    batch.delete(fileRef(repository, file.fileId));
    await withDeadline(batch.commit(), "첨부 정리 지연", 5000);
  }));
}

// The existing Storage bucket returns 404. Store bounded chunks in the working
// Firestore instead, keeping binary contents out of assignment documents/audits.
// Staged chunks become readable only when their metadata publishes with the assignment.
export async function stageAttachments(repository, classKey, recordId, current, options = {}) {
  const next = {}, uploaded = [], obsolete = [], api = repository.api;
  checkScope(classKey, recordId);
  const selected = [["noticeAttachment", options.noticeFile, options.removeNotice], ["worksheetPack", options.packFile, options.removePack]];
  const types = new Map();
  for (const [slot, file] of selected) if (file) types.set(slot, await validateAttachment(slot, file));
  const totalBytes = selected.reduce((sum, [, file]) => sum + (file?.size || 0), 0);
  let transferred = 0;
  try {
    for (const [slot, file, remove] of selected) {
      const old = scopedAttachment(current?.[slot], slot, classKey, recordId);
      next[slot] = remove ? null : old;
      if (file) {
        if (globalThis.navigator?.onLine === false) throw new Error("인터넷에 연결한 뒤 다시 저장해 주세요. 선택한 파일은 그대로 유지돼요.");
        if (!api.Bytes?.fromUint8Array) throw new Error("파일 저장 모듈을 새로 불러와 주세요. 페이지를 새로고침한 뒤 다시 시도해 주세요.");
        const fileName = String(file.name).replace(/[\/\\<>\x00-\x1f]/g, "-").slice(-160);
        const attachment = { backend: "firestore", fileId: crypto.randomUUID(), classKey, recordId, fileName, contentType: types.get(slot), fileSize: file.size, chunkCount: Math.ceil(file.size / FILE_CHUNK_SIZE) };
        uploaded.push(attachment);
        options.onProgress?.({ phase: "upload", slot, fileName, transferred, totalBytes });
        const begin = api.writeBatch(api.db);
        begin.set(fileRef(repository, attachment.fileId), { ...attachment, slot, state: "staging", createdAtMs: Date.now() });
        const beginCommit = begin.commit();
        try { await withDeadline(beginCommit, "파일 저장소 연결이 지연돼요. 인터넷 연결을 확인한 뒤 다시 저장해 주세요."); }
        catch (error) { beginCommit.then(() => removeFiles(repository, [attachment]), () => {}).catch(() => {}); throw error; }
        for (let offset = 0; offset < attachment.chunkCount; offset += 4) {
          const batch = api.writeBatch(api.db);
          let groupBytes = 0;
          for (let i = offset; i < Math.min(offset + 4, attachment.chunkCount); i++) {
            const bytes = new Uint8Array(await withDeadline(file.slice(i * FILE_CHUNK_SIZE, (i + 1) * FILE_CHUNK_SIZE).arrayBuffer(), "파일을 읽지 못했어요. 다시 선택해 주세요."));
            batch.set(chunkRef(repository, attachment.fileId, i), { data: api.Bytes.fromUint8Array(bytes) });
            groupBytes += bytes.byteLength;
          }
          const partCommit = batch.commit();
          try { await withDeadline(partCommit, "업로드 응답이 지연돼요. 연결을 확인한 뒤 다시 저장해 주세요."); }
          catch (error) { partCommit.then(() => removeFiles(repository, [attachment]), () => {}).catch(() => {}); throw error; }
          transferred += groupBytes;
          options.onProgress?.({ phase: "upload", slot, fileName, transferred, totalBytes });
        }
        next[slot] = attachment;
      }
      if (old && (old.fileId || old.storagePath) !== (next[slot]?.fileId || next[slot]?.storagePath)) obsolete.push(old);
    }
  } catch (error) { await removeFiles(repository, uploaded); throw error; }
  return {
    values: next,
    publish: batch => { for (const file of uploaded) batch.update(fileRef(repository, file.fileId), { state: "ready" }); },
    rollback: () => removeFiles(repository, uploaded), cleanup: () => removeFiles(repository, obsolete),
  };
}

export async function previewAttachment(gateway, recordId, slot) {
  await withDeadline(gateway.start(), "자료 연결이 지연돼요. 다시 시도해 주세요.");
  const snapshot = gateway.snapshot(), repository = gateway.repository;
  if (!repository?.api) throw new Error("파일 저장소 연결을 확인해 주세요.");
  await withDeadline(repository.ensureUser(), "로그인 연결을 확인해 주세요.");
  const record = (snapshot.data?.classAssignments || []).find(row => row.id === recordId && !row.deleted && row.published !== false);
  if (!record) throw new Error("공개된 수행평가를 찾지 못했습니다.");
  const attachment = scopedAttachment(record[slot], slot, snapshot.profile?.classKey, recordId);
  if (!attachment) throw new Error("첨부 파일이 없습니다.");
  let blob;
  if (attachment.backend === "firestore") {
    const meta = await withDeadline(repository.api.getDoc(fileRef(repository, attachment.fileId)), "파일 확인이 지연돼요. 다시 시도해 주세요.");
    if (!meta.exists()) throw new Error("첨부 파일을 찾지 못했습니다.");
    const stored = meta.data();
    if (stored.state !== "ready" || stored.classKey !== attachment.classKey || stored.recordId !== recordId || stored.contentType !== attachment.contentType || stored.chunkCount !== attachment.chunkCount || stored.fileSize !== attachment.fileSize) throw new Error("첨부 파일 정보를 확인할 수 없습니다.");
    const chunks = [];
    for (let offset = 0; offset < attachment.chunkCount; offset += 4) {
      const group = await Promise.all(Array.from({ length: Math.min(4, attachment.chunkCount - offset) }, (_, i) => withDeadline(repository.api.getDoc(chunkRef(repository, attachment.fileId, offset + i)), "파일을 불러오는 중 연결이 끊겼어요. 다시 시도해 주세요.")));
      for (const chunk of group) {
        if (!chunk.exists() || !chunk.data().data?.toUint8Array) throw new Error("파일 일부가 없습니다. 다시 업로드해 주세요.");
        chunks.push(chunk.data().data.toUint8Array());
      }
    }
    blob = new Blob(chunks, { type: attachment.contentType });
    if (blob.size !== attachment.fileSize) throw new Error("파일 크기가 일치하지 않습니다. 다시 업로드해 주세요.");
  } else {
    blob = await withDeadline(repository.api.getBlob(repository.api.ref(repository.api.storage, attachment.storagePath), MAX_ATTACHMENT_SIZE), "파일 저장소 연결이 지연돼요. 다시 시도해 주세요.");
  }
  const url = URL.createObjectURL(new Blob([blob], { type: attachment.contentType }));
  return { ...attachment, url, revoke: () => URL.revokeObjectURL(url) };
}
