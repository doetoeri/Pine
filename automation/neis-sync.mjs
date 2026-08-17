import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import {
  classLabel,
  dateLabel,
  diffPeriods,
  groupTimetableRows,
  rowsFromPayload,
  totalCountFromPayload,
} from "./neis-core.mjs";

const SCHOOL = Object.freeze({
  id: "gochon-high",
  name: "고촌고등학교",
  region: "경기",
  officeCode: "J10",
  schoolCode: "7531375",
});
const NEIS_BASE_URL = "https://open.neis.go.kr/hub";
const PAGE_SIZE = 1000;

function compactDate(date) {
  return String(date || "").replaceAll("-", "");
}

function kstToday(now = new Date()) {
  return new Date(now.getTime() + (9 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

function addDays(date, amount) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + amount);
  return next.toISOString().slice(0, 10);
}

function weekDatesFor(date) {
  const base = new Date(`${date}T00:00:00Z`);
  const day = base.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(base);
  monday.setUTCDate(base.getUTCDate() + mondayOffset);
  return Array.from({ length: 5 }, (_, index) => {
    const next = new Date(monday);
    next.setUTCDate(monday.getUTCDate() + index);
    return next.toISOString().slice(0, 10);
  });
}

function semesterFor(date) {
  const [year, month] = String(date).split("-").map(Number);
  return { year: String(year), semester: month >= 8 ? "2" : "1" };
}

function neisResult(payload, datasetName) {
  const direct = payload?.RESULT;
  if (direct?.CODE || direct?.MESSAGE) {
    return { code: String(direct.CODE || ""), message: String(direct.MESSAGE || "") };
  }
  const head = payload?.[datasetName]?.[0]?.head;
  if (Array.isArray(head)) {
    const result = head.find((item) => item?.RESULT)?.RESULT;
    if (result?.CODE || result?.MESSAGE) {
      return { code: String(result.CODE || ""), message: String(result.MESSAGE || "") };
    }
  }
  return { code: "", message: "" };
}

function throwForNeisError(payload, datasetName) {
  const result = neisResult(payload, datasetName);
  if (result.code.startsWith("ERROR")) {
    throw new Error(`${datasetName} NEIS 오류 ${result.code}: ${result.message || "알 수 없는 오류"}`);
  }
  return result;
}

async function fetchNeisRows(datasetName, path, queryParams = {}) {
  const rows = [];
  let page = 1;
  let total = Infinity;
  let lastResult = { code: "", message: "" };

  while (rows.length < total) {
    const query = new URLSearchParams({
      KEY: process.env.NEIS_API_KEY,
      Type: "json",
      pIndex: String(page),
      pSize: String(PAGE_SIZE),
      ATPT_OFCDC_SC_CODE: SCHOOL.officeCode,
      SD_SCHUL_CODE: SCHOOL.schoolCode,
      ...queryParams,
    });
    const response = await fetch(`${NEIS_BASE_URL}/${path}?${query}`);
    if (!response.ok) throw new Error(`${datasetName} 요청 실패: HTTP ${response.status}`);
    const payload = await response.json();
    lastResult = throwForNeisError(payload, datasetName);
    const nextRows = rowsFromPayload(payload, datasetName);
    total = totalCountFromPayload(payload, datasetName);
    rows.push(...nextRows);
    if (!nextRows.length || nextRows.length < PAGE_SIZE) break;
    page += 1;
  }

  return { rows, result: lastResult };
}

async function fetchNeisTimetables(start, end) {
  const ranged = await fetchNeisRows("hisTimetable", "hisTimetable", {
    TI_FROM_YMD: compactDate(start),
    TI_TO_YMD: compactDate(end),
  });
  if (ranged.rows.length) {
    return { rows: ranged.rows, source: "NEIS", mode: "date-range", result: ranged.result };
  }

  const { year, semester } = semesterFor(start);
  const semesterWide = await fetchNeisRows("hisTimetable", "hisTimetable", {
    AY: year,
    SEM: semester,
  });
  const startCompact = compactDate(start);
  const endCompact = compactDate(end);
  const filtered = semesterWide.rows.filter((row) => {
    const date = String(row.ALL_TI_YMD || "").replaceAll("-", "");
    return /^\d{8}$/.test(date) && date >= startCompact && date <= endCompact;
  });

  if (!filtered.length) {
    console.warn(JSON.stringify({
      warning: "NEIS_TIMETABLE_EMPTY_FOR_RANGE",
      start,
      end,
      queryResult: ranged.result,
      semesterResult: semesterWide.result,
      semesterRows: semesterWide.rows.length,
    }));
  }

  return { rows: filtered, source: "NEIS", mode: "semester-fallback", result: semesterWide.result };
}

function lessonObjects(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) lessonObjects(item, output);
    return output;
  }
  if (!value || typeof value !== "object") return output;
  const subject = String(value.subject ?? value.subjectName ?? value.ITRT_CNTNT ?? "").trim();
  const period = Number(value.period ?? value.classTime ?? value.class_time ?? value.PERIO);
  if (subject && Number.isInteger(period) && period > 0) output.push({ ...value, subject, period });
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === "object") lessonObjects(nested, output);
  }
  return output;
}

