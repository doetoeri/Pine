// Legacy rollback module: ./account-gate.js?v=20260903-identity2
import { enableForcedReadonly, savedClassProfile } from "./core/degraded-readonly.js?v=20260905-readonly1";

function hasOfflineClassProfile() {
  return !navigator.onLine && Boolean(savedClassProfile());
}

async function importSchoolLifeModules() {
  const NativeMutationObserver = globalThis.MutationObserver;
  if (typeof NativeMutationObserver !== "function") {
    await import("./school-life.js?v=20260907-schoollife2");
    await import("./school-life-bell-schedule.js?v=20260907-schoollife2");
    await import("./school-life-inbox.js?v=20260907-schoollife2");
    await import("./school-life-editor.js?v=20260907-schoollife3");
    return;
  }

  function ScopedSchoolLifeMutationObserver(callback) {
    return new NativeMutationObserver((records, observer) => {
      const relevant = records.filter((record) => {
        const target = record.target;
        return !(target instanceof Element && target.closest?.("#schoolLifeAssistant"));
      });
      if (relevant.length) callback(relevant, observer);
    });
  }
  ScopedSchoolLifeMutationObserver.prototype = NativeMutationObserver.prototype;
  Object.setPrototypeOf(ScopedSchoolLifeMutationObserver, NativeMutationObserver);

  globalThis.MutationObserver = ScopedSchoolLifeMutationObserver;
  try {
    await import("./school-life.js?v=20260907-schoollife2");
    await import("./school-life-bell-schedule.js?v=20260907-schoollife2");
    await import("./school-life-inbox.js?v=20260907-schoollife2");
    await import("./school-life-editor.js?v=20260907-schoollife3");
  } finally {
    globalThis.MutationObserver = NativeMutationObserver;
  }
}

let accountReady = Promise.resolve(null);
if (hasOfflineClassProfile()) {
  const detail = { mode: "offline-readonly", user: null, account: null };
  enableForcedReadonly(detail.mode);
  globalThis.PINCON_ACCOUNT = detail;
  window.dispatchEvent(new CustomEvent("pincon-account-ready", { detail }));
} else {
  ({ accountReady } = await import("./simple-account-gate.js?v=20260905-readonly1"));
}

await accountReady;
await import("./route-focus-stability.js?v=20260903-route2");
await import("./core/evaluation-plan-media.js?v=20260831-media2");
await import("./personal-notification-filter.js?v=20260830-personal1");
await import("./firestore-route-budget.js?v=20260908-budget1");
await import("./app.js?v=20260905-readonly1");
await import("./firestore-visibility-budget.js?v=20260908-budget1");
await import("./readonly-notice.js?v=20260905-readonly1");
await import("./app-interactions.js?v=20260830-interaction1");
await import("./route-current-semantics.js?v=20260907-route1");
await import("./detail-history-stability.js?v=20260831-history1");
await import("./evaluation-plan-preview.js?v=20260831-media2");
await import("./write-mode.js");
await import("./admin-visibility.js");
await import("./account-center.js");
await import("./student-ops.js");
await import("./classroom-entry.js?v=20260906-officer1");
await import("./school-life-registration.js?v=20260907-schoollife1");
await importSchoolLifeModules();
await import("./dialog-focus-stability.js?v=20260903-focus1");