import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { dispatchNotificationFrequencyExperiment } from "./notification-frequency-experiment.mjs";
import { inspectNotificationReadiness, retireLegacyNotificationStudy } from "./notification-study-readiness.mjs";

// Independent from timetable/NEIS: a failed data sync must not prevent
// scheduled experimental notifications from being considered.
async function main() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON");
  const credentials = JSON.parse(raw);
  if (!getApps().length) initializeApp({ credential: cert(credentials) });
  const db = getFirestore();
  const heartbeat = db.collection("schools").doc("gochon-high").collection("experimentRuntime").doc("notification-frequency");
  try {
    await retireLegacyNotificationStudy(db);
    const readiness = await inspectNotificationReadiness(db);
    const result = await dispatchNotificationFrequencyExperiment({ db, messaging: getMessaging(), now: new Date() });
    await heartbeat.set({ status: "ok", checkedAtMs: Date.now(), readiness, result,
      commit: process.env.GITHUB_SHA || "", workflowUrl: process.env.GITHUB_RUN_ID
        ? `https://github.com/doetoeri/Pine/actions/runs/${process.env.GITHUB_RUN_ID}` : "" });
    console.log(JSON.stringify({ component: "notification-frequency", ...result, readiness }));
  } catch (error) {
    await heartbeat.set({ status: "error", checkedAtMs: Date.now(), errorCode: String(error?.code || "dispatcher-failed").slice(0, 80) }).catch(() => {});
    throw error;
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
