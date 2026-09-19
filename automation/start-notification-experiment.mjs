import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const SCHOOL_ID = "gochon-high";
const UI_EXPERIMENT_ID = "pincon-next-ui";
const NOTIFICATION_EXPERIMENT_ID = "notification-frequency";

function kstDate(now = new Date()) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function main() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON secret is missing.");

  const serviceAccount = JSON.parse(raw);
  if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();
  const root = db.collection("schools").doc(SCHOOL_ID);

  const [uiSnap, notificationSnap, flagSnap, subscriptionsSnap] = await Promise.all([
    root.collection("experiments").doc(UI_EXPERIMENT_ID).get(),
    root.collection("experiments").doc(NOTIFICATION_EXPERIMENT_ID).get(),
    root.collection("experimentFlags").doc("notification_experiment").get(),
    root.collection("pushSubscriptions").where("enabled", "==", true).get(),
  ]);

  const ui = uiSnap.exists ? uiSnap.data() : null;
  if (!ui || ui.status !== "COMPLETED" || ui.promotedVariant !== "next") {
    throw new Error(
      `Notification experiment start blocked: pincon-next-ui must be COMPLETED with promotedVariant=next. Current status=${ui?.status || "missing"}, promotedVariant=${ui?.promotedVariant || "missing"}`
    );
  }

  const activeSubscriptions = subscriptionsSnap.docs.filter((doc) => {
    const data = doc.data();
    return Boolean(data?.ownerUid && data?.token && data?.classKey);
  });
  const uniqueOwners = new Set(activeSubscriptions.map((doc) => String(doc.data().ownerUid)));

  if (uniqueOwners.size < 3) {
    throw new Error(`Notification experiment start blocked: only ${uniqueOwners.size} eligible owner(s) have active push subscriptions.`);
  }

  const existing = notificationSnap.exists ? notificationSnap.data() : {};
  const existingFlag = flagSnap.exists ? flagSnap.data() : {};
  const alreadyActive = existing.status === "ACTIVE" && existingFlag.enabled === true;
  const startDate = alreadyActive && /^\d{4}-\d{2}-\d{2}$/.test(String(existing.startDate || ""))
    ? existing.startDate
    : kstDate();

  const nextConfig = {
    status: "ACTIVE",
    version: Number(existing.version || 1),
    stableVariant: "next",
    promotedVariant: String(existing.promotedVariant || ""),
    rolloutPercent: 100,
    startDate,
    baselineDays: Number.isFinite(Number(existing.baselineDays)) ? Number(existing.baselineDays) : 2,
    periodDays: Number.isFinite(Number(existing.periodDays)) ? Number(existing.periodDays) : 4,
    frequency: {
      lowPerDay: Number(existing.frequency?.lowPerDay ?? 1),
      midPerDay: Number(existing.frequency?.midPerDay ?? 3),
      highPerDay: Number(existing.frequency?.highPerDay ?? 4),
    },
    activatedAtMs: alreadyActive ? Number(existing.activatedAtMs || Date.now()) : Date.now(),
    activatedBy: "github-actions",
    updatedAt: FieldValue.serverTimestamp(),
  };

  const batch = db.batch();
  batch.set(root.collection("experiments").doc(NOTIFICATION_EXPERIMENT_ID), nextConfig, { merge: true });
  batch.set(root.collection("experimentFlags").doc("notification_experiment"), {
    enabled: true,
    rolloutPercent: 100,
    experimentId: NOTIFICATION_EXPERIMENT_ID,
    stableVariant: "next",
    updatedAtMs: Date.now(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();

  console.log(JSON.stringify({
    ok: true,
    action: alreadyActive ? "already-active-verified" : "activated",
    uiExperiment: { status: ui.status, promotedVariant: ui.promotedVariant },
    notificationExperiment: {
      status: "ACTIVE",
      startDate,
      baselineDays: nextConfig.baselineDays,
      periodDays: nextConfig.periodDays,
      frequency: nextConfig.frequency,
    },
    pushHealth: {
      enabledSubscriptions: subscriptionsSnap.size,
      eligibleSubscriptions: activeSubscriptions.length,
      uniqueOwners: uniqueOwners.size,
      multiDeviceSubscriptions: Math.max(0, activeSubscriptions.length - uniqueOwners.size),
    },
    note: "Baseline phase sends no experiment notifications.",
  }));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
