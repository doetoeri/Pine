import { NextDataGateway } from "../core/data-gateway.js";
import { SCHOOL } from "../../pincon-class-ops-data.js";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Map([
  ["application/pdf", "pdf"],
  ["image/jpeg", "image"],
  ["image/png", "image"],
  ["image/webp", "image"],
]);

function clean(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function safeFileName(value) {
  return clean(value || "file", 160).replace(/[^0-9A-Za-z가-힣._-]+/g, "-").slice(-120);
}

function normalizeContentType(file) {
  const direct = clean(file?.type, 100).toLowerCase();
  if (direct === "image/jpg" || direct === "image/pjpeg") return "image/jpeg";
  if (ALLOWED_TYPES.has(direct)) return direct;
  const name = clean(file?.name, 200).toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (/\.jpe?g$/.test(name)) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  return direct;
}

function previewTypeFor(contentType, mediaKind = "") {
  if (contentType === "application/pdf" || mediaKind === "pdf") return "pdf";
  if (String(contentType || "").startsWith("image/") || mediaKind === "image") return "image";
  return "link";
}

function safeUrl(value) {
  const text = clean(value, 1200);
  if (!text) return "";
  const url = new URL(text);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("학교 원문 링크는 http 또는 https 주소여야 합니다.");
  return url.href;
}

function dateValue(value) {
  const text = clean(value, 10);
  if (!text) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("공개 날짜를 확인해 주세요.");
  return text;
}

function today() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function assertFile(file) {
  if (!(file instanceof File) || !file.size) throw new Error("평가계획서 파일을 선택해 주세요.");
  if (file.size > MAX_FILE_SIZE) throw new Error("평가계획서는 10MB 이하 파일만 올릴 수 있습니다.");
  const contentType = normalizeContentType(file);
  if (!ALLOWED_TYPES.has(contentType)) throw new Error("평가계획서는 PDF, JPG/JPEG, PNG, WEBP 파일만 지원합니다.");
  const mediaKind = ALLOWED_TYPES.get(contentType);
  return { contentType, mediaKind, previewType: previewTypeFor(contentType, mediaKind) };
}

function normalizePlan(values = {}, current = null) {
  const title = clean(values.title, 140);
  const subject = clean(values.subject, 40);
  if (!title) throw new Error("평가계획서 제목을 입력해 주세요.");
  if (!subject) throw new Error("과목을 입력해 주세요.");

  const status = ["draft", "review", "verified"].includes(values.status) ? values.status : "review";
  const published = status !== "draft" && values.published !== false;
  const schoolYear = Math.max(2000, Math.min(2100, Math.trunc(Number(values.schoolYear || new Date().getFullYear()))));
  const semester = Number(values.semester) === 1 ? 1 : 2;
  const sourceUrl = safeUrl(values.sourceUrl || current?.sourceUrl || "");
  const storagePath = clean(values.storagePath ?? current?.storagePath, 700);
  const contentType = normalizeContentType({
    type: values.contentType ?? current?.contentType,
    name: values.fileName ?? current?.fileName,
  });
  const mediaKind = clean(values.mediaKind ?? current?.mediaKind ?? ALLOWED_TYPES.get(contentType), 20);
  const previewType = previewTypeFor(contentType, mediaKind || (sourceUrl ? "link" : ""));

  if (published && !storagePath && !sourceUrl) {
    throw new Error("학생에게 공개하려면 PDF·JPG·PNG·WEBP 파일 또는 학교 원문 링크가 필요합니다.");
  }

  return {
    title,
    subject,
    schoolYear,
    semester,
    status,
    published,
    sourceUrl,
    sourceAttribution: clean(values.sourceAttribution || current?.sourceAttribution || "고촌고등학교 평가계획서", 300),
    description: clean(values.description, 1200),
    announcedDate: dateValue(values.announcedDate) || current?.announcedDate || today(),
    pageCount: Math.max(0, Math.min(999, Math.trunc(Number(values.pageCount || current?.pageCount || 0)))),
    recoveryRelevant: values.recoveryRelevant !== false,
    fileName: clean(values.fileName ?? current?.fileName, 180),
    storagePath,
    contentType,
    mediaKind,
    previewType,
    fileSize: Math.max(0, Number(values.fileSize ?? current?.fileSize ?? 0)),
    revision: Math.max(1, Number(current?.revision || 0) + 1),
  };
}

export class EvaluationPlanService {
  constructor(gateway = new NextDataGateway()) {
    this.gateway = gateway;
  }

  async ready() {
    await this.gateway.start();
    const repository = this.gateway.repository;
    if (!repository?.api) throw new Error("평가계획서 저장소 연결이 준비되지 않았습니다.");
    return repository;
  }

  snapshot() {
    return this.gateway.snapshot();
  }

  plans({ includeArchived = false, includeDrafts = false } = {}) {
    return (this.snapshot().data?.evaluationPlans || [])
      .filter((item) => includeArchived || item.deleted !== true)
      .filter((item) => includeDrafts || (item.status !== "draft" && item.published !== false))
      .sort((a, b) => {
        const subject = String(a.subject || "").localeCompare(String(b.subject || ""), "ko");
        if (subject) return subject;
        return Number(b.updatedAtMs || b.createdAtMs || 0) - Number(a.updatedAtMs || a.createdAtMs || 0);
      });
  }

  async upload(recordId, file) {
    const repository = await this.ready();
    const state = this.snapshot();
    if (!state.canArchiveContent) throw new Error("평가계획서 파일 업로드는 학급 운영자만 가능합니다.");
    const { contentType, mediaKind, previewType } = assertFile(file);
    const fileName = safeFileName(file.name);
    const path = `class-evaluation-plans/${SCHOOL.id}/${state.profile.classKey}/${recordId}/${Date.now()}-${fileName}`;
    const storageRef = repository.api.ref(repository.api.storage, path);
    const result = await repository.api.uploadBytes(storageRef, file, {
      contentType,
      contentDisposition: `inline; filename="${fileName.replaceAll('"', "")}"`,
      customMetadata: {
        classKey: state.profile.classKey,
        recordId,
        mediaKind,
        previewType,
      },
    });
    return {
      fileName,
      storagePath: result.ref.fullPath,
      contentType,
      mediaKind,
      previewType,
      fileSize: file.size,
    };
  }

  async save(values, { id = "", file = null, confirmed = false } = {}) {
    const repository = await this.ready();
    const state = this.snapshot();
    if (!state.canArchiveContent) throw new Error("평가계획서는 학급 운영자만 등록·수정할 수 있습니다.");
    if (!confirmed) throw new Error("공유 권한과 개인정보 제거 여부를 확인해 주세요.");

    const current = id ? (state.data?.evaluationPlans || []).find((item) => item.id === id) : null;
    const recordId = id || repository.api.doc(repository.collectionRef("evaluationPlans")).id;
    let upload = null;
    if (file) upload = await this.upload(recordId, file);

    const plan = normalizePlan({ ...values, ...(upload || {}) }, current || null);
    const action = current ? "update" : "create";
    await repository.adminWrite("evaluationPlans", plan, {
      id: recordId,
      action,
      label: `${plan.subject} · ${plan.title}`,
    });

    if (upload && current?.storagePath && current.storagePath !== upload.storagePath) {
      const prefix = `class-evaluation-plans/${SCHOOL.id}/${state.profile.classKey}/`;
      if (String(current.storagePath).startsWith(prefix)) {
        repository.api.deleteObject(repository.api.ref(repository.api.storage, current.storagePath)).catch(() => {});
      }
    }
    return recordId;
  }

  async archive(id) {
    return this.gateway.archiveManagedRecord("evaluationPlans", id);
  }

  async restore(id) {
    return this.gateway.restoreManagedRecord("evaluationPlans", id);
  }

  async preview(planOrId) {
    const repository = await this.ready();
    const state = this.snapshot();
    const plan = typeof planOrId === "string"
      ? (state.data?.evaluationPlans || []).find((item) => item.id === planOrId)
      : planOrId;
    if (!plan?.storagePath) return null;
    const prefix = `class-evaluation-plans/${SCHOOL.id}/${state.profile.classKey}/`;
    if (!String(plan.storagePath).startsWith(prefix)) throw new Error("현재 학급의 평가계획서 파일이 아닙니다.");
    const blob = await repository.api.getBlob(repository.api.ref(repository.api.storage, plan.storagePath));
    const contentType = normalizeContentType({ type: blob.type, name: plan.fileName });
    if (!ALLOWED_TYPES.has(contentType)) throw new Error("이 파일 형식은 바로 보기를 지원하지 않습니다.");
    const mediaKind = ALLOWED_TYPES.get(contentType);
    const url = URL.createObjectURL(blob);
    return {
      url,
      contentType,
      mediaKind,
      previewType: previewTypeFor(contentType, mediaKind),
      revoke: () => URL.revokeObjectURL(url),
    };
  }
}

export { ALLOWED_TYPES, MAX_FILE_SIZE, assertFile, normalizePlan, normalizeContentType, previewTypeFor };
