import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { dispatchNotificationFrequencyExperiment } from "./notification-frequency-experiment.mjs";

// Independent from timetable/NEIS: a failed data sync must not prevent
// scheduled experimental notifications from being considered.
async function main() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON");
  const credentials = JSON.parse(raw);
  if (!getApps().length) initializeApp({ credential: cert(credentials) });
  const result = await dispatchNotificationFrequencyExperiment({
    db: getFirestore(),
    messaging: getMessaging(),
    now: new Date(),
  });
  console.log(JSON.stringify({ component: "notification-frequency", ...result }));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
