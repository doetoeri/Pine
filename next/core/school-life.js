const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const SCHOOL_LIFE_NOTIFICATION_DEFAULTS = Object.freeze({
  dailyBriefing: true,
  dailyBriefingTime: "08:00",
  nextDayMaterials: false,
  nextDayMaterialsTime: "21:00",
  movingClass: true,
  movingClassMinutes: 5,
  timetableChange: true,
  locationChange: true,
  sportsLocationChange: true,
  assessmentReminder: true,
  assessmentReminderMinutes: 60,
});

export const SCHOOL_LIFE_EVENT = Object.freeze({
  DAILY_BRIEFING: "DAILY_BRIEFING",
  NEXT_DAY_MATERIALS: "NEXT_DAY_MATERIALS",
  MATERIAL_REMINDER: "MATERIAL_REMINDER",
  ASSESSMENT_REMINDER: "ASSESSMENT_REMINDER",
  CLASS_CHANGED: "CLASS_CHANGED",
  LOCATION_CHANGED: "LOCATION_CHANGED",
  SPORTS_LOCATION_CHANGED: "SPORTS_LOCATION_CHANGED",
  MOVING_CLASS: "MOVING_CLASS",
});

export function kstDate(value = Date.now(), offsetDays = 0) {
  const source = value instanceof Date ? value.getTime() : Number(value);
  const shifted = new Date((Number.isFinite(source) ? source : Date.now()) + KST_OFFSET_MS);
  shifted.setUTCDate(shifted.getUTCDate() + Number(offsetDays || 0));
  return shifted.toISOString().slice(0, 10);
}

export function cleanText(value, max = 160) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function subjectKey(value) {
  return cleanText(value, 60)
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s·/()\[\]{}_-]+/g, "")
    .replace(/[^0-9a-z가-힣]/g, "");
}

export function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

export function validClock(value) {
  if (!/^\d{2}:\d{2}$/.test(String(value || ""))) return false;
  const [hour, minute] = String(value).split(":").map(Number);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

export function clockToMinutes(value) {
  if (!validClock(value)) return null;
  const [hour, minute] = String(value).split(":").map(Number);
  return hour * 60 + minute;
}

export function dateClockToMs(date, clock) {
  if (!validDate(date) || !validClock(clock)) return 0;
  const value = Date.parse(`${date}T${clock}:00+09:00`);
  return Number.isFinite(value) ? value : 0;
}

export function normalizeNotificationPreferences(value = {}) {
  const minutes = Number(value.movingClassMinutes);
  const assessmentMinutes = Number(value.assessmentReminderMinutes);
  return {
    ...SCHOOL_LIFE_NOTIFICATION_DEFAULTS,
    ...value,
    dailyBriefing: value.dailyBriefing !== false,
    dailyBriefingTime: validClock(value.dailyBriefingTime) ? value.dailyBriefingTime : SCHOOL_LIFE_NOTIFICATION_DEFAULTS.dailyBriefingTime,
    nextDayMaterials: value.nextDayMaterials === true,
    nextDayMaterialsTime: validClock(value.nextDayMaterialsTime) ? value.nextDayMaterialsTime : SCHOOL_LIFE_NOTIFICATION_DEFAULTS.nextDayMaterialsTime,
    movingClass: value.movingClass !== false,
    movingClassMinutes: [3, 5, 10].includes(minutes) ? minutes : 5,
    timetableChange: value.timetableChange !== false,
    locationChange: value.locationChange !== false,
    sportsLocationChange: value.sportsLocationChange !== false,
    assessmentReminder: value.assessmentReminder !== false,
    assessmentReminderMinutes: [10, 30, 60, 180, 1440].includes(assessmentMinutes) ? assessmentMinutes : 60,
  };
}

function activeRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((item) => item && item.deleted !== true);
}

function lessonPeriod(value, fallback = 0) {
  const period = Number(value);
  return Number.isInteger(period) && period > 0 && period <= 12 ? period : fallback;
}

