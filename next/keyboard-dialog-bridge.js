// PinCon Next keyboard activation normalizer for Material buttons.
// Material Web renders its real native control inside an open Shadow Root. Some browser
// paths stop the key event before it reaches the custom-element host, so listening on
// the host is not sufficient. Capture on the Shadow Root itself, before the inner
// control receives the event, and forward one composed host click.

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
