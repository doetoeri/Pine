const FIREBASE = globalThis.PINCON_FIREBASE_CONFIG || {};
const SDK = "12.16.0";
const CONSENT_KEY = "pincon-analytics-consent-v1";
const PROMPT_ID = "pinconAnalyticsConsent";
const STYLE_ID = "pinconAnalyticsConsentStyle";

const FLOW_ROUTES = new Set(["today", "timetable", "schedule", "assessment", "meal", "hub"]);
const NEXT_ROUTES = new Set(["today", "timetable", "schedule", "classroom", "more"]);
const SAFE_ACTIONS = new Set([
  "classic",
  "refresh",
  "change-class",
  "retry-flow",
  "meal-detail",
  "open-search",
  "open-notifications",
]);

let analyticsApi = null;
let analytics = null;
let initialized = false;
let lastScreenKey = "";
let initPromise = null;

function surface() {
  if (location.pathname.includes("/next/flow/")) return "flow";
  if (location.pathname.includes("/next/admin/")) return "admin";
  return "next";
}

function consentChoice() {
  const choice = localStorage.getItem(CONSENT_KEY);
  return choice === "granted" || choice === "denied" ? choice : "";
}

function routeFromLocation() {
  const raw = location.hash.replace(/^#\/?/, "").split(/[/?]/)[0].trim().toLowerCase();
  const allowed = surface() === "flow" ? FLOW_ROUTES : NEXT_ROUTES;
  return allowed.has(raw) ? raw : "today";
}

function eventHost(event, predicate) {
  return event.composedPath?.().find((node) => node instanceof HTMLElement && predicate(node)) || null;
}

function injectPromptStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .pincon-analytics-consent{position:fixed;z-index:2147483000;left:50%;bottom:calc(18px + env(safe-area-inset-bottom));transform:translateX(-50%);width:min(620px,calc(100vw - 28px));box-sizing:border-box;padding:16px 16px 14px;border:1px solid rgba(20,32,22,.14);border-radius:20px;background:rgba(250,252,248,.97);box-shadow:0 18px 48px rgba(25,42,29,.18);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);color:#182019;font:500 14px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Noto Sans KR",sans-serif}
    .pincon-analytics-consent strong{display:block;margin:0 0 4px;font-size:15px}
    .pincon-analytics-consent p{margin:0;color:#526057}
    .pincon-analytics-consent__actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
    .pincon-analytics-consent button{min-height:40px;padding:0 15px;border-radius:999px;border:1px solid rgba(29,52,34,.16);background:#fff;color:#233027;font:700 13px/1 system-ui,-apple-system,BlinkMacSystemFont,"Noto Sans KR",sans-serif;cursor:pointer}
    .pincon-analytics-consent button[data-choice="granted"]{border-color:transparent;background:#244d32;color:#fff}
    @media (max-width:520px){.pincon-analytics-consent{bottom:calc(86px + env(safe-area-inset-bottom));padding:14px}.pincon-analytics-consent__actions{display:grid;grid-template-columns:1fr 1fr}.pincon-analytics-consent button{width:100%}}
  `;
  document.head.appendChild(style);
}

function removePrompt() {
  document.getElementById(PROMPT_ID)?.remove();
}

function showPrompt() {
  if (consentChoice() || document.getElementById(PROMPT_ID)) return;
  injectPromptStyle();
  const box = document.createElement("section");
  box.id = PROMPT_ID;
  box.className = "pincon-analytics-consent";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "PinCon 사용 분석 설정");
  box.innerHTML = `
    <strong>PinCon 사용 분석</strong>
    <p>기능 개선을 위해 어떤 화면과 기능이 사용되는지만 집계합니다. 학번, 이름, 이메일, 검색어, 과제 제목이나 알림 내용은 보내지 않습니다.</p>
    <div class="pincon-analytics-consent__actions">
      <button type="button" data-choice="denied">안 함</button>
      <button type="button" data-choice="granted">허용</button>
    </div>
  `;
  box.addEventListener("click", (event) => {
    const button = eventHost(event, (node) => node.matches?.("button[data-choice]"));
    if (!button) return;
    setCollectionChoice(button.dataset.choice).catch(() => {});
  });
  document.body.appendChild(box);
}

async function loadAnalytics() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (!FIREBASE?.measurementId || !FIREBASE?.appId) return null;
    const [appApi, api] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-analytics.js`),
    ]);
    if (!(await api.isSupported())) return null;
    const app = appApi.getApps().length ? appApi.getApp() : appApi.initializeApp(FIREBASE);
    analyticsApi = api;
    analytics = api.getAnalytics(app);
    api.setUserId(analytics, null);
    api.setConsent({
      analytics_storage: "granted",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
    api.setAnalyticsCollectionEnabled(analytics, true);
    initialized = true;
    return analytics;
  })().catch((error) => {
    console.warn("[PinCon Analytics] unavailable", error);
    return null;
  });
  return initPromise;
}

