import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { groupTimetableRows } from "./neis-core.mjs";

const SCHOOL = Object.freeze({
  id: "gochon-high",
  name: "고촌고등학교",
  region: "경기",
});

const DEFAULT_TARGETS = [[1, 8]];
const MAX_ATTEMPTS = 3;

function compactDate(date) {
  return String(date || "").replaceAll("-", "");
}

function kstToday(now = new Date()) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function schoolWeekDates(date) {
  const base = new Date(`${date}T00:00:00Z`);
  const day = base.getUTCDay();
  // On Saturday/Sunday, PinCon is interested in the coming school week.
  const mondayOffset = day === 0 ? 1 : day === 6 ? 2 : 1 - day;
  const monday = new Date(base);
  monday.setUTCDate(base.getUTCDate() + mondayOffset);
  return Array.from({ length: 5 }, (_, index) => {
    const next = new Date(monday);
    next.setUTCDate(monday.getUTCDate() + index);
    return next.toISOString().slice(0, 10);
  });
}

function parseTargets(value = "") {
  const parsed = String(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const match = /^(\d+)[-:]([0-9]+)$/.exec(part);
      if (!match) return [];
      const grade = Number(match[1]);
      const classNumber = Number(match[2]);
      return Number.isInteger(grade) && grade >= 1 && grade <= 3 && Number.isInteger(classNumber) && classNumber >= 1 && classNumber <= 10
        ? [[grade, classNumber]]
        : [];
    });
  return parsed.length ? parsed : DEFAULT_TARGETS;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(label, task) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      console.warn(JSON.stringify({ warning: "COMCIGAN_RETRY", label, attempt, message: error?.message || String(error) }));
      if (attempt < MAX_ATTEMPTS) await sleep(350 * attempt);
    }
  }
  throw lastError;
}

function subjectOf(lesson) {
  const raw = lesson?.subject ?? lesson?.subjectName ?? lesson?.lecture ?? lesson?.name ?? lesson?.ITRT_CNTNT ?? "";
  const value = typeof raw === "object" ? raw?.name ?? raw?.title ?? "" : raw;
  return String(value || "").replace(/\s+/g, " ").trim();
}

function periodOf(lesson, fallback = 0) {
  const value = Number(lesson?.period ?? lesson?.classTime ?? lesson?.class_time ?? lesson?.PERIO ?? fallback);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

function deepLessons(value, output = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => deepLessons(item, output));
    return output;
  }
  if (!value || typeof value !== "object") return output;
  const subject = subjectOf(value);
  const period = periodOf(value);
  if (subject && period) output.push({ ...value, subject, period });
  Object.values(value).forEach((nested) => {
    if (nested && typeof nested === "object") deepLessons(nested, output);
  });
  return output;
}

function preferredWeekPayload(raw, preferNextWeek) {
  if (!raw || typeof raw !== "object") return raw;
  const nextCandidates = [
    raw.next,
    raw.nextWeek,
    raw.timetable?.next,
    raw.timetable?.nextWeek,
    raw.data?.next,
    raw.data?.nextWeek,
  ];
  const currentCandidates = [
    raw.current,
    raw.timetable?.current,
    raw.timetable,
    raw.data?.current,
    raw.data,
    raw,
  ];
  return [...(preferNextWeek ? nextCandidates : []), ...currentCandidates].find((item) => item && typeof item === "object") ?? raw;
}

function dayPayloads(payload) {
  if (Array.isArray(payload)) return payload.slice(0, 5);
  if (!payload || typeof payload !== "object") return [];

  const nested = payload.days ?? payload.week ?? payload.weekdays ?? payload.items;
  if (Array.isArray(nested)) return nested.slice(0, 5);

  const zeroBased = [0, 1, 2, 3, 4].map((index) => payload[index] ?? payload[String(index)]);
  if (zeroBased.some(Boolean)) return zeroBased;
  const oneBased = [1, 2, 3, 4, 5].map((index) => payload[index] ?? payload[String(index)]);
  if (oneBased.some(Boolean)) return oneBased;
  return [];
}

