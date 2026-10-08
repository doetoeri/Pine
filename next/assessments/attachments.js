import { SCHOOL } from "../../pincon-class-ops-data.js";

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
export const ATTACHMENT_SLOTS = Object.freeze({
  noticeAttachment: { label: "안내문", type: "image/jpeg", extension: /\.jpe?g$/i },
  worksheetPack: { label: "학습지팩", type: "application/pdf", extension: /\.pdf$/i },
});

export async function validateAttachment(slot, file) {
  const spec = ATTACHMENT_SLOTS[slot];
  if (!spec || !(file instanceof File) || !file.size) throw new Error("첨부할 파일을 선택해 주세요.");
  if (file.size > MAX_ATTACHMENT_SIZE) throw new Error(`${spec.label}은 10MB 이하만 올릴 수 있습니다.`);
  if (!spec.extension.test(file.name)) throw new Error(`${spec.label}은 ${slot === "noticeAttachment" ? "JPG/JPEG" : "PDF"} 파일로 올려 주세요.`);
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const matches = slot === "noticeAttachment"
    ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : new TextDecoder().decode(bytes).startsWith("%PDF-");
  if (!matches) throw new Error(`${spec.label}의 실제 파일 형식을 확인해 주세요.`);
  return spec.type;
}

function filePrefix(classKey, recordId) {
  if (!/^[1-3]-(?:[1-9]|10)$/.test(classKey) || !recordId || /[\/\\]/.test(recordId)) throw new Error("수행평가와 학급 정보를 확인해 주세요.");
  return `class-resources/${SCHOOL.id}/${classKey}/${recordId}/`;
}

export function scopedAttachment(value, slot, classKey, recordId) {
  if (!value) return null;
  const spec = ATTACHMENT_SLOTS[slot];
  if (!spec || value.contentType !== spec.type || !String(value.storagePath || "").startsWith(filePrefix(classKey, recordId))) throw new Error("현재 수행평가의 첨부 파일이 아닙니다.");
  return {
    fileName: String(value.fileName || spec.label).slice(0, 160),
    storagePath: String(value.storagePath).slice(0, 600),
    contentType: spec.type,
    fileSize: Math.max(0, Math.min(MAX_ATTACHMENT_SIZE, Number(value.fileSize) || 0)),
  };
}

// Uploads are staged until the assignment and its audit log commit together.
export async function stageAttachments(repository, classKey, recordId, current, options = {}) {
  const next = {}, uploaded = [], obsolete = [];
  for (const [slot, file] of [["noticeAttachment", options.noticeFile], ["worksheetPack", options.packFile]]) {
    if (file) await validateAttachment(slot, file);
  }
  const removePaths = async paths => {
    await Promise.allSettled(paths.map(path => repository.api.deleteObject(repository.api.ref(repository.api.storage, path))));
  };
  try {
    for (const [slot, file, remove] of [["noticeAttachment", options.noticeFile, options.removeNotice], ["worksheetPack", options.packFile, options.removePack]]) {
      const old = scopedAttachment(current?.[slot], slot, classKey, recordId);
      next[slot] = remove ? null : old;
      if (file) {
        const safeName = String(file.name).replace(/[^0-9A-Za-z가-힣._-]+/g, "-").slice(-120);
        const path = filePrefix(classKey, recordId) + `${crypto.randomUUID()}-${safeName}`;
        const ref = repository.api.ref(repository.api.storage, path);
        await repository.api.uploadBytes(ref, file, { contentType: ATTACHMENT_SLOTS[slot].type, contentDisposition: `inline; filename="${safeName}"`, customMetadata: { classKey, recordId, slot } });
        uploaded.push(path);
        next[slot] = { fileName: safeName, storagePath: path, contentType: ATTACHMENT_SLOTS[slot].type, fileSize: file.size };
      }
      if (old && old.storagePath !== next[slot]?.storagePath) obsolete.push(old.storagePath);
    }
  } catch (error) {
    await removePaths(uploaded);
    throw error;
  }
  return { values: next, rollback: () => removePaths(uploaded), cleanup: () => removePaths(obsolete) };
}

export async function previewAttachment(gateway, recordId, slot) {
  await gateway.start();
  const snapshot = gateway.snapshot();
  const repository = gateway.repository;
  if (!repository?.api) throw new Error("파일 저장소 연결을 확인해 주세요.");
  await repository.ensureUser();
  const record = (snapshot.data?.classAssignments || []).find(row => row.id === recordId && !row.deleted && row.published !== false);
  if (!record) throw new Error("공개된 수행평가를 찾지 못했습니다.");
  const attachment = scopedAttachment(record[slot], slot, snapshot.profile?.classKey, recordId);
  if (!attachment) throw new Error("첨부 파일이 없습니다.");
  const blob = await repository.api.getBlob(repository.api.ref(repository.api.storage, attachment.storagePath), MAX_ATTACHMENT_SIZE);
  const url = URL.createObjectURL(new Blob([blob], { type: attachment.contentType }));
  return { ...attachment, url, revoke: () => URL.revokeObjectURL(url) };
}
