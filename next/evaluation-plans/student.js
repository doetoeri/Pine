import { NextDataGateway } from "../core/data-gateway.js";
import { EvaluationPlanService } from "./service.js";

const gateway = new NextDataGateway();
const service = new EvaluationPlanService(gateway);
let selectedSubject = "all";
let activePreview = null;
let activePlanId = "";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function statusMeta(plan) {
  if (plan.status === "verified") return { label: "원본 확인 완료", tone: "verified" };
  return { label: "학생 공개", tone: "review" };
}

function fileMeta(plan) {
  const image = plan.mediaKind === "image" || String(plan.contentType || "").startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(plan.fileName || "");
  if (image) return { icon: "image", label: "이미지" };
  if (plan.storagePath || /\.pdf$/i.test(plan.fileName || "")) return { icon: "picture_as_pdf", label: "PDF" };
  return { icon: "link", label: "원문 링크" };
}

function plans() {
  return service.plans();
}

function subjectOptions(rows) {
  return [...new Set(rows.map((item) => String(item.subject || "과목 미정")).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
}

function cardMarkup(plan) {
  const status = statusMeta(plan);
  const file = fileMeta(plan);
  return `<button type="button" class="evaluation-plan-card" data-evaluation-plan-open="${escapeHtml(plan.id)}">
    <div class="evaluation-plan-card__top">
      <span class="evaluation-plan-card__icon"><md-icon>${file.icon}</md-icon></span>
      <span class="evaluation-plan-status evaluation-plan-status--${status.tone}">${escapeHtml(status.label)}</span>
    </div>
    <div class="evaluation-plan-card__body">
      <span class="evaluation-plan-card__subject">${escapeHtml(plan.subject || "과목 미정")}</span>
      <h3>${escapeHtml(plan.title || "평가계획서")}</h3>
      <p>${escapeHtml(`${plan.schoolYear || "-"}학년도 ${plan.semester || "-"}학기`)}</p>
      ${plan.description ? `<p class="evaluation-plan-card__description">${escapeHtml(plan.description)}</p>` : ""}
    </div>
    <div class="evaluation-plan-card__foot"><span>${escapeHtml(file.label)}</span><span>${escapeHtml(plan.announcedDate || "")}</span><md-icon>arrow_forward</md-icon></div>
  </button>`;
}

function libraryMarkup(rows) {
  const subjects = subjectOptions(rows);
  if (selectedSubject !== "all" && !subjects.includes(selectedSubject)) selectedSubject = "all";
  const visible = selectedSubject === "all" ? rows : rows.filter((item) => item.subject === selectedSubject);
  return `<div class="evaluation-plans-v2" data-evaluation-plan-library-v2>
    <div class="evaluation-plans-v2__header">
      <div>
        <span class="evaluation-plans-v2__eyebrow">ASSESSMENT LIBRARY</span>
        <h2>평가계획서</h2>
        <p class="evaluation-plans-v2__intro">과목별 평가 기준과 학교 공식 문서를 한 곳에서 바로 확인합니다.</p>
      </div>
      <div class="evaluation-plans-v2__summary"><strong>${rows.length}</strong><span>공개 문서</span></div>
    </div>
    ${subjects.length > 1 ? `<div class="evaluation-plans-v2__filters" aria-label="평가계획서 과목 필터">
      <button type="button" class="evaluation-plans-v2__filter" data-plan-subject="all" aria-pressed="${selectedSubject === "all"}">전체</button>
      ${subjects.map((subject) => `<button type="button" class="evaluation-plans-v2__filter" data-plan-subject="${escapeHtml(subject)}" aria-pressed="${selectedSubject === subject}">${escapeHtml(subject)}</button>`).join("")}
    </div>` : ""}
    ${visible.length ? `<div class="evaluation-plans-v2__grid">${visible.map(cardMarkup).join("")}</div>` : `<div class="evaluation-plan-empty"><md-icon>description</md-icon><strong>공개된 평가계획서가 없습니다</strong><span>운영자가 공식 자료를 등록하면 이곳에서 바로 확인할 수 있습니다.</span></div>`}
  </div>`;
}

function librarySurfaceMarkup(rows) {
  return `<article class="surface evaluation-plan-library-surface" data-evaluation-plan-library-host aria-label="평가계획서 라이브러리">${libraryMarkup(rows)}</article>`;
}

function findLegacySurface() {
  return [...document.querySelectorAll("article.surface")].find((node) => node.querySelector(".surface__title")?.textContent?.trim() === "평가계획서 자료실") || null;
}

function ensureViewer() {
  let dialog = document.querySelector("#evaluationPlanViewerDialog");
  if (dialog) return dialog;
  document.body.insertAdjacentHTML("beforeend", `<md-dialog id="evaluationPlanViewerDialog">
    <div slot="headline" id="evaluationPlanViewerHeadline">평가계획서</div>
    <div slot="content" class="evaluation-plan-viewer" id="evaluationPlanViewerContent"></div>
    <div slot="actions"><md-text-button id="evaluationPlanViewerClose">닫기</md-text-button></div>
  </md-dialog>`);
  return document.querySelector("#evaluationPlanViewerDialog");
}

function mountLibrary() {
  const html = librarySurfaceMarkup(plans());
  const existing = document.querySelector("[data-evaluation-plan-library-host]");
  if (existing) {
    existing.outerHTML = html;
    return;
  }
  const legacy = findLegacySurface();
  if (!legacy) return;
  legacy.outerHTML = html;
}

function scheduleMount() {
  requestAnimationFrame(() => requestAnimationFrame(mountLibrary));
}

function cleanupPreview() {
  activePreview?.revoke?.();
  activePreview = null;
  activePlanId = "";
}

function viewerMeta(plan) {
  const status = statusMeta(plan);
  const file = fileMeta(plan);
  return `<div class="evaluation-plan-viewer__header">
    <div>
      <span class="evaluation-plans-v2__eyebrow">${escapeHtml(plan.subject || "과목 미정")}</span>
      <h2>${escapeHtml(plan.title || "평가계획서")}</h2>
      <p class="evaluation-plans-v2__intro">${escapeHtml(`${plan.schoolYear || "-"}학년도 ${plan.semester || "-"}학기`)}</p>
    </div>
    <span class="evaluation-plan-status evaluation-plan-status--${status.tone}">${escapeHtml(status.label)}</span>
  </div>
  <div class="evaluation-plan-viewer__meta">
    <span class="evaluation-plan-status">${escapeHtml(file.label)}</span>
    ${plan.pageCount ? `<span class="evaluation-plan-status">${escapeHtml(`${plan.pageCount}쪽`)}</span>` : ""}
    ${plan.sourceAttribution ? `<span class="evaluation-plan-status">${escapeHtml(plan.sourceAttribution)}</span>` : ""}
  </div>`;
}

async function openPlan(id) {
  const plan = plans().find((item) => item.id === id);
  if (!plan) return;
  cleanupPreview();
  activePlanId = id;
  const dialog = ensureViewer();
  const content = document.querySelector("#evaluationPlanViewerContent");
  const headline = document.querySelector("#evaluationPlanViewerHeadline");
  if (!dialog || !content) return;
  if (headline) headline.textContent = plan.subject ? `${plan.subject} 평가계획서` : "평가계획서";
  content.innerHTML = `${viewerMeta(plan)}
    <div class="evaluation-plan-viewer__preview"><div class="evaluation-plan-viewer__loading"><md-icon>hourglass_top</md-icon><span>문서를 불러오는 중</span></div></div>
    ${plan.description ? `<p class="evaluation-plan-viewer__description">${escapeHtml(plan.description)}</p>` : ""}
    <div class="evaluation-plan-viewer__actions" id="evaluationPlanViewerActions"></div>`;
  dialog.show?.();

  const previewRoot = content.querySelector(".evaluation-plan-viewer__preview");
  const actions = content.querySelector("#evaluationPlanViewerActions");
  try {
    if (plan.storagePath) {
      activePreview = await service.preview(plan);
      if (activePlanId !== id) return activePreview?.revoke?.();
      if (activePreview?.mediaKind === "image") {
        previewRoot.innerHTML = `<img src="${activePreview.url}" alt="${escapeHtml(plan.title)}">`;
      } else if (activePreview) {
        previewRoot.innerHTML = `<iframe src="${activePreview.url}#view=FitH" title="${escapeHtml(plan.title)}"></iframe>`;
      }
      if (activePreview) {
        actions.insertAdjacentHTML("beforeend", `<md-filled-tonal-button data-plan-open-file><md-icon slot="icon">open_in_new</md-icon>전체 화면으로 보기</md-filled-tonal-button>`);
      }
    } else {
      previewRoot.innerHTML = `<div class="evaluation-plan-viewer__empty"><md-icon>link</md-icon><span>첨부 파일 없이 학교 원문 링크로 등록된 자료입니다.</span></div>`;
    }
    if (plan.sourceUrl) {
      actions.insertAdjacentHTML("beforeend", `<md-text-button data-plan-source-url="${escapeHtml(plan.sourceUrl)}"><md-icon slot="icon">language</md-icon>학교 원문 열기</md-text-button>`);
    }
  } catch (error) {
    previewRoot.innerHTML = `<div class="evaluation-plan-viewer__error"><md-icon>error</md-icon><span>${escapeHtml(error?.message || "문서를 불러오지 못했습니다.")}</span></div>`;
    if (plan.sourceUrl) actions.insertAdjacentHTML("beforeend", `<md-text-button data-plan-source-url="${escapeHtml(plan.sourceUrl)}">학교 원문 열기</md-text-button>`);
  }
}

function legacyPlanIdFromControl(control) {
  const key = control?.getAttribute?.("data-detail-key") || "";
  const prefix = "evaluation-plan:evaluationPlans:";
  if (!key.startsWith(prefix)) return "";
  try { return decodeURIComponent(key.slice(prefix.length)); } catch { return key.slice(prefix.length); }
}

document.addEventListener("click", (event) => {
  const path = event.composedPath?.() || [];
  const control = path.find((node) => node instanceof HTMLElement && (
    node.hasAttribute("data-evaluation-plan-open")
    || node.hasAttribute("data-plan-subject")
    || node.hasAttribute("data-plan-open-file")
    || node.hasAttribute("data-plan-source-url")
    || node.id === "evaluationPlanViewerClose"
    || String(node.getAttribute?.("data-detail-key") || "").startsWith("evaluation-plan:evaluationPlans:")
  ));
  if (!control) return;

  const legacyId = legacyPlanIdFromControl(control);
  if (legacyId) {
    event.preventDefault();
    event.stopImmediatePropagation();
    openPlan(legacyId);
    return;
  }
  if (control.hasAttribute("data-evaluation-plan-open")) return openPlan(control.getAttribute("data-evaluation-plan-open"));
  if (control.hasAttribute("data-plan-subject")) {
    selectedSubject = control.getAttribute("data-plan-subject") || "all";
    return mountLibrary();
  }
  if (control.id === "evaluationPlanViewerClose") {
    cleanupPreview();
    return ensureViewer().close?.();
  }
  if (control.hasAttribute("data-plan-open-file") && activePreview?.url) {
    const link = document.createElement("a");
    link.href = activePreview.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.click();
    return;
  }
  if (control.hasAttribute("data-plan-source-url")) {
    const url = control.getAttribute("data-plan-source-url");
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }
}, true);

document.addEventListener("closed", (event) => {
  if (event.target?.id === "evaluationPlanViewerDialog") cleanupPreview();
}, true);

gateway.addEventListener("change", scheduleMount);
window.addEventListener("popstate", scheduleMount);
window.addEventListener("hashchange", scheduleMount);
await gateway.start();
scheduleMount();

export { mountLibrary as mountEvaluationPlanLibrary, openPlan as openEvaluationPlan };