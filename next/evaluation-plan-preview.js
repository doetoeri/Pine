import { NextDataGateway } from "./core/data-gateway.js";

const gateway = new NextDataGateway();
let activePreview = null;
let activeKey = "";
let renderToken = 0;

function currentDetailKey() {
  const query = location.hash.includes("?") ? location.hash.split("?").slice(1).join("?") : "";
  return new URLSearchParams(query).get("detail") || "";
}

function currentPlanId() {
  const key = currentDetailKey();
  const prefix = "evaluation-plan:evaluationPlans:";
  if (!key.startsWith(prefix)) return "";
  try { return decodeURIComponent(key.slice(prefix.length)); } catch { return key.slice(prefix.length); }
}

function cleanupPreview() {
  activePreview?.revoke?.();
  activePreview = null;
  activeKey = "";
}

function fileKind(item, contentType = "") {
  if (contentType === "application/pdf") return "pdf";
  if (contentType.startsWith("image/")) return "image";
  const name = String(item?.fileName || "").toLowerCase();
  return name.endsWith(".pdf") ? "pdf" : /\.(jpe?g|png|webp)$/.test(name) ? "image" : "";
}

function shellMarkup(item) {
  return `<section class="detail-section evaluation-plan-preview" data-evaluation-plan-preview>
    <div class="evaluation-plan-preview__head">
      <strong>평가계획서 바로 보기</strong>
      <span>${String(item.fileName || "첨부 파일").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</span>
    </div>
    <div class="evaluation-plan-preview__frame">
      <div class="evaluation-plan-preview__loading" role="status"><md-icon>hourglass_top</md-icon><span>문서를 불러오는 중</span></div>
    </div>
  </section>`;
}

async function renderPreview() {
  const token = ++renderToken;
  const planId = currentPlanId();
  const layer = document.querySelector("#detailLayer");
  const body = layer?.querySelector(".detail-body");

  if (!planId || !layer?.classList.contains("is-open") || !body) {
    cleanupPreview();
    document.querySelector("[data-evaluation-plan-preview]")?.remove();
    return;
  }

  await gateway.start();
  const item = (gateway.snapshot().data?.evaluationPlans || []).find((row) => String(row.id) === planId && row.deleted !== true);
  if (!item?.storagePath) {
    cleanupPreview();
    document.querySelector("[data-evaluation-plan-preview]")?.remove();
    return;
  }

  const previewKey = `${planId}:${item.storagePath}`;
  if (activeKey === previewKey && document.querySelector("[data-evaluation-plan-preview]")) return;
  cleanupPreview();
  document.querySelector("[data-evaluation-plan-preview]")?.remove();

  const wrapper = document.createElement("div");
  wrapper.innerHTML = shellMarkup(item);
  const section = wrapper.firstElementChild;
  body.prepend(section);

  try {
    const preview = await gateway.repository.previewEvaluationPlanFile(item.storagePath);
    if (token !== renderToken || currentPlanId() !== planId || !section.isConnected) {
      preview.revoke();
      return;
    }
    activePreview = preview;
    activeKey = previewKey;
    const frame = section.querySelector(".evaluation-plan-preview__frame");
    const kind = fileKind(item, preview.contentType);
    if (kind === "image") {
      const image = document.createElement("img");
      image.src = preview.url;
      image.alt = `${item.title || item.subject || "평가계획서"} 미리보기`;
      frame.replaceChildren(image);
    } else if (kind === "pdf") {
      const viewer = document.createElement("iframe");
      viewer.src = preview.url;
      viewer.title = `${item.title || item.subject || "평가계획서"} PDF`;
      viewer.setAttribute("loading", "eager");
      frame.replaceChildren(viewer);
    } else {
      throw new Error("지원하지 않는 파일 형식입니다.");
    }

    const actions = document.createElement("div");
    actions.className = "evaluation-plan-preview__actions";
    const open = document.createElement("a");
    open.href = preview.url;
    open.target = "_blank";
    open.rel = "noopener";
    open.textContent = "전체 화면으로 보기";
    open.className = "evaluation-plan-preview__open";
    open.setAttribute("aria-label", "평가계획서를 새 화면에서 보기");
    actions.append(open);
    section.append(actions);
  } catch (error) {
    if (token !== renderToken || !section.isConnected) return;
    const frame = section.querySelector(".evaluation-plan-preview__frame");
    frame.innerHTML = `<div class="evaluation-plan-preview__error" role="alert"><md-icon>broken_image</md-icon><span>${String(error?.message || "평가계획서를 표시하지 못했습니다.").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</span></div>`;
  }
}

const observer = new MutationObserver(() => queueMicrotask(renderPreview));
observer.observe(document.querySelector("#app") || document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["class", "hidden"],
});

window.addEventListener("hashchange", renderPreview);
window.addEventListener("popstate", renderPreview);
window.addEventListener("pagehide", cleanupPreview);

gateway.addEventListener("change", renderPreview);
renderPreview();
