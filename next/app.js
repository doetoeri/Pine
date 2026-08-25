import { NextDataGateway, readClassProfile, saveClassProfile } from "./core/data-gateway.js";
import { buildNotificationFeed } from "./core/notification-store.js";

await import("../material-official-loader.js");
await globalThis.PINCON_MATERIAL_READY;

const app = document.querySelector("#app");
const gateway = new NextDataGateway();

const ROUTES = Object.freeze([
  { id: "today", label: "오늘", icon: "today" },
  { id: "timetable", label: "시간표", icon: "calendar_view_week" },
  { id: "schedule", label: "일정", icon: "event" },
  { id: "classroom", label: "학급", icon: "groups" },
  { id: "more", label: "더보기", icon: "more_horiz" },
]);

const SUBJECT_NAMES = Object.freeze({
  공영: "공통영어",
  공수: "공통수학",
  공국: "공통국어",
  통사: "통합사회",
  통과: "통합과학",
});

const ALLERGENS = Object.freeze({
  1: "난류", 2: "우유", 3: "메밀", 4: "땅콩", 5: "대두", 6: "밀", 7: "고등어",
  8: "게", 9: "새우", 10: "돼지고기", 11: "복숭아", 12: "토마토", 13: "아황산류",
  14: "호두", 15: "닭고기", 16: "쇠고기", 17: "오징어", 18: "조개류", 19: "잣",
});

const initialLocation = locationState();
const state = {
  route: initialLocation.route,
  detailKey: initialLocation.detailKey,
  detailNotificationId: history.state?.notificationId || "",
  data: gateway.snapshot(),
  timetableDate: localIsoDate(new Date()),
  scheduleFilter: "all",
  problemAttempts: new Map(),
};

const detailRegistry = new Map();
const externalDetailRegistry = new Map();
let lastDetailTrigger = null;
let lastDetailTriggerKey = "";
let detailPointer = null;
let renderTimer = 0;

function locationState() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [routePart = "", query = ""] = raw.split("?");
  const route = ROUTES.some((item) => item.id === routePart) ? routePart : "today";
  const detailKey = new URLSearchParams(query).get("detail") || "";
  return { route, detailKey };
}

function routeHash(route, detailKey = "") {
  return `#${route}${detailKey ? `?detail=${encodeURIComponent(detailKey)}` : ""}`;
}

function localIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(dateString, amount) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return localIsoDate(date);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cleanText(value) {
  const node = document.createElement("div");
  node.innerHTML = String(value || "").replace(/<br\s*\/?\s*>/gi, "\n");
  return (node.textContent || "").replace(/\s*\n\s*/g, " · ").replace(/\s+/g, " ").trim();
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ""), location.href);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function timestampMs(value) {
  if (Number.isFinite(Number(value)) && Number(value) > 0) return Number(value);
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (Number.isFinite(Number(value?.seconds))) return Number(value.seconds) * 1000;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstTimestamp(item = {}, keys = []) {
  for (const key of keys) {
    const value = timestampMs(item[key]);
    if (value) return value;
  }
  return 0;
}

function formatDateTime(value) {
  const time = timestampMs(value);
  if (!time) return "아직 확인되지 않음";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(time));
}

function dateLabel(dateString, options = {}) {
  if (!dateString) return "날짜 미정";
  const date = new Date(`${dateString}T12:00:00`);
  if (Number.isNaN(date.getTime())) return String(dateString);
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: options.weekday === false ? undefined : "long",
  }).format(date);
}

function timeDistance(dateString) {
  if (!dateString) return "날짜 미정";
  const today = new Date(`${localIsoDate(new Date())}T12:00:00`);
  const target = new Date(`${dateString}T12:00:00`);
  if (Number.isNaN(target.getTime())) return "날짜 미정";
  const days = Math.round((target - today) / 86_400_000);
  if (days === 0) return "오늘";
  if (days === 1) return "내일";
  if (days > 1) return `D-${days}`;
  return `D+${Math.abs(days)}`;
}

