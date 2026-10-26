// Shared by the browser and trusted dispatcher. No Firebase or DOM dependency.
export const STUDY_MODE = "career-v3";
export const CONDITIONS = Object.freeze(["LOW", "MID", "HIGH"]);
export const FREQUENCY = Object.freeze({ LOW: 0, MID: 1, HIGH: 3 });
export const SEQUENCES = Object.freeze([
  ["LOW", "MID", "HIGH"], ["MID", "HIGH", "LOW"], ["HIGH", "LOW", "MID"],
  ["LOW", "HIGH", "MID"], ["HIGH", "MID", "LOW"], ["MID", "LOW", "HIGH"],
].map(Object.freeze));
export const STUDY_SLOTS = Object.freeze([
  Object.freeze({ index: 0, hour: 8, categoryHint: "daily_summary" }),
  Object.freeze({ index: 2, hour: 17, categoryHint: "assignment" }),
  Object.freeze({ index: 3, hour: 19, categoryHint: "materials" }),
]);
export const DAY_MS = 86_400_000;
export const isCareerStudy = (config) => config?.studyMode === STUDY_MODE;
export const dateKey = (now = new Date()) => new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
export const addDays = (date, count) => new Date(Date.parse(`${date}T00:00:00Z`) + count * DAY_MS).toISOString().slice(0, 10);
export function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function hash(value) {
  let result = 2166136261;
  for (const char of String(value)) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}
export function sequenceForStudy(uid, version = 3) {
  const index = hash(`${uid}:notification-frequency:v${version}:sequence`) % SEQUENCES.length;
  return { index, sequence: [...SEQUENCES[index]] };
}
export function balancedSequences(uids, seed) {
  const ranked = [...new Set(uids)].sort((a, b) => hash(`${seed}:${a}`) - hash(`${seed}:${b}`) || a.localeCompare(b));
  const triads = [[0, 1, 2], [3, 4, 5]].map((triad) => triad.sort((a, b) => hash(`${seed}:order:${a}`) - hash(`${seed}:order:${b}`)));
  if (hash(`${seed}:triad`) % 2) triads.reverse();
  const order = triads.flat();
  return new Map(ranked.map((uid, n) => {
    const index = order[n % SEQUENCES.length];
    return [uid, { index, sequence: [...SEQUENCES[index]] }];
  }));
}
export function studySlots({ anonymousParticipant = "", date = "", period = 0, condition = "" } = {}) {
  if (condition === "HIGH") return STUDY_SLOTS.map((slot) => slot.index);
  if (condition !== "MID") return [];
  return [STUDY_SLOTS[hash(`${anonymousParticipant}:${date}:${period}:mid-slot`) % 3].index];
}
export function eligibleDate(date, config = {}) {
  if (!validDate(date)) return false;
  if ((config.excludedDates || []).includes(date)) return false;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return config.schoolDaysOnly !== true || (weekday !== 0 && weekday !== 6);
}
export function studyCalendar(config = {}) {
  if (!validDate(config.startDate)) return [];
  const baseline = Math.max(0, Math.min(14, Math.trunc(Number(config.baselineDays ?? 2))));
  const duration = Math.max(1, Math.min(14, Math.trunc(Number(config.periodDays ?? 4))));
  const total = baseline + duration * 3;
  const rows = [];
  for (let offset = 0; offset < 730 && rows.length < total; offset++) {
    const date = addDays(config.startDate, offset);
    if (!eligibleDate(date, config)) continue;
    const ordinal = rows.length;
    rows.push({ date, phase: ordinal < baseline ? "BASELINE" : "EXPERIMENT",
      period: ordinal < baseline ? 0 : Math.floor((ordinal - baseline) / duration) + 1,
      periodDay: ordinal < baseline ? ordinal + 1 : (ordinal - baseline) % duration + 1 });
  }
  return rows;
}
export function studyPeriodAt(config = {}, now = new Date()) {
  const today = dateKey(now), calendar = studyCalendar(config);
  if (!calendar.length || today < config.startDate) return { phase: "NOT_STARTED", period: 0, periodDay: 0 };
  if (today > calendar.at(-1).date) return { phase: "COMPLETE", period: 4, periodDay: 0 };
  const row = calendar.find((item) => item.date === today);
  return row ? { phase: row.phase, period: row.period, periodDay: row.periodDay } : { phase: "OFF_DAY", period: 0, periodDay: 0 };
}
export function studyDefaults(classKey = "1-8", now = new Date()) {
  return { id: "notification-frequency", studyMode: STUDY_MODE, design: "balanced-crossover", studyKind: "formal",
    status: "DRAFT", version: 3, stableVariant: "next", promotedVariant: "", rolloutPercent: 0,
    targetClassKeys: [classKey], startDate: dateKey(now), baselineDays: 2, periodDays: 4,
    schoolDaysOnly: true, excludedDates: [], frequency: { lowPerDay: 0, midPerDay: 1, highPerDay: 3 },
    consentRecorded: true };
}
export function validateStudyConfig(config) {
  if (!isCareerStudy(config) || !validDate(config.startDate)) throw new Error("시작일을 확인해 주세요.");
  if (!Number.isInteger(config.baselineDays) || config.baselineDays < 0 || config.baselineDays > 14
    || !Number.isInteger(config.periodDays) || config.periodDays < 1 || config.periodDays > 14) throw new Error("기간은 기준선 0~14일, 조건별 1~14일로 입력해 주세요.");
  if (!Array.isArray(config.targetClassKeys) || config.targetClassKeys.length < 1
    || config.targetClassKeys.some((key) => !/^[1-3]-(?:[1-9]|10)$/.test(key))) throw new Error("실험 대상 학급을 지정해 주세요.");
  if (!Array.isArray(config.excludedDates) || config.excludedDates.some((date) => !validDate(date))) throw new Error("제외일은 YYYY-MM-DD 형식으로 입력해 주세요.");
  if (config.studyKind !== "pilot" && config.studyKind !== "formal") throw new Error("실험 종류를 확인해 주세요.");
  if (JSON.stringify(config.frequency) !== JSON.stringify({ lowPerDay: 0, midPerDay: 1, highPerDay: 3 })) throw new Error("실험 빈도는 0·1·3회로 고정됩니다.");
  return config;
}
