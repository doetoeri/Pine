// PinCon Next keyboard activation normalizer for Material buttons.
// Material Web renders the actual native <button> inside Shadow DOM. Chromium/WebKit
// can surface keyboard activation differently across the shadow boundary, especially
// while the App Shell is being re-rendered. Normalize both the host-capture path and
// the inner native-control path into the exact same composed host click contract.

const MATERIAL_BUTTON_SELECTOR = [
  "md-icon-button",
  "md-text-button",
  "md-filled-button",
  "md-filled-tonal-button",
  "md-outlined-button",
  "md-elevated-button",
].join(",");

function activationKey(event) {
  return ["Enter", " "].includes(event.key)
    && !event.repeat
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey;
}

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

function handleActivation(event, host) {
  if (!activationKey(event) || host.hasAttribute("disabled")) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  dispatchHostActivation(host);
}

function bindHostCapture(host) {
  if (host.__pinconAuthoritativeKeyboardBridge) return;
  Object.defineProperty(host, "__pinconAuthoritativeKeyboardBridge", {
    value: true,
    configurable: true,
  });
  host.addEventListener("keydown", (event) => handleActivation(event, host), true);
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
  target.addEventListener("keydown", (event) => handleActivation(event, host), true);
  return true;
}

function prepareHost(host) {
  if (!(host instanceof HTMLElement)) return;

  // This module is loaded before day2-layer.js. Its host capture listener therefore
  // wins the registration order and prevents the older fallback bridge from producing
  // a second or browser-dependent activation. If the event never crosses Shadow DOM,
  // the inner listener handles it instead.
  bindHostCapture(host);
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
