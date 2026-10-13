import { subjectTheme } from "../next/assessments/coverflow.js?v=20261011-tilt1";

const escape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const DAY = 86400000;
const dateKey = ms => new Date(ms).toISOString().slice(0, 10);

export function calendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) return "";
  const ms = Date.UTC(year, month - 1, day);
  return dateKey(ms) === value ? value : "";
}

export function seoulToday(now = Date.now()) { return dateKey(Number(now) + 9 * 60 * 60 * 1000); }
export function currentCalendarMonth(now = Date.now()) { return seoulToday(now).slice(0, 7); }

function writtenDate(value, reference) {
  const text = String(value ?? "").normalize("NFKC").trim().replace(/\s*\([월화수목금토일](?:요일)?\)\s*$/, "");
  const full = text.match(/^(\d{4})\s*([-./])\s*(\d{1,2})\s*\2\s*(\d{1,2})\.?$/)
    || text.match(/^(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일$/);
  const short = text.match(/^(\d{1,2})\s*([./-])\s*(\d{1,2})\.?$/)
    || text.match(/^(\d{1,2})\s*월\s*(\d{1,2})\s*일$/);
  if (!full && !short) return "";
  const parts = full ? (full.length === 5 ? [full[1], full[3], full[4]] : full.slice(1))
    : [Number(reference.slice(0, 4)) + (Number(reference.slice(5, 7)) >= 11 && Number(short[1]) <= 2 ? 1 : 0), short[1], short.at(-1)];
  return calendarDate(parts.map((part, i) => String(Number(part)).padStart(i ? 2 : 4, "0")).join("-"));
}

// Resolve a display date without changing the stored assessment. A period or
// tentative date never becomes an invented single-day deadline.
export function assessmentDate(row, now = Date.now()) {
  if (["range", "month"].includes(row.dateType)) return "";
  const created = Number.isFinite(row.createdAtMs) && row.createdAtMs > 0 && row.createdAtMs < 8.64e15 - 9 * 3600000 ? seoulToday(row.createdAtMs) : "";
  const reference = calendarDate(row.announcedDate)
    || calendarDate(created) || seoulToday(now);
  if (String(row.dueDate ?? "").trim()) return writtenDate(row.dueDate, reference);
  if ((!row.dateType || row.dateType === "exact") && Number.isFinite(row.dueAtMs) && row.dueAtMs > 0) {
    const date = new Date(row.dueAtMs + 9 * 3600000);
    if (Number.isFinite(date.getTime())) return calendarDate(date.toISOString().slice(0, 10));
  }
  const dates = new Set();
  for (const line of `${row.title || ""}\n${row.description || ""}`.split(/[\n;；]/)) {
    const label = line.match(/(?:마감\s*(?:일|날짜|기한)?|제출\s*(?:일|기한|마감)?)\s*[:：]?\s*(.+)$/);
    if (!label) continue;
    // Read the whole labelled value: ranges, conflicting dates and words such
    // as '예정' or '미정' fail instead of silently using the first number.
    const date = writtenDate(label[1].replace(/\s*까지\s*$/, ""), reference);
    if (!date) return "";
    dates.add(date);
  }
  return dates.size === 1 ? [...dates][0] : "";
}

export function assessmentCalendarAnchor(rows, id, now = Date.now()) {
  const row = rows.find(row => row.id === id && !row.deleted && row.published !== false);
  const date = row ? assessmentDate(row, now) : "";
  return { id: row?.id || "", date, month: date ? date.slice(0, 7) : currentCalendarMonth(now) };
}

export function shiftCalendarMonth(month, delta) {
  if (!calendarDate(`${month}-01`)) return currentCalendarMonth();
  const [year, number] = month.split("-").map(Number);
  return dateKey(Date.UTC(year, number - 1 + delta, 1)).slice(0, 7);
}
export function shiftCalendarDay(day, delta) {
  return calendarDate(day) ? dateKey(Date.parse(`${day}T00:00:00Z`) + delta * DAY) : seoulToday();
}

export function assessmentCalendar(rows, month = currentCalendarMonth(), now = Date.now()) {
  if (!calendarDate(`${month}-01`)) month = currentCalendarMonth(now);
  const first = Date.parse(`${month}-01T00:00:00Z`);
  const start = first - new Date(first).getUTCDay() * DAY;
  const [year, number] = month.split("-").map(Number);
  const length = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const cells = Math.ceil((new Date(first).getUTCDay() + length) / 7) * 7;
  const byDate = new Map(), unscheduled = [];
  for (const row of rows) {
    if (row.deleted || row.published === false) continue;
    const date = assessmentDate(row, now);
    if (!date) { unscheduled.push(row); continue; }
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(row);
  }
  return {
    month, today: seoulToday(now), unscheduled,
    days: Array.from({ length: cells }, (_, i) => {
      const date = dateKey(start + i * DAY);
      return { date, number: Number(date.slice(8)), current: date.startsWith(month), rows: byDate.get(date) || [] };
    }),
  };
}

export function calendarDateLabel(date) {
  return `${Number(date.slice(5, 7))}월 ${Number(date.slice(8))}일`;
}
function tile(row, full = false, anchorId = "", now) {
  const date = assessmentDate(row, now);
  return `<button type="button" class="pc-calendar-tile pc-theme-${subjectTheme(row.subject)}${full ? " pc-calendar-tile-full" : ""}" data-assessment-id="${escape(row.id)}"${row.id === anchorId ? ' data-calendar-anchor="true"' : ""} aria-label="${escape(`${row.subject || "수행평가"} · ${row.title}${date ? " · " + calendarDateLabel(date) : ""}`)}"><span class="pc-calendar-subject">${escape(row.subject || "수행평가")}</span><strong class="pc-calendar-title">${escape(row.title)}</strong></button>`;
}

export function assessmentCalendarMarkup(rows, month, selectedDay = "", now = Date.now(), anchor = {}) {
  const model = assessmentCalendar(rows, month, now), [year, number] = model.month.split("-").map(Number);
  const anchorDate = calendarDate(anchor.date);
  const focused = selectedDay || (anchorDate.startsWith(model.month) ? anchorDate : "") || (model.today.startsWith(model.month) ? model.today : `${model.month}-01`);
  const selection = model.days.find(day => day.date === selectedDay);
  const dayTiles = day => {
    const current = day.rows.find(row => row.id === anchor.id);
    return (current ? [current, ...day.rows.filter(row => row !== current)] : day.rows).slice(0, 2).map(row => tile(row, false, anchor.id, now)).join("");
  };
  return `<section class="pc-calendar" aria-labelledby="calendar-month-title" data-month="${model.month}">
    <header class="pc-calendar-header"><h1 id="calendar-month-title"><span>${year}년</span><strong>${number}월</strong></h1><nav aria-label="달력 월 선택"><button type="button" data-calendar-month="-1" aria-label="이전 달">‹</button><button type="button" data-calendar-month="today">오늘</button><button type="button" data-calendar-month="1" aria-label="다음 달">›</button></nav></header>
    <div class="pc-calendar-weekdays" aria-hidden="true">${["일", "월", "화", "수", "목", "금", "토"].map(day => `<span>${day}</span>`).join("")}</div>
    <div class="pc-calendar-grid" role="group" aria-label="${year}년 ${number}월 수행평가 마감일">
      ${model.days.map(day => `<div class="pc-calendar-day${day.current ? "" : " is-outside"}${day.date === model.today ? " is-today" : ""}${day.date === selectedDay ? " is-selected" : ""}${day.date === anchorDate ? " is-anchor" : ""}" data-date="${day.date}">
        <button type="button" class="pc-calendar-number" data-calendar-day="${day.date}" tabindex="${day.date === focused ? 0 : -1}" aria-label="${calendarDateLabel(day.date)}, 수행평가 ${day.rows.length}개" aria-pressed="${day.date === selectedDay}"${day.date === model.today ? ' aria-current="date"' : ""}><span>${day.number}</span></button>
        <div class="pc-calendar-day-tiles">${dayTiles(day)}</div>
        ${day.rows.length > 2 ? `<button type="button" class="pc-calendar-more" data-calendar-day="${day.date}" aria-label="${calendarDateLabel(day.date)} 수행평가 ${day.rows.length}개 모두 보기">+${day.rows.length - 2}개</button>` : ""}
      </div>`).join("")}
    </div>
    ${selection ? `<section class="pc-calendar-agenda" aria-labelledby="calendar-day-title"><h2 id="calendar-day-title" tabindex="-1">${calendarDateLabel(selection.date)} <span>${selection.rows.length}개</span></h2><div class="pc-calendar-list">${selection.rows.map(row => tile(row, true, "", now)).join("") || '<p class="muted">이날 마감인 수행평가가 없습니다.</p>'}</div></section>` : ""}
    ${model.unscheduled.length ? `<section class="pc-calendar-unscheduled" aria-labelledby="calendar-unscheduled-title"><h2 id="calendar-unscheduled-title">일정 확인 필요 <span>${model.unscheduled.length}개</span></h2><div class="pc-calendar-list">${model.unscheduled.map(row => tile(row, true, anchor.id, now)).join("")}</div></section>` : ""}
    ${!rows.length ? '<p class="pc-calendar-empty">등록된 수행평가가 없습니다.</p>' : ""}
  </section>`;
}
