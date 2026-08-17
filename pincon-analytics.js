import { f as firebaseApi } from "./assets/firebase-IW9tbrMW.js";
await globalThis.PINCON_MATERIAL_READY;

const FIREBASE = globalThis.PINCON_FIREBASE_CONFIG || {};
const SCHOOL = globalThis.PINCON_SCHOOL_CONFIG || { id: "gochon-high", name: "학교" };
const PROJECT_ID = FIREBASE.projectId || "";
const SDK = "12.16.0";
const VERSION = "2026.08.17-material-analytics1";
const ENABLE_KEY = "pincon-analytics-enabled-v1";

let analyticsApi = null;
let analytics = null;
let currentUser = null;
let currentRole = null;
let initialized = false;
let initError = "";
let cardQueued = false;
let lastScreen = "";
let vitals = { lcp: 0, cls: 0, inp: 0 };

function analyticsEnabled() {
  return localStorage.getItem(ENABLE_KEY) !== "0";
}

function profile() {
  try { return JSON.parse(localStorage.getItem("pincon-profile-v2") || "null") || {}; }
  catch { return {}; }
}

function deviceClass() {
  const width = Math.min(screen.width || innerWidth || 0, innerWidth || screen.width || 0);
  if (width && width < 600) return "mobile";
  if (width && width < 1024) return "tablet";
  return "desktop";
}

function pwaMode() {
  return matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone ? "standalone" : "browser";
}

function betaStatus() {
  return localStorage.getItem("pincon-next-beta-v1") === "1" ? "on" : "off";
}

function authMode(user) {
  if (!user) return "signed_out";
  if (user.isAnonymous) return "guest";
  const provider = user.providerData?.[0]?.providerId || "";
  if (provider === "apple.com") return "apple";
  if (provider === "google.com") return "google";
  return "account";
}

function safeParams(params = {}) {
  const out = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "string") out[key] = value.slice(0, 80);
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

