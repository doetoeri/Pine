import { createHash } from "node:crypto";

export function rowsFromPayload(payload, datasetName) {
  const dataset = payload?.[datasetName];
  if (!Array.isArray(dataset)) return [];
  return Array.isArray(dataset[1]?.row) ? dataset[1].row : [];
}

export function totalCountFromPayload(payload, datasetName) {
  const dataset = payload?.[datasetName];
  const count = dataset?.[0]?.head?.find?.((item) => item.LIST_TOTAL_COUNT)?.LIST_TOTAL_COUNT;
  return Number(count) || 0;
}

export function expandDate(value) {
  const compact = String(value || "").replaceAll("-", "");
  return /^\d{8}$/.test(compact)
    ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
    : "";
}

export function classKeyForRow(row = {}) {
  const grade = Number(row.GRADE);
  const classNumber = Number(row.CLASS_NM);
  if (!Number.isInteger(grade) || grade < 1 || grade > 3) return "";
  if (!Number.isInteger(classNumber) || classNumber < 1 || classNumber > 10) return "";
  return `${grade}-${classNumber}`;
}

export function timetableFingerprint(periods = []) {
  const stable = periods
    .map(({ period, subject }) => `${Number(period)}:${String(subject || "").trim()}`)
    .sort((a, b) => Number(a.split(":")[0]) - Number(b.split(":")[0]))
    .join("|");
  return createHash("sha256").update(stable).digest("hex");
}

export function groupTimetableRows(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const classKey = classKeyForRow(row);
    const date = expandDate(row.ALL_TI_YMD);
    const period = Number(row.PERIO);
    const subject = String(row.ITRT_CNTNT || "").replace(/\s+/g, " ").trim();
    if (!classKey || !date || !Number.isInteger(period) || !subject) continue;
    const id = `${classKey}-${date.replaceAll("-", "")}`;
    if (!groups.has(id)) groups.set(id, { id, classKey, date, periods: [] });
    groups.get(id).periods.push({ period, subject });
  }

  return [...groups.values()].map((document) => {
    const periods = document.periods.sort((a, b) => a.period - b.period);
    return { ...document, periods, fingerprint: timetableFingerprint(periods) };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

export function diffPeriods(before = [], after = []) {
  const oldPeriods = new Map(before.map((item) => [Number(item.period), String(item.subject || "")]));
  const nextPeriods = new Map(after.map((item) => [Number(item.period), String(item.subject || "")]));
  const periodNumbers = [...new Set([...oldPeriods.keys(), ...nextPeriods.keys()])].sort((a, b) => a - b);
  return periodNumbers.flatMap((period) => {
    const previous = oldPeriods.get(period) || "없음";
    const next = nextPeriods.get(period) || "없음";
    return previous === next ? [] : [`${period}교시 ${previous} → ${next}`];
  });
}

export function classLabel(classKey) {
  const [grade, classNumber] = String(classKey).split("-");
  return `${grade}학년 ${classNumber}반`;
}

export function dateLabel(date) {
  const [, month, day] = String(date).split("-").map(Number);
  return `${month}월 ${day}일`;
}
