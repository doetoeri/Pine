import { PinconClassOpsRepository, SCHOOL } from "../../pincon-class-ops-data.js";

const PATCH_FLAG = Symbol.for("pincon.evaluation-plan-media-patched");
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function schoolId() {
  return String(SCHOOL?.id || "gochon-high");
}

function safeName(value) {
  return String(value || "file")
    .replace(/[^0-9A-Za-z가-힣._-]+/g, "-")
    .slice(-120);
}

function normalizedType(file) {
  const direct = String(file?.type || "").toLowerCase();
  if (ALLOWED_TYPES.has(direct)) return direct;
  const name = String(file?.name || "").toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  return direct;
}

function assertEvaluationPlanFile(file) {
  if (!file || Number(file.size || 0) <= 0) throw new Error("올릴 평가계획서 파일을 선택해 주세요.");
  if (Number(file.size || 0) > MAX_FILE_SIZE) throw new Error("평가계획서 파일은 10MB 이하만 올릴 수 있습니다.");
  const contentType = normalizedType(file);
  if (!ALLOWED_TYPES.has(contentType)) throw new Error("평가계획서는 PDF, JPG, PNG, WEBP 파일만 올릴 수 있습니다.");
  return contentType;
}

function assertPlanPath(repository, storagePath) {
  const path = String(storagePath || "").trim().slice(0, 600);
  const prefix = `class-evaluation-plans/${schoolId()}/${repository.state.classKey}/`;
  if (!path.startsWith(prefix)) throw new Error("현재 학급의 평가계획서 파일이 아닙니다.");
  return path;
}

if (!PinconClassOpsRepository.prototype[PATCH_FLAG]) {
  const originalUploadFile = PinconClassOpsRepository.prototype.uploadFile;

  PinconClassOpsRepository.prototype.uploadFile = async function uploadFile(folder, recordId, file) {
    if (folder !== "evaluation-plans") return originalUploadFile.call(this, folder, recordId, file);

    await this.ensureUser();
    if (!this.state.isPresident) throw new Error("평가계획서 업로드는 학급 운영자만 가능합니다.");
    const contentType = assertEvaluationPlanFile(file);
    const fileName = safeName(file.name);
    const storageRef = this.api.ref(
      this.api.storage,
      `class-evaluation-plans/${schoolId()}/${this.state.classKey}/${recordId}/${Date.now()}-${fileName}`,
    );
    const result = await this.api.uploadBytes(storageRef, file, {
      contentType,
      contentDisposition: `inline; filename="${fileName.replaceAll('"', "")}"`,
      customMetadata: { classKey: this.state.classKey, mediaKind: contentType === "application/pdf" ? "pdf" : "image" },
    });
    return {
      fileName,
      fileUrl: "",
      storagePath: result.ref.fullPath,
      contentType,
    };
  };

  PinconClassOpsRepository.prototype.previewEvaluationPlanFile = async function previewEvaluationPlanFile(storagePath) {
    await this.ensureUser();
    const path = assertPlanPath(this, storagePath);
    const blob = await this.api.getBlob(this.api.ref(this.api.storage, path));
    const contentType = String(blob.type || "").toLowerCase();
    if (!ALLOWED_TYPES.has(contentType)) throw new Error("미리보기를 지원하지 않는 평가계획서 파일입니다.");
    const url = URL.createObjectURL(blob);
    return {
      url,
      contentType,
      revoke() {
        URL.revokeObjectURL(url);
      },
    };
  };

  Object.defineProperty(PinconClassOpsRepository.prototype, PATCH_FLAG, { value: true });
}

export { ALLOWED_TYPES, MAX_FILE_SIZE, assertEvaluationPlanFile };
