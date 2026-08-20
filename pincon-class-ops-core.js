export const CLASS_OPS_VERSION = "1.0.0";

export const FEEDBACK_STATUSES = Object.freeze({
  received: "접수",
  reviewing: "검토 중",
  planned: "실행 예정",
  completed: "처리 완료",
  difficult: "실행 어려움",
});

export const SUPPLY_STATUSES = Object.freeze({
  enough: "충분",
  low: "부족",
  empty: "없음",
  available: "사용 가능",
  loaned: "대여 중",
});

export const RESOURCE_CATEGORIES = Object.freeze([
  "시험범위",
  "수행평가",
  "수업자료",
  "친구 공유자료",
  "공지 프린트",
]);

export const NOTIFICATION_DEFAULTS = Object.freeze({
  assessmentTomorrow: true,
  assessmentToday: true,
  importantPreparation: true,
  timetableChange: true,
  eventStart: true,
  pollClosing: true,
  urgentAnnouncement: true,
});

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function kstDate(value = Date.now(), offsetDays = 0) {
  const input = value instanceof Date ? value.getTime() : Number(value);
  const shifted = new Date((Number.isFinite(input) ? input : Date.now()) + KST_OFFSET_MS);
  shifted.setUTCDate(shifted.getUTCDate() + offsetDays);
  return shifted.toISOString().slice(0, 10);
}

export function monthKey(value = Date.now()) {
  return kstDate(value).slice(0, 7);
}

export function dateToMs(date, endOfDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return 0;
  const suffix = endOfDay ? "T23:59:59+09:00" : "T00:00:00+09:00";
  const result = Date.parse(`${date}${suffix}`);
  return Number.isFinite(result) ? result : 0;
}

export function formatKoreanDate(date, options = {}) {
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))
    ? dateToMs(date)
    : Number(date || Date.now());
  try {
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      month: options.long ? "long" : "numeric",
      day: "numeric",
      weekday: options.weekday === false ? undefined : "short",
      year: options.year ? "numeric" : undefined,
    }).format(new Date(ms));
  } catch {
    return String(date || "");
  }
}

export function relativeDateLabel(date, now = Date.now()) {
  const target = dateToMs(date);
  const today = dateToMs(kstDate(now));
  if (!target) return "날짜 미정";
  const days = Math.round((target - today) / 86_400_000);
  if (days === 0) return "오늘";
  if (days === 1) return "내일";
  if (days === -1) return "어제";
  if (days > 1 && days <= 7) return `${days}일 뒤`;
  if (days < -1 && days >= -7) return `${Math.abs(days)}일 전`;
  return formatKoreanDate(date);
}

export function timestampMs(value) {
  if (Number.isFinite(value)) return Number(value);
  if (value?.toMillis) return value.toMillis();
  if (Number.isFinite(value?.seconds)) return value.seconds * 1000;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function plainText(value, max = 2000) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, max);
}

export function safeExternalUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text, globalThis.location?.href || "https://pincon.app/");
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

export function normalizedRecord(record = {}) {
  const result = { ...record };
  for (const key of ["createdAt", "updatedAt", "deletedAt", "publishedAt"]) {
    if (result[key] !== undefined && !result[`${key}Ms`]) result[`${key}Ms`] = timestampMs(result[key]);
  }
  return result;
}

export function academicSchedulesForGrade(rows = [], grade) {
  const gradeNumber = Number(grade);
  if (!Number.isInteger(gradeNumber) || gradeNumber < 1 || gradeNumber > 3) return rows;
  return rows.flatMap((item) => {
    const byGrade = item?.eventsByGrade;
    if (byGrade && typeof byGrade === "object") {
      const events = Array.isArray(byGrade[String(gradeNumber)]) ? byGrade[String(gradeNumber)].filter(Boolean) : [];
      return events.length ? [{ ...item, events, title: events.join(" · "), grades: [gradeNumber] }] : [];
    }
    if (Array.isArray(item?.grades) && item.grades.length && !item.grades.includes(gradeNumber)) return [];
    return [item];
  });
}

