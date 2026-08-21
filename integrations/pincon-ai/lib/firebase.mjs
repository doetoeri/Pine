import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

let db;

function serviceAccount() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured.");

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }
}

export function firestore() {
  if (db) return db;

  const app = getApps().find((item) => item.name === "pincon-ai-gateway")
    || initializeApp({ credential: cert(serviceAccount()) }, "pincon-ai-gateway");

  db = getFirestore(app);
  return db;
}
