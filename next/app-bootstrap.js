import { accountReady } from "./account-gate.js?v=20260830-interaction1";

await accountReady;
await import("./app.js?v=20260830-interaction1");
await import("./app-interactions.js?v=20260830-interaction1");
await import("./route-focus-stability.js");
await import("./write-mode.js");
await import("./admin-visibility.js");
await import("./problem-bank.js");
await import("./account-center.js");
await import("./student-ops.js");
