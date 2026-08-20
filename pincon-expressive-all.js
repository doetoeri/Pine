const ROOT_MODE = "material-expressive";
const DESIGN_KEY = "pincon-design-system-v1";

function lockExpressiveMode() {
  document.documentElement.dataset.pinconDesign = ROOT_MODE;
  document.body?.classList.add("pincon-expressive");
  try { localStorage.setItem(DESIGN_KEY, ROOT_MODE); } catch {}
}

function isIconOnlyButton(el) {
  const text = (el.textContent || "").trim();
  const hasIcon = !!el.querySelector("svg, img, md-icon, .material-symbols-rounded, .material-icons");
  const labelled = !!(el.getAttribute("aria-label") || el.getAttribute("title"));
  return hasIcon && (!text || (labelled && text.length <= 2));
}

function classifyButton(el) {
  if (!(el instanceof HTMLElement)) return;
  if (el.matches("md-filled-button, md-filled-tonal-button, md-outlined-button, md-text-button, md-icon-button, md-fab")) return;
  if (el.closest("md-filled-button, md-filled-tonal-button, md-outlined-button, md-text-button, md-icon-button, md-fab")) return;
  if (el.dataset.pinconControl) return;

  const cls = String(el.className || "").toLowerCase();
  const label = `${el.getAttribute("aria-label") || ""} ${el.textContent || ""}`.trim().toLowerCase();

  if (isIconOnlyButton(el) || cls.includes("icon") || cls.includes("close") || cls.includes("menu")) {
    el.dataset.pinconControl = "icon";
  } else if (cls.includes("outline") || cls.includes("secondary") || label.includes("취소")) {
    el.dataset.pinconControl = "outlined";
  } else if (cls.includes("text") || cls.includes("ghost") || cls.includes("link")) {
    el.dataset.pinconControl = "text";
  } else if (cls.includes("tonal") || cls.includes("filter") || cls.includes("chip")) {
    el.dataset.pinconControl = "tonal";
  } else if (cls.includes("primary") || cls.includes("submit") || label.includes("저장") || label.includes("추가") || label.includes("완료") || label.includes("확인")) {
    el.dataset.pinconControl = "primary";
  } else {
    el.dataset.pinconControl = "tonal";
  }
}

function classifySurface(el) {
  if (!(el instanceof HTMLElement) || el.dataset.pinconSurface) return;
  const cls = String(el.className || "").toLowerCase();
  if (!/(card|panel|tile|widget|section)/.test(cls)) return;
  if (/(hero|today|primary|highlight)/.test(cls)) el.dataset.pinconSurface = "filled";
  else if (/(floating|elevated|popup)/.test(cls)) el.dataset.pinconSurface = "elevated";
  else el.dataset.pinconSurface = "outlined";
}

function markTabsAndNavigation(scope) {
  scope.querySelectorAll?.('[role="tab"], [data-tab], nav a, [role="navigation"] a').forEach((el) => {
    if (el instanceof HTMLElement) el.dataset.pinconExpressiveItem = "true";
  });
}

function upgradeScope(scope = document) {
  lockExpressiveMode();

  scope.querySelectorAll?.('button, [role="button"]').forEach(classifyButton);
  scope.querySelectorAll?.('[class*="card" i], [class*="panel" i], [class*="tile" i], [class*="widget" i], [class*="section" i]').forEach(classifySurface);
  markTabsAndNavigation(scope);

  scope.querySelectorAll?.('input:not([type="hidden"]), select, textarea').forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    el.dataset.pinconField = "expressive";
  });

  scope.querySelectorAll?.('dialog, [role="dialog"], [class*="modal" i], [class*="sheet" i]').forEach((el) => {
    if (el instanceof HTMLElement) el.dataset.pinconDialog = "expressive";
  });
}

function observeApp() {
  const root = document.getElementById("root") || document.body;
  if (!root) return;

  let queued = false;
  const flush = () => {
    queued = false;
    upgradeScope(root);
  };

  const observer = new MutationObserver((records) => {
    if (queued) return;
    if (!records.some((record) => record.addedNodes.length || record.type === "attributes")) return;
    queued = true;
    requestAnimationFrame(flush);
  });

  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "role", "aria-selected", "aria-current", "disabled"],
  });
}

async function boot() {
  lockExpressiveMode();
  try { await globalThis.PINCON_MATERIAL_READY; } catch {}
  upgradeScope(document);
  observeApp();
  window.dispatchEvent(new CustomEvent("pincon-expressive-ready", {
    detail: { mode: ROOT_MODE, material: globalThis.PINCON_MATERIAL_STATUS || null },
  }));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
