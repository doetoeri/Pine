import { dateKey, isCareerStudy } from "./notification-study.js";

const TRACKER = Symbol.for("pincon.career-study.tracker");
const receiptKey = (uid, version, id) => `pincon-study-received:${uid}:v${version}:${id}`;
export async function installStudyTracking(platform) {
  if (window[TRACKER]) { await window[TRACKER].refresh(); return window[TRACKER]; }
  let refreshing = false, lastSession = "";
  const route = () => location.pathname.includes("/new/") ? "assessments" : location.hash.replace(/^#\/?/, "").split(/[?\/]/)[0] || "today";
  const activeContext = () => {
    const ctx = platform.notificationContext;
    return platform.user && !platform.user.isAnonymous && isCareerStudy(ctx?.config) && ctx.status === "ACTIVE"
      && ["BASELINE", "EXPERIMENT"].includes(ctx.phase) ? ctx : null;
  };
  function log(type, properties = {}, options = {}) {
    const ctx = activeContext();
    if (!ctx) return false;
    return platform.log(type, { route: route(), ...properties }, { ...options, contextOverride: ctx });
  }
  function session() {
    const ctx = activeContext();
    if (!ctx || document.hidden) return;
    const key = `${platform.user.uid}:${ctx.experimentVersion}:${dateKey()}:${Math.floor(Date.now() / 1_800_000)}`;
    if (key === lastSession) return;
    lastSession = key;
    log("session_start", { period: ctx.period, condition: ctx.condition || "" });
    platform.analytics.flush();
  }
  function received(message) {
    const ctx = platform.notificationContext;
    if (!platform.user || platform.user.isAnonymous || !ctx?.anonymousParticipant || !message.notificationId
      || message.experimentId !== "notification-frequency" || !Number(message.experimentVersion)
      || message.anonymousParticipant !== ctx.anonymousParticipant) return;
    const key = receiptKey(platform.user.uid, message.experimentVersion, message.notificationId);
    if (localStorage.getItem(key)) return;
    const queued = platform.log("notification_received", {
      notificationId: message.notificationId, condition: message.condition || "", period: Number(message.period || 0),
      category: message.category || "", route: message.targetRoute || "", slotIndex: Number(message.slotIndex ?? -1),
      sentAtMs: Number(message.sentAtMs || 0), receivedAtMs: Number(message.receivedAtMs || Date.now()),
    }, { contextOverride: { ...ctx, experimentVersion: Number(message.experimentVersion), variant: message.condition || "" },
      timestampMs: Number(message.receivedAtMs || Date.now()) });
    if (queued) localStorage.setItem(key, "1");
  }
  function attribution() {
    const ctx = activeContext();
    if (!ctx) return;
    const url = new URL(location.href), id = url.searchParams.get("pinconNotificationId");
    if (!id || url.searchParams.get("pinconExperimentId") !== "notification-frequency") return;
    const version = Number(url.searchParams.get("pinconExperimentVersion"));
    const participant = url.searchParams.get("pinconParticipant");
    if (participant === ctx.anonymousParticipant && version >= 3) {
      const properties = { notificationId: id, period: Number(url.searchParams.get("pinconPeriod") || 0),
        condition: url.searchParams.get("pinconCondition") || "", category: url.searchParams.get("pinconCategory") || "", route: route() };
      const options = { contextOverride: { ...ctx, experimentVersion: version, variant: properties.condition } };
      platform.log("notification_click", properties, options);
      const elapsed = Date.now() - Number(url.searchParams.get("pinconSentAt") || 0);
      if (elapsed >= 0) [[5, "5m"], [30, "30m"], [60, "1h"]].forEach(([minutes, window]) => {
        if (elapsed <= minutes * 60_000) platform.log(`app_open_after_notification_${window}`, { ...properties, window }, options);
      });
      // Opening a route alone is not recorded as reading the information.
      sessionStorage.setItem("pincon-study-click-context", JSON.stringify({ ...properties, experimentVersion: version, at: Date.now() }));
    }
    [...url.searchParams.keys()].filter((key) => key.startsWith("pincon")).forEach((key) => url.searchParams.delete(key));
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  }
  function informationView(itemType) {
    session();
    const type = { assignment: "assignment_view", schedule: "schedule_view", notice: "notice_view", material: "material_view", meal: "meal_view" }[itemType];
    if (!type) return;
    log(type, { itemType }, { dedupeKey: `study-view:${itemType}`, dedupeMs: 800 });
    let click = null;
    try { click = JSON.parse(sessionStorage.getItem("pincon-study-click-context") || "null"); } catch {}
    const ctx = activeContext();
    if (click && ctx && click.experimentVersion === ctx.experimentVersion && Date.now() - click.at < 60 * 60_000) {
      log("target_view_after_notification", { notificationId: click.notificationId, condition: click.condition, period: click.period, itemType },
        { dedupeKey: `study-target:${click.notificationId}`, dedupeMs: 3_600_000 });
    }
  }
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try { await platform.start(); session(); attribution(); }
    finally { refreshing = false; }
  }
  const tracker = { refresh, informationView };
  window[TRACKER] = tracker;
  window.addEventListener("pincon-study-information-viewed", (event) => informationView(event.detail?.itemType));
  document.addEventListener("click", (event) => {
    const node = event.composedPath?.().find((item) => item instanceof Element && item.matches?.("[data-detail-key],[data-detail]"));
    const key = node?.getAttribute("data-detail-key") || node?.getAttribute("data-detail") || "";
    const type = { assignment: "assignment", announcement: "notice", resource: "material", "evaluation-plan": "material", meal: "meal", lesson: "schedule" }[key.split(":")[0]];
    if (type) informationView(type);
  }, { capture: true, passive: true });
  navigator.serviceWorker?.addEventListener("message", (event) => {
    if (event.data?.type === "pincon-experiment-notification-received") received(event.data);
    if (event.data?.type === "pincon-experiment-notification-received-batch") (event.data.receipts || []).forEach(received);
  });
  navigator.serviceWorker?.ready?.then((registration) => (navigator.serviceWorker.controller || registration.active)?.postMessage({ type: "pincon-experiment-drain-received" })).catch(() => {});
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh().catch(() => {}); else platform.analytics.flush(); });
  window.addEventListener("pagehide", () => platform.analytics.flush());
  setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, 60_000);
  await refresh();
  return tracker;
}
