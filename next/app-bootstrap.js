import { accountReady } from "./simple-account-gate.js?v=20260903-simple1";

await import("./core/evaluation-plan-media.js?v=20260831-media2");
await import("./app.js?v=20260830-interaction1");
await import("./app-interactions.js?v=20260830-interaction1");
await import("./today-changes.js?v=20260905-digest1");
await import("./evaluation-plan-preview.js?v=20260831-media2");
await import("./write-mode.js");
await import("./admin-visibility.js");
await import("./account-center.js");
let privateLoaded = false;
async function loadPersonal(detail) {
  if (!["student", "legacy"].includes(detail?.mode)) return;
  if (privateLoaded) { if (detail.mode === "student") await import("./student-ops.js"); return; }
  privateLoaded = true;
  await import("./personal-notification-filter.js?v=20260830-personal1");
  if (detail.mode === "student") await import("./student-ops.js");
}
window.addEventListener("pincon-account-ready", (event) => void loadPersonal(event.detail));
void accountReady.then(loadPersonal);
