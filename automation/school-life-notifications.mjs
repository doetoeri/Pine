import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import {
  SCHOOL_LIFE_EVENT,
  buildBriefing,
  buildLessons,
  briefingText,
  eventRoute,
  isNonSchoolDay,
  kstDate,
  mergeLessonBundles,
  normalizeNotificationPreferences,
} from "../next/core/school-life.js";

const SCHOOL_ID = "gochon-high";
const MAX_BODY = 1800;
const GRACE_MINUTES = 14;

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 28);
}

function compactDate(value) {
  return String(value || "").replaceAll("-", "");
}

function kstClock(now = new Date()) {
  const shifted = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return {
    date: shifted.toISOString().slice(0, 10),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    totalMinutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

function clockMinutes(value) {
  if (!/^\d{2}:\d{2}$/.test(String(value || ""))) return null;
  const [hour, minute] = String(value).split(":").map(Number);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function dueClock(targetClock, now = new Date(), graceMinutes = GRACE_MINUTES) {
  const target = clockMinutes(targetClock);
  if (target === null) return false;
  const current = kstClock(now).totalMinutes;
  const delta = current - target;
  return delta >= 0 && delta < graceMinutes;
}

function dueMs(targetMs, now = new Date(), graceMinutes = GRACE_MINUTES) {
  const target = Number(targetMs || 0);
  if (!Number.isFinite(target) || target <= 0) return false;
  const delta = now.getTime() - target;
  return delta >= 0 && delta < graceMinutes * 60_000;
}

function dateClockMs(date, clock) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) || !/^\d{2}:\d{2}$/.test(String(clock || ""))) return 0;
  const value = Date.parse(`${date}T${clock}:00+09:00`);
  return Number.isFinite(value) ? value : 0;
}

function active(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((item) => item && item.deleted !== true);
}

function row(snapshot) {
  return snapshot?.exists ? { id: snapshot.id, ...snapshot.data() } : null;
}

async function queryRows(ref) {
  const snapshot = await ref.get();
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
}

async function loadClassContext(root, classKey, date) {
  const tomorrow = kstDate(Date.parse(`${date}T00:00:00+09:00`), 1);
  const [todayTableSnapshot, tomorrowTableSnapshot, materials, overrides, assignments, todayMealSnapshot, tomorrowMealSnapshot, todayAcademicSnapshot, tomorrowAcademicSnapshot, classSettingsSnapshot] = await Promise.all([
    root.collection("neisTimetables").doc(`${classKey}-${compactDate(date)}`).get(),
    root.collection("neisTimetables").doc(`${classKey}-${compactDate(tomorrow)}`).get(),
    queryRows(root.collection("lessonMaterials").where("classKey", "==", classKey).limit(400)),
    queryRows(root.collection("lessonOverrides").where("classKey", "==", classKey).where("date", ">=", date).where("date", "<=", tomorrow).limit(250)),
    queryRows(root.collection("classAssignments").where("classKey", "==", classKey).limit(400)),
    root.collection("meals").doc(compactDate(date)).get(),
    root.collection("meals").doc(compactDate(tomorrow)).get(),
    root.collection("academicSchedules").doc(date).get(),
    root.collection("academicSchedules").doc(tomorrow).get(),
    root.collection("classSettings").doc(classKey).get(),
  ]);
  return {
    classKey,
    date,
    tomorrow,
    timetables: {
      [date]: row(todayTableSnapshot),
      [tomorrow]: row(tomorrowTableSnapshot),
    },
    meals: {
      [date]: row(todayMealSnapshot),
      [tomorrow]: row(tomorrowMealSnapshot),
    },
    academic: [row(todayAcademicSnapshot), row(tomorrowAcademicSnapshot)].filter(Boolean),
    classMaterials: active(materials),
    lessonOverrides: active(overrides),
    assignments: active(assignments),
    classSettings: row(classSettingsSnapshot),
  };
}

async function loadUsers(root, classKey) {
  const snapshot = await root.collection("schoolLifeUsers").where("classKey", "==", classKey).limit(100).get();
  return snapshot.docs.map((document) => ({ id: document.id, uid: document.id, ...document.data() }));
}

async function loadUserContext(root, user) {
  const userRef = root.collection("schoolLifeUsers").doc(user.uid);
  const [preferenceSnapshot, personalMaterials, materialStates, assessmentStates] = await Promise.all([
    userRef.collection("settings").doc("notifications").get(),
    queryRows(userRef.collection("materials").limit(250)),
    queryRows(userRef.collection("materialStates").limit(600)),
    queryRows(userRef.collection("assessmentStates").limit(400)),
  ]);
  return {
    user,
    preferences: normalizeNotificationPreferences(preferenceSnapshot.exists ? preferenceSnapshot.data() : {}),
    personalMaterials: active(personalMaterials),
    materialStates: Object.fromEntries(materialStates.map((item) => [item.id, item])),
    assessmentStates: Object.fromEntries(assessmentStates.map((item) => [item.id, item])),
  };
}

