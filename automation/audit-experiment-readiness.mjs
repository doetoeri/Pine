import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const SCHOOL_ID = "gochon-high";
const UI_EXPERIMENT_ID = "pincon-next-ui";

async function main() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON secret is missing.");
  const serviceAccount = JSON.parse(raw);
  if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();
  const root = db.collection("schools").doc(SCHOOL_ID);

  const [configSnap, flagSnap, eventSnap, pushSnap] = await Promise.all([
    root.collection("experiments").doc(UI_EXPERIMENT_ID).get(),
    root.collection("experimentFlags").doc("pincon_next_ui").get(),
    root.collection("experimentEvents").orderBy("timestampMs", "desc").limit(5000).get(),
    root.collection("pushSubscriptions").where("enabled", "==", true).get(),
  ]);

  const config = configSnap.exists ? configSnap.data() : null;
  const flag = flagSnap.exists ? flagSnap.data() : null;
  const events = eventSnap.docs
    .map((doc) => doc.data())
    .filter((row) => row.experimentId === UI_EXPERIMENT_ID);

  const nextEvidence = events.filter((row) =>
    row.variant === "next"
    && ["canary", "public-beta", "rollout", "controlled"].includes(String(row.properties?.cohort || ""))
  );
  const sessions = new Set(nextEvidence.filter((row) => row.eventType === "session_start").map((row) => row.sessionId));
  const participants = new Set(nextEvidence.map((row) => row.anonymousParticipant).filter(Boolean));
  const errorTypes = new Set(["js_error", "data_load_failure", "login_failure", "navigation_error"]);
  const errors = nextEvidence.filter((row) => errorTypes.has(row.eventType));
  const dataFailures = nextEvidence.filter((row) => row.eventType === "data_load_failure");
  const targetViews = nextEvidence.filter((row) => ["schedule_view","assignment_view","material_view","notice_view","target_information_view"].includes(row.eventType));
  const satisfaction = nextEvidence.filter((row) => row.eventType === "ui_satisfaction").map((row) => Number(row.properties?.value)).filter(Number.isFinite);
  const avg = satisfaction.length ? satisfaction.reduce((a,b)=>a+b,0)/satisfaction.length : null;

  const eligiblePush = pushSnap.docs.filter((doc) => {
    const data = doc.data();
    return Boolean(data?.ownerUid && data?.token && data?.classKey);
  });
  const owners = new Set(eligiblePush.map((doc) => String(doc.data().ownerUid)));

  const result = {
    ui: {
      status: config?.status || "missing",
      stableVariant: config?.stableVariant || "",
      promotedVariant: config?.promotedVariant || "",
      publicBetaEnabled: config?.publicBetaEnabled === true,
      flagEnabled: flag?.enabled !== false,
    },
    canaryNextEvidence: {
      participants: participants.size,
      sessions: sessions.size,
      events: nextEvidence.length,
      errors: errors.length,
      dataFailures: dataFailures.length,
      errorPerSession: sessions.size ? errors.length / sessions.size : null,
      targetViews: targetViews.length,
      satisfactionAverage: avg,
    },
    pushHealth: {
      enabledSubscriptions: pushSnap.size,
      eligibleSubscriptions: eligiblePush.length,
      uniqueOwners: owners.size,
    },
  };

  console.log("PINCON_AUDIT_RESULT=" + JSON.stringify(result));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
