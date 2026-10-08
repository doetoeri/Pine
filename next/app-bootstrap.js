import { enableForcedReadonly, savedClassProfile } from "./core/degraded-readonly.js?v=20260905-readonly1";

function hasOfflineClassProfile() {
  return !navigator.onLine && Boolean(savedClassProfile());
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

try {
  await accountReady;
} catch (error) {
  try { localStorage.setItem("pincon-experiment-login-failure-pending-v1", "1"); } catch {}
  throw error;
}
// Mount the usable app before experiment configuration and analytics.
document.body.dataset.pinconVariant = "legacy";
await import("./evaluation-plans/service.js");
await import("./personal-notification-filter.js?v=20260830-personal1");
await import("./loading-resilience.js?v=20261007-light2");
await import("./app.js?v=20261009-coverflow1");
await import("./app-interactions.js?v=20261007-light2");
await import("./theme.js?v=20261007-light2");

await Promise.all([
  import("./readonly-notice.js?v=20260905-readonly1"),
  import("./write-mode.js"),
  import("./evaluation-plans/student.js"),
  import("./admin-visibility.js"),
  import("./account-center.js"),
  import("./student-ops.js?v=20261007-light2"),
  import("./classroom-entry.js?v=20260906-officer1"),
  import("./detail-history-stability.js?v=20260831-history1"),
  import("./dialog-focus-stability.js?v=20260903-focus1"),
]);

async function startExperiments() {
  const { initExperimentPlatform, reportDataGatewaySnapshot } = await import("./experiment/bootstrap.js?v=20261007-light2");
  const experimentPlatform = await initExperimentPlatform();
  if (localStorage.getItem("pincon-experiment-login-failure-pending-v1") === "1") {
    experimentPlatform.log("login_failure", { errorType: "account_gate", source: "previous_session" });
    localStorage.removeItem("pincon-experiment-login-failure-pending-v1");
  }
  const { NextDataGateway } = await import("./core/data-gateway.js");
  const gateway = new NextDataGateway();
  gateway.addEventListener("change", (event) => reportDataGatewaySnapshot(event.detail));
  reportDataGatewaySnapshot(gateway.snapshot());
  if (experimentPlatform.uiContext?.variant === "next") {
    await import("./experiments/pincon-next-ui.js?v=20261007-light2").catch((error) => {
      document.body.dataset.pinconVariant = "legacy";
      experimentPlatform.log("js_error", { errorType: "variant_boot", source: "pincon-next-ui" });
      console.error("[PinCon Experiment]", error);
    });
  }
  await Promise.all([
    import("./experiments/public-beta.js?v=20260914-beta1"),
    import("./experiments/ui-satisfaction.js?v=20260914-exp1"),
    import("./experiments/notification-frequency.js?v=20260914-exp1"),
  ]);
}
startExperiments().catch((error) => console.warn("[PinCon Experiment]", error));
