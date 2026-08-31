import { NextDataGateway } from "../core/data-gateway.js";
import { EvaluationPlanService } from "./service.js";

const gateway = new NextDataGateway();
const service = new EvaluationPlanService(gateway);
const root = document.querySelector("#adminApp");
let editingId = "";
let mounted = false;
let previewHandle = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function dateValue(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : "";
}

function statusMeta(plan) {
  if (plan.status === "verified") return { label: "원본 확인 완료", tone: "verified" };
  if (plan.status === "draft" || plan.published === false) return { label: "초안", tone: "draft" };
  return { label: "학생 공개", tone: "review" };
}

function fileLabel(plan) {
  if (plan.mediaKind === "image" || String(plan.contentType || "").startsWith("image/")) return "이미지";
  if (plan.storagePath || /\.pdf$/i.test(plan.fileName || "")) return "PDF";
  return plan.sourceUrl ? "원문 링크" : "파일 없음";
}

function currentPlans() {
  return service.plans({ includeArchived: false, includeDrafts: true });
}

function metricsMarkup(plans) {
  const published = plans.filter((item) => item.status !== "draft" && item.published !== false).length;
  const verified = plans.filter((item) => item.status === "verified" && item.published !== false).length;
  const drafts = plans.filter((item) => item.status === "draft" || item.published === false).length;
  return `<div class="evaluation-plan-admin__metrics">
    <div class="evaluation-plan-admin__metric"><strong>${published}</strong><span>학생 공개</span></div>
    <div class="evaluation-plan-admin__metric"><strong>${verified}</strong><span>원본 확인</span></div>
    <div class="evaluation-plan-admin__metric"><strong>${drafts}</strong><span>초안</span></div>
  </div>`;
}

function planCard(plan) {
  const status = statusMeta(plan);
  return `<article class="evaluation-plan-admin__card" data-plan-id="${escapeHtml(plan.id)}">
    <div class="evaluation-plan-admin__top">
      <strong>${escapeHtml(plan.subject || "과목 미정")}</strong>
      <span class="evaluation-plan-status evaluation-plan-status--${status.tone}">${escapeHtml(status.label)}</span>
    </div>
    <h3>${escapeHtml(plan.title || "평가계획서")}</h3>
    <p>${escapeHtml(`${plan.schoolYear || "-"}학년도 ${plan.semester || "-"}학기 · ${fileLabel(plan)}${plan.revision ? ` · v${plan.revision}` : ""}`)}</p>
    ${plan.description ? `<p>${escapeHtml(plan.description)}</p>` : ""}
    <div class="evaluation-plan-admin__actions">
      ${plan.storagePath ? `<md-text-button data-plan-preview="${escapeHtml(plan.id)}"><md-icon slot="icon">visibility</md-icon>바로 보기</md-text-button>` : ""}
      <md-text-button data-plan-edit="${escapeHtml(plan.id)}"><md-icon slot="icon">edit</md-icon>수정</md-text-button>
      <md-text-button data-plan-archive="${escapeHtml(plan.id)}"><md-icon slot="icon">archive</md-icon>보관</md-text-button>
    </div>
  </article>`;
}

function editorFields(plan = {}) {
  const status = plan.status || "review";
  return `<div class="evaluation-plan-editor">
    <md-outlined-text-field id="evaluationPlanTitle" label="제목" value="${escapeHtml(plan.title || "")}" maxlength="140" required></md-outlined-text-field>
    <md-outlined-text-field id="evaluationPlanSubject" label="과목" value="${escapeHtml(plan.subject || "")}" maxlength="40" required></md-outlined-text-field>
    <div class="evaluation-plan-editor__split">
      <md-outlined-text-field id="evaluationPlanYear" label="학년도" type="number" value="${escapeHtml(plan.schoolYear || new Date().getFullYear())}"></md-outlined-text-field>
      <md-outlined-select id="evaluationPlanSemester" label="학기" value="${escapeHtml(String(plan.semester || 2))}">
        <md-select-option value="1" ${Number(plan.semester) === 1 ? "selected" : ""}><div slot="headline">1학기</div></md-select-option>
        <md-select-option value="2" ${Number(plan.semester) !== 1 ? "selected" : ""}><div slot="headline">2학기</div></md-select-option>
      </md-outlined-select>
    </div>
    <md-outlined-select id="evaluationPlanStatus" label="공개 상태" value="${escapeHtml(status)}">
      <md-select-option value="draft" ${status === "draft" ? "selected" : ""}><div slot="headline">초안 · 학생에게 숨김</div></md-select-option>
      <md-select-option value="review" ${status === "review" ? "selected" : ""}><div slot="headline">학생 공개 · 검토 중</div></md-select-option>
      <md-select-option value="verified" ${status === "verified" ? "selected" : ""}><div slot="headline">학생 공개 · 원본 확인 완료</div></md-select-option>
    </md-outlined-select>
    <label class="evaluation-plan-editor__file" for="evaluationPlanFile">
      <span>PDF 또는 이미지 파일 · 10MB 이하</span>
      <input id="evaluationPlanFile" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp">
      <small>${escapeHtml(plan.fileName ? `현재 파일: ${plan.fileName}` : "PDF·JPG·PNG·WEBP를 지원합니다. 파일 없이 학교 원문 링크만 등록할 수도 있습니다.")}</small>
    </label>
    <md-outlined-text-field id="evaluationPlanSourceUrl" label="학교 홈페이지 원문 링크 · 선택" type="url" value="${escapeHtml(plan.sourceUrl || "")}" maxlength="1200"></md-outlined-text-field>
    <md-outlined-text-field id="evaluationPlanSource" label="출처" value="${escapeHtml(plan.sourceAttribution || "고촌고등학교 평가계획서")}" maxlength="300"></md-outlined-text-field>
    <div class="evaluation-plan-editor__split">
      <md-outlined-text-field id="evaluationPlanDate" label="학생 공개 날짜" type="date" value="${escapeHtml(dateValue(plan.announcedDate))}"></md-outlined-text-field>
      <md-outlined-text-field id="evaluationPlanPages" label="페이지 수 · 선택" type="number" value="${escapeHtml(plan.pageCount || 0)}"></md-outlined-text-field>
    </div>
    <md-outlined-text-field id="evaluationPlanDescription" label="학생용 설명" type="textarea" rows="4" value="${escapeHtml(plan.description || "")}" maxlength="1200"></md-outlined-text-field>
    <label class="evaluation-plan-editor__confirm">
      <input id="evaluationPlanConfirmed" type="checkbox">
      <span>공유 가능한 공식 자료이며 개인정보가 포함되지 않았음을 확인합니다.<small>학생들이 바로 열람할 수 있으므로 학번, 전화번호, 서명 등 불필요한 개인정보가 들어 있지 않은지 확인하세요.</small></span>
    </label>
  </div>`;
}