function log(name, params = {}) {
  if (!initialized || !analytics || !analyticsApi || consentChoice() !== "granted") return;
  analyticsApi.logEvent(analytics, name, {
    app_surface: surface(),
    ...params,
  });
}

function logScreen(route = routeFromLocation()) {
  const allowed = surface() === "flow" ? FLOW_ROUTES : NEXT_ROUTES;
  if (!allowed.has(route)) return;
  const key = `${surface()}:${route}`;
  if (key === lastScreenKey) return;
  lastScreenKey = key;
  log("screen_view", {
    firebase_screen: route,
    firebase_screen_class: surface(),
  });
  log("pincon_route_view", { route });
}

function logAction(action, params = {}) {
  log("pincon_action", { action, route: routeFromLocation(), ...params });
}

async function startGrantedCollection() {
  const instance = await loadAnalytics();
  if (!instance) return;
  analyticsApi.setConsent({
    analytics_storage: "granted",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  analyticsApi.setAnalyticsCollectionEnabled(analytics, true);
  log("pincon_app_open", { route: routeFromLocation(), installed: matchMedia("(display-mode: standalone)").matches ? 1 : 0 });
  logScreen();
}

export async function setCollectionChoice(choice) {
  const next = choice === "granted" ? "granted" : "denied";
  localStorage.setItem(CONSENT_KEY, next);
  removePrompt();

  if (next === "granted") {
    await startGrantedCollection();
    return next;
  }

  if (initialized && analytics && analyticsApi) {
    analyticsApi.setConsent({
      analytics_storage: "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
    analyticsApi.setAnalyticsCollectionEnabled(analytics, false);
  }
  return next;
}

function bindBehaviorEvents() {
  document.addEventListener("click", (event) => {
    const routeControl = eventHost(event, (node) => node.hasAttribute?.("data-route"));
    if (routeControl) {
      const route = String(routeControl.getAttribute("data-route") || "").toLowerCase();
      queueMicrotask(() => logScreen(route));
      return;
    }

    const notification = eventHost(event, (node) => node.hasAttribute?.("data-notification-id"));
    if (notification) {
      const kind = String(notification.getAttribute("data-notification-kind") || "general").slice(0, 32);
      logAction("notification_open", { content_type: kind });
      return;
    }

    const assignment = eventHost(event, (node) => node.getAttribute?.("data-item-kind") === "assignment");
    if (assignment) {
      logAction("assignment_detail");
      return;
    }

    const lesson = eventHost(event, (node) => node.hasAttribute?.("data-lesson"));
    if (lesson) {
      logAction("lesson_detail");
      return;
    }

    const mealDate = eventHost(event, (node) => node.hasAttribute?.("data-meal-date"));
    if (mealDate) {
      logAction("meal_date_select");
      return;
    }

    const classicRoute = eventHost(event, (node) => node.hasAttribute?.("data-classic-route"));
    if (classicRoute) {
      const route = String(classicRoute.getAttribute("data-classic-route") || "").toLowerCase();
      logAction("classic_route_open", { target_route: NEXT_ROUTES.has(route) ? route : "other" });
      return;
    }

    const search = eventHost(event, (node) => node.id === "openSearch");
    if (search) {
      logAction("search_open");
      return;
    }

    const notifications = eventHost(event, (node) => node.id === "openNotifications");
    if (notifications) {
      logAction("notifications_open");
      return;
    }

    const actionControl = eventHost(event, (node) => node.hasAttribute?.("data-action"));
    if (!actionControl) return;
    const action = String(actionControl.getAttribute("data-action") || "").toLowerCase();
    if (SAFE_ACTIONS.has(action)) logAction(action.replaceAll("-", "_"));
  }, true);

  window.addEventListener("popstate", () => queueMicrotask(() => logScreen()));
  window.addEventListener("hashchange", () => queueMicrotask(() => logScreen()));
  window.addEventListener("appinstalled", () => logAction("pwa_installed"));
}

function exposeApi() {
  globalThis.PinConAnalytics = Object.freeze({
    choice: consentChoice,
    setChoice: setCollectionChoice,
    showSettings: () => {
      localStorage.removeItem(CONSENT_KEY);
      if (initialized && analytics && analyticsApi) {
        analyticsApi.setConsent({
          analytics_storage: "denied",
          ad_storage: "denied",
          ad_user_data: "denied",
          ad_personalization: "denied",
        });
        analyticsApi.setAnalyticsCollectionEnabled(analytics, false);
      }
      showPrompt();
    },
    event: (name, params = {}) => {
      const safe = String(name || "").toLowerCase();
      if (!/^[a-z][a-z0-9_]{1,38}$/.test(safe)) return;
      log(safe, params);
    },
  });
}

bindBehaviorEvents();
exposeApi();

if (consentChoice() === "granted") {
  startGrantedCollection().catch(() => {});
} else if (!consentChoice()) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", showPrompt, { once: true });
  } else {
    showPrompt();
  }
}
