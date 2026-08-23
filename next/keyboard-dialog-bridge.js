// PinCon Next keyboard activation normalizer for Material buttons.
// Material Web renders the actual native <button> inside Shadow DOM. Chromium/WebKit
// do not always surface synthetic/native keyboard activation to the custom-element host
// in exactly the same way, especially while the App Shell is being re-rendered.
// Bind the real inner control after Lit finishes rendering, then route Enter/Space through
// the same composed host click contract used by pointer activation.

const MATERIAL_BUTTON_SELECTOR = [
  "md-icon-button",
  "md-text-button",
  "md-filled-button",
  "md-filled-tonal-button",
  "md-outlined-button",
  "md-elevated-button",
].join(",");

function innerButton(host) {
  return host?.shadowRoot?.querySelector("button, a") || null;
}

function dispatchHostActivation(host) {
  host.dispatchEvent(new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
  }));
}

function bindInnerControl(host) {
  if (!(host instanceof HTMLElement) || host.hasAttribute("disabled")) return false;
  const target = innerButton(host);
  if (!target) return false;
  if (target.__pinconKeyboardHost === host) return true;

  Object.defineProperty(target, "__pinconKeyboardHost", {
    value: host,
    configurable: true,
  });

  target.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    if (host.hasAttribute("disabled")) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    dispatchHostActivation(host);
  }, true);

  return true;
}

function prepareHost(host) {
  if (!(host instanceof HTMLElement)) return;

  // Lit can create the shadow button one microtask/frame after the host is connected.
  // Re-binding is idempotent, so cover each lifecycle point instead of racing it.
  bindInnerControl(host);
  queueMicrotask(() => bindInnerControl(host));
  requestAnimationFrame(() => bindInnerControl(host));

  const updateComplete = host.updateComplete;
  if (updateComplete && typeof updateComplete.then === "function") {
    updateComplete.then(() => bindInnerControl(host)).catch(() => {});
  }
}

function prepareScope(scope = document) {
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
