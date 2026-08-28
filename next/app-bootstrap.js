import { accountReady } from "./account-gate.js";

await accountReady;
await import("./app.js");
await import("./app-interactions.js");
await import("./write-mode.js");
await import("./admin-visibility.js");
await import("./problem-bank.js");
await import("./student-ops.js");
