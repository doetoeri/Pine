const DAY_MS = 86_400_000;
const MAX_PRIMARY = 4;
const MAX_UPCOMING = 4;
const MAX_CHECKLIST = 4;

function clean(value, max = 500) {
  return String(value ?? "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim()
    .slice(0, max);
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(dateString, amount) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return localDateKey(date);
}

function dateFromValue(value) {
  if (!value) return "";
  if (typeof value?.toMillis === "function") return localDateKey(new Date(value.toMillis()));
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 10_000_000_000) return localDateKey(new Date(numeric));
  const direct = clean(value, 32).match(/^\d{4}-\d{2}-\d{2}/);
  if (direct) return direct[0];
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? localDateKey(new Date(parsed)) : "";
}

function itemDate(item = {}) {
  return dateFromValue(
    item.dueDate
    || item.date
    || item.startsOn
    || item.startDate
    || item.dueAt
    || item.dueAtMs
    || item.startsAtMs
  );
}

function timestamp(item = {}) {
  for (const value of [item.updatedAtMs, item.createdAtMs, item.publishedAtMs, item.clientCreatedAt]) {
    if (typeof value?.toMillis === "function") return value.toMillis();
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

function activeRows(data, name) {
  const rows = data?.[name];
  return Array.isArray(rows)
    ? rows.filter((item) => item && item.deleted !== true && item.status !== "archived" && item.published !== false)
    : [];
}

function timeText(item = {}) {
  const direct = [item.dueTime, item.time, item.startTime]
    .map((value) => clean(value, 16))
    .find((value) => /^\d{1,2}:\d{2}$/.test(value));
  if (direct) return direct.padStart(5, "0");
  const numeric = Number(item.dueAtMs || item.startsAtMs || 0);
  if (numeric > 10_000_000_000) {
    return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false })
      .format(new Date(numeric));
  }
  return "";
}

function dateDistance(dateString, today) {
  if (!dateString) return { days: 99, label: "" };
  const base = new Date(`${today}T12:00:00`);
  const target = new Date(`${dateString}T12:00:00`);
  const days = Math.round((target - base) / DAY_MS);
  if (days === 0) return { days, label: "오늘" };
  if (days === 1) return { days, label: "내일" };
  if (days > 1 && days <= 6) return { days, label: `D-${days}` };
  if (days < 0) return { days, label: "" };
  const label = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" })
    .format(target)
    .replace(/\s/g, "");
  return { days, label };
}

function kindMeta(kind) {
  if (kind === "assignment") return { label: "수행·숙제", icon: "task" };
  if (kind === "event") return { label: "행사", icon: "event" };
  if (kind === "academic") return { label: "학사", icon: "school" };
  return { label: "공지", icon: "campaign" };
}

function normalizeTask(item, kind, today) {
  const date = itemDate(item);
  const distance = dateDistance(date, today);
  const time = timeText(item);
  const priority = clean(item.priority, 20).toLowerCase();
  const title = clean(item.title || item.name || item.subject || item.body || "일정", 180);
  const important = item.important === true || ["urgent", "important", "high"].includes(priority);
  const meta = kindMeta(kind);
  return {
    id: clean(item.id || `${kind}-${title}-${date}`, 220),
    title,
    date,
    time,
    days: distance.days,
    dateLabel: [distance.label, time].filter(Boolean).join(" "),
    kind,
    kindLabel: meta.label,
    important,
    sourceTime: timestamp(item),
    materials: clean(item.materials || item.preparation || item.supplies || "", 220),
  };
}

function collectTasks(data, today) {
  const horizon = addDays(today, 7);
  const scheduled = [
    ...activeRows(data, "classAssignments").map((item) => normalizeTask(item, "assignment", today)),
    ...activeRows(data, "events").map((item) => normalizeTask(item, "event", today)),
    ...activeRows(data, "academicSchedules").map((item) => normalizeTask(item, "academic", today)),
  ].filter((item) => item.date && item.date >= today && item.date <= horizon);

  const notices = [
    ...activeRows(data, "announcements"),
    ...activeRows(data, "content").filter((item) => item.kind === "notice"),
  ]
    .filter((item) => item.important === true || ["urgent", "important", "high"].includes(clean(item.priority, 20).toLowerCase()))
    .map((item) => normalizeTask(item, "notice", today));

  const deduped = new Map();
  [...scheduled, ...notices].forEach((item) => {
    const key = `${item.kind}|${item.title}|${item.date}|${item.time}`;
    if (!deduped.has(key)) deduped.set(key, item);
  });

  return [...deduped.values()].sort((a, b) => {
    if (a.important !== b.important) return a.important ? -1 : 1;
    if (a.days !== b.days) return a.days - b.days;
    if (a.time !== b.time) return (a.time || "99:99").localeCompare(b.time || "99:99");
    return b.sourceTime - a.sourceTime;
  });
}

