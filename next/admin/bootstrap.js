import { NextDataGateway } from "../core/data-gateway.js";

await import("../core/evaluation-plan-media.js?v=20260831-media2");
const gateway = new NextDataGateway();

await gateway.start();
const snapshot = gateway.snapshot();

if (!snapshot.canArchiveContent) {
  location.replace("../#more");
} else {
  await import("./admin-stable-render.js");
  await import("./admin.js");
  await import("./admin-nav-performance.js");
  await import("./admin-shortcuts.js");
  await import("./class-switcher.js");
  await import("./brand-settings.js");
  await import("./content-editor.js?v=20260830-archive1");
  await import("./evaluation-plan-media.js?v=20260831-media2");
  await import("./daily-brief-image.js?v=20260831-daily2");
  await import("./personal-notifications.js?v=20260830-personal1");
  await import("./user-manager.js?v=20260903-pinless1");
  await import("./account-create-v2.js?v=20260903-identity2");
  await import("./account-security-v2.js?v=20260903-identity2");
  await import("./admin-user-access-v2.js");
  await import("./class-ops-settings-v2.js");
  await import("./class-duty-manager.js?v=20260901-duty1");
}
