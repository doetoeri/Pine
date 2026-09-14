// Legacy rollback module: ./account-gate.js?v=20260903-identity2
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
const { initExperimentPlatform, reportDataGatewaySnapshot } = await import("./experiment/bootstrap.js?v=20260914-beta1");
const experimentPlatform = await initExperimentPlatform().catch((error) => {
  console.warn("[PinCon Experiment] bootstrap failed; using stable UI", error);
  return null;
});
if (experimentPlatform && localStorage.getItem("pincon-experiment-login-failure-pending-v1") === "1") {
  experimentPlatform.log("login_failure", { errorType: "account_gate", source: "previous_session" });
  localStorage.removeItem("pincon-experiment-login-failure-pending-v1");
}
document.body.dataset.pinconVariant = "legacy";

await import("./route-focus-stability.js?v=20260903-route2");
await import("./core/evaluation-plan-media.js?v=20260831-media2");
await import("./personal-notification-filter.js?v=20260830-personal1");
await import("./app.js?v=20260905-readonly1");

try {
  const { NextDataGateway } = await import("./core/data-gateway.js");
  const experimentGateway = new NextDataGateway();
  experimentGateway.addEventListener("change", (event) => reportDataGatewaySnapshot(event.detail));
  reportDataGatewaySnapshot(experimentGateway.snapshot());
} catch {}

if (experimentPlatform?.uiContext?.variant === "next") {
  try {
    await import("./experiments/pincon-next-ui.js?v=20260914-beta1");
  } catch (error) {
    document.body.dataset.pinconVariant = "legacy";
    experimentPlatform?.log("js_error", { errorType: "variant_boot", source: "pincon-next-ui" });
    console.error("[PinCon Experiment] Next variant failed; Legacy remains active", error);
  }
}

await import("./experiments/public-beta.js?v=20260914-beta1").catch(() => {});
await import("./experiments/ui-satisfaction.js?v=20260914-exp1").catch(() => {});
await import("./experiments/notification-frequency.js?v=20260914-exp1").catch(() => {});
await import("./readonly-notice.js?v=20260905-readonly1");
await import("./app-interactions.js?v=20260830-interaction1");
await import("./detail-history-stability.js?v=20260831-history1");
await import("./evaluation-plan-preview.js?v=20260831-media2");
await import("./write-mode.js");
await import("./admin-visibility.js");
await import("./account-center.js");
await import("./student-ops.js");
await import("./classroom-entry.js?v=20260906-officer1");
await import("./dialog-focus-stability.js?v=20260903-focus1");