export function isOpenWindow(item = {}, now = Date.now()) {
  if (item.deleted || item.status !== "open") return false;
  const deadline = Number(item.closesAtMs || item.endsAtMs || 0);
  return !deadline || deadline >= now;
}

export function itemDate(item = {}) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(item.date || ""))) return item.date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(item.dueDate || ""))) return item.dueDate;
  if (Number.isFinite(item.dueAtMs)) return kstDate(item.dueAtMs);
  if (Number.isFinite(item.startsAtMs)) return kstDate(item.startsAtMs);
  return "";
}

export function itemPriority(item = {}, now = Date.now()) {
  if (item.deleted) return 99;
  const type = item.type || item.kind || "";
  const date = itemDate(item);
  const today = kstDate(now);
  const tomorrow = kstDate(now, 1);
  if (item.priority === "urgent" || item.urgent === true) return 0;
  if (["assessment", "exam"].includes(type) && date === today) return 1;
  if (["assessment", "exam"].includes(type) && date === tomorrow) return 2;
  if (type === "preparation" && date === today) return 3;
  if (item.pinned === true || item.priority === "important") return 4;
  if (item.source === "COMCIGAN" || item.category === "수업 변경") return 4;
  if (type === "academic" || item.source === "NEIS") return 5;
  if (type === "meal") return 7;
  if (type === "event") return 8;
  return 6;
}

