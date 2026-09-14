import { createHash } from "node:crypto";

export const CONDITIONS = Object.freeze(["LOW", "MID", "HIGH"]);
export const SEQUENCES = Object.freeze([
  Object.freeze(["LOW", "MID", "HIGH"]),
  Object.freeze(["MID", "HIGH", "LOW"]),
  Object.freeze(["HIGH", "LOW", "MID"]),
  Object.freeze(["LOW", "HIGH", "MID"]),
  Object.freeze(["HIGH", "MID", "LOW"]),
  Object.freeze(["MID", "LOW", "HIGH"]),
]);

export function digest(value, length = 24) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

export function sequenceFor(uid, experimentId = "notification-frequency", version = 1) {
  const hex = digest(`${uid}:${experimentId}:v${version}:sequence`, 8);
  const index = Number.parseInt(hex, 16) % SEQUENCES.length;
  return { index, sequence: [...SEQUENCES[index]] };
}

export function kstDate(now = new Date()) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function kstClock(now = new Date()) {
  const shifted = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return { hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes(), date: shifted.toISOString().slice(0,10) };
}

export function periodFor(config = {}, now = new Date()) {
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(config.startDate || "")) ? config.startDate : "";
  if (!startDate) return { phase: "NOT_STARTED", period: 0, periodDay: 0 };
  const day = Math.floor((Date.parse(`${kstDate(now)}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000);
  if (day < 0) return { phase: "NOT_STARTED", period: 0, periodDay: 0 };
  const baselineDays = Math.max(0, Math.trunc(Number(config.baselineDays ?? 2)));
  const periodDays = Math.max(1, Math.trunc(Number(config.periodDays ?? 4)));
  if (day < baselineDays) return { phase: "BASELINE", period: 0, periodDay: day + 1 };
  const elapsed = day - baselineDays;
  const period = Math.floor(elapsed / periodDays) + 1;
  if (period > 3) return { phase: "COMPLETE", period: 4, periodDay: 0 };
  return { phase: "EXPERIMENT", period, periodDay: (elapsed % periodDays) + 1 };
}

export function conditionFor(sequence = [], config = {}, now = new Date()) {
  const info = periodFor(config, now);
  return {
    ...info,
    condition: info.phase === "EXPERIMENT" ? String(sequence[info.period - 1] || "") : "",
  };
}

export function dailyBudget(condition, config = {}) {
  const defaults = { LOW: 1, MID: 3, HIGH: 4 };
  const field = condition === "LOW" ? "lowPerDay" : condition === "MID" ? "midPerDay" : "highPerDay";
  return Math.max(0, Math.min(4, Math.trunc(Number(config?.frequency?.[field] ?? defaults[condition] ?? 0))));
}

export const SLOTS = Object.freeze([
  Object.freeze({ index: 0, hour: 7, categoryHint: "daily_summary" }),
  Object.freeze({ index: 1, hour: 12, categoryHint: "schedule" }),
  Object.freeze({ index: 2, hour: 16, categoryHint: "assignment" }),
  Object.freeze({ index: 3, hour: 20, categoryHint: "materials" }),
]);

export function currentSlot(now = new Date()) {
  const clock = kstClock(now);
  if (clock.minute > 35) return null;
  return SLOTS.find((slot) => slot.hour === clock.hour) || null;
}

export function eligibleForSlot(condition, slot, config = {}) {
  if (!slot) return false;
  return slot.index < dailyBudget(condition, config);
}

export function notificationId({ anonymousParticipant, date, period, slotIndex, candidateKey }) {
  return `nexp_${digest(`${anonymousParticipant}:${date}:p${period}:s${slotIndex}:${candidateKey}`, 28)}`;
}
