import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { dispatchSchoolLifeNotifications } from "./school-life-notifications.mjs";

async function main() {
  const serviceJson = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!serviceJson) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON GitHub Secret이 필요합니다.");
  const serviceAccount = JSON.parse(serviceJson);
  if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
  const result = await dispatchSchoolLifeNotifications({
    db: getFirestore(),
    messaging: getMessaging(),
    now: new Date(),
  });
  console.log(JSON.stringify({ schoolLifeNotifications: result }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
