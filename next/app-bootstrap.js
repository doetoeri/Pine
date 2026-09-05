// Legacy rollback module: ./account-gate.js?v=20260903-identity2
function hasOfflineClassProfile() {
  if (navigator.onLine) return false;
  try {
    const profile = JSON.parse(localStorage.getItem("pincon-profile-v2") || "null");
    const grade = Number(profile?.grade);
    const classNumber = Number(profile?.classNumber);
    return Number.isInteger(grade)
      && grade >= 1
      && grade <= 3
      && Number.isInteger(classNumber)
      && classNumber >= 1
      && classNumber <= 10;
  } catch {
    return false;
  }
}

let accountReady = Promise.resolve(null);
if (hasOfflineClassProfile()) {
  const detail = { mode: "offline-readonly", user: null, account: null };
  globalThis.PINCON_OFFLINE_READONLY = true;
  globalThis.PINCON_ACCOUNT = detail;
  window.dispatchEvent(new CustomEvent("pincon-account-ready", { detail }));
} else {
  ({ accountReady } = await import("./simple-account-gate.js?v=20260903-simple1"));
}

await accountReady;
await import("./route-focus-stability.js?v=20260903-route2");
await import("./core/evaluation-plan-media.js?v=20260831-media2");
await import("./personal-notification-filter.js?v=20260830-personal1");
await import("./app.js?v=20260830-interaction1");
await import("./app-interactions.js?v=20260830-interaction1");
await import("./detail-history-stability.js?v=20260831-history1");
await import("./evaluation-plan-preview.js?v=20260831-media2");
await import("./write-mode.js");
await import("./admin-visibility.js");
await import("./account-center.js");
await import("./student-ops.js");
await import("./dialog-focus-stability.js?v=20260903-focus1");