function lessonTimeFromSettings(classSettings, period, key) {
  const table = classSettings?.periodTimes;
  if (!table || typeof table !== "object") return "";
  const item = table[String(period)] ?? table[period];
  if (!item || typeof item !== "object") return "";
  const value = cleanText(item[key], 5);
  return validClock(value) ? value : "";
}

function overrideFor(overrides, date, period) {
  return activeRows(overrides)
    .filter((item) => item.date === date && lessonPeriod(item.period) === period)
    .sort((a, b) => Number(b.updatedAtMs || b.createdAtMs || 0) - Number(a.updatedAtMs || a.createdAtMs || 0))[0] || null;
}

export function buildLessons({ timetable = null, lessonOverrides = [], classSettings = null } = {}) {
  const date = validDate(timetable?.date) ? timetable.date : "";
  const periods = Array.isArray(timetable?.periods) ? timetable.periods : [];
  if (!date) return [];
  return periods.map((raw, index) => {
    const period = lessonPeriod(raw?.period, index + 1);
    const override = overrideFor(lessonOverrides, date, period);
    const originalSubject = cleanText(raw?.subject || raw?.subjectName || "과목 미정", 60);
    const originalLocation = cleanText(raw?.location || raw?.room || "", 80);
    const subject = cleanText(override?.subject || override?.subjectName || originalSubject, 60) || originalSubject;
    const location = cleanText(override?.location || originalLocation, 80);
    const startTime = cleanText(
      override?.startTime || raw?.startTime || lessonTimeFromSettings(classSettings, period, "startTime"),
      5,
    );
    const endTime = cleanText(
      override?.endTime || raw?.endTime || lessonTimeFromSettings(classSettings, period, "endTime"),
      5,
    );
    const previousSubject = cleanText(override?.previousSubject || (subject !== originalSubject ? originalSubject : ""), 60);
    const previousLocation = cleanText(override?.previousLocation || (location !== originalLocation ? originalLocation : ""), 80);
    const changed = Boolean(override?.changed === true || previousSubject || previousLocation);
    return {
      date,
      period,
      id: `${date}-${period}`,
      subject,
      subjectKey: subjectKey(subject),
      originalSubject,
      previousSubject,
      startTime: validClock(startTime) ? startTime : "",
      endTime: validClock(endTime) ? endTime : "",
      location,
      originalLocation,
      previousLocation,
      isMovingClass: override?.isMovingClass === true || raw?.isMovingClass === true,
      changed,
      source: cleanText(timetable?.source || "시간표", 40),
      overrideId: override?.id || "",
    };
  });
}

function materialApplies(material, lesson, ownerUid = "") {
  if (!material || material.deleted === true || !lesson) return false;
  if (material.ownerUid && ownerUid && material.ownerUid !== ownerUid) return false;
  if (material.ownerUid && !ownerUid) return false;
  const materialSubjectKey = subjectKey(material.subjectKey || material.subject || "");
  if (materialSubjectKey && materialSubjectKey !== lesson.subjectKey) return false;
  const recurrence = material.recurrence || "once";
  if (recurrence === "subject-default") return Boolean(materialSubjectKey);
  if (validDate(material.date) && material.date !== lesson.date) return false;
  const period = lessonPeriod(material.period);
  if (period && period !== lesson.period) return false;
  return validDate(material.date) || Boolean(period);
}

function materialIdentity(item) {
  return subjectKey(item?.title || item?.name || "") || cleanText(item?.title || item?.name || "", 80).toLocaleLowerCase("ko-KR");
}

function assignmentDate(item = {}) {
  if (validDate(item.date)) return item.date;
  if (validDate(item.dueDate)) return item.dueDate;
  return "";
}

export function assessmentApplies(item, lesson) {
  if (!item || item.deleted === true || !lesson) return false;
  if (!["assessment", "exam"].includes(item.type || "assessment")) return false;
  const date = assignmentDate(item);
  if (!date || date !== lesson.date) return false;
  const period = lessonPeriod(item.period);
  if (period && period !== lesson.period) return false;
  const key = subjectKey(item.subjectKey || item.subject || "");
  return !key || key === lesson.subjectKey;
}

