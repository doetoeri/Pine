import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { canonicalSubscriptionIds, conditionFor, kstDate, plannedSlotIndexes } from "./notification-frequency-core.mjs";
import { isIntensiveStudy, INTENSIVE_SLOTS, STUDY_SLOTS } from "../next/experiment/notification-study.js";

export function previewEligibility({ config, now, slotIndex, accounts, subscriptions, preferences, assignments, receipts }) {
  const date = kstDate(now);
  const phase = conditionFor([], config, now).phase;
  const active = config.status === "ACTIVE" && (phase === "EXPERIMENT" || (isIntensiveStudy(config) && phase === "PILOT"));
  const slots = isIntensiveStudy(config) ? INTENSIVE_SLOTS : STUDY_SLOTS;
  const slot = slots.find(s => s.index === slotIndex);
  const result = { dryRun: true, date, phase, active, slotIndex, slotValid: Boolean(slot),
    accounts: accounts.size, ready: 0, planned: 0, alreadyRecorded: 0, noAssignment: 0 };
  if (!active || !slot) return result;
  const pref = new Map(preferences.map(p => [p.id, p.data]));
  const intensive = isIntensiveStudy(config);
  const canonical = new Set(canonicalSubscriptionIds(subscriptions.map(s => ({
    ...s.data, id: s.id, preferences: {
      ...s.data.preferences,
      ...(pref.has(s.data.ownerUid) ? { notificationExperiment: pref.get(s.data.ownerUid).enabled } : {}),
    },
  }))));
  const targets = new Set(config.targetClassKeys || []);
  for (const sub of subscriptions) {
    if (!canonical.has(sub.id)) continue;
    const uid = String(sub.data.ownerUid || "");
    const account = accounts.get(uid);
    const preference = pref.get(uid);
    if (!account || account.classKey !== sub.data.classKey || (targets.size && !targets.has(account.classKey))) continue;
    if (preference?.enabled === false) continue;
    if (intensive && !(preference?.enabled === true && Number(preference.updatedAtMs || 0) >= Number(config.createdAtMs || Infinity))) continue;
    result.ready++;
    const assignment = assignments.get(uid);
    if (!assignment || Number(assignment.experimentVersion) !== Number(config.version || 1)) { result.noAssignment++; continue; }
    const state = conditionFor(assignment.sequence, config, now);
    const planned = plannedSlotIndexes({
      anonymousParticipant: assignment.anonymousParticipant, date, period: state.period,
      condition: state.condition, config,
    });
    if (!planned.includes(slotIndex)) continue;
    result.planned++;
    // Receipts are intentionally not matched here: this preview never computes
    // notification IDs, and must not be interpreted as an exact send count.
  }
  return result;
}

async function main() {
  const slotIndex = Number(process.env.PREVIEW_SLOT_INDEX);
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 5) throw new Error("Invalid slot index");
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Missing Firebase credentials");
  if (!getApps().length) initializeApp({ credential: cert(JSON.parse(raw)) });
  const root = getFirestore().collection("schools").doc("gochon-high");
  const [study, flag, users, subs, prefs] = await Promise.all([
    root.collection("experiments").doc("notification-frequency").get(),
    root.collection("experimentFlags").doc("notification_experiment").get(),
    root.collection("users").where("status", "==", "ACTIVE").get(),
    root.collection("pushSubscriptions").get(),
    root.collection("notificationExperimentPreferences").get(),
  ]);
  const config = study.data() || {};
  const assignments = await root.collection("experiments").doc("notification-frequency").collection("assignments").get();
  const report = previewEligibility({
    config, now: new Date(), slotIndex,
    accounts: new Map(users.docs.map(d => [d.id, d.data()])),
    subscriptions: subs.docs.map(d => ({ id: d.id, data: d.data() })),
    preferences: prefs.docs.map(d => ({ id: d.id, data: d.data() })),
    assignments: new Map(assignments.docs.map(d => [d.id, d.data()])),
  });
  console.log(JSON.stringify({ component: "manual-notification-preview", ...report,
    active: report.active && flag.data()?.enabled === true, note: "estimate-only; no FCM calls, no Firestore writes" }));
}
if (process.argv[1]?.endsWith("manual-notification-preview.mjs")) main().catch(e => { console.error(e.message); process.exitCode = 1; });