function itemDate(item = {}) {
  const raw = item.dueDate || item.date || item.startsOn || item.startDate || item.dueAt || "";
  const match = String(raw).match(/^\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  const time = Number(item.dueAtMs || item.startsAtMs || 0);
  return time ? localIsoDate(new Date(time)) : "";
}

function summaryDate(item = {}) {
  const direct = itemDate(item);
  if (direct) return direct;
  const time = firstTimestamp(item, ["updatedAtMs", "createdAtMs", "publishedAtMs", "clientCreatedAt"]);
  return time ? localIsoDate(new Date(time)) : "";
}

function itemTitle(item, fallback = "제목 없음") {
  return cleanText(item?.title || item?.name || item?.subject || item?.body || fallback);
}

function collections() {
  return state.data.data || Object.create(null);
}

function fullSubjectName(value) {
  const subject = cleanText(value);
  return SUBJECT_NAMES[subject] || subject || "과목 미정";
}

function sourceLabel(value) {
  const source = String(value || "").toUpperCase();
  if (source === "COMCIGAN" || source === "컴시간") return "컴시간";
  if (source === "NEIS" || source === "나이스") return "NEIS";
  return cleanText(value) || "반에서 정리";
}

function assignmentCategory(item = {}) {
  const type = String(item.type || "").toLowerCase();
  if (type === "exam" || /중간|기말|시험\s*범위/.test(itemTitle(item))) return "시험 범위";
  if (type === "preparation" || /숙제|과제|준비물/.test(itemTitle(item))) return "숙제";
  return "수행평가";
}

function statusInfo(item = {}) {
  const raw = String(item.verificationStatus || item.confirmationStatus || item.status || "").toLowerCase();
  if (item.changed === true || ["changed", "updated", "modified"].includes(raw)) {
    return { label: "변경됨", icon: "update", tone: "changed" };
  }
  if (item.confirmed === true || ["confirmed", "verified", "approved", "published", "open", "active"].includes(raw)) {
    return { label: "확정", icon: "check_circle", tone: "confirmed" };
  }
  return { label: "확인 중", icon: "help", tone: "checking" };
}

function originInfo(item = {}, context = {}) {
  const raw = String(item.source || item.sourceType || context.source || "").toUpperCase();
  const official = item.official === true || ["NEIS", "COMCIGAN", "SCHOOL", "OFFICIAL"].includes(raw)
    || ["academicSchedules", "neisTimetables", "meals"].includes(context.collection)
    || Boolean(item.planUrl || item.evaluationPlanUrl || item.originalUrl);
  return official
    ? { label: "학교 공식 자료", icon: "verified", tone: "official" }
    : { label: "반에서 정리", icon: "groups", tone: "class" };
}

function collectionStatus(name) {
  const explicit = state.data.collectionStatus?.[name];
  if (explicit) return explicit;
  if (state.data.error && !state.data.ready) return "error";
  return state.data.ready ? "success" : "loading";
}

function collectionLoading(names) {
  return names.some((name) => ["idle", "loading"].includes(collectionStatus(name)));
}

function collectionFailed(names) {
  return names.length > 0 && names.every((name) => collectionStatus(name) === "error");
}

function skeletonMarkup(count = 3, label = "불러오는 중") {
  return `<div class="skeleton-list" role="status" aria-label="${escapeHtml(label)}">
    ${Array.from({ length: count }, () => `<div class="skeleton-row"><span></span><span></span></div>`).join("")}
  </div>`;
}

function emptyMarkup(icon, title, support) {
  return `<div class="empty">
    <md-icon>${icon}</md-icon>
    <strong>${escapeHtml(title)}</strong>
    <span>${escapeHtml(support)}</span>
  </div>`;
}

function errorMarkup(title = "정보를 불러오지 못했습니다") {
  return `<div class="data-error" role="alert">
    <md-icon>cloud_off</md-icon>
    <div><strong>${escapeHtml(title)}</strong><span>네트워크 상태를 확인한 뒤 다시 시도해 주세요.</span></div>
    <md-filled-tonal-button data-action="retry-data">다시 시도</md-filled-tonal-button>
  </div>`;
}

function hashText(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function detailKeyForReference(kind, collection, id) {
  return `${kind}:${collection}:${encodeURIComponent(String(id || ""))}`;
}

function registerDetail(kind, item, context = {}, external = false) {
  if (!item) return "";
  const collection = context.collection || kind;
  const id = item.id || context.id || hashText([
    collection,
    itemDate(item),
    itemTitle(item),
    context.date,
    context.period,
  ].join("|"));
  const key = detailKeyForReference(kind, collection, id);
  const record = { kind, item, context: { ...context, collection }, key };
  detailRegistry.set(key, record);
  if (external) externalDetailRegistry.set(key, record);
  if (state.detailKey === key) requestAnimationFrame(() => renderDetailSurface({ focus: false, swap: true }));
  return key;
}

function prepareDetailRegistry() {
  detailRegistry.clear();
  for (const [key, value] of externalDetailRegistry) detailRegistry.set(key, value);

  (collections().announcements || []).filter((item) => !item.deleted)
    .forEach((item) => registerDetail("announcement", item, { collection: "announcements", route: "today" }));
  (collections().content || []).filter((item) => !item.deleted && item.kind === "notice")
    .forEach((item) => registerDetail("announcement", item, {
      collection: "content",
      route: item.category === "수업 변경" ? "timetable" : "today",
    }));
  (collections().classAssignments || []).filter((item) => !item.deleted)
    .forEach((item) => registerDetail("assignment", item, { collection: "classAssignments", route: "schedule" }));
  (collections().events || []).filter((item) => !item.deleted && item.status !== "draft")
    .forEach((item) => registerDetail("event", item, { collection: "events", route: "classroom" }));
  (collections().academicSchedules || []).filter((item) => !item.deleted)
    .forEach((item) => registerDetail("academic", item, { collection: "academicSchedules", route: "schedule" }));
  (collections().resources || []).filter((item) => !item.deleted)
    .forEach((item) => registerDetail("resource", item, { collection: "resources", route: "classroom" }));
  (collections().lostItems || []).filter((item) => !item.deleted)
    .forEach((item) => registerDetail("lost", item, { collection: "lostItems", route: "classroom" }));
  (collections().meals || []).filter((item) => !item.deleted)
    .forEach((item) => registerDetail("meal", item, { collection: "meals", route: "today" }));
  (collections().neisTimetables || []).forEach((document) => {
    (document.periods || []).forEach((period, index) => registerDetail("lesson", period, {
      collection: "neisTimetables",
      id: `${document.id || document.date || "day"}-${period.period || index + 1}`,
      route: "timetable",
      document,
      date: document.date,
      period: period.period || index + 1,
    }));
  });
}

function timetableDocument(date = state.timetableDate) {
  return (collections().neisTimetables || []).find((item) => item.date === date) || null;
}

function periodsFor(date = state.timetableDate) {
  return Array.isArray(timetableDocument(date)?.periods) ? timetableDocument(date).periods : [];
}

function mealFor(date = localIsoDate(new Date())) {
  return (collections().meals || []).find((item) => item.date === date) || null;
}

function allNotices() {
  const announcementRows = (collections().announcements || []).map((item) => ({ ...item, __collection: "announcements" }));
  const contentRows = (collections().content || [])
    .filter((item) => item.kind === "notice")
    .map((item) => ({ ...item, __collection: "content" }));
  return [...announcementRows, ...contentRows]
    .filter((item) => !item.deleted)
    .sort((a, b) => firstTimestamp(b, ["updatedAtMs", "createdAtMs", "clientCreatedAt"])
      - firstTimestamp(a, ["updatedAtMs", "createdAtMs", "clientCreatedAt"]));
}

function announcements(limit = 5) {
  return allNotices().slice(0, limit);
}

function timetableChanges(limit = 8) {
  return (collections().content || [])
    .filter((item) => !item.deleted && item.kind === "notice" && item.category === "수업 변경")
    .sort((a, b) => firstTimestamp(b, ["updatedAtMs", "createdAtMs", "clientCreatedAt"])
      - firstTimestamp(a, ["updatedAtMs", "createdAtMs", "clientCreatedAt"]))
    .slice(0, limit);
}

function scheduleItems() {
  const rows = [];
  for (const item of collections().classAssignments || []) {
    if (item.deleted) continue;
    rows.push({
      category: assignmentCategory(item),
      filter: "work",
      title: itemTitle(item),
      date: itemDate(item),
      subject: fullSubjectName(item.subject),
      detailKey: registerDetail("assignment", item, { collection: "classAssignments", route: "schedule" }),
      source: item,
    });
  }
  for (const item of collections().events || []) {
    if (item.deleted || item.status === "draft") continue;
    rows.push({
      category: "학급 행사",
      filter: "event",
      title: itemTitle(item),
      date: itemDate(item),
      subject: cleanText(item.location),
      detailKey: registerDetail("event", item, { collection: "events", route: "classroom" }),
      source: item,
    });
  }
  for (const item of collections().academicSchedules || []) {
    if (item.deleted) continue;
    rows.push({
      category: "학사일정",
      filter: "academic",
      title: itemTitle(item),
      date: itemDate(item),
      subject: "",
      detailKey: registerDetail("academic", item, { collection: "academicSchedules", route: "schedule" }),
      source: item,
    });
  }
  const priority = { 수행평가: 0, "시험 범위": 1, 숙제: 2, "학급 행사": 3, 학사일정: 4 };
  return rows.sort((a, b) => {
    const recurringA = /토요휴업일/.test(a.title) ? 1 : 0;
    const recurringB = /토요휴업일/.test(b.title) ? 1 : 0;
    return recurringA - recurringB
      || (a.date || "9999-99-99").localeCompare(b.date || "9999-99-99")
      || (priority[a.category] ?? 9) - (priority[b.category] ?? 9);
  });
}

function upcomingSchedule(limit = 6, filter = "all") {
  const today = localIsoDate(new Date());
  return scheduleItems()
    .filter((item) => !item.date || item.date >= today)
    .filter((item) => filter === "all" || item.filter === filter)
    .slice(0, limit);
}

function statusChipMarkup(item) {
  const status = statusInfo(item);
  return `<span class="status-chip status-chip--${status.tone}"><md-icon>${status.icon}</md-icon>${status.label}</span>`;
}

function originChipMarkup(item, context) {
  const origin = originInfo(item, context);
  return `<span class="origin-chip origin-chip--${origin.tone}"><md-icon>${origin.icon}</md-icon>${origin.label}</span>`;
}

function interactiveListItem({
  key,
  title,
  supporting = "",
  leading = "",
  date = "",
  status = "",
  route = "",
  className = "",
  ariaLabel = "",
}) {
  return `<md-list-item type="button" class="interactive-item ${className}" data-detail-key="${escapeHtml(key)}" ${route ? `data-detail-route="${escapeHtml(route)}"` : ""} aria-pressed="false" aria-label="${escapeHtml(ariaLabel || `${title}, 자세히`)}">
    <span slot="start" class="item-leading">${leading}</span>
    <div slot="headline" class="item-title">${escapeHtml(title)}</div>
    ${supporting ? `<div slot="supporting-text" class="item-support">${escapeHtml(supporting)}</div>` : ""}
    <span slot="end" class="item-end">${status || ""}${date ? `<span>${escapeHtml(date)}</span>` : ""}<md-icon aria-hidden="true">chevron_right</md-icon></span>
  </md-list-item>`;
}

function periodRows(periods, document) {
  if (!periods.length && collectionLoading(["neisTimetables"])) return skeletonMarkup(5, "시간표 불러오는 중");
  if (!periods.length && collectionFailed(["neisTimetables"])) return errorMarkup("시간표를 불러오지 못했습니다");
  if (!periods.length) {
    return emptyMarkup("calendar_today", "등록된 수업이 없습니다", "컴시간에서 수업이 확인되면 이곳에 표시됩니다.");
  }
  return `<md-list class="interactive-list" aria-label="${escapeHtml(dateLabel(document?.date || state.timetableDate))} 시간표">
    ${periods.map((item, index) => {
      const period = item.period || index + 1;
      const key = registerDetail("lesson", item, {
        collection: "neisTimetables",
        id: `${document?.id || document?.date || "day"}-${period}`,
        route: "timetable",
        document,
        date: document?.date,
        period,
      });
      const subject = fullSubjectName(item.subject);
      return interactiveListItem({
        key,
        title: subject,
        supporting: [item.room || item.classroom, item.teacher || item.teacherName].filter(Boolean).join(" · ") || "수업 상세 보기",
        leading: `<strong>${escapeHtml(period)}교시</strong>`,
        route: "timetable",
        ariaLabel: `${period}교시 ${subject}, 수업 상세`,
      });
    }).join("")}
  </md-list>`;
}

function scheduleRows(items, { loadingNames = ["classAssignments", "events", "academicSchedules"], emptySupport = "등록되면 이곳에서 확인할 수 있습니다." } = {}) {
  if (!items.length && collectionLoading(loadingNames)) return skeletonMarkup(4, "일정 불러오는 중");
  if (!items.length && collectionFailed(loadingNames)) return errorMarkup("일정을 불러오지 못했습니다");
  if (!items.length) return emptyMarkup("event_available", "예정된 항목이 없습니다", emptySupport);
  return `<md-list class="interactive-list" aria-label="일정 목록">
    ${items.map((item) => interactiveListItem({
      key: item.detailKey,
      title: item.title,
      supporting: [item.category, item.subject].filter(Boolean).join(" · "),
      leading: `<strong>${escapeHtml(timeDistance(item.date))}</strong>`,
      date: item.date ? dateLabel(item.date, { weekday: false }) : "날짜 미정",
      status: statusChipMarkup(item.source),
      route: item.filter === "event" ? "classroom" : "schedule",
      ariaLabel: `${item.title}, ${item.date ? dateLabel(item.date) : "날짜 미정"}, ${statusInfo(item.source).label}, 자세히`,
    })).join("")}
  </md-list>`;
}

function syncMarkup() {
  if (state.data.syncing && !state.data.ready) {
    return `<div class="sync-line" role="status" aria-live="polite">
      <md-linear-progress indeterminate></md-linear-progress>
      <span>학급 정보를 불러오는 중</span>
    </div>`;
  }
  const cachedAt = Number(state.data.cacheSavedAtMs || 0);
  const stale = Boolean(state.data.usingCache || (!state.data.online && cachedAt));
  if (stale) {
    return `<div class="sync-line sync-line--stale" role="status">
      <md-icon>history</md-icon>
      <span>저장된 정보 표시 중${cachedAt ? ` · ${escapeHtml(formatDateTime(cachedAt))} 저장` : ""}</span>
      <md-text-button data-action="retry-data">새로고침</md-text-button>
    </div>`;
  }
  return `<div class="sync-line" role="status">
    <span class="status-dot ${state.data.online ? "" : "status-dot--offline"}"></span>
    <span>${state.data.online ? "실시간 정보 연결됨" : "오프라인"}</span>
    ${state.data.syncing ? "<md-linear-progress indeterminate></md-linear-progress>" : ""}
  </div>`;
}

function navMarkup(className) {
  return `<nav class="${className}" aria-label="주요 메뉴">
    ${ROUTES.map((route) => {
      const selected = route.id === state.route;
      const tag = selected ? "md-filled-tonal-button" : "md-text-button";
      return `<${tag} data-route="${route.id}" ${selected ? 'aria-current="page" data-aria-current="page"' : ""}>
        <md-icon slot="icon">${route.icon}</md-icon>${route.label}
      </${tag}>`;
    }).join("")}
  </nav>`;
}

function seasonDashboardMarkup() {
  const today = localIsoDate(new Date());
  const assignments = (collections().classAssignments || [])
    .filter((item) => !item.deleted && (!itemDate(item) || itemDate(item) >= today));
  const performance = assignments.filter((item) => assignmentCategory(item) === "수행평가").slice(0, 6);
  const exams = assignments.filter((item) => assignmentCategory(item) === "시험 범위").slice(0, 8);
  const loading = collectionLoading(["classAssignments"]);

  if (!performance.length && !exams.length && collectionFailed(["classAssignments"])) {
    return `<section class="season-dashboard" aria-labelledby="season-title"><div class="section-heading"><div><p class="page-eyebrow">평가 시즌</p><h2 id="season-title">평가 일정</h2></div></div><article class="surface">${errorMarkup("평가 일정을 불러오지 못했습니다")}</article></section>`;
  }
  if (!performance.length && !exams.length && !loading) return "";
  if (!performance.length && !exams.length && loading) {
    return `<section class="season-dashboard" aria-labelledby="season-title">
      <div class="section-heading"><div><p class="page-eyebrow">평가 시즌</p><h2 id="season-title">평가 일정을 확인하는 중</h2></div></div>
      <article class="surface">${skeletonMarkup(3, "평가 일정 불러오는 중")}</article>
    </section>`;
  }

  const performanceMarkup = performance.length ? `<article class="surface season-card">
    <div class="surface__header">
      <div><p class="page-eyebrow">수행평가 시즌</p><h2 class="surface__title">다가오는 수행평가</h2></div>
      <span class="surface__meta">${performance.length}건</span>
    </div>
    <md-list class="interactive-list">
      ${performance.map((item) => {
        const date = itemDate(item);
        const key = registerDetail("assignment", item, { collection: "classAssignments", route: "today" });
        return interactiveListItem({
          key,
          title: itemTitle(item),
          supporting: [fullSubjectName(item.subject), date ? dateLabel(date) : "날짜 미정"].join(" · "),
          leading: `<strong>${escapeHtml(timeDistance(date))}</strong>`,
          status: statusChipMarkup(item),
          route: "today",
          ariaLabel: `${fullSubjectName(item.subject)} ${itemTitle(item)}, ${date ? dateLabel(date) : "날짜 미정"}, ${statusInfo(item).label}, 자세히`,
        });
      }).join("")}
    </md-list>
  </article>` : "";

  const examMarkup = exams.length ? `<article class="surface season-card season-card--exam">
    <div class="surface__header">
      <div><p class="page-eyebrow">중간·기말고사</p><h2 class="surface__title">시험 범위와 확인 상태</h2></div>
      <span class="surface__meta">${escapeHtml(timeDistance(itemDate(exams[0])))}</span>
    </div>
    <md-list class="interactive-list">
      ${exams.map((item) => {
        const date = itemDate(item);
        const key = registerDetail("assignment", item, { collection: "classAssignments", route: "today" });
        const range = cleanText(item.range || item.examRange || item.scope || item.evaluationRange) || "범위 확인 중";
        return interactiveListItem({
          key,
          title: `${fullSubjectName(item.subject)} · ${itemTitle(item)}`,
          supporting: `${date ? dateLabel(date) : "시험일 미정"} · ${range}`,
          leading: `<strong>${escapeHtml(timeDistance(date))}</strong>`,
          status: statusChipMarkup(item),
          route: "today",
        });
      }).join("")}
    </md-list>
  </article>` : "";

  return `<section class="season-dashboard" aria-labelledby="season-title">
    <div class="section-heading">
      <div><p class="page-eyebrow">읽기 전용 시즌 보드</p><h2 id="season-title">평가 일정</h2></div>
      <span>확인되지 않은 내용은 추측하지 않습니다.</span>
    </div>
    <div class="grid grid--2">${performanceMarkup}${examMarkup}</div>
  </section>`;
}

function todayPage() {
  const today = localIsoDate(new Date());
  const document = timetableDocument(today);
  const periods = periodsFor(today);
  const meal = mealFor(today);
  const tasks = upcomingSchedule(5);
  const notice = announcements(1)[0];
  const profile = state.data.profile || readClassProfile();
  const mealKey = meal ? registerDetail("meal", meal, { collection: "meals", route: "today" }) : "";
  const noticeKey = notice ? registerDetail("announcement", notice, {
    collection: notice.__collection || "announcements",
    route: notice.category === "수업 변경" ? "timetable" : "today",
  }) : "";

  return `<section class="view-enter" aria-labelledby="today-title">
    <div class="surface surface--hero">
      <p class="hero-kicker">${escapeHtml(dateLabel(today))}</p>
      <h1 class="hero-title" id="today-title">오늘 필요한 것부터.</h1>
      <div class="hero-meta">
        <span class="meta-pill"><md-icon>school</md-icon>${escapeHtml(profile ? `${profile.grade}학년 ${profile.classNumber}반` : "학급 미선택")}</span>
        <span class="meta-pill"><md-icon>schedule</md-icon>${!periods.length && collectionLoading(["neisTimetables"]) ? "시간표 확인 중" : !periods.length && collectionFailed(["neisTimetables"]) ? "시간표 연결 오류" : periods.length ? `${periods.length}개 수업` : "등록된 수업 없음"}</span>
        <span class="meta-pill"><md-icon>task_alt</md-icon>${!tasks.length && collectionLoading(["classAssignments", "events", "academicSchedules"]) ? "일정 확인 중" : !tasks.length && collectionFailed(["classAssignments", "events", "academicSchedules"]) ? "일정 연결 오류" : tasks.length ? `예정 ${tasks.length}건` : "예정된 일정 없음"}</span>
      </div>
    </div>
    ${syncMarkup()}
    ${state.data.error ? `<div class="surface surface--error notice-banner" role="alert"><md-icon>error</md-icon><p>${escapeHtml(state.data.error)}</p><md-text-button data-action="retry-data">다시 시도</md-text-button></div>` : ""}
    ${seasonDashboardMarkup()}
    <div class="grid grid--2 dashboard-grid">
      <article class="surface">
        <div class="surface__header"><h2 class="surface__title">오늘 시간표</h2><span class="surface__meta">컴시간</span></div>
        ${periodRows(periods.slice(0, 8), document)}
      </article>
      <article class="surface">
        <div class="surface__header"><h2 class="surface__title">다가오는 일정</h2><span class="surface__meta">${tasks.length ? `${tasks.length}건` : ""}</span></div>
        ${scheduleRows(tasks)}
      </article>
      <article class="surface surface--lowest">
        <div class="surface__header"><h2 class="surface__title">오늘 급식</h2><span class="surface__meta">NEIS</span></div>
        ${!meal && collectionLoading(["meals"]) ? skeletonMarkup(1, "급식 불러오는 중") : !meal && collectionFailed(["meals"]) ? errorMarkup("급식을 불러오지 못했습니다") : meal
          ? `<md-list class="interactive-list">${interactiveListItem({
            key: mealKey,
            title: meal.mealType || "중식",
            supporting: cleanText(meal.dishesHtml) || "식단 정보 없음",
            leading: "<md-icon>restaurant</md-icon>",
            date: meal.calories || "",
            route: "today",
            ariaLabel: `${meal.mealType || "중식"} 급식 메뉴 자세히`,
          })}</md-list>`
          : emptyMarkup("restaurant", "급식 정보가 없습니다", "NEIS에 식단이 등록되면 표시됩니다.")}
      </article>
      <article class="surface surface--lowest">
        <div class="surface__header"><h2 class="surface__title">중요 공지</h2><span class="surface__meta">최신</span></div>
        ${!notice && collectionLoading(["announcements", "content"]) ? skeletonMarkup(1, "공지 불러오는 중") : !notice && collectionFailed(["announcements", "content"]) ? errorMarkup("공지를 불러오지 못했습니다") : notice
          ? `<md-list class="interactive-list">${interactiveListItem({
            key: noticeKey,
            title: itemTitle(notice),
            supporting: cleanText(notice.body || notice.description || notice.category),
            leading: "<md-icon>campaign</md-icon>",
            date: summaryDate(notice) ? dateLabel(summaryDate(notice), { weekday: false }) : "",
            route: notice.category === "수업 변경" ? "timetable" : "today",
          })}</md-list>`
          : emptyMarkup("notifications_none", "새 공지가 없습니다", "새 공지가 등록되면 알림함에도 남습니다.")}
      </article>
    </div>
  </section>`;
}

function timetablePage() {
  const dates = Array.from({ length: 7 }, (_, index) => addDays(localIsoDate(new Date()), index - 1));
  const periods = periodsFor(state.timetableDate);
  const document = timetableDocument(state.timetableDate);
  const changes = timetableChanges();
  return `<section class="view-enter" aria-labelledby="timetable-title">
    <div class="page-head"><div class="page-head__copy">
      <p class="page-eyebrow">수업</p>
      <h1 class="page-title" id="timetable-title">시간표</h1>
      <p class="page-subtitle">수업을 선택하면 교실·담당 교사·준비물·관련 평가를 확인할 수 있습니다.</p>
    </div></div>
    ${syncMarkup()}
    <div class="day-strip" aria-label="날짜 선택">
      ${dates.map((date) => `<md-filter-chip data-date="${date}" ${date === state.timetableDate ? "selected" : ""} aria-pressed="${date === state.timetableDate}">
        ${escapeHtml(dateLabel(date, { weekday: false }))}
      </md-filter-chip>`).join("")}
    </div>
    <article class="surface">
      <div class="surface__header">
        <h2 class="surface__title">${escapeHtml(dateLabel(state.timetableDate))}</h2>
        <span class="surface__meta">${escapeHtml(sourceLabel(document?.source || "컴시간"))}${document ? ` · ${escapeHtml(formatDateTime(document.fetchedAt || document.fetchedAtMs))}` : ""}</span>
      </div>
      ${periodRows(periods, document)}
    </article>
    ${changes.length ? `<article class="surface timetable-changes">
      <div class="surface__header"><h2 class="surface__title">최근 시간표 변경</h2><span class="surface__meta">${changes.length}건</span></div>
      <md-list class="interactive-list">${changes.map((item) => interactiveListItem({
        key: registerDetail("announcement", item, { collection: "content", route: "timetable" }),
        title: itemTitle(item),
        supporting: cleanText(item.body || item.description || "변경 내용을 확인하세요."),
        leading: "<md-icon>update</md-icon>",
        date: summaryDate(item) ? dateLabel(summaryDate(item), { weekday: false }) : "",
        status: '<span class="status-chip status-chip--changed"><md-icon>update</md-icon>변경됨</span>',
        route: "timetable",
      })).join("")}</md-list>
    </article>` : collectionLoading(["content"]) ? `<article class="surface timetable-changes"><div class="surface__header"><h2 class="surface__title">최근 시간표 변경</h2></div>${skeletonMarkup(1, "시간표 변경 불러오는 중")}</article>` : collectionFailed(["content"]) ? `<article class="surface timetable-changes"><div class="surface__header"><h2 class="surface__title">최근 시간표 변경</h2></div>${errorMarkup("시간표 변경을 불러오지 못했습니다")}</article>` : ""}
  </section>`;
}

function schedulePage() {
  const all = upcomingSchedule(120, state.scheduleFilter);
  const recurring = all.filter((item) => /토요휴업일/.test(item.title));
  const primary = all.filter((item) => !/토요휴업일/.test(item.title));
  const filters = [
    ["all", "전체"],
    ["academic", "학사일정"],
    ["work", "수행·숙제"],
    ["event", "학급 행사"],
  ];
  return `<section class="view-enter" aria-labelledby="schedule-title">
    <div class="page-head"><div class="page-head__copy">
      <p class="page-eyebrow">날짜 정보</p>
      <h1 class="page-title" id="schedule-title">일정</h1>
      <p class="page-subtitle">수행평가·시험·학급 행사를 먼저 보여주고, 반복 일정은 접어서 정리합니다.</p>
    </div></div>
    ${syncMarkup()}
    <div class="filter-bar" aria-label="일정 종류 필터">
      ${filters.map(([value, label]) => `<md-filter-chip data-schedule-filter="${value}" ${state.scheduleFilter === value ? "selected" : ""} aria-pressed="${state.scheduleFilter === value}">${label}</md-filter-chip>`).join("")}
    </div>
    <article class="surface">
      ${scheduleRows(primary, { emptySupport: recurring.length ? "반복 일정은 아래에서 펼쳐 볼 수 있습니다." : "선택한 종류의 예정된 일정이 없습니다." })}
      ${recurring.length ? `<details class="recurring-group"><summary><span><md-icon>event_repeat</md-icon>토요휴업일 ${recurring.length}회</span><span>펼쳐보기</span></summary>${scheduleRows(recurring, { loadingNames: [] })}</details>` : ""}
    </article>
  </section>`;
}

function resourceRows(items) {
  if (!items.length && collectionLoading(["resources"])) return skeletonMarkup(3, "학습 자료 불러오는 중");
  if (!items.length && collectionFailed(["resources"])) return errorMarkup("학습 자료를 불러오지 못했습니다");
  if (!items.length) return emptyMarkup("description", "등록된 자료가 없습니다", "승인된 학습 자료만 표시합니다.");
  return `<md-list class="interactive-list">
    ${items.map((item) => {
      const key = registerDetail("resource", item, { collection: "resources", route: "classroom" });
      return interactiveListItem({
        key,
        title: itemTitle(item),
        supporting: [fullSubjectName(item.subject), item.materialType || item.category].filter(Boolean).join(" · "),
        leading: "<md-icon>description</md-icon>",
        date: itemDate(item) ? dateLabel(itemDate(item), { weekday: false }) : "",
        route: "classroom",
      });
    }).join("")}
  </md-list>`;
}

function lostItemRows(items) {
  if (!items.length && collectionLoading(["lostItems"])) return skeletonMarkup(3, "분실물 불러오는 중");
  if (!items.length && collectionFailed(["lostItems"])) return errorMarkup("분실물을 불러오지 못했습니다");
  if (!items.length) return emptyMarkup("inventory_2", "등록된 분실물이 없습니다", "새 분실물이 접수되면 이곳에 표시됩니다.");
  return `<md-list class="interactive-list" aria-label="분실물 목록">
    ${items.map((item) => interactiveListItem({
      key: registerDetail("lost", item, { collection: "lostItems", route: "classroom" }),
      title: itemTitle(item),
      supporting: [item.location, item.description].filter(Boolean).map(cleanText).join(" · "),
      leading: "<md-icon>inventory_2</md-icon>",
      status: `<span class="status-chip status-chip--checking"><md-icon>info</md-icon>${escapeHtml(item.status || "보관 중")}</span>`,
      route: "classroom",
    })).join("")}
  </md-list>`;
}

function classroomPage() {
  const assignments = (collections().classAssignments || []).filter((item) => !item.deleted).slice(0, 8);
  const events = (collections().events || []).filter((item) => !item.deleted && item.status !== "draft").slice(0, 8);
  const resources = (collections().resources || []).filter((item) => !item.deleted && (!item.moderationStatus || item.moderationStatus === "approved")).slice(0, 8);
  const lostItems = (collections().lostItems || []).filter((item) => !item.deleted && item.status !== "resolved").slice(0, 8);
  const assignmentRows = assignments.map((item) => ({
    category: assignmentCategory(item),
    filter: "work",
    title: itemTitle(item),
    date: itemDate(item),
    subject: fullSubjectName(item.subject),
    source: item,
    detailKey: registerDetail("assignment", item, { collection: "classAssignments", route: "classroom" }),
  }));
  const eventRows = events.map((item) => ({
    category: "학급 행사",
    filter: "event",
    title: itemTitle(item),
    date: itemDate(item),
    subject: cleanText(item.location),
    source: item,
    detailKey: registerDetail("event", item, { collection: "events", route: "classroom" }),
  }));
  return `<section class="view-enter" aria-labelledby="classroom-title">
    <div class="page-head"><div class="page-head__copy">
      <p class="page-eyebrow">우리 반 정보</p>
      <h1 class="page-title" id="classroom-title">학급</h1>
      <p class="page-subtitle">수행·숙제, 학급 행사, 학습 자료와 문제를 항목별로 살펴봅니다.</p>
    </div></div>
    ${syncMarkup()}
    <div class="grid grid--2">
      <article class="surface"><div class="surface__header"><h2 class="surface__title">수행·숙제</h2><span class="surface__meta">${assignments.length ? `${assignments.length}건` : ""}</span></div>${scheduleRows(assignmentRows, { loadingNames: ["classAssignments"] })}</article>
      <article class="surface"><div class="surface__header"><h2 class="surface__title">학급 행사</h2><span class="surface__meta">${events.length ? `${events.length}건` : ""}</span></div>${scheduleRows(eventRows, { loadingNames: ["events"] })}</article>
      <article class="surface"><div class="surface__header"><h2 class="surface__title">학습 자료</h2><span class="surface__meta">${resources.length ? `${resources.length}건` : ""}</span></div>${resourceRows(resources)}</article>
      <article class="surface"><div class="surface__header"><h2 class="surface__title">분실물</h2><span class="surface__meta">${lostItems.length ? `${lostItems.length}건` : ""}</span></div>${lostItemRows(lostItems)}</article>
    </div>
  </section>`;
}

function morePage() {
  const profile = state.data.profile || readClassProfile();
  const roleLabel = state.data.isManager ? "학급 관리자" : "학생 · 읽기 전용";
  return `<section class="view-enter" aria-labelledby="more-title">
    <div class="page-head"><div class="page-head__copy">
      <p class="page-eyebrow">설정</p>
      <h1 class="page-title" id="more-title">더보기</h1>
      <p class="page-subtitle">내 학급과 정보 출처, 개인정보 보호 원칙을 확인합니다.</p>
    </div></div>
    <div class="grid grid--2">
      <article class="surface">
        <div class="surface__header"><h2 class="surface__title">내 학급</h2><span class="surface__meta">${escapeHtml(roleLabel)}</span></div>
        <div class="list">
          <div class="row"><div class="row__leading"><md-icon>school</md-icon></div><div class="row__body"><p class="row__title">${escapeHtml(profile ? `${profile.grade}학년 ${profile.classNumber}반` : "학급 미선택")}</p><p class="row__support">고촌고등학교</p></div><md-text-button id="changeClass">변경</md-text-button></div>
          <div class="row"><div class="row__leading"><md-icon>${state.data.online ? "cloud_done" : "cloud_off"}</md-icon></div><div class="row__body"><p class="row__title">${state.data.online ? "실시간 정보 연결됨" : "저장된 정보 표시 중"}</p><p class="row__support">급식·시간표·일정은 기존 PinCon 자료를 그대로 사용합니다.</p></div></div>
        </div>
      </article>
      <article class="surface">
        <div class="surface__header"><h2 class="surface__title">PinCon Beta 안내</h2><span class="beta-badge">Beta</span></div>
        <div class="trust-grid">
          <div class="trust-line"><strong>정보 구분</strong><span>학교 공식 자료와 반에서 정리한 정보를 상세 화면에서 구분합니다.</span></div>
          <div class="trust-line"><strong>개인정보</strong><span>학생 이름·성적·전화번호를 새로 수집하지 않습니다.</span></div>
          <div class="trust-line"><strong>편집</strong><span>학생 화면은 읽기 전용이며, 관리 권한은 별도 관리자 화면에서 확인합니다.</span></div>
        </div>
      </article>
    </div>
  </section>`;
}

function pageMarkup() {
  if (state.route === "timetable") return timetablePage();
  if (state.route === "schedule") return schedulePage();
  if (state.route === "classroom") return classroomPage();
  if (state.route === "more") return morePage();
  return todayPage();
}

function dialogsMarkup() {
  return `<md-dialog id="searchDialog">
    <div slot="headline">통합 검색</div>
    <div slot="content">
      <md-outlined-text-field id="searchField" label="공지, 일정, 자료 검색" type="search"></md-outlined-text-field>
      <div id="searchResults" class="section-stack" aria-live="polite"></div>
    </div>
    <div slot="actions"><md-text-button id="closeSearch">닫기</md-text-button></div>
  </md-dialog>
  <md-dialog id="notificationDialog">
    <div slot="headline">알림함</div>
    <div slot="content" id="notificationContent"></div>
    <div slot="actions"><md-text-button id="closeNotifications">닫기</md-text-button></div>
  </md-dialog>`;
}

function detailLayerMarkup() {
  return `<div class="detail-layer" id="detailLayer" hidden aria-hidden="true">
    <div class="detail-backdrop" data-detail-close aria-hidden="true"></div>
    <section class="detail-surface" id="detailSurface" role="dialog" aria-labelledby="detailTitle" tabindex="-1">
      <div class="detail-drag-handle" id="detailDragHandle" aria-hidden="true"><span></span></div>
      <header class="detail-header">
        <div class="detail-header__copy"><p class="detail-eyebrow" id="detailEyebrow"></p><h2 id="detailTitle" tabindex="-1"></h2><div class="detail-summary" id="detailSummary"></div></div>
        <md-icon-button data-detail-close aria-label="상세 화면 닫기"><md-icon>close</md-icon></md-icon-button>
      </header>
      <div class="detail-body" id="detailBody"></div>
    </section>
  </div>`;
}

function renderProfileSetup() {
  clearModalInert();
  app.innerHTML = `<main class="splash" id="mainContent" tabindex="-1">
    <section class="splash__surface" aria-labelledby="profile-title">
      <div class="splash__mark"><md-icon>hub</md-icon></div>
      <span class="beta-badge">PinCon Beta</span>
      <h1 id="profile-title">내 학급을 선택하세요.</h1>
      <p>학급을 선택하면 시간표·일정·급식 등 기존 PinCon의 실제 정보를 읽기 전용으로 연결합니다.</p>
      <div class="profile-form">
        <md-outlined-select id="gradeSelect" label="학년" value="1">
          <md-select-option value="1"><div slot="headline">1학년</div></md-select-option>
          <md-select-option value="2"><div slot="headline">2학년</div></md-select-option>
          <md-select-option value="3"><div slot="headline">3학년</div></md-select-option>
        </md-outlined-select>
        <md-outlined-select id="classSelect" label="반" value="8">
          ${Array.from({ length: 10 }, (_, index) => `<md-select-option value="${index + 1}"><div slot="headline">${index + 1}반</div></md-select-option>`).join("")}
        </md-outlined-select>
        <md-filled-button id="saveProfile"><md-icon slot="icon">arrow_forward</md-icon>PinCon Beta 열기</md-filled-button>
      </div>
    </section>
  </main>`;
}

function render({ preserveView = false } = {}) {
  const profile = state.data.profile || readClassProfile();
  if (!profile) {
    renderProfileSetup();
    return;
  }
  if (!state.detailKey) clearModalInert();
  const scrollY = preserveView ? window.scrollY : 0;
  const active = preserveView ? document.activeElement : null;
  const activeSelector = active?.id
    ? `#${CSS.escape(active.id)}`
    : ["data-detail-key", "data-route", "data-date", "data-schedule-filter"]
      .map((name) => active?.getAttribute?.(name) ? `[${name}="${CSS.escape(active.getAttribute(name))}"]` : "")
      .find(Boolean) || "";
  prepareDetailRegistry();
  app.innerHTML = `<div class="shell">
    <aside class="rail" aria-label="PinCon 내비게이션">
      <div class="rail__brand" aria-hidden="true"><md-icon>hub</md-icon></div>
      ${navMarkup("rail__nav")}
      <span class="beta-badge rail__beta">Beta</span>
    </aside>
    <div class="app-frame">
      <header class="topbar">
        <div class="brand">
          <div class="brand__mark" aria-hidden="true"><md-icon>hub</md-icon></div>
          <div class="brand__text">
            <span class="brand__title">PinCon <span class="beta-badge">Beta</span></span>
            <span class="brand__meta">고촌고등학교 · ${escapeHtml(`${profile.grade}학년 ${profile.classNumber}반`)}</span>
            <span class="brand__tagline" hidden></span>
          </div>
        </div>
        <div class="topbar__actions">
          <md-icon-button id="openSearch" aria-label="통합 검색"><md-icon>search</md-icon></md-icon-button>
          <md-icon-button id="openNotifications" aria-label="알림함"><md-icon>notifications</md-icon></md-icon-button>
        </div>
      </header>
      <main class="content-wrap" id="mainContent" tabindex="-1">${pageMarkup()}</main>
      ${navMarkup("bottom-nav")}
    </div>
    ${dialogsMarkup()}
    ${detailLayerMarkup()}
  </div>`;
  requestAnimationFrame(() => {
    if (preserveView) window.scrollTo({ top: scrollY, behavior: "auto" });
    if (state.detailKey) {
      renderDetailSurface({ focus: !preserveView });
      if (preserveView && activeSelector) {
        requestAnimationFrame(() => actualFocusable(app.querySelector(activeSelector))?.focus?.({ preventScroll: true }));
      }
    } else if (preserveView && activeSelector) {
      actualFocusable(app.querySelector(activeSelector))?.focus?.({ preventScroll: true });
    }
  });
}

function fieldValue(item, keys, fallback = "아직 등록되지 않음") {
  for (const key of keys) {
    const value = item?.[key];
    if (Array.isArray(value) && value.length) return value.map(cleanText).filter(Boolean).join(" · ");
    if (typeof value === "object" && value && !Array.isArray(value)) {
      const text = Object.values(value).map(cleanText).filter(Boolean).join(" · ");
      if (text) return text;
    }
    const text = cleanText(value);
    if (text) return text;
  }
  return fallback;
}

function detailFieldsMarkup(fields) {
  return `<dl class="detail-fields">${fields.map(([label, value, icon = "info"]) => `<div class="detail-field">
    <dt><md-icon>${icon}</md-icon>${escapeHtml(label)}</dt>
    <dd>${escapeHtml(value || "아직 등록되지 않음")}</dd>
  </div>`).join("")}</dl>`;
}

function detailSection(title, content) {
  return `<section class="detail-section"><h3>${escapeHtml(title)}</h3>${content}</section>`;
}

function sourceUrlFor(item = {}) {
  for (const key of ["evaluationPlanUrl", "planUrl", "originalUrl", "sourceUrl", "fileUrl", "url", "attachmentUrl"]) {
    const url = safeUrl(item[key]);
    if (url) return url;
  }
  return "";
}

function linkedMaterialsMarkup(item = {}) {
  const links = [];
  const direct = sourceUrlFor(item);
  if (direct) links.push({ label: item.fileName || item.linkLabel || "원본 자료", url: direct });
  for (const row of Array.isArray(item.links) ? item.links : Array.isArray(item.attachments) ? item.attachments : []) {
    const url = safeUrl(typeof row === "string" ? row : row.url || row.fileUrl);
    if (url) links.push({ label: cleanText(row.title || row.name || row.fileName) || "연결된 자료", url });
  }
  if (!links.length) return `<p class="detail-muted">연결된 원본 자료가 아직 등록되지 않았습니다.</p>`;
  return `<div class="detail-actions">${links.slice(0, 8).map((link) => `<md-outlined-button href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer"><md-icon slot="icon">open_in_new</md-icon>${escapeHtml(link.label)}</md-outlined-button>`).join("")}</div>`;
}

function changeHistoryMarkup(record) {
  const { item, context } = record;
  const embedded = Array.isArray(item.changeHistory) ? item.changeHistory : Array.isArray(item.history) ? item.history : [];
  const logs = (collections().changeLogs || []).filter((log) => (
    log.documentId === item.id && (!context.collection || log.collection === context.collection)
  ));
  const rows = [...embedded, ...logs]
    .sort((a, b) => firstTimestamp(b, ["createdAtMs", "updatedAtMs", "occurredAtMs"]) - firstTimestamp(a, ["createdAtMs", "updatedAtMs", "occurredAtMs"]))
    .slice(0, 8);
  if (!rows.length) return `<p class="detail-muted">확인 가능한 변경 기록이 없습니다.</p>`;
  return `<ol class="change-history">${rows.map((row) => `<li><strong>${escapeHtml(cleanText(row.label || row.summary || row.action || "내용 변경"))}</strong><span>${escapeHtml(formatDateTime(firstTimestamp(row, ["createdAtMs", "updatedAtMs", "occurredAtMs"])))}</span></li>`).join("")}</ol>`;
}

function notificationContextMarkup() {
  if (!state.detailNotificationId) return "";
  const notification = buildNotificationFeed(collections()).find((item) => item.id === state.detailNotificationId);
  if (!notification) return "";
  return detailSection("알림 정보", `<div class="notification-context">
    <div><strong>발생 시각</strong><span>${escapeHtml(formatDateTime(notification.occurredAtMs || notification.order))}</span></div>
    <div><strong>관련 항목</strong><span>${escapeHtml(notification.kind)} · ${escapeHtml(notification.title)}</span></div>
    <div><strong>변경된 내용</strong><span>${escapeHtml(notification.changeSummary || notification.body || "새 정보가 등록되었습니다.")}</span></div>
    <md-outlined-button data-detail-original><md-icon slot="icon">my_location</md-icon>원본 항목 보기</md-outlined-button>
  </div>`);
}

function assignmentDetail(record) {
  const { item, context } = record;
  const category = assignmentCategory(item);
  const date = itemDate(item);
  const originalUrl = sourceUrlFor(item);
  const lastChecked = firstTimestamp(item, ["lastVerifiedAtMs", "lastCheckedAtMs", "verifiedAtMs", "updatedAtMs", "createdAtMs"]);
  const fields = [
    ["과목", fullSubjectName(item.subject), "menu_book"],
    ["날짜", date ? `${dateLabel(date)} · ${timeDistance(date)}` : "아직 등록되지 않음", "event"],
    ["평가 범위", fieldValue(item, ["evaluationRange", "examRange", "range", "scope"], "확인 중"), "fact_check"],
    ["평가 방식", fieldValue(item, ["evaluationMethod", "method", "format"], "아직 등록되지 않음"), "assignment"],
    ["준비물·제출물", fieldValue(item, ["materials", "preparation", "supplies", "submission", "deliverables"]), "inventory_2"],
    ["배점·반영 비율", fieldValue(item, ["points", "score", "weight", "ratio", "percentage"]), "percent"],
    ["설명", fieldValue(item, ["description", "body", "note"], "아직 등록되지 않음"), "notes"],
    ["마지막 확인", lastChecked ? formatDateTime(lastChecked) : "아직 확인되지 않음", "schedule"],
  ];
  return {
    eyebrow: category,
    title: itemTitle(item),
    summary: `${date ? `${dateLabel(date)} · ${timeDistance(date)}` : "날짜 미정"}${item.subject ? ` · ${fullSubjectName(item.subject)}` : ""}`,
    badges: `${statusChipMarkup(item)}${originChipMarkup(item, context)}`,
    body: `${notificationContextMarkup()}
      ${detailSection("핵심 정보", detailFieldsMarkup(fields))}
      ${detailSection(category === "시험 범위" ? "평가계획서 원본" : "원본 평가계획서", originalUrl ? linkedMaterialsMarkup(item) : '<p class="detail-muted">원본 평가계획서가 아직 등록되지 않았습니다.</p>')}
      ${detailSection("변경 기록", changeHistoryMarkup(record))}`,
  };
}

function scheduleDetail(record, type) {
  const { item, context } = record;
  const date = itemDate(item);
  const start = fieldValue(item, ["time", "startTime", "startsAt"], "");
  const end = fieldValue(item, ["endTime", "endsAt"], "");
  const fields = [
    ["종류", type, "category"],
    ["날짜와 시간", `${date ? `${dateLabel(date)} · ${timeDistance(date)}` : "날짜 미정"}${start ? ` · ${start}${end ? `~${end}` : ""}` : ""}`, "event"],
    ["장소", fieldValue(item, ["location", "place", "room"]), "location_on"],
    ["담당", fieldValue(item, ["teacher", "teacherName", "manager", "personInCharge", "subject"]), "person"],
    ["준비물", fieldValue(item, ["materials", "preparation", "supplies"]), "inventory_2"],
    ["상세 설명", fieldValue(item, ["description", "body", "question", "events"]), "notes"],
    ["마지막 수정", formatDateTime(firstTimestamp(item, ["updatedAtMs", "createdAtMs", "fetchedAtMs"])), "schedule"],
  ];
  return {
    eyebrow: type,
    title: itemTitle(item),
    summary: date ? `${dateLabel(date)} · ${timeDistance(date)}` : "날짜 미정",
    badges: `${statusChipMarkup(item)}${originChipMarkup(item, context)}`,
    body: `${notificationContextMarkup()}${detailSection("일정 정보", detailFieldsMarkup(fields))}${detailSection("연결된 자료", linkedMaterialsMarkup(item))}${detailSection("변경 기록", changeHistoryMarkup(record))}`,
  };
}

function announcementDetail(record) {
  const { item, context } = record;
  const occurred = firstTimestamp(item, ["updatedAtMs", "createdAtMs", "clientCreatedAt", "publishedAtMs"]);
  const fields = [
    ["종류", item.category || "공지", "campaign"],
    ["발생 시각", occurred ? formatDateTime(occurred) : (itemDate(item) ? dateLabel(itemDate(item)) : "아직 확인되지 않음"), "schedule"],
    ["내용", fieldValue(item, ["body", "description"], "내용이 등록되지 않았습니다."), "notes"],
    ["작성·출처", fieldValue(item, ["authorName", "sourceAttribution", "source"], originInfo(item, context).label), "source"],
  ];
  return {
    eyebrow: item.category || "공지",
    title: itemTitle(item),
    summary: occurred ? formatDateTime(occurred) : (itemDate(item) ? dateLabel(itemDate(item)) : "게시 시각 미정"),
    badges: originChipMarkup(item, context),
    body: `${notificationContextMarkup()}${detailSection("공지 내용", detailFieldsMarkup(fields))}${detailSection("원본으로 이동", linkedMaterialsMarkup(item))}${detailSection("변경 기록", changeHistoryMarkup(record))}`,
  };
}

function resourceDetail(record) {
  const { item, context } = record;
  const fields = [
    ["과목", fullSubjectName(item.subject), "menu_book"],
    ["자료 종류", fieldValue(item, ["materialType", "category", "type"]), "description"],
    ["설명", fieldValue(item, ["description", "body", "note"]), "notes"],
    ["출처", fieldValue(item, ["sourceAttribution", "authorName", "source"], originInfo(item, context).label), "source"],
    ["마지막 확인", formatDateTime(firstTimestamp(item, ["updatedAtMs", "createdAtMs", "publishedAtMs"])), "schedule"],
  ];
  return {
    eyebrow: "학습 자료",
    title: itemTitle(item),
    summary: [fullSubjectName(item.subject), item.materialType || item.category].filter(Boolean).join(" · "),
    badges: originChipMarkup(item, context),
    body: `${notificationContextMarkup()}${detailSection("자료 정보", detailFieldsMarkup(fields))}${detailSection("자료 열기", linkedMaterialsMarkup(item))}${detailSection("변경 기록", changeHistoryMarkup(record))}`,
  };
}

function lostItemDetail(record) {
  const { item, context } = record;
  const foundDate = itemDate(item);
  return {
    eyebrow: "분실물",
    title: itemTitle(item),
    summary: [item.status || "보관 중", foundDate ? dateLabel(foundDate) : "날짜 미정"].filter(Boolean).join(" · "),
    badges: originChipMarkup(item, context),
    body: `${detailSection("분실물 정보", detailFieldsMarkup([
      ["상태", item.status || "보관 중", "info"],
      ["발견 날짜", foundDate ? dateLabel(foundDate) : "아직 등록되지 않음", "event"],
      ["발견·보관 장소", fieldValue(item, ["location", "place", "storageLocation"]), "location_on"],
      ["설명", fieldValue(item, ["description", "body", "note"]), "notes"],
      ["마지막 수정", formatDateTime(firstTimestamp(item, ["updatedAtMs", "createdAtMs"])), "schedule"],
    ]))}${detailSection("연결된 사진·자료", linkedMaterialsMarkup(item))}`,
  };
}

function allergenNumbers(item) {
  const text = cleanText(item.dishesHtml || item.menu || item.dishes || "");
  const numbers = new Set();
  for (const group of text.matchAll(/\(([\d.\s]+)\)/g)) {
    for (const value of group[1].split(".")) {
      const number = Number(value);
      if (ALLERGENS[number]) numbers.add(number);
    }
  }
  return [...numbers].sort((a, b) => a - b);
}

function mealDetail(record) {
  const { item, context } = record;
  const date = itemDate(item);
  const numbers = allergenNumbers(item);
  const menu = cleanText(item.dishesHtml || item.menu || item.dishes) || "식단 정보가 없습니다.";
  return {
    eyebrow: "급식",
    title: `${date ? dateLabel(date) : "오늘"} ${item.mealType || "중식"}`,
    summary: [item.calories, sourceLabel(item.source || "NEIS")].filter(Boolean).join(" · "),
    badges: originChipMarkup({ ...item, source: item.source || "NEIS" }, context),
    body: `${detailSection("메뉴", `<p class="meal-menu">${escapeHtml(menu)}</p>`)}
      ${detailSection("급식 정보", detailFieldsMarkup([
        ["날짜", date ? dateLabel(date) : "날짜 미정", "event"],
        ["열량", item.calories || "아직 등록되지 않음", "local_fire_department"],
        ["데이터 출처", sourceLabel(item.source || "NEIS"), "source"],
        ["마지막 확인", formatDateTime(firstTimestamp(item, ["fetchedAtMs", "updatedAtMs", "createdAtMs"])), "schedule"],
      ]))}
      ${detailSection("알레르기 번호 범례", numbers.length
        ? `<div class="allergen-grid">${numbers.map((number) => `<span><strong>${number}</strong>${escapeHtml(ALLERGENS[number])}</span>`).join("")}</div>`
        : '<p class="detail-muted">표시된 알레르기 번호가 없습니다.</p>')}`,
  };
}

function relatedAssignmentsForLesson(item, date) {
  const full = fullSubjectName(item.subject);
  const short = cleanText(item.subject);
  return (collections().classAssignments || [])
    .filter((row) => !row.deleted)
    .filter((row) => {
      const subject = fullSubjectName(row.subject);
      return subject === full || cleanText(row.subject) === short;
    })
    .filter((row) => !date || !itemDate(row) || itemDate(row) >= date)
    .slice(0, 5);
}

function lessonDetail(record) {
  const { item, context } = record;
  const document = context.document || {};
  const date = context.date || document.date || "";
  const period = context.period || item.period || "";
  const related = relatedAssignmentsForLesson(item, date);
  const relatedMarkup = related.length ? `<md-list class="interactive-list">
    ${related.map((row) => interactiveListItem({
      key: registerDetail("assignment", row, { collection: "classAssignments", route: "timetable" }),
      title: itemTitle(row),
      supporting: `${assignmentCategory(row)} · ${itemDate(row) ? dateLabel(itemDate(row), { weekday: false }) : "날짜 미정"}`,
      leading: "<md-icon>assignment</md-icon>",
      route: "timetable",
    })).join("")}
  </md-list>` : `<p class="detail-muted">연결된 수행평가나 숙제가 아직 없습니다.</p>`;
  const time = [item.startTime, item.endTime].filter(Boolean).join("~");
  const changed = fieldValue(item, ["changeSummary", "changeStatus"], "확인된 변경 기록 없음");
  return {
    eyebrow: `${period}교시 수업`,
    title: fullSubjectName(item.subject),
    summary: `${date ? dateLabel(date) : "날짜 미정"}${time ? ` · ${time}` : ""}`,
    badges: originChipMarkup({ ...document, source: document.source || "COMCIGAN" }, context),
    body: `${notificationContextMarkup()}
      ${detailSection("수업 정보", detailFieldsMarkup([
        ["과목 전체 이름", fullSubjectName(item.subject), "menu_book"],
        ["교시와 시간", `${period ? `${period}교시` : "교시 미정"}${time ? ` · ${time}` : " · 시간은 아직 등록되지 않음"}`, "schedule"],
        ["교실", fieldValue(item, ["room", "classroom", "location"]), "meeting_room"],
        ["담당 교사", fieldValue(item, ["teacher", "teacherName"]), "person"],
        ["준비물", fieldValue(item, ["materials", "preparation", "supplies"]), "inventory_2"],
        ["시간표 변경", changed, "update"],
        ["데이터 출처", sourceLabel(document.source || "COMCIGAN"), "source"],
        ["마지막 확인", formatDateTime(firstTimestamp(document, ["fetchedAtMs", "updatedAtMs", "createdAtMs", "fetchedAt"])), "schedule"],
      ]))}
      ${detailSection("관련 수행평가·숙제", relatedMarkup)}
      ${detailSection("변경 기록", changeHistoryMarkup(record))}`,
  };
}

function problemSourceLabel(item) {
  const note = cleanText(item.source?.note);
  const example = /예시|sample/i.test(note) || item.example === true;
  return example ? "예시 문제" : "실제 학급 자료";
}

function problemDetail(record) {
  const item = record.item;
  const attempt = state.problemAttempts.get(item.id) || { selected: "", answer: "", submitted: false, correct: false };
  const objective = item.type === "multiple-choice";
  let interaction = "";
  if (objective) {
    interaction = `<fieldset class="quiz-choices" ${attempt.submitted ? "disabled" : ""}><legend>보기를 선택하세요</legend>
      ${item.choices.map((choice, index) => `<label class="${String(attempt.selected) === String(index) ? "is-selected" : ""}">
        <md-radio name="problem-${escapeHtml(item.id)}" value="${index}" data-problem-choice="${index}" ${String(attempt.selected) === String(index) ? "checked" : ""}></md-radio>
        <span><strong>${index + 1}</strong>${escapeHtml(choice)}</span>
      </label>`).join("")}
    </fieldset>`;
  } else {
    interaction = `<md-outlined-text-field class="quiz-short-answer" data-problem-short-answer label="답 입력" value="${escapeHtml(attempt.answer || "")}" ${attempt.submitted ? "disabled" : ""}></md-outlined-text-field>`;
  }
  const result = attempt.submitted ? `<div class="quiz-result quiz-result--${attempt.correct ? "correct" : "incorrect"}" role="status" tabindex="-1">
      <md-icon>${attempt.correct ? "check_circle" : "error"}</md-icon>
      <div><strong>${attempt.correct ? "정답입니다" : "다시 확인해 보세요"}</strong><span><b>정답</b> ${escapeHtml(item.answer)}</span><span><b>해설</b> ${escapeHtml(item.explanation)}</span></div>
    </div>
    <md-filled-tonal-button data-problem-retry><md-icon slot="icon">refresh</md-icon>다시 풀기</md-filled-tonal-button>`
    : `<md-filled-button data-problem-submit ${objective ? (attempt.selected === "" ? "disabled" : "") : (!attempt.answer ? "disabled" : "")}>제출</md-filled-button>`;
  return {
    eyebrow: `${item.subject} · ${item.unit}`,
    title: item.question,
    summary: `${item.difficulty === "easy" ? "기초" : item.difficulty === "hard" ? "도전" : "보통"} · ${objective ? "객관식" : "주관식"}`,
    badges: `<span class="origin-chip ${problemSourceLabel(item) === "예시 문제" ? "origin-chip--example" : "origin-chip--official"}"><md-icon>${problemSourceLabel(item) === "예시 문제" ? "science" : "verified"}</md-icon>${problemSourceLabel(item)}</span>`,
    body: `${detailSection("문제 풀기", `<div class="quiz-panel">${interaction}<div class="quiz-actions">${result}</div></div>`)}
      ${detailSection("출처", `<p class="detail-muted">${escapeHtml(problemSourceLabel(item))} · ${escapeHtml(item.source?.note || "출처 설명 없음")}</p>`)}`,
  };
}

function detailSpec(record) {
  if (!record) return null;
  if (record.kind === "assignment") return assignmentDetail(record);
  if (record.kind === "event") return scheduleDetail(record, "학급 행사");
  if (record.kind === "academic") return scheduleDetail(record, "학사일정");
  if (record.kind === "announcement") return announcementDetail(record);
  if (record.kind === "resource") return resourceDetail(record);
  if (record.kind === "lost") return lostItemDetail(record);
  if (record.kind === "meal") return mealDetail(record);
  if (record.kind === "lesson") return lessonDetail(record);
  if (record.kind === "problem") return problemDetail(record);
  return null;
}

function detailMode() {
  if (innerWidth <= 599) return "bottom";
  if (innerWidth >= 1180) return "side";
  return "dialog";
}

function setModalInert(mode) {
  const modal = mode !== "side";
  for (const node of [app.querySelector(".rail"), app.querySelector(".app-frame")]) {
    if (!node) continue;
    node.inert = modal;
    if (modal) node.setAttribute("aria-hidden", "true");
    else node.removeAttribute("aria-hidden");
  }
  document.body.classList.toggle("detail-modal-open", modal);
  document.body.classList.toggle("detail-side-open", !modal);
}

function clearModalInert() {
  for (const node of [app.querySelector(".rail"), app.querySelector(".app-frame")]) {
    if (!node) continue;
    node.inert = false;
    node.removeAttribute("aria-hidden");
  }
  document.body.classList.remove("detail-modal-open", "detail-side-open");
}

function renderDetailSurface({ focus = false, swap = false } = {}) {
  const layer = app.querySelector("#detailLayer");
  const surface = app.querySelector("#detailSurface");
  if (!layer || !surface || !state.detailKey) return;
  const record = detailRegistry.get(state.detailKey);
  const spec = detailSpec(record);
  const mode = detailMode();
  surface.dataset.mode = mode;
  surface.setAttribute("aria-modal", mode === "side" ? "false" : "true");
  layer.dataset.mode = mode;
  layer.hidden = false;
  layer.setAttribute("aria-hidden", "false");
  setModalInert(mode);
  app.querySelectorAll("[data-detail-key]").forEach((item) => {
    const selected = item.getAttribute("data-detail-key") === state.detailKey;
    item.toggleAttribute("data-highlight", selected);
    item.setAttribute("aria-pressed", String(selected));
  });

  if (!spec) {
    app.querySelector("#detailEyebrow").textContent = "상세 정보";
    app.querySelector("#detailTitle").textContent = "상세 정보를 불러오는 중";
    app.querySelector("#detailSummary").innerHTML = "";
    app.querySelector("#detailBody").innerHTML = skeletonMarkup(4, "상세 정보 불러오는 중");
  } else {
    app.querySelector("#detailEyebrow").textContent = spec.eyebrow || "상세 정보";
    app.querySelector("#detailTitle").textContent = spec.title || "상세 정보";
    app.querySelector("#detailSummary").innerHTML = `<span>${escapeHtml(spec.summary || "")}</span><div class="detail-badges">${spec.badges || ""}</div>`;
    const body = app.querySelector("#detailBody");
    const scrollTop = swap ? body.scrollTop : 0;
    body.innerHTML = spec.body;
    body.scrollTop = swap ? Math.min(scrollTop, body.scrollHeight) : 0;
    if (swap) {
      body.classList.remove("detail-body--swap");
      requestAnimationFrame(() => body.classList.add("detail-body--swap"));
    }
  }
  updateVisualViewport();
  requestAnimationFrame(() => {
    layer.classList.add("is-open");
    if (focus) app.querySelector("#detailTitle")?.focus({ preventScroll: true });
  });
}

function hideDetailSurface({ restoreFocus = true } = {}) {
  const layer = app.querySelector("#detailLayer");
  if (!layer || layer.hidden) {
    clearModalInert();
    if (restoreFocus) restoreDetailFocus();
    return;
  }
  layer.classList.remove("is-open");
  layer.setAttribute("aria-hidden", "true");
  clearModalInert();
  const finish = () => {
    if (!layer.classList.contains("is-open")) layer.hidden = true;
    app.querySelectorAll("[data-detail-key]").forEach((item) => {
      item.removeAttribute("data-highlight");
      item.setAttribute("aria-pressed", "false");
    });
    if (restoreFocus) restoreDetailFocus();
  };
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) finish();
  else window.setTimeout(finish, 240);
}

function actualFocusable(control) {
  return control?.shadowRoot?.querySelector("button, a, input, textarea, select, [tabindex]") || control;
}

function deepActiveElement() {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

function restoreDetailFocus() {
  requestAnimationFrame(() => {
    const byKey = lastDetailTriggerKey
      ? app.querySelector(`[data-detail-key="${CSS.escape(lastDetailTriggerKey)}"]`)
      : null;
    const target = byKey || (lastDetailTrigger?.isConnected ? lastDetailTrigger : null)
      || app.querySelector(`[data-route="${state.route}"]`);
    actualFocusable(target)?.focus?.({ preventScroll: true });
  });
}

function openDetail(key, trigger, { push = true, notificationId = "" } = {}) {
  if (!key) return;
  const replacing = Boolean(state.detailKey);
  lastDetailTrigger = trigger || null;
  lastDetailTriggerKey = key;
  state.detailKey = key;
  state.detailNotificationId = notificationId;
  const historyValue = {
    route: state.route,
    detailKey: key,
    notificationId,
    detailPushed: replacing ? Boolean(history.state?.detailPushed) : push,
  };
  if (push && !replacing) history.pushState(historyValue, "", routeHash(state.route, key));
  else history.replaceState(historyValue, "", routeHash(state.route, key));
  renderDetailSurface({ focus: true, swap: replacing });
}

function navigateToDetail(route, key, trigger, { notificationId = "" } = {}) {
  lastDetailTrigger = trigger || null;
  lastDetailTriggerKey = key;
  state.route = ROUTES.some((item) => item.id === route) ? route : "today";
  state.detailKey = key;
  state.detailNotificationId = notificationId;
  history.pushState({
    route: state.route,
    detailKey: key,
    notificationId,
    detailPushed: true,
  }, "", routeHash(state.route, key));
  render();
  window.scrollTo({ top: 0, behavior: "auto" });
}

function requestCloseDetail() {
  if (!state.detailKey) return;
  if (history.state?.detailPushed) {
    history.back();
    return;
  }
  state.detailKey = "";
  state.detailNotificationId = "";
  history.replaceState({ route: state.route, detailKey: "", detailPushed: false }, "", routeHash(state.route));
  hideDetailSurface();
}

function navigate(route, { push = true } = {}) {
  if (!ROUTES.some((item) => item.id === route)) route = "today";
  if (state.route === route && !state.detailKey) return;
  state.route = route;
  state.detailKey = "";
  state.detailNotificationId = "";
  clearModalInert();
  if (push) history.pushState({ route, detailKey: "" }, "", routeHash(route));
  else history.replaceState({ route, detailKey: "" }, "", routeHash(route));
  render();
  requestAnimationFrame(() => app.querySelector("#mainContent")?.focus({ preventScroll: true }));
  window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

function searchIndex() {
  const rows = [];
  const specs = [
    ["공지", "announcement", "announcements", "today", collections().announcements || []],
    ["시간표 변경", "announcement", "content", "timetable", (collections().content || []).filter((item) => item.kind === "notice")],
    ["수행·숙제", "assignment", "classAssignments", "schedule", collections().classAssignments || []],
    ["학급 행사", "event", "events", "classroom", collections().events || []],
    ["학사일정", "academic", "academicSchedules", "schedule", collections().academicSchedules || []],
    ["학습 자료", "resource", "resources", "classroom", collections().resources || []],
    ["분실물", "lost", "lostItems", "classroom", collections().lostItems || []],
  ];
  for (const [label, kind, collection, route, items] of specs) {
    for (const item of items) {
      if (item?.deleted || item?.status === "draft") continue;
      rows.push({
        label,
        title: itemTitle(item),
        support: [item.subject, item.description, item.body, item.location, item.category].filter(Boolean).map(cleanText).join(" · "),
        date: itemDate(item),
        route,
        detailKey: registerDetail(kind, item, { collection, route }),
      });
    }
  }
  return rows;
}

function renderSearchResults(query) {
  const target = app.querySelector("#searchResults");
  if (!target) return;
  const normalized = String(query || "").trim().toLocaleLowerCase("ko-KR");
  if (!normalized) {
    target.innerHTML = emptyMarkup("search", "검색어를 입력하세요", "공지, 일정, 자료를 한 번에 찾습니다.");
    return;
  }
  if (!state.data.ready && state.data.syncing) {
    target.innerHTML = skeletonMarkup(4, "검색할 정보 불러오는 중");
    return;
  }
  const results = searchIndex()
    .filter((item) => `${item.title} ${item.support} ${item.label}`.toLocaleLowerCase("ko-KR").includes(normalized))
    .slice(0, 40);
  target.innerHTML = results.length ? `<md-list class="interactive-list" aria-label="검색 결과">
    ${results.map((item) => interactiveListItem({
      key: item.detailKey,
      title: item.title,
      supporting: item.support || item.label,
      leading: `<strong>${escapeHtml(item.label)}</strong>`,
      date: item.date ? dateLabel(item.date, { weekday: false }) : "",
      route: item.route,
    })).join("")}
  </md-list>` : emptyMarkup("search_off", "검색 결과가 없습니다", `“${query}”와 일치하는 항목을 찾지 못했습니다.`);
}

function eventHost(event, predicate) {
  return event.composedPath?.().find((node) => node instanceof HTMLElement && predicate(node)) || null;
}

function updateVisualViewport() {
  const viewport = window.visualViewport;
  const height = viewport?.height || innerHeight;
  const bottomOffset = viewport ? Math.max(0, innerHeight - viewport.height - viewport.offsetTop) : 0;
  document.documentElement.style.setProperty("--pincon-visual-height", `${height}px`);
  document.documentElement.style.setProperty("--pincon-visual-bottom-offset", `${bottomOffset}px`);
}

function trapDetailFocus(event) {
  if (event.key !== "Tab" || detailMode() === "side" || !state.detailKey) return;
  const surface = app.querySelector("#detailSurface");
  const focusable = [...(surface?.querySelectorAll('button, [href], input, md-icon-button, md-filled-button, md-filled-tonal-button, md-outlined-button, md-text-button, md-radio, md-outlined-text-field, [tabindex]:not([tabindex="-1"])') || [])]
    .filter((node) => !node.hasAttribute("disabled") && !node.closest("[hidden]"));
  if (!focusable.length) return;
  const active = deepActiveElement();
  const first = actualFocusable(focusable[0]);
  const last = actualFocusable(focusable[focusable.length - 1]);
  if (event.shiftKey && (active === first || active === surface)) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first?.focus();
  }
}

app.addEventListener("click", async (event) => {
  const routeControl = eventHost(event, (node) => node.hasAttribute("data-route"));
  if (routeControl) {
    navigate(routeControl.getAttribute("data-route"));
    return;
  }

  const closeDetail = eventHost(event, (node) => node.hasAttribute("data-detail-close"));
  if (closeDetail) {
    requestCloseDetail();
    return;
  }

  const detailItem = eventHost(event, (node) => node.hasAttribute("data-detail-key"));
  if (detailItem) {
    const key = detailItem.getAttribute("data-detail-key");
    const route = detailItem.getAttribute("data-detail-route") || state.route;
    app.querySelector("#searchDialog")?.close?.();
    if (route !== state.route) navigateToDetail(route, key, detailItem);
    else openDetail(key, detailItem);
    return;
  }

  const dateControl = eventHost(event, (node) => node.hasAttribute("data-date"));
  if (dateControl) {
    state.timetableDate = dateControl.getAttribute("data-date");
    render();
    requestAnimationFrame(() => actualFocusable(app.querySelector(`[data-date="${CSS.escape(state.timetableDate)}"]`))?.focus?.());
    return;
  }

  const filterControl = eventHost(event, (node) => node.hasAttribute("data-schedule-filter"));
  if (filterControl) {
    state.scheduleFilter = filterControl.getAttribute("data-schedule-filter") || "all";
    render();
    requestAnimationFrame(() => app.querySelector(`[data-schedule-filter="${state.scheduleFilter}"]`)?.focus?.());
    return;
  }

  const retry = eventHost(event, (node) => node.getAttribute("data-action") === "retry-data");
  if (retry) {
    retry.setAttribute("disabled", "");
    await gateway.retry();
    return;
  }

  const openSearch = eventHost(event, (node) => node.id === "openSearch");
  if (openSearch) {
    renderSearchResults("");
    app.querySelector("#searchDialog")?.show?.();
    requestAnimationFrame(() => app.querySelector("#searchField")?.focus?.());
    return;
  }

  const closeSearch = eventHost(event, (node) => node.id === "closeSearch");
  if (closeSearch) {
    app.querySelector("#searchDialog")?.close?.();
    requestAnimationFrame(() => actualFocusable(app.querySelector("#openSearch"))?.focus?.());
    return;
  }

  const saveProfile = eventHost(event, (node) => node.id === "saveProfile");
  if (saveProfile) {
    try {
      saveClassProfile(app.querySelector("#gradeSelect")?.value, app.querySelector("#classSelect")?.value);
      location.reload();
    } catch (error) {
      console.error(error);
    }
    return;
  }

  const changeClass = eventHost(event, (node) => node.id === "changeClass");
  if (changeClass) {
    localStorage.removeItem("pincon-profile-v2");
    gateway.dispose();
    state.data = gateway.snapshot();
    state.detailKey = "";
    renderProfileSetup();
    return;
  }

  const problemSubmit = eventHost(event, (node) => node.hasAttribute("data-problem-submit"));
  if (problemSubmit) {
    const record = detailRegistry.get(state.detailKey);
    if (record?.kind !== "problem") return;
    const item = record.item;
    const attempt = state.problemAttempts.get(item.id) || { selected: "", answer: "" };
    const selectedText = item.type === "multiple-choice" ? item.choices[Number(attempt.selected)] : attempt.answer;
    const normalizedSelected = cleanText(selectedText).toLocaleLowerCase("ko-KR");
    const normalizedAnswer = cleanText(item.answer).toLocaleLowerCase("ko-KR");
    attempt.correct = normalizedSelected === normalizedAnswer
      || (item.type === "multiple-choice" && normalizedAnswer === String(Number(attempt.selected) + 1));
    attempt.submitted = true;
    state.problemAttempts.set(item.id, attempt);
    renderDetailSurface({ focus: false, swap: true });
    app.querySelector(".quiz-result")?.focus?.();
    return;
  }

  const problemRetry = eventHost(event, (node) => node.hasAttribute("data-problem-retry"));
  if (problemRetry) {
    const item = detailRegistry.get(state.detailKey)?.item;
    if (item?.id) state.problemAttempts.delete(item.id);
    renderDetailSurface({ focus: false, swap: true });
    return;
  }

  const original = eventHost(event, (node) => node.hasAttribute("data-detail-original"));
  if (original) {
    app.querySelector("#detailTitle")?.focus({ preventScroll: true });
    app.querySelector("#detailBody")?.scrollTo?.({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
});

app.addEventListener("input", (event) => {
  const searchField = eventHost(event, (node) => node.id === "searchField");
  if (searchField) {
    renderSearchResults(searchField.value);
    return;
  }
  const shortAnswer = eventHost(event, (node) => node.hasAttribute("data-problem-short-answer"));
  if (shortAnswer) {
    const item = detailRegistry.get(state.detailKey)?.item;
    if (!item?.id) return;
    const attempt = state.problemAttempts.get(item.id) || { selected: "", answer: "", submitted: false };
    attempt.answer = shortAnswer.value || "";
    state.problemAttempts.set(item.id, attempt);
    const submit = app.querySelector("[data-problem-submit]");
    if (submit) submit.toggleAttribute("disabled", !attempt.answer.trim());
  }
});

app.addEventListener("change", (event) => {
  const radio = eventHost(event, (node) => node.hasAttribute("data-problem-choice"));
  if (!radio) return;
  const record = detailRegistry.get(state.detailKey);
  if (record?.kind !== "problem") return;
  const attempt = state.problemAttempts.get(record.item.id) || { answer: "", submitted: false };
  attempt.selected = radio.getAttribute("data-problem-choice");
  state.problemAttempts.set(record.item.id, attempt);
  app.querySelector("[data-problem-submit]")?.removeAttribute("disabled");
  app.querySelectorAll(".quiz-choices label").forEach((label) => label.classList.toggle("is-selected", label.contains(radio)));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.detailKey) {
    event.preventDefault();
    requestCloseDetail();
    return;
  }
  trapDetailFocus(event);
});

app.addEventListener("pointerdown", (event) => {
  const handle = eventHost(event, (node) => node.id === "detailDragHandle");
  if (!handle || detailMode() !== "bottom") return;
  detailPointer = { id: event.pointerId, startY: event.clientY, lastY: event.clientY };
  handle.setPointerCapture?.(event.pointerId);
});

app.addEventListener("pointermove", (event) => {
  if (!detailPointer || detailPointer.id !== event.pointerId) return;
  detailPointer.lastY = event.clientY;
  const surface = app.querySelector("#detailSurface");
  const delta = Math.max(0, event.clientY - detailPointer.startY);
  if (surface) surface.style.transform = `translateY(${Math.min(delta, 180)}px)`;
});

app.addEventListener("pointerup", (event) => {
  if (!detailPointer || detailPointer.id !== event.pointerId) return;
  const delta = event.clientY - detailPointer.startY;
  const surface = app.querySelector("#detailSurface");
  if (surface) surface.style.transform = "";
  if (delta > 96) requestCloseDetail();
  else if (delta < -52) surface?.classList.add("detail-surface--expanded");
  detailPointer = null;
});

window.addEventListener("popstate", () => {
  const next = locationState();
  const routeChanged = next.route !== state.route;
  const hadDetail = Boolean(state.detailKey);
  state.route = next.route;
  state.detailKey = next.detailKey;
  state.detailNotificationId = history.state?.notificationId || "";
  if (routeChanged) {
    render();
    return;
  }
  if (state.detailKey) renderDetailSurface({ focus: true, swap: hadDetail });
  else hideDetailSurface({ restoreFocus: true });
});

window.addEventListener("resize", () => {
  updateVisualViewport();
  if (state.detailKey) renderDetailSurface({ focus: false });
});
window.visualViewport?.addEventListener("resize", updateVisualViewport);

gateway.addEventListener("change", (event) => {
  state.data = event.detail;
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => render({ preserveView: true }), 32);
});

globalThis.PinConNext = Object.freeze({
  registerDetail(kind, item, context = {}) {
    return registerDetail(kind, item, context, true);
  },
  detailKeyForReference,
  navigateToDetail,
  openDetail,
  refreshDetail() {
    if (state.detailKey) renderDetailSurface({ focus: false, swap: true });
  },
});

if (!location.hash) {
  history.replaceState({ route: state.route, detailKey: "", detailPushed: false }, "", routeHash(state.route));
} else if (state.detailKey) {
  const detailUrl = routeHash(state.route, state.detailKey);
  history.replaceState({ route: state.route, detailKey: "", detailPushed: false }, "", routeHash(state.route));
  history.pushState({
    ...(history.state || {}),
    route: state.route,
    detailKey: state.detailKey,
    detailPushed: true,
  }, "", detailUrl);
} else {
  history.replaceState({
    ...(history.state || {}),
    route: state.route,
    detailKey: state.detailKey,
    detailPushed: false,
  }, "", routeHash(state.route, state.detailKey));
}

updateVisualViewport();
render();
await gateway.start();