async function initAnalytics() {
  if (initialized || initError || !analyticsEnabled()) return;
  initialized = true;
  try {
    const [appApi, api] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-analytics.js`),
    ]);
    if (!(await api.isSupported())) throw new Error("이 브라우저에서는 Google Analytics를 지원하지 않습니다.");
    const app = appApi.getApps().length ? appApi.getApp() : appApi.initializeApp(FIREBASE);
    analyticsApi = api;
    analytics = api.getAnalytics(app);
    api.setConsent({
      analytics_storage: "granted",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      personalization_storage: "denied",
      functionality_storage: "granted",
      security_storage: "granted",
    });
    api.setAnalyticsCollectionEnabled(analytics, true);
    api.setDefaultEventParameters({
      app_area: "pincon_web",
      app_version: VERSION,
      school_scope: SCHOOL.id,
      device_class: deviceClass(),
      pwa_mode: pwaMode(),
    });
    updateUserProperties();
    log("pincon_session_ready", { beta_status: betaStatus(), auth_mode: authMode(currentUser) });
    installWebVitals();
    scheduleAdminCard();
  } catch (error) {
    initError = error?.message || "Analytics 초기화 실패";
    console.warn("[PinCon Analytics]", error);
    scheduleAdminCard();
  }
}

function updateUserProperties() {
  if (!analytics || !analyticsApi) return;
  const p = profile();
  const grade = Number(p?.grade);
  analyticsApi.setUserProperties(analytics, safeParams({
    school_scope: SCHOOL.id,
    grade: Number.isInteger(grade) && grade >= 1 && grade <= 3 ? `g${grade}` : "unknown",
    device_class: deviceClass(),
    pwa_mode: pwaMode(),
    beta_status: betaStatus(),
    auth_mode: authMode(currentUser),
  }));
}

function log(name, params = {}) {
  if (!analyticsEnabled()) return;
  if (!analytics || !analyticsApi) {
    initAnalytics().then(() => {
      if (analytics && analyticsApi) analyticsApi.logEvent(analytics, name, safeParams(params));
    });
    return;
  }
  analyticsApi.logEvent(analytics, name, safeParams(params));
}

function screenView(name) {
  if (!name || name === lastScreen) return;
  lastScreen = name;
  log("screen_view", { firebase_screen: name, firebase_screen_class: "pincon_web" });
}

function classifyMainSection(target) {
  const text = String(target?.textContent || "").replace(/\s+/g, " ").trim();
  const whitelist = [
    ["오늘", "today"], ["시간표", "timetable"], ["급식", "meal"], ["공지", "notice"],
    ["준비물", "supplies"], ["수행", "assignments"], ["일정", "events"], ["모둠", "groups"],
    ["더보기", "more"], ["설정", "settings"],
  ];
  const hit = whitelist.find(([label]) => text === label || text.startsWith(label));
  return hit?.[1] || "";
}

function installEventTracking() {
  document.addEventListener("click", (event) => {
    const t = event.target.closest?.("button,a,md-filled-button,md-filled-tonal-button,md-outlined-button,md-text-button,md-fab,md-filter-chip,md-list-item");
    if (!t) return;

    const section = classifyMainSection(t);
    if (section) screenView(section);

    if (t.matches?.("[data-new-poll]")) log("feature_action", { feature: "poll", action_type: "create_open" });
    if (t.matches?.("[data-vote]")) log("feature_action", { feature: "poll", action_type: "vote_save" });
    if (t.matches?.("[data-toggle-poll]")) log("feature_action", { feature: "poll", action_type: "status_toggle" });
    if (t.matches?.("[data-new-link]")) log("feature_action", { feature: "group_share", action_type: "link_open" });
    if (t.matches?.("[data-new-note]")) log("feature_action", { feature: "group_share", action_type: "text_open" });
    if (t.matches?.("[data-share-drive]")) log("share", { content_type: "group_share" });
    if (t.matches?.("[data-copy-drive]")) log("feature_action", { feature: "group_share", action_type: "copy" });
    if (t.matches?.("[data-new-assignment]")) log("feature_action", { feature: "assignment", action_type: "create_open" });
    if (t.matches?.("[data-progress]")) log("assignment_progress", { progress_state: t.dataset.progress || "unknown" });
    if (t.matches?.("[data-add-kind]")) log("content_editor_open", { item_type: t.dataset.addKind || "unknown" });
    if (t.matches?.("[data-action='edit']")) log("feature_action", { feature: "content", action_type: "edit_open" });
    if (t.matches?.("[data-action='delete']")) log("feature_action", { feature: "content", action_type: "delete_open" });
    if (t.matches?.(".pincon-material-next-fab")) log("feature_action", { feature: "next", action_type: "open" });
    if (t.matches?.("[data-copy-brief]")) log("feature_action", { feature: "briefing", action_type: "copy" });
    if (t.matches?.("[data-share-brief]")) log("share", { content_type: "briefing" });
    if (t.matches?.("[data-refresh-snapshot]")) log("feature_action", { feature: "offline_snapshot", action_type: "refresh" });
  }, { capture: true, passive: true });

  document.addEventListener("change", (event) => {
    const t = event.target;
    if (t?.matches?.("[data-pincon-beta-switch]")) {
      log("beta_toggle", { beta_status: t.selected ? "on" : "off" });
      setTimeout(updateUserProperties, 0);
    }
    if (t?.matches?.("[data-progress]")) log("assignment_progress", { progress_state: t.dataset.progress || "unknown" });
    if (t?.id === "pincon-next-tabs") {
      const names = ["brief", "search", "focus", "radar", "notes", "prefs"];
      log("next_feature_view", { feature: names[t.activeTabIndex] || "unknown" });
    }
  }, { capture: true, passive: true });

  let searchTimer = null;
  document.addEventListener("input", (event) => {
    if (event.target?.id !== "pincon-next-search") return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const n = String(event.target.value || "").trim().length;
      const bucket = n === 0 ? "empty" : n <= 5 ? "1_5" : n <= 15 ? "6_15" : "16_plus";
      log("pincon_search", { query_length_bucket: bucket });
    }, 700);
  }, { passive: true });

  window.addEventListener("appinstalled", () => log("pwa_install", { pwa_mode: pwaMode() }), { passive: true });
  window.addEventListener("online", () => log("connection_state", { state: "online" }), { passive: true });
  window.addEventListener("offline", () => log("connection_state", { state: "offline" }), { passive: true });
  window.addEventListener("error", (event) => {
    const source = String(event.filename || "").split("/").pop().slice(0, 50) || "unknown";
    log("app_error", { error_type: "script", source_file: source });
  }, { passive: true });
  window.addEventListener("unhandledrejection", () => log("app_error", { error_type: "promise" }), { passive: true });
}

function installWebVitals() {
  if (!("PerformanceObserver" in window)) return;
  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) vitals.lcp = Math.round(last.startTime || 0);
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {}
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) vitals.cls += Number(entry.value || 0);
    }).observe({ type: "layout-shift", buffered: true });
  } catch {}
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (entry.interactionId) vitals.inp = Math.max(vitals.inp, Math.round(entry.duration || 0));
    }).observe({ type: "event", buffered: true, durationThreshold: 40 });
  } catch {}
  window.addEventListener("pagehide", () => {
    log("web_vitals", {
      lcp_ms: vitals.lcp || 0,
      cls_x1000: Math.round(vitals.cls * 1000),
      inp_ms: vitals.inp || 0,
    });
  }, { once: true, passive: true });
}

async function readOwnRole(user) {
  if (!user || user.isAnonymous || !PROJECT_ID) return null;
  try {
    const token = await user.getIdToken();
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/schools/${SCHOOL.id}/roles/${user.uid}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return null;
    const doc = await response.json();
    const fields = doc.fields || {};
    return {
      level: fields.level?.stringValue || "",
      enabled: fields.enabled?.booleanValue === true,
    };
  } catch { return null; }
}

function analyticsStatusText() {
  if (!analyticsEnabled()) return "이 기기에서 수집 꺼짐";
  if (analytics) return "GA4 측정 활성";
  if (initError) return "GA4 연결 확인 필요";
  return "GA4 연결 확인 중";
}

function ensureAdminCard() {
  const grid = document.querySelector(".settings-grid");
  let card = document.querySelector(".pincon-analytics-admin-card");
  if (!grid || !currentRole?.enabled || currentRole.level !== "school") {
    card?.remove();
    return;
  }
  if (!card) {
    card = document.createElement("section");
    card.className = "pincon-analytics-admin-card";
    grid.appendChild(card);
  }
  card.innerHTML = `<md-list>
    <md-list-item>
      <md-icon slot="start">monitoring</md-icon>
      <div slot="headline">PinCon Analytics</div>
      <div slot="supporting-text">개인 이름·이메일·UID·검색어 원문은 보내지 않고, 기능 사용·성능·기기 유형을 GA4 이벤트로 측정합니다.</div>
      <md-assist-chip slot="end" label="${analyticsStatusText()}"></md-assist-chip>
    </md-list-item>
    <md-list-item>
      <div slot="headline" class="pincon-material-actions">
        <md-filled-button href="https://analytics.google.com/analytics/web/" target="_blank"><md-icon slot="icon">analytics</md-icon>Google Analytics</md-filled-button>
        <md-outlined-button href="https://console.firebase.google.com/project/${encodeURIComponent(PROJECT_ID)}/analytics" target="_blank"><md-icon slot="icon">query_stats</md-icon>Firebase Analytics</md-outlined-button>
      </div>
    </md-list-item>
    <md-list-item>
      <div slot="headline">수집 범위</div>
      <div slot="supporting-text">방문·세션 · 기능별 사용 · 투표/공유/과제 흐름 · Beta 이용 · PWA 설치 · 오류 유형 · LCP/CLS/INP 성능</div>
    </md-list-item>
    <md-list-item>
      <div slot="headline">익명 사용 통계</div>
      <div slot="supporting-text">광고 저장·광고 사용자 데이터·광고 개인화는 항상 거부합니다.</div>
      <md-switch slot="end" data-analytics-toggle ${analyticsEnabled() ? "selected" : ""}></md-switch>
    </md-list-item>
  </md-list>`;
  card.querySelector("[data-analytics-toggle]")?.addEventListener("change", (event) => {
    const enabled = Boolean(event.target.selected);
    localStorage.setItem(ENABLE_KEY, enabled ? "1" : "0");
    if (analytics && analyticsApi) analyticsApi.setAnalyticsCollectionEnabled(analytics, enabled);
    if (enabled) { initError = ""; initialized = false; initAnalytics(); }
    scheduleAdminCard();
  });
}

function scheduleAdminCard() {
  if (cardQueued) return;
  cardQueued = true;
  requestAnimationFrame(() => { cardQueued = false; ensureAdminCard(); });
}

firebaseApi.observeAuth(async (user) => {
  currentUser = user;
  currentRole = await readOwnRole(user);
  updateUserProperties();
  scheduleAdminCard();
  if (user) log("login", { method: authMode(user) });
});

const root = document.getElementById("root");
if (root) new MutationObserver(scheduleAdminCard).observe(root, { childList: true, subtree: true });
window.addEventListener("storage", () => { updateUserProperties(); scheduleAdminCard(); }, { passive: true });
window.addEventListener("pageshow", () => { updateUserProperties(); scheduleAdminCard(); }, { passive: true });

installEventTracking();
initAnalytics();