function dialogMarkup() {
  return `<md-dialog id="evaluationPlanEditorDialog">
    <div slot="headline" id="evaluationPlanEditorTitle">평가계획서 등록</div>
    <form slot="content" method="dialog" id="evaluationPlanEditorForm">${editorFields()}</form>
    <div slot="actions">
      <md-text-button id="evaluationPlanCancel">취소</md-text-button>
      <md-filled-button id="evaluationPlanSave">저장</md-filled-button>
    </div>
  </md-dialog>
  <md-dialog id="evaluationPlanAdminPreviewDialog">
    <div slot="headline">평가계획서 미리보기</div>
    <div slot="content" class="evaluation-plan-viewer" id="evaluationPlanAdminPreviewContent"></div>
    <div slot="actions"><md-text-button id="evaluationPlanAdminPreviewClose">닫기</md-text-button></div>
  </md-dialog>`;
}

function adminMarkup(plans) {
  return `<section class="admin-card admin-card--wide evaluation-plan-admin evaluation-plans-v2" data-evaluation-plan-admin-v2 aria-labelledby="evaluation-plan-admin-title">
    <div class="evaluation-plan-admin__header">
      <div>
        <h2 id="evaluation-plan-admin-title">평가계획서</h2>
        <p class="evaluation-plan-admin__intro">과목별 공식 문서를 등록하고 학생 공개 상태를 관리합니다. 수행평가에서는 같은 문서를 연결해 재사용할 수 있습니다.</p>
      </div>
      <md-filled-tonal-button id="evaluationPlanCreate"><md-icon slot="icon">add</md-icon>평가계획서 등록</md-filled-tonal-button>
    </div>
    ${metricsMarkup(plans)}
    ${plans.length ? `<div class="evaluation-plan-admin__grid">${plans.map(planCard).join("")}</div>` : `<div class="evaluation-plan-empty"><md-icon>description</md-icon><strong>등록된 평가계획서가 없습니다</strong><span>PDF나 이미지 파일을 올리면 학생 화면에서 바로 볼 수 있습니다.</span></div>`}
    <p class="managed-editor-status" id="evaluationPlanAdminStatus" role="status"></p>
    ${dialogMarkup()}
  </section>`;
}

function legacySection() {
  return root?.querySelector("#managed-evaluationPlans-title")?.closest(".managed-editor-section") || null;
}

function mount() {
  if (!root || !gateway.snapshot().canManageContent) return;
  const legacy = legacySection();
  if (!legacy) return;
  legacy.hidden = true;
  legacy.setAttribute("aria-hidden", "true");
  const existing = root.querySelector("[data-evaluation-plan-admin-v2]");
  const html = adminMarkup(currentPlans());
  if (existing) existing.outerHTML = html;
  else legacy.insertAdjacentHTML("beforebegin", html);
  mounted = true;
}

function scheduleMount() {
  requestAnimationFrame(() => requestAnimationFrame(mount));
}

function openEditor(plan = null) {
  editingId = plan?.id || "";
  const dialog = root.querySelector("#evaluationPlanEditorDialog");
  const form = root.querySelector("#evaluationPlanEditorForm");
  const title = root.querySelector("#evaluationPlanEditorTitle");
  if (!dialog || !form) return;
  form.innerHTML = editorFields(plan || {});
  if (title) title.textContent = plan ? "평가계획서 수정" : "평가계획서 등록";
  dialog.show?.();
}

