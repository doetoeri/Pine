import { NextDataGateway } from "../core/data-gateway.js";

const gateway = new NextDataGateway();

await gateway.start();
const snapshot = gateway.snapshot();

if (!snapshot.canArchiveContent) {
  location.replace("../#more");
} else {
  await import("./admin.js");
  await import("./admin-shortcuts.js");
  await import("./class-switcher.js");
  await import("./brand-settings.js");
  await import("./content-editor.js");
  await import("./problem-bank-guide.js");
  await import("./role-manager.js");
  await import("./user-manager.js");
  await import("./class-ops-settings-v2.js");
}