function assessmentMaterials(assignments, lesson) {
  const results = [];
  for (const item of activeRows(assignments).filter((assignment) => assessmentApplies(assignment, lesson))) {
    const raw = Array.isArray(item.materialItems)
      ? item.materialItems
      : String(item.materials || "").split(/[,\n·]+/);
    for (const value of raw) {
      const title = cleanText(typeof value === "string" ? value : value?.title, 80);
      if (!title) continue;
      results.push({
        id: `assessment:${item.id || item.title}:${materialIdentity({ title })}`,
        title,
        source: "assessment",
        assessmentId: item.id || "",
        scope: "class",
      });
    }
  }
  return results;
}

export function materialsForLesson({ lesson, classMaterials = [], personalMaterials = [], assignments = [], ownerUid = "", states = {} } = {}) {
  if (!lesson) return [];
  const candidates = [
    ...activeRows(classMaterials).filter((item) => materialApplies(item, lesson)),
    ...activeRows(personalMaterials).filter((item) => materialApplies(item, lesson, ownerUid)),
    ...assessmentMaterials(assignments, lesson),
  ];
  const deduped = new Map();
  for (const item of candidates) {
    const title = cleanText(item.title || item.name, 80);
    if (!title) continue;
    const key = materialIdentity({ title });
    const existing = deduped.get(key);
    if (!existing || (existing.source === "assessment" && item.source !== "assessment")) {
      deduped.set(key, { ...item, title });
    }
  }
  return [...deduped.values()].map((item) => {
    const stateKey = `${lesson.date}:${item.id || materialIdentity(item)}`;
    return {
      ...item,
      stateKey,
      completed: Boolean(states[stateKey]?.completed === true || states[stateKey] === true),
    };
  }).sort((a, b) => Number(a.completed) - Number(b.completed) || a.title.localeCompare(b.title, "ko"));
}

export function assessmentsForLesson(assignments = [], lesson) {
  return activeRows(assignments)
    .filter((item) => assessmentApplies(item, lesson))
    .sort((a, b) => Number(a.period || 99) - Number(b.period || 99));
}

export function lessonBundle({ lesson, classMaterials, personalMaterials, assignments, ownerUid, states } = {}) {
  return {
    lesson,
    materials: materialsForLesson({ lesson, classMaterials, personalMaterials, assignments, ownerUid, states }),
    assessments: assessmentsForLesson(assignments, lesson),
  };
}

export function mergeLessonBundles({ lessons = [], classMaterials = [], personalMaterials = [], assignments = [], ownerUid = "", states = {} } = {}) {
  return lessons.map((lesson) => lessonBundle({ lesson, classMaterials, personalMaterials, assignments, ownerUid, states }));
}

export function nextLesson(bundles = [], now = Date.now()) {
  const dated = bundles.filter((bundle) => dateClockToMs(bundle.lesson?.date, bundle.lesson?.startTime));
  const future = dated.find((bundle) => dateClockToMs(bundle.lesson.date, bundle.lesson.startTime) > now);
  if (future) return future;
  return bundles.find((bundle) => bundle.lesson?.date === kstDate(now)) || null;
}

export function isNonSchoolDay({ date, academicSchedules = [], timetable = null } = {}) {
  if (!validDate(date)) return false;
  if (Array.isArray(timetable?.periods) && timetable.periods.length) return false;
  const labels = activeRows(academicSchedules)
    .filter((item) => item.date === date)
    .flatMap((item) => [item.title, ...(Array.isArray(item.events) ? item.events : [])])
    .map((value) => cleanText(value, 100));
  return labels.some((value) => /(공휴일|휴업|방학|재량휴업|학교장재량|대체공휴일)/.test(value));
}