function formValue(id) {
  return root.querySelector(`#${id}`)?.value ?? "";
}

async function saveEditor() {
  const statusNode = root.querySelector("#evaluationPlanAdminStatus");
  const button = root.querySelector("#evaluationPlanSave");
  try {
    if (button) button.disabled = true;
    const values = {
      title: formValue("evaluationPlanTitle"),
      subject: formValue("evaluationPlanSubject"),
      schoolYear: formValue("evaluationPlanYear"),
      semester: formValue("evaluationPlanSemester"),
      status: formValue("evaluationPlanStatus"),
      sourceUrl: formValue("evaluationPlanSourceUrl"),
      sourceAttribution: formValue("evaluationPlanSource"),
      announcedDate: formValue("evaluationPlanDate"),
      pageCount: formValue("evaluationPlanPages"),
      description: formValue("evaluationPlanDescription"),
      recoveryRelevant: true,
    };
    const file = root.querySelector("#evaluationPlanFile")?.files?.[0] || null;
    const confirmed = Boolean(root.querySelector("#evaluationPlanConfirmed")?.checked);
    await service.save(values, { id: editingId, file, confirmed });
    root.querySelector("#evaluationPlanEditorDialog")?.close?.();
    editingId = "";
    if (statusNode) {
      statusNode.dataset.kind = "success";
      statusNode.textContent = "평가계획서를 저장했습니다. 학생 화면에도 즉시 반영됩니다.";
    }
  } catch (error) {
    if (statusNode) {
      statusNode.dataset.kind = "error";
      statusNode.textContent = error?.message || "평가계획서를 저장하지 못했습니다.";
    }
  } finally {
    if (button) button.disabled = false;
  }
}

function cleanupPreview() {
  previewHandle?.revoke?.();
  previewHandle = null;
}

async function previewPlan(id) {
  const dialog = root.querySelector("#evaluationPlanAdminPreviewDialog");
  const content = root.querySelector("#evaluationPlanAdminPreviewContent");
  const plan = currentPlans().find((item) => item.id === id);
  if (!dialog || !content || !plan) return;
  cleanupPreview();
  content.innerHTML = `<div class="evaluation-plan-viewer__loading"><md-icon>hourglass_top</md-icon><span>문서를 불러오는 중</span></div>`;
  dialog.show?.();
  try {
    previewHandle = await service.preview(plan);
    if (!previewHandle) throw new Error("첨부 파일이 없습니다.");
    content.innerHTML = previewHandle.mediaKind === "image"
      ? `<div class="evaluation-plan-viewer__preview"><img src="${previewHandle.url}" alt="${escapeHtml(plan.title)}"></div>`
      : `<div class="evaluation-plan-viewer__preview"><iframe src="${previewHandle.url}#view=FitH" title="${escapeHtml(plan.title)}"></iframe></div>`;
  } catch (error) {
    content.innerHTML = `<div class="evaluation-plan-viewer__error"><md-icon>error</md-icon><span>${escapeHtml(error?.message || "문서를 불러오지 못했습니다.")}</span></div>`;
  }
}

root?.addEventListener("click", async (event) => {
  const path = event.composedPath?.() || [];
  const action = path.find((node) => node instanceof HTMLElement && (
    node.id === "evaluationPlanCreate"
    || node.id === "evaluationPlanSave"
    || node.id === "evaluationPlanCancel"
    || node.id === "evaluationPlanAdminPreviewClose"
    || node.hasAttribute("data-plan-edit")
    || node.hasAttribute("data-plan-archive")
    || node.hasAttribute("data-plan-preview")
  ));
  if (!action) return;

  if (action.id === "evaluationPlanCreate") return openEditor();
  if (action.id === "evaluationPlanSave") return saveEditor();
  if (action.id === "evaluationPlanCancel") return root.querySelector("#evaluationPlanEditorDialog")?.close?.();
  if (action.id === "evaluationPlanAdminPreviewClose") {
    cleanupPreview();
    return root.querySelector("#evaluationPlanAdminPreviewDialog")?.close?.();
  }
  if (action.hasAttribute("data-plan-edit")) {
    const plan = currentPlans().find((item) => item.id === action.getAttribute("data-plan-edit"));
    return openEditor(plan || null);
  }
  if (action.hasAttribute("data-plan-preview")) return previewPlan(action.getAttribute("data-plan-preview"));
  if (action.hasAttribute("data-plan-archive")) {
    const id = action.getAttribute("data-plan-archive");
    action.disabled = true;
    try {
      await service.archive(id);
    } finally {
      action.disabled = false;
    }
  }
});

root?.addEventListener("closed", (event) => {
  if (event.target?.id === "evaluationPlanAdminPreviewDialog") cleanupPreview();
});

gateway.addEventListener("change", scheduleMount);
window.addEventListener("popstate", scheduleMount);
await gateway.start();
scheduleMount();

export { mount as mountEvaluationPlanAdmin };