export function buildTodayFeed(data = {}, now = Date.now()) {
  const today = kstDate(now);
  const tomorrow = kstDate(now, 1);
  const weekEndMs = dateToMs(kstDate(now, 7), true);
  const rows = [];

  for (const item of data.announcements || []) {
    if (item.deleted || (item.expiresAtMs && item.expiresAtMs < now)) continue;
    rows.push({ ...item, feedKind: "announcement", sourceLabel: "학급 입력" });
  }
  for (const item of data.classAssignments || data.assignments || []) {
    if (item.deleted) continue;
    const date = itemDate(item);
    if (!date || dateToMs(date) < dateToMs(today) || dateToMs(date) > weekEndMs) continue;
    rows.push({ ...item, date, feedKind: item.type || "assessment", sourceLabel: "학급 입력" });
  }
  for (const item of data.academicSchedules || []) {
    if (item.deleted || dateToMs(item.date) < dateToMs(today) || dateToMs(item.date) > weekEndMs) continue;
    rows.push({ ...item, type: "academic", feedKind: "academic", sourceLabel: item.source || "NEIS" });
  }
  for (const item of data.content || []) {
    if (item.deleted) continue;
    const isUseful = item.kind === "notice" || item.kind === "supply" || item.kind === "event";
    if (!isUseful) continue;
    const date = itemDate(item);
    if (date && (dateToMs(date) < dateToMs(today) || dateToMs(date) > weekEndMs)) continue;
    const freshness = timestampMs(item.updatedAtMs || item.createdAtMs || item.clientCreatedAt);
    if (!date && freshness && freshness < now - 14 * 86_400_000) continue;
    const mappedType = item.kind === "supply" ? "preparation" : item.kind;
    rows.push({ ...item, type: mappedType, feedKind: mappedType, sourceLabel: "기존 PinCon" });
  }
  for (const item of data.events || []) {
    const date = itemDate(item);
    if (item.deleted || item.status === "draft" || dateToMs(date) < dateToMs(today) || dateToMs(date) > weekEndMs) continue;
    rows.push({ ...item, type: "event", feedKind: "event", sourceLabel: "학급 입력" });
  }

  const timetable = (data.neisTimetables || []).find((item) => item.date === today);
  if (timetable?.periods?.length) {
    rows.push({
      id: `timetable-${today}`,
      title: "오늘 시간표",
      body: timetable.periods.map((period) => `${period.period || ""}교시 ${period.subject || ""}`).join(" · "),
      date: today,
      type: "timetable",
      feedKind: "timetable",
      source: timetable.source || "NEIS",
      sourceLabel: timetable.source || "NEIS",
    });
  }
  const meal = (data.meals || []).find((item) => item.date === today);
  if (meal) {
    rows.push({
      ...meal,
      id: meal.id || `meal-${today}`,
      title: `${meal.mealType || "중식"} 급식`,
      body: String(meal.dishesHtml || meal.body || "").replace(/<br\s*\/?\s*>/gi, " · ").replace(/<[^>]+>/g, " "),
      type: "meal",
      feedKind: "meal",
      sourceLabel: meal.source || "NEIS",
    });
  }

  const seen = new Set();
  return rows
    .filter((item) => {
      const key = `${item.feedKind}:${item.id || item.title}:${itemDate(item)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => itemPriority(a, now) - itemPriority(b, now)
      || dateToMs(itemDate(a)) - dateToMs(itemDate(b))
      || timestampMs(b.updatedAtMs || b.createdAtMs) - timestampMs(a.updatedAtMs || a.createdAtMs));
}

export function isExamPeriod(data = {}, now = Date.now()) {
  const start = dateToMs(kstDate(now));
  const end = start + 14 * 86_400_000;
  const candidates = [
    ...(data.academicSchedules || []),
    ...(data.classAssignments || data.assignments || []),
  ];
  const match = candidates
    .filter((item) => !item.deleted)
    .map((item) => ({ item, at: dateToMs(itemDate(item)) }))
    .filter(({ item, at }) => at >= start && at <= end && (/시험|고사|지필|중간|기말|모의/.test(`${item.title || ""} ${item.type || ""}`) || item.type === "exam"))
    .sort((a, b) => a.at - b.at)[0];
  if (!match) return { active: false, days: null, title: "" };
  return {
    active: true,
    days: Math.max(0, Math.round((match.at - start) / 86_400_000)),
    title: match.item.title || "시험",
    date: itemDate(match.item),
  };
}

function pushUnique(target, value) {
  const text = plainText(value, 180);
  if (text && !target.includes(text)) target.push(text);
}

export function buildPatchDraft({ month = monthKey(), feedback = [], supplies = [], events = [], announcements = [], changeLogs = [] } = {}) {
  const draft = { added: [], improved: [], fixed: [], reviewing: [], feedbackSummary: {} };
  const inMonth = (item) => {
    const date = item.date || kstDate(timestampMs(item.updatedAtMs || item.createdAtMs || Date.now()));
    return String(date).slice(0, 7) === month;
  };

  for (const item of feedback.filter(inMonth)) {
    if (item.status === "completed") pushUnique(draft.fixed, item.title);
    if (["reviewing", "planned"].includes(item.status)) pushUnique(draft.reviewing, item.title);
  }
  for (const item of supplies.filter((row) => inMonth(row) && !row.deleted)) {
    if (String(item.createdMonth || kstDate(item.createdAtMs)).slice(0, 7) === month) {
      pushUnique(draft.added, `${item.name} ${item.quantity ?? ""}${item.unit || ""} 추가`);
    }
  }
  for (const item of events.filter((row) => inMonth(row) && !row.deleted)) pushUnique(draft.added, `${item.title} 행사 운영`);
  for (const item of announcements.filter((row) => inMonth(row) && !row.deleted && row.category === "운영 변경")) pushUnique(draft.improved, item.title);
  for (const log of changeLogs.filter(inMonth)) {
    const after = log.after || {};
    if (log.collection === "supplies" && log.action === "create") pushUnique(draft.added, `${after.name || "공용 물품"} 추가`);
    if (log.collection === "classSettings") pushUnique(draft.improved, after.summary || log.label || "학급 운영 방식 개선");
    if (log.action === "restore") pushUnique(draft.fixed, log.label || "잘못 변경된 항목 복구");
  }

  const visibleFeedback = feedback.filter((item) => inMonth(item) && !item.deleted);
  draft.feedbackSummary = {
    total: visibleFeedback.length,
    completed: visibleFeedback.filter((item) => item.status === "completed").length,
    reviewing: visibleFeedback.filter((item) => ["reviewing", "planned"].includes(item.status)).length,
    difficult: visibleFeedback.filter((item) => item.status === "difficult").length,
  };
  return draft;
}

export function nextPatchVersion(patchNotes = []) {
  const latest = [...patchNotes]
    .filter((item) => !item.deleted && /^v\d+\.\d+$/.test(String(item.version || "")))
    .sort((a, b) => String(b.month || "").localeCompare(String(a.month || "")))[0];
  if (!latest) return "v1.0";
  const [, major, minor] = String(latest.version).match(/^v(\d+)\.(\d+)$/) || [];
  return major === undefined ? "v1.0" : `v${Number(major)}.${Number(minor) + 1}`;
}

export function aggregateAnswers(responses = [], max = 12) {
  const counts = new Map();
  for (const response of responses) {
    const raw = Array.isArray(response.answers) ? response.answers : [response.answer];
    for (const answer of raw) {
      const label = plainText(answer, 80).replace(/\s+/g, " ");
      if (!label) continue;
      const key = label.toLocaleLowerCase("ko-KR");
      const entry = counts.get(key) || { label, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ko")).slice(0, max);
}

export function searchAll(data = {}, queryText = "") {
  const query = plainText(queryText, 80).toLocaleLowerCase("ko-KR");
  if (!query) return [];
  const collections = [
    ["공지", data.announcements],
    ["수행평가", data.classAssignments || data.assignments],
    ["행사", data.events],
    ["투표", data.polls],
    ["건의", data.feedback],
    ["패치노트", data.patchNotes],
    ["자료", data.resources],
    ["공용품", data.supplies],
    ["기존 PinCon", data.content],
  ];
  const rows = [];
  for (const [group, items] of collections) {
    for (const item of items || []) {
      if (item.deleted || (item.status === "draft" && !item.__canReadDraft)) continue;
      const haystack = [
        item.title, item.name, item.subject, item.body, item.description, item.question,
        item.category, item.officialReply, item.month,
        ...(item.options || []), ...(item.added || []), ...(item.improved || []),
        ...(item.fixed || []), ...(item.reviewing || []),
      ]
        .filter(Boolean).join(" ").toLocaleLowerCase("ko-KR");
      if (!haystack.includes(query)) continue;
      const starts = haystack.startsWith(query) || String(item.title || item.name || "").toLocaleLowerCase("ko-KR").startsWith(query);
      rows.push({ ...item, searchGroup: group, searchScore: starts ? 0 : 1 });
    }
  }
  return rows.sort((a, b) => a.searchScore - b.searchScore || timestampMs(b.updatedAtMs || b.createdAtMs) - timestampMs(a.updatedAtMs || a.createdAtMs)).slice(0, 60);
}

export function buildNotificationDigest(data = {}, preferences = NOTIFICATION_DEFAULTS, now = Date.now()) {
  const today = kstDate(now);
  const tomorrow = kstDate(now, 1);
  const lines = [];
  for (const item of data.classAssignments || data.assignments || []) {
    if (item.deleted) continue;
    const date = itemDate(item);
    if (["assessment", "exam"].includes(item.type) && date === today && preferences.assessmentToday) pushUnique(lines, `오늘 ${item.subject ? `${item.subject} ` : ""}${item.title}`);
    if (["assessment", "exam"].includes(item.type) && date === tomorrow && preferences.assessmentTomorrow) pushUnique(lines, `내일 ${item.subject ? `${item.subject} ` : ""}${item.title}`);
    if (item.type === "preparation" && [today, tomorrow].includes(date) && item.important && preferences.importantPreparation) pushUnique(lines, `${date === today ? "오늘" : "내일"} 준비물: ${item.title}`);
  }
  for (const item of data.announcements || []) {
    if (!item.deleted && item.priority === "urgent" && preferences.urgentAnnouncement) pushUnique(lines, `긴급: ${item.title}`);
  }
  return lines.slice(0, 5);
}
