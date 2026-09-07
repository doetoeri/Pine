const appRoot = document.querySelector("#app");
const pendingHosts = new WeakSet();

function routeCurrent(host) {
  return host?.getAttribute?.("data-aria-current") === "page"
    || host?.getAttribute?.("aria-current") === "page";
}

function applyRouteCurrent(host) {
  if (!(host instanceof HTMLElement) || !host.hasAttribute("data-route")) return;
  const focusable = host.shadowRoot?.querySelector("button, a") || host;
  if (routeCurrent(host)) focusable.setAttribute("aria-current", "page");
  else focusable.removeAttribute("aria-current");
}

function settleRouteHost(host) {
  if (!(host instanceof HTMLElement) || !host.hasAttribute("data-route")) return;
  applyRouteCurrent(host);
  if (pendingHosts.has(host)) return;
  pendingHosts.add(host);

  const finish = async () => {
    try {
      const tagName = host.localName;
      if (tagName?.includes("-")) await customElements.whenDefined(tagName);
      const updateComplete = host.updateComplete;
      if (updateComplete && typeof updateComplete.then === "function") await updateComplete;
      applyRouteCurrent(host);
      queueMicrotask(() => applyRouteCurrent(host));
      requestAnimationFrame(() => applyRouteCurrent(host));
    } catch {
      applyRouteCurrent(host);
    } finally {
      pendingHosts.delete(host);
    }
  };

  void finish();
}

function settleRouteScope(scope = document) {
  if (scope instanceof HTMLElement && scope.hasAttribute("data-route")) settleRouteHost(scope);
  scope.querySelectorAll?.("[data-route]").forEach(settleRouteHost);
}

const observer = new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node instanceof HTMLElement) settleRouteScope(node);
    }
  }
});

if (appRoot) observer.observe(appRoot, { childList: true, subtree: true });
settleRouteScope();

document.addEventListener("click", (event) => {
  const routeHost = event.composedPath?.().find(
    (node) => node instanceof HTMLElement && node.hasAttribute?.("data-route"),
  );
  if (!routeHost) return;
  requestAnimationFrame(() => settleRouteScope(appRoot || document));
}, true);
