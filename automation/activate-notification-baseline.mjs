import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { SEQUENCES, digest, periodFor } from "./notification-frequency-core.mjs";

const SCHOOL_ID = "gochon-high";
const UI_EXPERIMENT_ID = "pincon-next-ui";
const EXPERIMENT_ID = "notification-frequency";
const TARGET_CLASS_KEYS = Object.freeze(["1-8"]);
const START_DATE = "2026-09-21";
const EXCLUDED_DATES = Object.freeze(["2026-09-24", "2026-09-25", "2026-10-05", "2026-10-09"]);

function sequenceIndexOf(sequence) {
  if (!Array.isArray(sequence)) return -1;
  return SEQUENCES.findIndex((candidate) =>
    candidate.length === sequence.length && candidate.every((value, index) => value === sequence[index])
  );
}

async function main() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON secret is missing.");
  const serviceAccount = JSON.parse(raw);
  if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();
  const root = db.collection("schools").doc(SCHOOL_ID);

  const [uiSnap, currentSnap, flagSnap, subscriptionsSnap] = await Promise.all([
    root.collection("experiments").doc(UI_EXPERIMENT_ID).get(),
    root.collection("experiments").doc(EXPERIMENT_ID).get(),
    root.collection("experimentFlags").doc("notification_experiment").get(),
    root.collection("pushSubscriptions").where("enabled", "==", true).get(),
  ]);

  const ui = uiSnap.exists ? uiSnap.data() : null;
  if (!ui || ui.status !== "COMPLETED" || ui.promotedVariant !== "next") {
    throw new Error(
      `Start blocked: UI experiment must be COMPLETED+next. status=${ui?.status || "missing"} promoted=${ui?.promotedVariant || "missing"}`
    );
  }

  const targetSubscriptions = subscriptionsSnap.docs.filter((doc) => {
    const data = doc.data();
    return TARGET_CLASS_KEYS.includes(String(data?.classKey || ""))
      && Boolean(data?.ownerUid && data?.token);
  });
  const ownerIds = [...new Set(targetSubscriptions.map((doc) => String(doc.data().ownerUid)))].sort();
  if (ownerIds.length < 3) {
    throw new Error(`Start blocked: only ${ownerIds.length} eligible target-class push owner(s).`);
  }

  const existing = currentSnap.exists ? currentSnap.data() : {};
  const version = Number(existing.version || 1);
  const assignmentCollection = root.collection("experiments").doc(EXPERIMENT_ID).collection("assignments");
  const assignmentRefs = ownerIds.map((uid) => assignmentCollection.doc(uid));
  const participantRefs = ownerIds.map((uid) => root.collection("experimentParticipants").doc(uid));
  const [assignmentSnaps, participantSnaps] = await Promise.all([
    db.getAll(...assignmentRefs),
    db.getAll(...participantRefs),
  ]);
  const participantByUid = new Map(participantSnaps.filter((snap) => snap.exists).map((snap) => [
    snap.id,
    String(snap.data()?.anonymousParticipant || ""),
  ]));

  const counts = Array(SEQUENCES.length).fill(0);
  const missing = [];
  assignmentSnaps.forEach((snap, index) => {
    const data = snap.exists ? snap.data() : null;
    const seqIndex = data && Number(data.experimentVersion || 0) === version
      ? sequenceIndexOf(data.sequence)
      : -1;
    if (seqIndex >= 0) counts[seqIndex] += 1;
    else missing.push(ownerIds[index]);
  });

  missing.sort((a,b) =>
    digest(`${a}:${EXPERIMENT_ID}:v${version}:balanced`, 16)
      .localeCompare(digest(`${b}:${EXPERIMENT_ID}:v${version}:balanced`, 16))
  );

  const batch = db.batch();
  const assignedAtMs = Date.now();
  for (const uid of missing) {
    let sequenceIndex = 0;
    for (let i = 1; i < counts.length; i += 1) {
      if (counts[i] < counts[sequenceIndex]) sequenceIndex = i;
    }
    counts[sequenceIndex] += 1;
    batch.set(assignmentCollection.doc(uid), {
      schemaVersion: 1,
      sequence: [...SEQUENCES[sequenceIndex]],
      sequenceIndex,
      assignedAtMs,
      experimentVersion: version,
      anonymousParticipant: participantByUid.get(uid) || "",
      assignmentSource: "balanced-target-class",
    }, { merge: false });
  }

  const config = {
    id: EXPERIMENT_ID,
    status: "ACTIVE",
    version,
    stableVariant: "next",
    promotedVariant: "",
    rolloutPercent: 100,
    targetClassKeys: [...TARGET_CLASS_KEYS],
    startDate: START_DATE,
    baselineDays: 2,
    periodDays: 4,
    schoolDaysOnly: true,
    excludedDates: [...EXCLUDED_DATES],
    frequency: {
      lowPerDay: 1,
      midPerDay: 3,
      highPerDay: 4,
    },
    activatedAtMs: Number(existing.activatedAtMs || Date.now()),
    activatedBy: "github-actions",
    activationAudit: {
      targetOwners: ownerIds.length,
      eligibleSubscriptions: targetSubscriptions.length,
      preservedAssignments: ownerIds.length - missing.length,
      createdAssignments: missing.length,
      sequenceCounts: counts,
    },
    updatedAtMs: Date.now(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  batch.set(root.collection("experiments").doc(EXPERIMENT_ID), config, { merge: true });
  batch.set(root.collection("experimentFlags").doc("notification_experiment"), {
    enabled: true,
    rolloutPercent: 100,
    experimentId: EXPERIMENT_ID,
    stableVariant: "next",
    targetClassKeys: [...TARGET_CLASS_KEYS],
    updatedAtMs: Date.now(),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: "github-actions",
  }, { merge: true });

  await batch.commit();

  const phase = periodFor(config, new Date());
  console.log("PINCON_START_RESULT=" + JSON.stringify({
    ok: true,
    ui: { status: ui.status, promotedVariant: ui.promotedVariant },
    notification: {
      status: config.status,
      phase,
      startDate: config.startDate,
      baselineDays: config.baselineDays,
      periodDays: config.periodDays,
      schoolDaysOnly: config.schoolDaysOnly,
      excludedDates: config.excludedDates,
      frequency: config.frequency,
      targetClassKeys: config.targetClassKeys,
    },
    participants: {
      uniqueTargetOwners: ownerIds.length,
      eligibleSubscriptions: targetSubscriptions.length,
      preservedAssignments: ownerIds.length - missing.length,
      createdAssignments: missing.length,
      sequenceCounts: counts,
    },
    previousFlagEnabled: flagSnap.exists ? flagSnap.data()?.enabled !== false : null,
  }));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
