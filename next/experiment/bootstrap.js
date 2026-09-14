import { UI_EXPERIMENT_ID } from "./constants.js";
import { getExperimentPlatform } from "./experiment-service.js";

let platform = null;
let previousRoute = "";
const taskStartedAt = new Map();

function routeFromLocation() {
  return location.hash.replace(/^#\/?/, "").split(/[?\/]/)[0] || "today";
}

function eventHost(event, selector) {
  return event.composedPath?.().find((node) => node instanceof Element && node.matches?.(selector)) || null;
}

function itemTypeFromDetail(value) {
  const key = String(value || "");
  if (key.startsWith("lesson:")) return "schedule";
  if (key.startsWith("assignment:")) return "assignment";
  if (key.startsWith("announcement:")) return "notice";
  if (key.startsWith("resource:") || key.startsWith("evaluation-plan:")) return "material";
  if (key.startsWith("meal:")) return "meal";
  return "";
}

function markTask(task) {
  if (!task) return;
  taskStartedAt.set(task, performance.now());
  platform?.log("task_start", { task, route: routeFromLocation() }, { dedupeKey: `task:${task}`, dedupeMs: 500 });
}

function finishTask(task, itemType) {
  if (!task) return;
  const started = taskStartedAt.get(task);
  platform?.log("target_information_view", {
    task,
    itemType,
    route: routeFromLocation(),
    durationMs: started ? Math.max(0, performance.now() - started) : 0,
  }, { dedupeKey: `target:${task}:${itemType}`, dedupeMs: 800 });
  taskStartedAt.delete(task);
}

function taskForRoute(route) {
  if (route === "timetable") return "schedule";
  if (route === "schedule") return "assignment";
  if (route === "classroom") return "notice";
  return "";
}

function installNavigationInstrumentation() {
  previousRoute = routeFromLocation();
  const onRoute = () => {
    const route = routeFromLocation();
    if (route === previousRoute) return;
    platform?.log("navigation_change", { from: previousRoute, to: route, route });
    previousRoute = route;
    markTask(taskForRoute(route));
  };
  window.addEventListener("hashchange", onRoute, { passive: true });
  window.addEventListener("popstate", onRoute, { passive: true });

  document.addEventListener("click", (event) => {
    const routeControl = eventHost(event, "[data-route]");
    if (routeControl) markTask(taskForRoute(routeControl.getAttribute("data-route")));

    const detail = eventHost(event, "[data-detail-key],[data-detail]");
    const key = detail?.getAttribute("data-detail-key") || detail?.getAttribute("data-detail") || "";
    const itemType = itemTypeFromDetail(key);
    if (itemType) {
      const eventType = {
        schedule: "schedule_view",
        assignment: "assignment_view",
        notice: "notice_view",
        material: "material_view",
        meal: "meal_view",
      }[itemType];
      platform?.log(eventType, { itemType, route: routeFromLocation() });
      finishTask(itemType === "schedule" ? "schedule" : itemType === "assignment" ? "assignment" : itemType === "notice" ? "notice" : "material", itemType);
    }
  }, { capture: true, passive: true });
}

function installGuardrails() {
  window.addEventListener("error", (event) => {
    platform?.log("js_error", {
      errorType: "script",
      source: String(event.filename || "").split("/").pop().slice(0, 80) || "unknown",
    }, { dedupeKey: `js:${event.message || "error"}`, dedupeMs: 5000 });
  }, { passive: true });

  window.addEventListener("unhandledrejection", () => {
    platform?.log("js_error", { errorType: "promise", source: "unhandledrejection" }, {
      dedupeKey: "js:promise",
      dedupeMs: 5000,
    });
  }, { passive: true });

  const duration = Math.max(0, Math.round(performance.now()));
  platform?.log("page_load", { durationMs: duration, route: routeFromLocation() });
}

function installNotificationAttribution() {
  const url = new URL(location.href);
  const notificationId = url.searchParams.get("pinconNotificationId") || "";
  const experimentId = url.searchParams.get("pinconExperimentId") || "";
  if (!notificationId || !experimentId) return;

  platform?.log("notification_click", {
    notificationId,
    condition: url.searchParams.get("pinconCondition") || "",
    category: url.searchParams.get("pinconCategory") || "",
    route: routeFromLocation(),
  });

  const clickedAt = Number(url.searchParams.get("pinconClickedAt") || Date.now());
  const elapsed = Math.max(0, Date.now() - clickedAt);
  if (elapsed <= 5 * 60_000) platform?.log("app_open_after_notification_5m", { notificationId, window: "5m" });
  if (elapsed <= 30 * 60_000) platform?.log("app_open_after_notification_30m", { notificationId, window: "30m" });
  if (elapsed <= 60 * 60_000) platform?.log("app_open_after_notification_1h", { notificationId, window: "1h" });

  ["pinconNotificationId", "pinconExperimentId", "pinconCondition", "pinconCategory", "pinconClickedAt"]
    .forEach((key) => url.searchParams.delete(key));
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
}

export async function initExperimentPlatform() {
  platform = await getExperimentPlatform();

  globalThis.PinConExperiment = Object.freeze({
    get context() { return platform.context; },
    get uiContext() { return platform.uiContext || (platform.context?.experimentId === UI_EXPERIMENT_ID ? platform.context : null); },
    log: (eventType, properties, options) => platform.log(eventType, properties, options),
    flush: () => platform.analytics.flush(),
    saveNotificationSurvey: (payload) => platform.saveNotificationSurvey(payload),
  });

  installNavigationInstrumentation();
  installGuardrails();
  installNotificationAttribution();
  platform.log("session_start", { route: routeFromLocation() }, { dedupeKey: "session_start", dedupeMs: 60_000 });
  return platform;
}

export function reportDataGatewaySnapshot(snapshot = {}) {
  if (!platform) return;
  const failed = Object.entries(snapshot.collectionStatus || {})
    .filter(([, status]) => status === "error")
    .map(([name]) => name);
  if (snapshot.error || failed.length) {
    platform.log("data_load_failure", {
      errorType: snapshot.error ? "gateway" : "collection",
      source: failed[0] || "gateway",
    }, { dedupeKey: `data:${failed.join(",")}:${snapshot.error || ""}`, dedupeMs: 15_000 });
  }
}
