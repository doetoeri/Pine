// PinCon Next keyboard activation normalizer for Material buttons.
// Material Web renders its real native control inside an open Shadow Root. Keyboard
// events can cross that boundary differently by browser, while an older Day 2 fallback
// also listens at document capture. This module loads before Day 2, so it owns keyboard
// activation first and forwards exactly one composed host click. Shadow-root capture
// remains a fallback for keyboard events that are not composed across the boundary.
//
// It also makes a freshly rendered #mainContent programmatically focusable in the
// MutationObserver microtask, before app.js tries to focus it in requestAnimationFrame.

const MATERIAL_BUTTON_SELECTOR = [
  "md-icon-button",
  "md-text-button",
  "md-filled-button",
  "md-filled-tonal-button",
  "md-outlined-button",
  "md-elevated-button",
].join(",");

const boundRoots = new WeakSet();

function activationKey(event) {
  return ["Enter", " "].includes(event.key)
    && !event.repeat
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey;
}

function dispatchHostActivation(host) {
  host.dispatchEvent(new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
  }));
}

function materialHostFromEvent(event) {
  return event.composedPath?.().find((node) => (
    node instanceof HTMLElement && node.matches?.(MATERIAL_BUTTON_SELECTOR)
  )) || null;
}

// Registered before day2-layer.js. For composed keyboard events this is the single
// authoritative path, preventing the older bridge and Material internals from racing.
document.addEventListener("keydown", (event) => {
  if (!activationKey(event)) return;
  const host = materialHostFromEvent(event);
  if (!host || host.hasAttribute("disabled")) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  dispatchHostActivation(host);
}, true);

function bindShadowCapture(host) {
  if (!(host instanceof HTMLElement) || host.hasAttribute("disabled")) return false;
  const root = host.shadowRoot;
  if (!root) return false;
  if (boundRoots.has(root)) return true;

  root.addEventListener("keydown", (event) => {
    if (!activationKey(event) || host.hasAttribute("disabled")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    dispatchHostActivation(host);
  }, true);
  boundRoots.add(root);
  return true;
}

function prepareHost(host) {
  if (!(host instanceof HTMLElement)) return;

  bindShadowCapture(host);
  queueMicrotask(() => bindShadowCapture(host));
  requestAnimationFrame(() => bindShadowCapture(host));
  window.setTimeout(() => bindShadowCapture(host), 0);
  window.setTimeout(() => bindShadowCapture(host), 50);

  const updateComplete = host.updateComplete;
  if (updateComplete && typeof updateComplete.then === "function") {
    updateComplete.then(() => bindShadowCapture(host)).catch(() => {});
  }
}

function prepareMainFocus(scope = document) {
  const main = scope instanceof HTMLElement && scope.id === "mainContent"
    ? scope
    : scope.querySelector?.("#mainContent");
  if (main && !main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
}

function prepareScope(scope = document) {
  prepareMainFocus(scope);
  if (scope instanceof HTMLElement && scope.matches?.(MATERIAL_BUTTON_SELECTOR)) {
    prepareHost(scope);
  }
  scope.querySelectorAll?.(MATERIAL_BUTTON_SELECTOR).forEach(prepareHost);
}

const observer = new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node instanceof HTMLElement) prepareScope(node);
    }
  }
});

const app = document.querySelector("#app");
if (app) observer.observe(app, { childList: true, subtree: true });

prepareScope();
