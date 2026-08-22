const SELECTOR = [
  "md-filled-button",
  "md-filled-tonal-button",
  "md-outlined-button",
  "md-text-button",
  "md-icon-button",
  "md-filled-icon-button",
  "md-filled-tonal-icon-button",
  "md-outlined-icon-button",
  "md-fab",
  "md-branded-fab",
].join(",");

function isMaterialButton(node) {
  return node instanceof HTMLElement && node.matches(SELECTOR);
}

function hasHealthyMaterialSurface(node) {
  if (!customElements.get(node.localName)) return false;
  const root = node.shadowRoot;
  if (!root) return false;
  const control = root.querySelector("button, [role='button'], .button, .container") || root.firstElementChild;
  if (!(control instanceof Element)) return false;
  const rect = control.getBoundingClientRect();
  if (rect.width < 24 || rect.height < 24 || rect.height > 96) return false;
  const style = getComputedStyle(control);
  return style.display !== "none" && style.visibility !== "hidden";
}

function shouldFallback(node) {
  if (!isMaterialButton(node)) return false;
  if (!customElements.get(node.localName)) return true;
  if (!hasHealthyMaterialSurface(node)) return true;
  const rect = node.getBoundingClientRect();
  const style = getComputedStyle(node);
  return rect.height > 104 || Number.parseFloat(style.fontSize || "0") > 28;
}

function applyFallback(node) {
  if (!isMaterialButton(node)) return;

  // Once a specific DOM element needs the fallback, keep that decision for the
  // rest of its lifetime. Re-evaluating after the fallback changes its geometry
  // creates a feedback loop: fallback on -> looks healthy -> fallback off ->
  // looks broken -> fallback on. That loop is the visible button "wobble".
  if (node.dataset.pinconMaterialButtonFallbackLatched === "true") return;

  if (!shouldFallback(node)) return;

  node.dataset.pinconMaterialButtonFallback = "true";
  node.dataset.pinconMaterialButtonFallbackLatched = "true";
  if (!node.hasAttribute("role")) node.setAttribute("role", "button");
  if (!node.hasAttribute("tabindex") && !node.hasAttribute("disabled") && node.getAttribute("aria-disabled") !== "true") {
    node.tabIndex = 0;
  }
}

function scan(root = document) {
  if (root instanceof HTMLElement) applyFallback(root);
  root.querySelectorAll?.(SELECTOR).forEach(applyFallback);
}

function rescanSoon() {
  requestAnimationFrame(() => {
    scan(document);
    window.setTimeout(() => scan(document), 120);
    window.setTimeout(() => scan(document), 700);
  });
}

scan();
rescanSoon();

const observer = new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node instanceof HTMLElement) scan(node);
    }
  }
  rescanSoon();
});
observer.observe(document.documentElement, { childList: true, subtree: true });

window.addEventListener("pincon-material-ready", rescanSoon);
window.addEventListener("pincon-material-component-bridge-ready", rescanSoon);
window.addEventListener("resize", rescanSoon, { passive: true });

document.addEventListener("keydown", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.dataset.pinconMaterialButtonFallback !== "true") return;
  if (target.hasAttribute("disabled") || target.getAttribute("aria-disabled") === "true") return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  target.click();
});
