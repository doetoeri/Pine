const appRoot = document.querySelector("#app");
let routeFocusSequence = 0;

function eventRouteControl(event) {
  return event.composedPath?.().find((node) => (
    node instanceof HTMLElement && node.hasAttribute?.("data-route")
  )) || null;
}

function routeControlOwnsFocus(active, route) {
  if (!(active instanceof HTMLElement)) return false;
  if (active.getAttribute("data-route") === route) return true;
  return active.closest?.(`[data-route="${CSS.escape(route)}"]`) != null;
}

function focusMayMoveToMain(active, route) {
  return !active
    || active === document.body
    || active === document.documentElement
    || active === appRoot
    || active.id === "mainContent"
    || routeControlOwnsFocus(active, route);
}

function stabilizeRouteFocus(route) {
  const sequence = ++routeFocusSequence;
  let observer = null;

  const apply = () => {
    if (sequence !== routeFocusSequence) return;
    const main = document.querySelector("#mainContent");
    if (!main || !focusMayMoveToMain(document.activeElement, route)) return;
    if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
    if (document.activeElement !== main) main.focus({ preventScroll: true });
  };

  requestAnimationFrame(() => {
    apply();
    requestAnimationFrame(apply);
  });
  [0, 60, 160, 320].forEach((delay) => window.setTimeout(apply, delay));

  if (appRoot) {
    observer = new MutationObserver(() => queueMicrotask(apply));
    observer.observe(appRoot, { childList: true, subtree: true });
    window.setTimeout(() => observer?.disconnect(), 400);
  }
}

document.addEventListener("click", (event) => {
  const control = eventRouteControl(event);
  const route = control?.getAttribute("data-route") || "";
  if (route) stabilizeRouteFocus(route);
}, true);
