import { NextDataGateway } from "../core/data-gateway.js";

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
  await import("./problem-bank-guide.js");
  await import("./user-manager.js");
  await import("./admin-user-access-v2.js");
  await import("./class-ops-settings-v2.js");
}
