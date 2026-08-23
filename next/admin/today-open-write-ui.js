import { NextDataGateway } from "../core/data-gateway.js";

const root = document.querySelector("#adminApp");
const gateway = new NextDataGateway();
let snapshot = gateway.snapshot();
let queued = false;

function patch() {
  queued = false;
  if (!root || !snapshot.temporaryOpenWrite || snapshot.canArchiveContent) return;

  root.querySelectorAll("[data-managed-archive], [data-managed-restore]").forEach((node) => {
    node.hidden = true;
    node.setAttribute("aria-hidden", "true");
  });
  root.querySelectorAll("[data-managed-archive-card]").forEach((node) => { node.hidden = true; });

  const editorCard = root.querySelector("[data-managed-editor]");
  if (editorCard) {
    const badge = editorCard.querySelector(".beta-badge");
    if (badge && badge.textContent !== "WRITE ENABLED · TODAY") badge.textContent = "WRITE ENABLED · TODAY";
    const status = editorCard.querySelector(".admin-status p");
    const text = "오늘 23:59까지 1-8 공지·수행·학급 행사 생성·수정이 가능합니다. 보관·복원과 브랜드 설정은 기존 회장 계정에서만 가능합니다.";
    if (status && status.textContent !== text) status.textContent = text;
  }
}

function queuePatch() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(patch);
}

gateway.addEventListener("change", (event) => {
  snapshot = event.detail;
  queuePatch();
});

const observer = new MutationObserver(queuePatch);
if (root) observer.observe(root, { childList: true, subtree: true });
queuePatch();
