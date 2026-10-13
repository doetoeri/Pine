import { assessmentDate, calendarDate, seoulToday, shiftCalendarDay } from "./calendar.js?v=20261013-grid1";

export const noticeDay = seoulToday;
export function noticeDateLabel(day) {
  if (!calendarDate(day)) return "날짜 미정";
  const weekday = new Intl.DateTimeFormat("ko-KR", { weekday: "short", timeZone: "Asia/Seoul" }).format(new Date(`${day}T12:00:00+09:00`));
  return `${Number(day.slice(5, 7))}.${Number(day.slice(8))} (${weekday})`;
}

// A class notice never depends on an individual student's completion state.
export function noticeModel(snapshot, options = {}, now = Date.now()) {
  const day = calendarDate(options.day) || seoulToday(now);
  const tomorrow = shiftCalendarDay(day, 1);
  const horizon = [1, 7, 14].includes(Number(options.horizon)) ? Number(options.horizon) : 7;
  const end = shiftCalendarDay(day, horizon);
  const candidates = (snapshot.data?.classAssignments || [])
    .filter(row => !row.deleted && row.published !== false && (!row.type || row.type === "assessment") && (!row.classKey || row.classKey === snapshot.profile?.classKey))
    .map(row => {
      const date = assessmentDate(row, now);
      const tentative = /미확정|미정|예정|추후/.test(`${row.title || ""} ${row.dueDate || ""}`) || ["range", "month", "undecided"].includes(row.dateType);
      const days = date ? Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86400000) : null;
      return { id: row.id, subject: String(row.subject || "수행평가"), title: String(row.title || "제목 없음"), materials: String(row.materials || ""), date, tentative,
        group: !date ? "날짜 확인 필요" : date === tomorrow ? "내일" : "다가오는 수행",
        dateLabel: date ? `${noticeDateLabel(date)}${tentative ? " · 예정" : ""}` : "날짜 확인 필요",
        dueLabel: !date || tentative ? "일정 확인" : days === 1 ? "내일" : `D−${days}`,
        verified: Boolean(row.confirmed || row.verificationStatus === "verified") };
    })
    .filter(row => row.date ? row.date >= tomorrow && row.date <= end : options.includeUndated === true)
    .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || a.subject.localeCompare(b.subject, "ko") || a.title.localeCompare(b.title, "ko"));
  const selected = options.selectedIds == null ? null : new Set(options.selectedIds);
  const rows = selected ? candidates.filter(row => selected.has(row.id)) : candidates;
  const profile = snapshot.profile || {};
  const classLabel = profile.grade && profile.classNumber ? `${profile.grade}학년 ${profile.classNumber}반` : String(profile.classKey || "학급");
  const pending = !snapshot.ready && !snapshot.usingCache && !candidates.length;
  return { day, tomorrow, end, horizon, classKey: profile.classKey || "", classLabel, candidates, rows, pending,
    cached: Boolean(snapshot.usingCache || snapshot.error || snapshot.online === false),
    cacheSavedAtMs: Number(snapshot.cacheSavedAtMs || 0), generatedAtMs: now,
    includeMaterials: options.includeMaterials !== false,
    message: String(options.message || "").replace(/\s+/g, " ").trim().slice(0, 80),
    emptyText: `선택한 수행 ${rows.length}개 · ${noticeDateLabel(tomorrow)}부터 ${noticeDateLabel(end)}까지`,
    filename: `PinCon_${profile.classKey || "class"}_수행공지_${day}` };
}