function normalizeComciganPayload(raw) {
  if (!raw || typeof raw !== "object") return raw;
  return raw.current
    ?? raw.timetable?.current
    ?? raw.timetable
    ?? raw.data?.current
    ?? raw.data
    ?? raw;
}

function normalizeComciganClass(raw, grade, classNumber, weekDates) {
  const payload = normalizeComciganPayload(raw);
  const rows = [];

  // parse-comcigan 1.1.x: 월~금 배열, 각 날짜의 items 배열 순서가 1교시부터 시작한다.
  if (Array.isArray(payload) && payload.length >= 5) {
    for (let dayIndex = 0; dayIndex < 5; dayIndex += 1) {
      const day = payload[dayIndex];
      if (Array.isArray(day?.items)) {
        day.items.forEach((lesson, index) => {
          const subject = String(lesson?.subject || "").replace(/\s+/g, " ").trim();
          if (!subject) return;
          rows.push({
            GRADE: String(grade),
            CLASS_NM: String(classNumber),
            ALL_TI_YMD: compactDate(weekDates[dayIndex]),
            PERIO: String(index + 1),
            ITRT_CNTNT: subject,
          });
        });
        continue;
      }

      // 이전/다른 응답 형식도 계속 지원한다.
      const lessons = lessonObjects(day, []);
      const seen = new Set();
      for (const lesson of lessons) {
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
    }
    if (rows.length) return rows;
  }

  const lessons = lessonObjects(payload, []);
  const seen = new Set();
  for (const lesson of lessons) {
    const weekdayString = String(lesson.weekdayString ?? lesson.dayString ?? "").trim();
    const weekdayMap = { 월: 0, 화: 1, 수: 2, 목: 3, 금: 4 };
    let dayIndex = weekdayMap[weekdayString];
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

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function fetchComciganTimetables(start) {
  const module = await import("parse-comcigan");
  const Comcigan = module.default ?? module.Comcigan ?? module;
  if (typeof Comcigan?.search !== "function") throw new Error("parse-comcigan의 학교 검색 API를 찾지 못했습니다.");

  const schools = await Comcigan.search(SCHOOL.name);
  const school = schools.find((item) => String(item.name || "") === SCHOOL.name && String(item.region || "").includes(SCHOOL.region))
    ?? schools.find((item) => String(item.name || "").includes("고촌고"))
    ?? schools[0];
  if (!school) throw new Error("컴시간에서 고촌고등학교를 찾지 못했습니다.");

  const schoolCode = Number(school.code ?? school.schoolCode);
  if (!Number.isFinite(schoolCode)) throw new Error("컴시간 학교 코드가 올바르지 않습니다.");

  const weekDates = weekDatesFor(start);
  const classes = Array.from({ length: 30 }, (_, index) => ({
    grade: Math.floor(index / 10) + 1,
    classNumber: (index % 10) + 1,
  }));

  const classRows = await mapWithConcurrency(classes, 3, async ({ grade, classNumber }) => {
    try {
      const client = new Comcigan(schoolCode);
      const raw = await client.timetable({ grade, classNum: classNumber });
      const normalized = normalizeComciganClass(raw, grade, classNumber, weekDates);
      if (!normalized.length) console.warn(JSON.stringify({ warning: "COMCIGAN_CLASS_EMPTY", grade, classNumber }));
      return normalized;
    } catch (error) {
      console.warn(JSON.stringify({
        warning: "COMCIGAN_CLASS_FETCH_FAILED",
        grade,
        classNumber,
        message: error?.message || String(error),
      }));
      return [];
    }
  });

  const rows = classRows.flat();
  console.log(JSON.stringify({
    source: "COMCIGAN",
    school: { name: school.name, region: school.region, code: schoolCode },
    week: weekDates,
    rows: rows.length,
    classesWithData: classRows.filter((item) => item.length).length,
  }));
  return { rows, source: "COMCIGAN", mode: "current-week", weekDates };
}

async function fetchPreferredTimetables(start, end) {
  try {
    const comcigan = await fetchComciganTimetables(start);
    if (comcigan.rows.length) return comcigan;
    console.warn(JSON.stringify({ warning: "COMCIGAN_EMPTY_FALLING_BACK_TO_NEIS" }));
  } catch (error) {
    console.warn(JSON.stringify({ warning: "COMCIGAN_FAILED_FALLING_BACK_TO_NEIS", message: error?.message || String(error) }));
  }
  return fetchNeisTimetables(start, end);
}

async function fetchMeals(start, end) {
  const response = await fetchNeisRows("mealServiceDietInfo", "mealServiceDietInfo", {
    MLSV_FROM_YMD: compactDate(start),
    MLSV_TO_YMD: compactDate(end),
  });
  return response.rows;
}

async function readExisting(db, refs) {
  const snapshots = [];
  for (let index = 0; index < refs.length; index += 100) {
    snapshots.push(...await db.getAll(...refs.slice(index, index + 100)));
  }
  return new Map(snapshots.filter((item) => item.exists).map((item) => [item.id, item.data()]));
}

async function sendClassNotification(db, classKey, title, body) {
  const subscriptions = await db.collection("schools").doc(SCHOOL.id)
    .collection("pushSubscriptions")
    .where("classKey", "==", classKey)
    .where("enabled", "==", true)
    .get();
  if (subscriptions.empty) return 0;

  const documents = subscriptions.docs;
  let sent = 0;
  for (let index = 0; index < documents.length; index += 500) {
    const batch = documents.slice(index, index + 500);
    const response = await getMessaging().sendEachForMulticast({
      tokens: batch.map((item) => item.data().token),
      data: {
        title,
        body,
        tag: `pincon-${classKey}-timetable`,
        link: "https://pincon.app/",
      },
      webpush: { headers: { Urgency: "high" } },
    });
    sent += response.successCount;
    const invalidDeletes = response.responses.flatMap((result, responseIndex) => {
      const code = result.error?.code || "";
      return code.includes("registration-token-not-registered") || code.includes("invalid-registration-token")
        ? [batch[responseIndex].ref.delete()]
        : [];
    });
    await Promise.all(invalidDeletes);
  }
  return sent;
}

async function syncTimetables(db, start, end) {
  const fetched = await fetchPreferredTimetables(start, end);
  const documents = groupTimetableRows(fetched.rows);
  // 기존 클라이언트 호환을 위해 컬렉션 이름은 유지하되 source 필드로 실제 출처를 구분한다.
  const collection = db.collection("schools").doc(SCHOOL.id).collection("neisTimetables");
  const refs = documents.map((item) => collection.doc(item.id));
  const existing = await readExisting(db, refs);
  const writer = db.bulkWriter();
  const changes = [];
  const sourceLabel = fetched.source === "COMCIGAN" ? "컴시간" : "NEIS";

  for (const document of documents) {
    const previous = existing.get(document.id);
    if (previous?.fingerprint && previous.fingerprint !== document.fingerprint) {
      const differences = diffPeriods(previous.periods, document.periods);
      if (differences.length) changes.push({ ...document, differences });
    }
    writer.set(collection.doc(document.id), {
      classKey: document.classKey,
      date: document.date,
      periods: document.periods,
      fingerprint: document.fingerprint,
      source: fetched.source,
      fetchedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  await writer.close();

  let pushes = 0;
  for (const change of changes) {
    const title = `${classLabel(change.classKey)} 시간표 변경`;
    const summary = change.differences.slice(0, 4).join(", ");
    const overflow = change.differences.length > 4 ? ` 외 ${change.differences.length - 4}건` : "";
    const body = `${dateLabel(change.date)} 시간표가 변경됐어요. ${summary}${overflow}`;
    await db.collection("schools").doc(SCHOOL.id).collection("content").add({
      schoolId: SCHOOL.id,
      kind: "notice",
      targets: [change.classKey],
      scope: "class",
      authorName: `${sourceLabel} 자동 알림`,
      title,
      body,
      category: "수업 변경",
      date: change.date,
      source: fetched.source,
      deleted: false,
      clientCreatedAt: Date.now(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    pushes += await sendClassNotification(db, change.classKey, title, body);
  }

  return {
    source: fetched.source,
    mode: fetched.mode,
    rows: fetched.rows.length,
    documents: documents.length,
    changes: changes.length,
    pushes,
  };
}

async function syncMeals(db, start, end) {
  const rows = await fetchMeals(start, end);
  const collection = db.collection("schools").doc(SCHOOL.id).collection("meals");
  const writer = db.bulkWriter();
  let documents = 0;
  for (const row of rows) {
    const date = String(row.MLSV_YMD || "");
    if (!/^\d{8}$/.test(date)) continue;
    writer.set(collection.doc(date), {
      date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
      mealType: String(row.MMEAL_SC_NM || "중식"),
      dishesHtml: String(row.DDISH_NM || ""),
      calories: String(row.CAL_INFO || ""),
      source: "NEIS",
      fetchedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    documents += 1;
  }
  await writer.close();
  return { rows: rows.length, documents };
}

async function main() {
  const missingSecrets = [
    ["NEIS_API_KEY", process.env.NEIS_API_KEY],
    ["FIREBASE_SERVICE_ACCOUNT_JSON", process.env.FIREBASE_SERVICE_ACCOUNT_JSON],
  ].filter(([, value]) => !String(value || "").trim()).map(([name]) => name);

  if (missingSecrets.length) {
    throw new Error(`필수 GitHub Actions Secret이 없습니다: ${missingSecrets.join(", ")}`);
  }

  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();
  const start = kstToday();
  const end = addDays(start, 21);
  const [timetables, meals] = await Promise.all([
    syncTimetables(db, start, end),
    syncMeals(db, start, end),
  ]);
  console.log(JSON.stringify({ start, end, timetables, meals }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
