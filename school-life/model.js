import { academicSchedulesForGrade, kstDate, plainText, timestampMs } from "../pincon-class-ops-core.js";
import { assessmentDate, calendarDate, shiftCalendarDay } from "../new/calendar.js?v=20261013-grid1";

const dayMs = 86_400_000;
const seoulOffset = 9 * 60 * 60 * 1000;
const clockPattern = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export const ALLERGENS = Object.freeze({
  1: "난류", 2: "우유", 3: "메밀", 4: "땅콩", 5: "대두", 6: "밀", 7: "고등어",
  8: "게", 9: "새우", 10: "돼지고기", 11: "복숭아", 12: "토마토", 13: "아황산류",
  14: "호두", 15: "닭고기", 16: "쇠고기", 17: "오징어", 18: "조개류", 19: "잣",
});

export function schoolWeek(date) {
  const weekday = new Date(date + "T00:00:00Z").getUTCDay();
  const start = shiftCalendarDay(date, -((weekday + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => shiftCalendarDay(start, index));
}

export function deadlineLabel(date, today) {
  const days = (Date.parse(date) - Date.parse(today)) / dayMs;
  return days === 0 ? "D-Day" : `D-${days}`;
}

function isVisible(item, classKey) {
  return !item.deleted && !item.__private && item.published !== false && (!item.classKey || item.classKey === classKey);
}

export function upcomingAssessments(rows, classKey, today, now) {
  return rows
    .filter(row => isVisible(row, classKey) && (!row.type || row.type === "assessment"))
    .map(row => ({ ...row, date: assessmentDate(row, now) }))
    .filter(row => row.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function importantNotices(data, classKey) {
  const legacy = (data.content || []).filter(row => row.kind === "notice" && row.targets?.includes(classKey));
  const priority = row => row.priority === "urgent" || row.urgent === true ? 2 : 1;
  const date = row => timestampMs(row.updatedAtMs || row.publishedAtMs || row.createdAtMs || row.clientCreatedAt);
  return [...(data.announcements || []), ...legacy]
    .filter(row => isVisible(row, classKey) && row.status !== "draft" && !String(row.body || "").startsWith("[PINCON_BANNER]"))
    .filter(row => row.important || row.pinned || row.urgent || ["important", "urgent"].includes(row.priority))
    .sort((a, b) => priority(b) - priority(a) || date(b) - date(a));
}

export function classEvents(rows, classKey) {
  return rows
    .filter(row => isVisible(row, classKey) && row.status !== "draft")
    .map(row => ({
      ...row,
      date: calendarDate(row.date) || (Number.isFinite(row.startsAtMs) && row.startsAtMs > 0 ? kstDate(row.startsAtMs) : ""),
      category: row.scheduleOnly || row.important ? "중요 일정" : "학급 행사",
      body: row.description || row.question || row.body,
    }));
}

export function academicEvents(rows, grade) {
  return academicSchedulesForGrade(rows, grade).flatMap(row => {
    const date = calendarDate(row.date);
    if (!date || row.deleted) return [];
    const titles = Array.isArray(row.events) && row.events.length ? row.events : [row.title || row.eventName];
    return titles.filter(Boolean).map(title => ({ date, category: "학사 일정", title, body: row.description }));
  });
}

export function dailyMeals(rows, date) {
  return rows
    .filter(row => !row.deleted && row.date === date)
    .map(row => ({ ...row, dishes: parseDishes(row.dishesHtml || row.menu || row.dishes) }))
    .filter(row => row.dishes.length);
}

export function parseDishes(raw) {
  const lines = Array.isArray(raw) ? raw : plainText(raw, 8000).replace(/<br\s*\/?>/gi, "\n").split("\n");
  return lines.map(line => {
    const text = plainText(line, 300).replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").trim();
    const codes = [...text.matchAll(/\((\d{1,2}(?:\s*\.\s*\d{1,2})*\.?)\)/g)]
      .flatMap(([, group]) => group.split(".").filter(Boolean).map(Number)).filter(code => ALLERGENS[code]);
    const name = text.replace(/\((\d{1,2}(?:\s*\.\s*\d{1,2})*\.?)\)/g, (group, numbers) =>
      numbers.split(".").filter(Boolean).every(code => ALLERGENS[Number(code)]) ? "" : group).trim();
    return { name, codes: [...new Set(codes)] };
  }).filter(dish => dish.name);
}

function minutes(value) {
  const match = clockPattern.exec(String(value || "").trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
}

export function dailyTimetable(rows, date, classKey) {
  const row = rows.find(row => !row.deleted && row.date === date && (!row.classKey || row.classKey === classKey));
  const periods = (Array.isArray(row?.periods) ? row.periods : [])
    .filter(period => period?.subject && Number.isInteger(Number(period.period)) && Number(period.period) > 0)
    .sort((a, b) => Number(a.period) - Number(b.period));
  return { row, periods };
}

export function lessonTiming(periods, date, now = Date.now()) {
  if (date !== kstDate(now) || !periods.length) return null;
  const elapsed = new Date(now + seoulOffset);
  const minute = elapsed.getUTCHours() * 60 + elapsed.getUTCMinutes();
  const slots = periods.map(period => ({
    period, start: minutes(period.startTime || period.startsAt), end: minutes(period.endTime || period.endsAt),
  }));
  if (slots.some(({ start, end }, index) => !(start < end) || (index > 0 && start < slots[index - 1].end))) {
    return { available: false };
  }
  return {
    available: true,
    current: slots.find(slot => slot.start <= minute && minute < slot.end)?.period || null,
    next: slots.find(slot => minute < slot.start)?.period || null,
  };
}
