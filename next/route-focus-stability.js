const appRoot = document.querySelector("#app");
const ROUTES = new Set(["today", "timetable", "schedule", "classroom", "more"]);
const pointerRoutes = new Map();
let keyboardRoute = "";
let routeFocusSequence = 0;

function eventRouteControl(event) {
  return event.composedPath?.().find((node) => (
    node instanceof HTMLElement && node.hasAttribute?.("data-route")
  )) || null;
}

function controlRoute(control) {
  const route = control?.getAttribute?.("data-route") || "";
  return ROUTES.has(route) ? route : "";
}

function currentRoute() {
  const raw = location.hash.replace(/^#\/?/, "").split(/[/?]/)[0];
  return ROUTES.has(raw) ? raw : "today";
}

function routeIsRendered(route) {
  return currentRoute() === route && Boolean(document.querySelector(`#${CSS.escape(route)}-title`));
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

function recoverRoute(route) {
  if (!ROUTES.has(route) || routeIsRendered(route)) return;
  if (currentRoute() !== route) {
    history.pushState({ route, detailKey: "" }, "", `#${route}`);
  }
  window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
  stabilizeRouteFocus(route);
}

function scheduleRouteRecovery(route) {
  if (!ROUTES.has(route)) return;
  // Let app.js handle the normal click first. This only repairs activations whose
  // Material button was replaced by a background render between press and click.
  window.setTimeout(() => recoverRoute(route), 0);
  window.setTimeout(() => recoverRoute(route), 80);
}

document.addEventListener("pointerdown", (event) => {
  const route = controlRoute(eventRouteControl(event));
  if (route) pointerRoutes.set(event.pointerId, route);
}, true);

document.addEventListener("pointerup", (event) => {
  const route = pointerRoutes.get(event.pointerId) || "";
  pointerRoutes.delete(event.pointerId);
  if (route) scheduleRouteRecovery(route);
}, true);

document.addEventListener("pointercancel", (event) => {
  pointerRoutes.delete(event.pointerId);
}, true);

document.addEventListener("keydown", (event) => {
  if (!['Enter', ' '].includes(event.key)) return;
  keyboardRoute = controlRoute(eventRouteControl(event));
}, true);

document.addEventListener("keyup", (event) => {
  if (!['Enter', ' '].includes(event.key)) return;
  const route = keyboardRoute;
  keyboardRoute = "";
  if (route) scheduleRouteRecovery(route);
}, true);

document.addEventListener("click", (event) => {
  const route = controlRoute(eventRouteControl(event));
  if (!route) return;
  stabilizeRouteFocus(route);
  scheduleRouteRecovery(route);
}, true);