function normalizeClass(raw, grade, classNumber, weekDates, preferNextWeek) {
  const payload = preferredWeekPayload(raw, preferNextWeek);
  const days = dayPayloads(payload);
  const rows = [];

  days.forEach((day, dayIndex) => {
    const direct = Array.isArray(day?.items) ? day.items : Array.isArray(day) ? day : null;
    if (direct) {
      direct.forEach((lesson, index) => {
        const subject = subjectOf(lesson);
        const period = periodOf(lesson, index + 1);
        if (!subject || !period) return;
        rows.push({
          GRADE: String(grade),
          CLASS_NM: String(classNumber),
          ALL_TI_YMD: compactDate(weekDates[dayIndex]),
          PERIO: String(period),
          ITRT_CNTNT: subject,
        });
      });
      return;
    }

    const seen = new Set();
    for (const lesson of deepLessons(day, [])) {
      const key = `${lesson.period}:${lesson.subject}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        GRADE: String(grade),
        CLASS_NM: String(classNumber),
        ALL_TI_YMD: compactDate(weekDates[dayIndex]),
        PERIO: String(lesson.period),
        ITRT_CNTNT: lesson.subject,
      });
    }
  });

  if (rows.length) return rows;

  const weekdayMap = { 월: 0, 화: 1, 수: 2, 목: 3, 금: 4 };
  const seen = new Set();
  for (const lesson of deepLessons(payload, [])) {
    let dayIndex = weekdayMap[String(lesson.weekdayString ?? lesson.dayString ?? "").trim()];
    if (dayIndex === undefined) {
      const weekday = Number(lesson.weekday ?? lesson.day);
      if (weekday >= 1 && weekday <= 5) dayIndex = weekday - 1;
      else if (weekday >= 0 && weekday <= 4) dayIndex = weekday;
    }
    if (dayIndex === undefined) continue;
    const key = `${dayIndex}:${lesson.period}:${lesson.subject}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      GRADE: String(grade),
      CLASS_NM: String(classNumber),
      ALL_TI_YMD: compactDate(weekDates[dayIndex]),
      PERIO: String(lesson.period),
      ITRT_CNTNT: lesson.subject,
    });
  }
  return rows;
}

async function findSchool(Comcigan) {
  const terms = [SCHOOL.name, "고촌고"];
  for (const term of terms) {
    const schools = await withRetry(`school-search:${term}`, () => Comcigan.search(term));
    const exact = schools.find((item) => String(item.name || "") === SCHOOL.name && String(item.region || "").includes(SCHOOL.region));
    const close = schools.find((item) => String(item.name || "").includes("고촌고") && String(item.region || "").includes(SCHOOL.region));
    if (exact || close) return exact || close;
  }
  throw new Error("컴시간에서 고촌고등학교를 찾지 못했습니다.");
}

async function fetchTargetRows(Comcigan, schoolCode, targets, weekDates, preferNextWeek) {
  const rows = [];
  for (const [grade, classNumber] of targets) {
    const client = new Comcigan(schoolCode);
    const raw = await withRetry(`${grade}-${classNumber}`, () => client.timetable({ grade, classNum: classNumber }));
    const normalized = normalizeClass(raw, grade, classNumber, weekDates, preferNextWeek);
    if (!normalized.length) throw new Error(`컴시간 ${grade}학년 ${classNumber}반 시간표가 비어 있습니다.`);
    rows.push(...normalized);
    await sleep(120);
  }
  return rows;
}

async function main() {
  const serviceJson = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!serviceJson) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON Secret이 없습니다.");

  const module = await import("parse-comcigan");
  const Comcigan = module.default ?? module.Comcigan ?? module;
  if (typeof Comcigan?.search !== "function") throw new Error("parse-comcigan 학교 검색 API를 찾지 못했습니다.");

  const school = await findSchool(Comcigan);
  const schoolCode = Number(school.code ?? school.schoolCode);
  if (!Number.isFinite(schoolCode)) throw new Error("컴시간 학교 코드가 올바르지 않습니다.");

  const today = kstToday();
  const day = new Date(`${today}T00:00:00Z`).getUTCDay();
  const preferNextWeek = day === 0 || day === 6;
  const weekDates = schoolWeekDates(today);
  const targets = parseTargets(process.env.PINCON_COMCIGAN_PRIORITY_CLASSES);
  const rows = await fetchTargetRows(Comcigan, schoolCode, targets, weekDates, preferNextWeek);
  const documents = groupTimetableRows(rows);
  if (!documents.length) throw new Error("컴시간 시간표를 PinCon 형식으로 변환하지 못했습니다.");

  const serviceAccount = JSON.parse(serviceJson);
  if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();
  const collection = db.collection("schools").doc(SCHOOL.id).collection("neisTimetables");
  const writer = db.bulkWriter();

  for (const document of documents) {
    writer.set(collection.doc(document.id), {
      classKey: document.classKey,
      date: document.date,
      periods: document.periods,
      fingerprint: document.fingerprint,
      source: "COMCIGAN",
      sourceLabel: "컴시간",
      syncMode: preferNextWeek ? "weekend-upcoming-week" : "current-school-week",
      fetchedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  const statusRef = db.collection("schools").doc(SCHOOL.id).collection("integrationStatus").doc("comcigan");
  writer.set(statusRef, {
    ok: true,
    schoolName: school.name || SCHOOL.name,
    schoolCode,
    targets: targets.map(([grade, classNumber]) => `${grade}-${classNumber}`),
    weekDates,
    documents: documents.length,
    rows: rows.length,
    mode: preferNextWeek ? "weekend-upcoming-week" : "current-school-week",
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  await writer.close();
  console.log(JSON.stringify({ source: "COMCIGAN", school: school.name, schoolCode, targets, weekDates, rows: rows.length, documents: documents.length }));
}

main().catch((error) => {
  console.error("[PinCon Comcigan priority sync]", error);
  process.exitCode = 1;
});