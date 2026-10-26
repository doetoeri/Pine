import { canonicalSubscriptionIds } from "./notification-frequency-core.mjs";
import { isCareerStudy } from "../next/experiment/notification-study.js";

export async function retireLegacyNotificationStudy(db) {
  const root = db.collection("schools").doc("gochon-high");
  const ref = root.collection("experiments").doc("notification-frequency");
  const before = await ref.get();
  if (!before.exists || isCareerStudy(before.data()) || before.data().status !== "ACTIVE") return false;
  const assignments = await ref.collection("assignments").get();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref), config = snap.data();
    if (!snap.exists || isCareerStudy(config) || config.status !== "ACTIVE") return false;
    tx.set(ref.collection("runs").doc(`legacy-v${config.version || 1}`), {
      config, assignments: assignments.docs.map((doc) => ({ id: doc.id, ...doc.data() })), archivedAtMs: Date.now() });
    tx.set(ref, { status: "PAUSED", legacyRetiredAtMs: Date.now() }, { merge: true });
    tx.set(root.collection("experimentFlags").doc("notification_experiment"), { enabled: false }, { merge: true });
    return true;
  });
}

// Publish only per-account readiness. Never expose push tokens to the browser.
export async function inspectNotificationReadiness(db, now = new Date()) {
  const root = db.collection("schools").doc("gochon-high");
  const [users, subscriptions, preferences] = await Promise.all([
    root.collection("users").where("status", "==", "ACTIVE").get(),
    root.collection("pushSubscriptions").get(),
    root.collection("notificationExperimentPreferences").get(),
  ]);
  const prefs = new Map(preferences.docs.map((doc) => [doc.id, doc.data().enabled !== false]));
  const raw = subscriptions.docs.map((doc) => {
    const data = doc.data();
    return { ...data, id: doc.id, preferences: { ...data.preferences,
      ...(prefs.has(data.ownerUid) ? { notificationExperiment: prefs.get(data.ownerUid) } : {}) } };
  });
  const canonicalIds = new Set(canonicalSubscriptionIds(raw));
  const byOwner = new Map(raw.filter((row) => canonicalIds.has(row.id)).map((row) => [row.ownerUid, row]));
  let ready = 0, optedOut = 0;
  const rows = users.docs.map((doc) => {
    const profile = doc.data(), device = byOwner.get(doc.id);
    const enabled = prefs.get(doc.id) !== false;
    const pushRegistered = Boolean(enabled && device && device.classKey === profile.classKey);
    if (!enabled) optedOut++;
    if (pushRegistered) ready++;
    return { id: doc.id, data: { pushRegistered, experimentEnabled: enabled,
      classKey: String(profile.classKey || ""), checkedAtMs: now.getTime(),
      registeredAtMs: Number(device?.updatedAtMs || 0) } };
  });
  for (let i = 0; i < rows.length; i += 400) {
    const batch = db.batch();
    rows.slice(i, i + 400).forEach(({ id, data }) => batch.set(root.collection("notificationStudyDevices").doc(id), data));
    await batch.commit();
  }
  return { accounts: rows.length, pushReady: ready, optedOut };
}
