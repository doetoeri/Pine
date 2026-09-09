import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

let appInstance;
let db;
let authInstance;
let messagingInstance;

function serviceAccount() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured.");

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }
}

export function firebaseApp() {
  if (appInstance) return appInstance;

  appInstance = getApps().find((item) => item.name === "pincon-ai-gateway")
    || initializeApp({ credential: cert(serviceAccount()) }, "pincon-ai-gateway");

  return appInstance;
}

export function firestore() {
  if (!db) db = getFirestore(firebaseApp());
  return db;
}

export function firebaseAuth() {
  if (!authInstance) authInstance = getAuth(firebaseApp());
  return authInstance;
}

export function firebaseMessaging() {
  if (!messagingInstance) messagingInstance = getMessaging(firebaseApp());
  return messagingInstance;
}
