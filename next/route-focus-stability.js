const appRoot = document.querySelector("#app");
const ROUTES = new Set(["today", "timetable", "schedule", "classroom", "more"]);
const pointerRoutes = new Map();
let keyboardRoute = null;
let routeFocusSequence = 0;
let routeIntentSequence = 0;

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
    window.setTimeout(() => observer?.disconnect(), 600);
  }
}

function beginRouteIntent(route) {
  if (!ROUTES.has(route)) return null;
  return { route, token: ++routeIntentSequence };
}

function recoverRoute(route) {
  if (!ROUTES.has(route) || routeIsRendered(route)) return;
  if (currentRoute() !== route) {
    history.pushState({ route, detailKey: "" }, "", `#${route}`);
  }
  window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
  stabilizeRouteFocus(route);
}

function scheduleRouteRecovery(intent) {
  if (!intent || !ROUTES.has(intent.route)) return;
  const apply = () => {
    if (intent.token !== routeIntentSequence) return;
    recoverRoute(intent.route);
  };
  // app.js owns the normal activation. These delayed checks repair the WebKit
  // case where a background render replaces a Material route control while a
  // pointer press is in flight. The wider window also covers slower tablet
  // layouts without overriding a newer route intent because the token changes.
  [0, 80, 220, 500].forEach((delay) => window.setTimeout(apply, delay));
}

document.addEventListener("pointerdown", (event) => {
  const intent = beginRouteIntent(controlRoute(eventRouteControl(event)));
  if (intent) pointerRoutes.set(event.pointerId, intent);
}, true);

document.addEventListener("pointerup", (event) => {
  const intent = pointerRoutes.get(event.pointerId) || null;
  pointerRoutes.delete(event.pointerId);
  scheduleRouteRecovery(intent);
}, true);

document.addEventListener("pointercancel", (event) => {
  pointerRoutes.delete(event.pointerId);
}, true);

document.addEventListener("keydown", (event) => {
  if (!["Enter", " "].includes(event.key)) return;
  keyboardRoute = beginRouteIntent(controlRoute(eventRouteControl(event)));
}, true);

document.addEventListener("keyup", (event) => {
  if (!["Enter", " "].includes(event.key)) return;
  const intent = keyboardRoute;
  keyboardRoute = null;
  scheduleRouteRecovery(intent);
}, true);

document.addEventListener("click", (event) => {
  const route = controlRoute(eventRouteControl(event));
  const intent = beginRouteIntent(route);
  if (!intent) return;
  stabilizeRouteFocus(route);
  scheduleRouteRecovery(intent);
}, true);