async function subscriptionMap(root) {
  const snapshot = await root.collection("pushSubscriptions").where("enabled", "==", true).get();
  const byUid = new Map();
  for (const document of snapshot.docs) {
    const data = document.data();
    const uid = String(data.ownerUid || "");
    if (!uid || !data.token) continue;
    const group = byUid.get(uid) || [];
    if (!group.some((item) => item.data().token === data.token)) group.push(document);
    byUid.set(uid, group);
  }
  return byUid;
}

function eventPreference(type) {
  return {
    [SCHOOL_LIFE_EVENT.CLASS_CHANGED]: "timetableChange",
    [SCHOOL_LIFE_EVENT.LOCATION_CHANGED]: "locationChange",
    [SCHOOL_LIFE_EVENT.SPORTS_LOCATION_CHANGED]: "sportsLocationChange",
    [SCHOOL_LIFE_EVENT.MOVING_CLASS]: "movingClass",
    [SCHOOL_LIFE_EVENT.ASSESSMENT_REMINDER]: "assessmentReminder",
    [SCHOOL_LIFE_EVENT.DAILY_BRIEFING]: "dailyBriefing",
    [SCHOOL_LIFE_EVENT.NEXT_DAY_MATERIALS]: "nextDayMaterials",
  }[type] || "";
}

function notificationBody(value) {
  const body = String(value || "").trim();
  return body.length > MAX_BODY ? `${body.slice(0, MAX_BODY - 1)}…` : body;
}

async function sendToUser({ root, messaging, subscriptionsByUid, user, type, title, body, date, period = 0, relatedId = "", dedupeKey, urgency = "normal" }) {
  const receiptId = `sl-${digest(`${user.uid}:${dedupeKey}`)}`;
  const receiptRef = root.collection("notificationReceipts").doc(receiptId);
  if ((await receiptRef.get()).exists) return { sent: 0, deduped: true };

  const link = eventRoute(type, { date, period, relatedId });
  const cleanBody = notificationBody(body);
  const inboxRef = root.collection("schoolLifeUsers").doc(user.uid).collection("notificationInbox").doc(receiptId);
  const subscriptions = subscriptionsByUid.get(user.uid) || [];
  let sent = 0;

  for (let index = 0; index < subscriptions.length; index += 500) {
    const batch = subscriptions.slice(index, index + 500);
    const response = await messaging.sendEachForMulticast({
      tokens: batch.map((document) => document.data().token),
      data: {
        title: String(title || "PinCon 알림").slice(0, 120),
        body: cleanBody,
        tag: receiptId,
        link,
        route: type === SCHOOL_LIFE_EVENT.ASSESSMENT_REMINDER ? "schedule" : (type === SCHOOL_LIFE_EVENT.DAILY_BRIEFING || type === SCHOOL_LIFE_EVENT.NEXT_DAY_MATERIALS ? "today" : "timetable"),
        kind: type,
        notificationId: receiptId,
        urgency,
        timestampMs: String(Date.now()),
      },
      webpush: { headers: { Urgency: urgency === "urgent" ? "high" : "normal" } },
    });
    sent += response.successCount;
    await Promise.all(response.responses.flatMap((result, responseIndex) => {
      const code = result.error?.code || "";
      return code.includes("registration-token-not-registered") || code.includes("invalid-registration-token")
        ? [batch[responseIndex].ref.delete()]
        : [];
    }));
  }

  const writer = root.firestore.bulkWriter();
  writer.set(inboxRef, {
    type,
    title: String(title || "PinCon 알림").slice(0, 120),
    body: cleanBody,
    date: date || "",
    period: Number(period || 0),
    relatedId: String(relatedId || "").slice(0, 160),
    link,
    read: false,
    createdAtMs: Date.now(),
    createdAt: FieldValue.serverTimestamp(),
  });
  writer.set(receiptRef, {
    classKey: user.classKey,
    ownerUid: user.uid,
    type,
    dedupeKey,
    title: String(title || "PinCon 알림").slice(0, 120),
    sent,
    createdAtMs: Date.now(),
    createdAt: FieldValue.serverTimestamp(),
  });
  await writer.close();
  return { sent, deduped: false };
}

function bundlesFor(context, userContext, date) {
  const lessons = buildLessons({
    timetable: context.timetables[date],
    lessonOverrides: context.lessonOverrides,
    classSettings: context.classSettings,
  });
  return mergeLessonBundles({
    lessons,
    classMaterials: context.classMaterials,
    personalMaterials: userContext.personalMaterials,
    assignments: context.assignments,
    ownerUid: userContext.user.uid,
    states: userContext.materialStates,
  });
}

