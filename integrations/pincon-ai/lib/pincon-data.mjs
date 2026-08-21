import { firestore } from "./firebase.mjs";

const SCHOOL_ID = String(process.env.PINCON_SCHOOL_ID || "gochon-high").trim();
const DAY_MS = 86_400_000;
const PRIVATE_KEY_PATTERN = /(email|uid|token|secret|password|authorization|subscription|createdby|updatedby|deletedby|owner)/i;

function schoolCollection(name) {
  return firestore().collection("schools").doc(SCHOOL_ID).collection(name);
}

export function normalizeClassKey(value) {
  const text = String(value || "").trim();
  const match = /^([1-3])-(10|[1-9])$/.exec(text);
  if (!match) throw new Error("classKey must look like 1-8 (grade 1-3, class 1-10).");
  return `${Number(match[1])}-${Number(match[2])}`;
}

export function kstDate(value = Date.now(), offsetDays = 0) {
  const base = value instanceof Date ? value.getTime() : Number(value);
  const shifted = new Date((Number.isFinite(base) ? base : Date.now()) + 9 * 60 * 60 * 1000 + offsetDays * DAY_MS);
  return shifted.toISOString().slice(0, 10);
}

export function normalizeDate(value, fallback = kstDate()) {
  const text = String(value || fallback).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("date must use YYYY-MM-DD.");
  return text;
}

function dateMsKst(date, endOfDay = false) {
  const suffix = endOfDay ? "T23:59:59.999+09:00" : "T00:00:00+09:00";
  const parsed = Date.parse(`${date}${suffix}`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function itemDate(item = {}) {
  for (const key of ["date", "dueDate"]) {
    const value = String(item[key] || "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  }
  for (const key of ["dueAtMs", "startsAtMs", "endsAtMs"]) {
    const value = Number(item[key]);
    if (Number.isFinite(value) && value > 0) return kstDate(value);
  }
  return "";
}

function serialize(value) {
  if (value === null || value === undefined) return value;
  if (["string", "number", "boolean"].includes(typeof value)) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !PRIVATE_KEY_PATTERN.test(key))
      .map(([key, nested]) => [key, serialize(nested)]));
  }
  return String(value);
}

function row(snapshot) {
  if (!snapshot?.exists) return null;
  return serialize({ id: snapshot.id, ...snapshot.data() });
}

function rows(snapshot) {
  return snapshot.docs.map((doc) => row(doc)).filter(Boolean);
}

function visible(item = {}) {
  return item.deleted !== true && item.__private !== true;
}

function inRange(item, start, end) {
  const date = itemDate(item);
  return Boolean(date && date >= start && date <= end);
}

function gradeFromClassKey(classKey) {
  return Number(classKey.split("-")[0]);
}

function scheduleForGrade(item, grade) {
  const byGrade = item?.eventsByGrade;
  if (byGrade && typeof byGrade === "object") {
    const events = Array.isArray(byGrade[String(grade)]) ? byGrade[String(grade)].filter(Boolean) : [];
    if (!events.length) return null;
    return { ...item, events, title: events.join(" · "), grades: [grade] };
  }
  if (Array.isArray(item?.grades) && item.grades.length && !item.grades.includes(grade)) return null;
  return item;
}

export async function getTimetable({ classKey, date } = {}) {
  const safeClassKey = normalizeClassKey(classKey);
  const safeDate = normalizeDate(date);
  const id = `${safeClassKey}-${safeDate.replaceAll("-", "")}`;
  const snapshot = await schoolCollection("neisTimetables").doc(id).get();
  return row(snapshot);
}

export async function getMeal({ date } = {}) {
  const safeDate = normalizeDate(date);
  const snapshot = await schoolCollection("meals").doc(safeDate.replaceAll("-", "")).get();
  return row(snapshot);
}

export async function getAssignments({ classKey, startDate, endDate } = {}) {
  const safeClassKey = normalizeClassKey(classKey);
  const start = normalizeDate(startDate);
  const end = normalizeDate(endDate, start);
  const snapshot = await schoolCollection("classAssignments")
    .where("classKey", "==", safeClassKey)
    .limit(250)
    .get();

  return rows(snapshot)
    .filter((item) => visible(item) && inRange(item, start, end))
    .sort((a, b) => itemDate(a).localeCompare(itemDate(b)));
}

export async function getNotices({ classKey, limit = 50 } = {}) {
  const safeClassKey = normalizeClassKey(classKey);
  const max = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const [announcements, legacyContent] = await Promise.all([
    schoolCollection("announcements").where("classKey", "==", safeClassKey).limit(max).get(),
    schoolCollection("content").where("targets", "array-contains", safeClassKey).limit(max).get(),
  ]);

  const now = Date.now();
  const modern = rows(announcements).filter((item) => visible(item) && (!item.expiresAtMs || Number(item.expiresAtMs) >= now));
  const legacy = rows(legacyContent).filter((item) => visible(item) && item.kind === "notice");
  const combined = [...modern, ...legacy];
  const seen = new Set();
  return combined.filter((item) => {
    const key = `${item.id || ""}:${item.title || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, max);
}

export async function getSchoolEvents({ classKey, startDate, endDate } = {}) {
  const safeClassKey = normalizeClassKey(classKey);
  const grade = gradeFromClassKey(safeClassKey);
  const start = normalizeDate(startDate);
  const end = normalizeDate(endDate, start);
  const [classEvents, academic] = await Promise.all([
    schoolCollection("events").where("classKey", "==", safeClassKey).limit(250).get(),
    schoolCollection("academicSchedules").where("date", ">=", start).where("date", "<=", end).limit(120).get(),
  ]);

  const events = rows(classEvents)
    .filter((item) => visible(item) && item.status !== "draft" && inRange(item, start, end))
    .map((item) => ({ ...item, sourceType: "class" }));
  const schedules = rows(academic)
    .map((item) => scheduleForGrade(item, grade))
    .filter(Boolean)
    .map((item) => ({ ...item, sourceType: "academic" }));

  return [...events, ...schedules].sort((a, b) => itemDate(a).localeCompare(itemDate(b)));
}

export async function getToday({ classKey, date } = {}) {
  const safeClassKey = normalizeClassKey(classKey);
  const safeDate = normalizeDate(date);
  const [timetable, meal, assignments, notices, events] = await Promise.all([
    getTimetable({ classKey: safeClassKey, date: safeDate }),
    getMeal({ date: safeDate }),
    getAssignments({ classKey: safeClassKey, startDate: safeDate, endDate: safeDate }),
    getNotices({ classKey: safeClassKey, limit: 20 }),
    getSchoolEvents({ classKey: safeClassKey, startDate: safeDate, endDate: safeDate }),
  ]);

  return {
    schoolId: SCHOOL_ID,
    classKey: safeClassKey,
    date: safeDate,
    timetable,
    meal,
    assignments,
    notices,
    events,
  };
}

export async function getUpcoming({ classKey, date, days = 7 } = {}) {
  const safeClassKey = normalizeClassKey(classKey);
  const start = normalizeDate(date);
  const safeDays = Math.min(Math.max(Number(days) || 7, 1), 31);
  const end = kstDate(dateMsKst(start) + (safeDays - 1) * DAY_MS);
  const [assignments, events] = await Promise.all([
    getAssignments({ classKey: safeClassKey, startDate: start, endDate: end }),
    getSchoolEvents({ classKey: safeClassKey, startDate: start, endDate: end }),
  ]);
  return { classKey: safeClassKey, startDate: start, endDate: end, assignments, events };
}