function collectChecklist(data, tasks) {
  const values = [];
  const push = (value) => {
    const text = clean(value, 180);
    if (text && !values.includes(text)) values.push(text);
  };

  tasks.forEach((item) => {
    if (item.materials) push(item.materials);
    if (/준비물|가져오기|지참|노트|교과서|준비|제출|채워오기|알아오기/i.test(item.title)) push(item.title);
  });

  activeRows(data, "classAssignments").forEach((item) => {
    if (itemDate(item) && itemDate(item) > addDays(localDateKey(), 2)) return;
    push(item.materials || item.preparation || item.supplies || "");
  });
  return values.slice(0, MAX_CHECKLIST);
}

function timetableFor(data, date) {
  const document = activeRows(data, "neisTimetables").find((item) => item.date === date) || null;
  const periods = Array.isArray(document?.periods) ? document.periods : [];
  return {
    source: clean(document?.source || "컴시간", 40),
    periods: periods.map((item, index) => ({
      period: Number(item.period || index + 1),
      subject: clean(item.subject || "수업", 80),
      teacher: clean(item.teacher || item.teacherName || "", 80),
      room: clean(item.room || item.classroom || "", 80),
      startTime: clean(item.startTime || "", 16),
      endTime: clean(item.endTime || "", 16),
      changed: item.changed === true || Boolean(item.changeSummary || item.changeStatus),
    })).slice(0, 8),
  };
}

function decodeHtmlText(value) {
  if (typeof document === "undefined") return clean(value, 2000);
  const node = document.createElement("div");
  node.innerHTML = String(value || "").replace(/<br\s*\/?\s*>/gi, "\n");
  return (node.textContent || "").replace(/\u00a0/g, " ");
}

function mealFor(data, today) {
  const meal = activeRows(data, "meals").find((item) => item.date === today) || null;
  if (!meal) return { items: [], rating: 0, calories: "", allergy: "" };
  const raw = decodeHtmlText(meal.dishesHtml || meal.menu || meal.dishes || "");
  const items = raw
    .split(/\n|[·•]/)
    .map((value) => value.replace(/\([0-9.,\s]+\)/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 8);
  const rating = Math.max(0, Math.min(5, Number(meal.rating || meal.score || 0) || 0));
  const calories = clean(meal.calories || meal.calorie || meal.kcal || meal.calInfo || "", 80);
  const allergy = clean(meal.allergy || meal.allergens || meal.allergyInfo || "", 140);
  return { items, rating, calories, allergy };
}

function classLabel(profile) {
  if (!profile) return "PinCon";
  const grade = Number(profile.grade || 0);
  const classNumber = Number(profile.classNumber || 0);
  return grade && classNumber ? `${grade}학년 ${classNumber}반 · PinCon` : "PinCon";
}

export function buildDailyBriefData(snapshot, options = {}) {
  const data = snapshot?.data || Object.create(null);
  const today = options.date || localDateKey();
  const allTasks = collectTasks(data, today);
  const primary = allTasks.slice(0, MAX_PRIMARY);
  const upcoming = allTasks.filter((item) => item.days > 0).slice(0, MAX_UPCOMING);
  const timetable = timetableFor(data, today);
  const tomorrow = timetableFor(data, addDays(today, 1));
  const meal = mealFor(data, today);
  const checklist = collectChecklist(data, primary);
  const profile = snapshot?.profile || null;
  const displayDate = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${today}T12:00:00`));

  const lastPeriod = timetable.periods.at(-1) || null;
  return {
    today,
    displayDate,
    classLabel: classLabel(profile),
    profile,
    primary,
    upcoming,
    checklist,
    timetable,
    tomorrow: tomorrow.periods.slice(0, 3),
    meal,
    daySummary: {
      periodCount: timetable.periods.length,
      lastPeriod: lastPeriod?.period || 0,
      finishTime: lastPeriod?.endTime || "",
      changedCount: timetable.periods.filter((item) => item.changed).length,
    },
  };
}

export { localDateKey, addDays, clean };