function changesForDate(context, date) {
  return context.lessonOverrides
    .filter((item) => item.date === date && item.changed === true)
    .map((item) => ({
      ...item,
      summary: `${item.period}교시 ${item.previousSubject && item.previousSubject !== item.subject ? `${item.previousSubject} → ${item.subject}` : item.subject || "수업"}${item.previousLocation && item.previousLocation !== item.location ? ` · ${item.previousLocation} → ${item.location}` : ""}`,
    }));
}

async function dispatchDailyBriefing({ root, messaging, subscriptionsByUid, context, userContext, now }) {
  const prefs = userContext.preferences;
  if (!prefs.dailyBriefing || !dueClock(prefs.dailyBriefingTime, now)) return 0;
  const date = context.date;
  const timetable = context.timetables[date];
  if (isNonSchoolDay({ date, academicSchedules: context.academic, timetable })) return 0;
  const bundles = bundlesFor(context, userContext, date);
  const brief = buildBriefing({
    date,
    bundles,
    meal: context.meals[date],
    changes: changesForDate(context, date),
    academicSchedules: context.academic,
  });
  const body = briefingText(brief);
  const result = await sendToUser({
    root,
    messaging,
    subscriptionsByUid,
    user: userContext.user,
    type: SCHOOL_LIFE_EVENT.DAILY_BRIEFING,
    title: "PinCon 오늘 브리핑",
    body,
    date,
    dedupeKey: `brief:${date}:${prefs.dailyBriefingTime}`,
  });
  return result.sent;
}

async function dispatchNextDayMaterials({ root, messaging, subscriptionsByUid, context, userContext, now }) {
  const prefs = userContext.preferences;
  if (!prefs.nextDayMaterials || !dueClock(prefs.nextDayMaterialsTime, now)) return 0;
  const date = context.tomorrow;
  const timetable = context.timetables[date];
  if (isNonSchoolDay({ date, academicSchedules: context.academic, timetable })) return 0;
  const bundles = bundlesFor(context, userContext, date);
  const items = bundles.flatMap((bundle) => bundle.materials.filter((item) => !item.completed).map((item) => `${bundle.lesson.subject} · ${item.title}`));
  if (!items.length) return 0;
  const result = await sendToUser({
    root,
    messaging,
    subscriptionsByUid,
    user: userContext.user,
    type: SCHOOL_LIFE_EVENT.NEXT_DAY_MATERIALS,
    title: `내일 챙길 준비물 ${items.length}개`,
    body: items.slice(0, 10).join("\n"),
    date,
    dedupeKey: `next-materials:${date}:${prefs.nextDayMaterialsTime}:${digest(items.join("|"))}`,
  });
  return result.sent;
}

async function dispatchMovingClasses({ root, messaging, subscriptionsByUid, context, userContext, now }) {
  const prefs = userContext.preferences;
  if (!prefs.movingClass) return 0;
  const bundles = bundlesFor(context, userContext, context.date);
  let sent = 0;
  for (const bundle of bundles) {
    const lesson = bundle.lesson;
    if (!lesson.isMovingClass || !lesson.startTime) continue;
    const startMs = dateClockMs(lesson.date, lesson.startTime);
    const targetMs = startMs - prefs.movingClassMinutes * 60_000;
    if (!dueMs(targetMs, now)) continue;
    const materialText = bundle.materials.filter((item) => !item.completed).slice(0, 4).map((item) => item.title).join(", ");
    const lines = [`${lesson.period}교시 ${lesson.subject}`, lesson.location || "이동 장소를 확인하세요."];
    if (materialText) lines.push(`${materialText}을(를) 챙겨 이동하세요.`);
    const result = await sendToUser({
      root,
      messaging,
      subscriptionsByUid,
      user: userContext.user,
      type: SCHOOL_LIFE_EVENT.MOVING_CLASS,
      title: `${prefs.movingClassMinutes}분 뒤 이동수업이에요`,
      body: lines.join("\n"),
      date: lesson.date,
      period: lesson.period,
      relatedId: lesson.overrideId,
      dedupeKey: `moving:${lesson.date}:${lesson.period}:${prefs.movingClassMinutes}:${lesson.startTime}`,
      urgency: "urgent",
    });
    sent += result.sent;
  }
  return sent;
}

