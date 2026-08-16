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
  officeCode: "J10",
  schoolCode: "7531375",
});
const NEIS_BASE_URL = "https://open.neis.go.kr/hub";
const PAGE_SIZE = 1000;

function compactDate(date) {
  return date.replaceAll("-", "");
}

function kstToday(now = new Date()) {
  return new Date(now.getTime() + (9 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

function addDays(date, amount) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + amount);
  return next.toISOString().slice(0, 10);
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

async function fetchTimetables(start, end) {
  const ranged = await fetchNeisRows("hisTimetable", "hisTimetable", {
    TI_FROM_YMD: compactDate(start),
    TI_TO_YMD: compactDate(end),
  });
  if (ranged.rows.length) {
    return { rows: ranged.rows, mode: "date-range", result: ranged.result };
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
    const latest = semesterWide.rows
      .map((row) => String(row.ALL_TI_YMD || "").replaceAll("-", ""))
      .filter((date) => /^\d{8}$/.test(date))
      .sort()
      .at(-1) || "none";
    console.warn(JSON.stringify({
      warning: "NEIS_TIMETABLE_EMPTY_FOR_RANGE",
      start,
      end,
      queryResult: ranged.result,
      semesterResult: semesterWide.result,
      semesterRows: semesterWide.rows.length,
      latestPublishedDate: latest,
    }));
  }

  return { rows: filtered, mode: "semester-fallback", result: semesterWide.result };
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
  const fetched = await fetchTimetables(start, end);
  const rows = fetched.rows;
  const documents = groupTimetableRows(rows);
  const collection = db.collection("schools").doc(SCHOOL.id).collection("neisTimetables");
  const refs = documents.map((item) => collection.doc(item.id));
  const existing = await readExisting(db, refs);
  const writer = db.bulkWriter();
  const changes = [];

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
      source: "NEIS",
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
      authorName: "NEIS 자동 알림",
      title,
      body,
      category: "수업 변경",
      date: change.date,
      source: "NEIS",
      deleted: false,
      clientCreatedAt: Date.now(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    pushes += await sendClassNotification(db, change.classKey, title, body);
  }

  return {
    mode: fetched.mode,
    rows: rows.length,
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
