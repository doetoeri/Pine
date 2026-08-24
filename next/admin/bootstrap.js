import { NextDataGateway } from "../core/data-gateway.js";

const root = document.querySelector("#adminApp");
const gateway = new NextDataGateway();

await gateway.start();
const snapshot = gateway.snapshot();

if (!snapshot.canArchiveContent) {
  location.replace("../#more");
} else {
  await import("./admin.js");
  await import("./brand-settings.js");
  await import("./content-editor.js");
}