async function dispatchAssessments({ root, messaging, subscriptionsByUid, context, userContext, now }) {
  const prefs = userContext.preferences;
  if (!prefs.assessmentReminder) return 0;
  const bundles = bundlesFor(context, userContext, context.date);
  let sent = 0;
  for (const bundle of bundles) {
    const pendingAssessments = bundle.assessments.filter((item) => !item.id || userContext.assessmentStates[item.id]?.submitted !== true);
    if (!bundle.lesson.startTime || !pendingAssessments.length) continue;
    const startMs = dateClockMs(bundle.lesson.date, bundle.lesson.startTime);
    const targetMs = startMs - prefs.assessmentReminderMinutes * 60_000;
    if (!dueMs(targetMs, now)) continue;
    const titles = pendingAssessments.slice(0, 4).map((item) => item.title || "수행평가");
    const result = await sendToUser({
      root,
      messaging,
      subscriptionsByUid,
      user: userContext.user,
      type: SCHOOL_LIFE_EVENT.ASSESSMENT_REMINDER,
      title: `${bundle.lesson.subject} 수행평가 알림`,
      body: `${bundle.lesson.period}교시 · ${titles.join(" · ")}`,
      date: bundle.lesson.date,
      period: bundle.lesson.period,
      relatedId: pendingAssessments[0]?.id || "",
      dedupeKey: `assessment:${bundle.lesson.date}:${bundle.lesson.period}:${prefs.assessmentReminderMinutes}:${titles.join("|")}`,
      urgency: "urgent",
    });
    sent += result.sent;
  }
  return sent;
}

async function dispatchPendingEvents({ root, messaging, subscriptionsByUid, usersByClass, contexts }) {
  const events = await queryRows(root.collection("notificationEvents").where("status", "==", "pending").limit(100));
  let sent = 0;
  let processed = 0;
  for (const event of events) {
    const users = usersByClass.get(event.classKey) || [];
    const preference = eventPreference(event.type);
    for (const userContext of users) {
      if (preference && userContext.preferences[preference] === false) continue;
      let body = event.body;
      if (event.type === SCHOOL_LIFE_EVENT.CLASS_CHANGED && Number(event.period || 0) > 0) {
        const context = contexts.get(event.classKey);
        const bundle = context ? bundlesFor(context, userContext, event.date).find((item) => item.lesson.period === Number(event.period)) : null;
        const materialText = bundle?.materials?.filter((item) => !item.completed).slice(0, 5).map((item) => item.title).join(", ") || "";
        if (materialText) body = body + "\n준비물: " + materialText;
      }
      const result = await sendToUser({
        root,
        messaging,
        subscriptionsByUid,
        user: userContext.user,
        type: event.type,
        title: event.title,
        body,
        date: event.date,
        period: event.period,
        relatedId: event.relatedId,
        dedupeKey: `event:${event.id}:${event.updatedAtMs || event.createdAtMs || 0}`,
        urgency: [SCHOOL_LIFE_EVENT.CLASS_CHANGED, SCHOOL_LIFE_EVENT.LOCATION_CHANGED, SCHOOL_LIFE_EVENT.SPORTS_LOCATION_CHANGED].includes(event.type) ? "urgent" : "normal",
      });
      sent += result.sent;
    }
    await event.ref?.update?.({ status: "sent", sentAtMs: Date.now(), sentAt: FieldValue.serverTimestamp() });
    if (!event.ref) {
      await root.collection("notificationEvents").doc(event.id).set({ status: "sent", sentAtMs: Date.now(), sentAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    processed += 1;
  }
  return { sent, processed };
}

export async function dispatchSchoolLifeNotifications({ db, messaging, now = new Date() }) {
  const root = db.collection("schools").doc(SCHOOL_ID);
  const clock = kstClock(now);
  const subscriptionsByUid = await subscriptionMap(root);
  const userSnapshot = await root.collection("schoolLifeUsers").limit(3000).get();
  const users = userSnapshot.docs.map((document) => ({ uid: document.id, id: document.id, ...document.data() })).filter((item) => item.classKey);
  const classKeys = [...new Set(users.map((item) => item.classKey))];
  const contexts = new Map();
  const usersByClass = new Map();
  let sent = 0;

  for (const classKey of classKeys) {
    contexts.set(classKey, await loadClassContext(root, classKey, clock.date));
    const classUsers = users.filter((item) => item.classKey === classKey);
    const loaded = [];
    for (const user of classUsers) loaded.push(await loadUserContext(root, user));
    usersByClass.set(classKey, loaded);
  }

  const pending = await dispatchPendingEvents({ root, messaging, subscriptionsByUid, usersByClass, contexts });
  sent += pending.sent;

  for (const [classKey, userContexts] of usersByClass.entries()) {
    const context = contexts.get(classKey);
    for (const userContext of userContexts) {
      sent += await dispatchDailyBriefing({ root, messaging, subscriptionsByUid, context, userContext, now });
      sent += await dispatchNextDayMaterials({ root, messaging, subscriptionsByUid, context, userContext, now });
      sent += await dispatchMovingClasses({ root, messaging, subscriptionsByUid, context, userContext, now });
      sent += await dispatchAssessments({ root, messaging, subscriptionsByUid, context, userContext, now });
    }
  }

  return {
    date: clock.date,
    classes: classKeys.length,
    users: users.length,
    pendingEvents: pending.processed,
    sent,
  };
}