export function buildBriefing({ date, bundles = [], meal = null, changes = [], academicSchedules = [] } = {}) {
  const materials = [];
  const assessments = [];
  for (const bundle of bundles) {
    for (const item of bundle.materials || []) {
      if (item.completed) continue;
      materials.push({ period: bundle.lesson.period, subject: bundle.lesson.subject, title: item.title });
    }
    for (const item of bundle.assessments || []) {
      assessments.push({ period: bundle.lesson.period, subject: bundle.lesson.subject, title: cleanText(item.title, 120) });
    }
  }
  const dishes = Array.isArray(meal?.dishes)
    ? meal.dishes
    : Array.isArray(meal?.menu)
      ? meal.menu
      : String(meal?.dishesHtml || "").split(/<br\s*\/?\s*>|\n/gi).map((value) => cleanText(value.replace(/\([^)]*\)/g, ""), 60)).filter(Boolean);
  const events = activeRows(academicSchedules)
    .filter((item) => item.date === date)
    .flatMap((item) => Array.isArray(item.events) ? item.events : [item.title])
    .map((value) => cleanText(value, 100))
    .filter(Boolean);
  return {
    date,
    materials,
    assessments,
    changes: activeRows(changes).filter((item) => item.date === date),
    meal: dishes.slice(0, 7),
    academic: [...new Set(events)].slice(0, 5),
  };
}

export function briefingText(brief = {}) {
  const lines = [];
  const date = brief.date || kstDate();
  lines.push(`${date.slice(5, 7)}월 ${date.slice(8, 10)}일 · 오늘의 PinCon`);
  if (brief.materials?.length) {
    lines.push("", "준비물", ...brief.materials.slice(0, 8).map((item) => `${item.period}교시 ${item.subject} · ${item.title}`));
  }
  if (brief.assessments?.length) {
    lines.push("", "수행평가", ...brief.assessments.slice(0, 6).map((item) => `${item.period}교시 ${item.subject} · ${item.title}`));
  }
  if (brief.changes?.length) {
    lines.push("", "변경사항", ...brief.changes.slice(0, 5).map((item) => cleanText(item.summary || item.title || "수업 변경", 120)));
  }
  if (brief.meal?.length) lines.push("", "급식", brief.meal.slice(0, 5).join(" · "));
  if (brief.academic?.length) lines.push("", "오늘 일정", brief.academic.join(" · "));
  if (lines.length === 1) lines.push("", "오늘 따로 챙길 학교생활 항목은 없습니다.");
  return lines.join("\n");
}

export function materialDocumentId({ ownerUid = "", recurrence = "once", subject = "", date = "", period = 0, title = "" } = {}) {
  const raw = [ownerUid || "class", recurrence, subjectKey(subject), validDate(date) ? date : "all", lessonPeriod(period) || "all", materialIdentity({ title })].join(":");
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `mat-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function eventRoute(type, { date = "", period = 0, relatedId = "" } = {}) {
  const route = {
    [SCHOOL_LIFE_EVENT.DAILY_BRIEFING]: "today",
    [SCHOOL_LIFE_EVENT.NEXT_DAY_MATERIALS]: "today",
    [SCHOOL_LIFE_EVENT.MATERIAL_REMINDER]: "timetable",
    [SCHOOL_LIFE_EVENT.ASSESSMENT_REMINDER]: "schedule",
    [SCHOOL_LIFE_EVENT.CLASS_CHANGED]: "timetable",
    [SCHOOL_LIFE_EVENT.LOCATION_CHANGED]: "timetable",
    [SCHOOL_LIFE_EVENT.SPORTS_LOCATION_CHANGED]: "timetable",
    [SCHOOL_LIFE_EVENT.MOVING_CLASS]: "timetable",
  }[type] || "today";
  const params = new URLSearchParams();
  if (validDate(date)) params.set("lessonDate", date);
  if (lessonPeriod(period)) params.set("period", String(period));
  if (relatedId) params.set("relatedId", cleanText(relatedId, 160));
  const query = params.toString();
  return `https://pincon.app/next/${query ? `?${query}` : ""}#${route}`;
}
