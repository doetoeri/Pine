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

async function fetchNeisRows(datasetName, path, rangeKeys, start, end) {
  const rows = [];
  let page = 1;
  let total = Infinity;
  while (rows.length < total) {
    const query = new URLSearchParams({
      KEY: process.env.NEIS_API_KEY,
      Type: "json",
      pIndex: String(page),
      pSize: String(PAGE_SIZE),
      ATPT_OFCDC_SC_CODE: SCHOOL.officeCode,
      SD_SCHUL_CODE: SCHOOL.schoolCode,
      [rangeKeys[0]]: compactDate(start),
      [rangeKeys[1]]: compactDate(end),
    });
    const response = await fetch(`${NEIS_BASE_URL}/${path}?${query}`);
    if (!response.ok) throw new Error(`${datasetName} 요청 실패: HTTP ${response.status}`);
    const payload = await response.json();
    const nextRows = rowsFromPayload(payload, datasetName);
    total = totalCountFromPayload(payload, datasetName);
    rows.push(...nextRows);
    if (!nextRows.length || nextRows.length < PAGE_SIZE) break;
    page += 1;
  }
  return rows;
}

async function fetchTimetables(start, end) {
  return fetchNeisRows("hisTimetable", "hisTimetable", ["TI_FROM_YMD", "TI_TO_YMD"], start, end);
}

async function fetchMeals(start, end) {
  return fetchNeisRows("mealServiceDietInfo", "mealServiceDietInfo", ["MLSV_FROM_YMD", "MLSV_TO_YMD"], start, end);
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
  const rows = await fetchTimetables(start, end);
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

  return { rows: rows.length, documents: documents.length, changes: changes.length, pushes };
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
  if (!process.env.NEIS_API_KEY || !process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    console.log("NEIS_API_KEY 또는 FIREBASE_SERVICE_ACCOUNT_JSON이 없어 동기화를 건너뜁니다.");
    return;
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
