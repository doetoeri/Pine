import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
if (!raw) throw new Error("service-account-secret-missing");
const credentials = JSON.parse(raw);
const app = initializeApp({ credential: cert(credentials) }, `pincon-health-${Date.now()}`);
const db = getFirestore(app);

try {
  const startedAt = Date.now();
  await db.doc("schools/gochon-high").get();
  console.log(`FIRESTORE_HEALTH_OK latencyMs=${Date.now() - startedAt}`);
} catch (error) {
  const code = String(error?.code || "unknown").slice(0, 120);
  const message = String(error?.message || "unknown").replace(/\s+/g, " ").slice(0, 500);
  console.error(`FIRESTORE_HEALTH_ERROR code=${code} message=${message}`);
  process.exitCode = 1;
}
