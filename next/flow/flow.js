import { NextDataGateway, readClassProfile, saveClassProfile } from "../core/data-gateway.js";

const app = document.querySelector("#flowApp");
const boot = document.querySelector("#flowBoot");
const sheet = document.querySelector("#flowSheet");
const sheetContent = document.querySelector("#flowSheetContent");
const gateway = new NextDataGateway();

const withShare = globalThis.PINCON_FLOW_WITH_SHARE || ((url) => url);
const { iconMarkup: icon } = await import(withShare("./flow-local-icons-v6.js?v=20260909-layout1"));

const ROUTES = [
  { id: "today", label: "오늘", icon: "today" },
  { id: "timetable", label: "시간표", icon: "timeline" },
  { id: "schedule", label: "일정", icon: "event" },
  { id: "assessment", label: "수행", icon: "assignment" },
  { id: "meal", label: "급식", icon: "restaurant" },
  { id: "hub", label: "허브", icon: "apps" },
];

const SUBJECT_NAMES = {
  공영: "공통영어",
  공수: "공통수학",
  공국: "공통국어",
  통사: "통합사회",
  통과: "통합과학",
  한국: "한국사",
};

const state = {
  route: "today",
  data: gateway.snapshot(),
  selectedDate: isoDate(new Date()),
  scheduleFilter: "all",
  assessmentFilter: "all",
  mealDate: isoDate(new Date()),
  choosingClass: false,
};

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clean(value) {
  const node = document.createElement("div");
  node.innerHTML = String(value || "").replace(/<br\s*\/?\s*>/gi, "\n");
  return (node.textContent || "")
    .replace(/\s*\n\s*/g, " · ")
    .replace(/\s+/g, " ")
    .trim();
}

function isoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(dateString, amount) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return isoDate(date);
}

function dateOf(item = {}) {
  const raw = item.dueDate || item.date || item.startsOn || item.startDate || item.dueAt || "";
  const match = String(raw).match(/^\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  const ms = Number(item.dueAtMs || item.startsAtMs || 0);
  return ms ? isoDate(new Date(ms)) : "";
}

function dateLabel(value, { weekday = true } = {}) {
  if (!value) return "날짜 미정";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: weekday ? "short" : undefined,
  }).format(date);
}

function shortDate(value) {
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function dday(value) {
  if (!value) return "미정";
  const today = new Date(`${isoDate(new Date())}T12:00:00`);
  const target = new Date(`${value}T12:00:00`);
  const days = Math.round((target - today) / 86400000);
  if (days === 0) return "오늘";
  if (days === 1) return "내일";
  return days > 1 ? `D-${days}` : `D+${Math.abs(days)}`;
}

function title(item, fallback = "제목 없음") {
  return clean(item?.title || item?.name || item?.subject || item?.body || fallback);
}

function subjectName(value) {
  const subject = clean(value);
  return SUBJECT_NAMES[subject] || subject || "과목 미정";
}

function collections() {
  return state.data?.data || {};
}

function profile() {
  return state.data?.profile || readClassProfile();
}

function routeFromHash() {
  const raw = location.hash.replace(/^#\/?/, "").split("?")[0];
  return ROUTES.some((item) => item.id === raw) ? raw : "today";
}

function go(route) {
  const next = ROUTES.some((item) => item.id === route) ? route : "today";
  if (location.hash !== `#${next}`) history.pushState({ route: next }, "", `#${next}`);
  state.route = next;
  render({ motion: true, routeChange: true });
}

function timetableDoc(date) {
  return (collections().neisTimetables || []).find((item) => item.date === date) || null;
}

function periodsFor(date) {
  const doc = timetableDoc(date);
  return Array.isArray(doc?.periods) ? [...doc.periods].sort((a, b) => Number(a.period || 0) - Number(b.period || 0)) : [];
}

function mealFor(date) {
  return (collections().meals || []).find((item) => item.date === date) || null;
}

function dishList(meal) {
  const raw = clean(meal?.dishesHtml || meal?.menu || meal?.dishes || "");
  return raw
    ? raw.split(/\s*[·,\n]\s*/).map((item) => item.trim()).filter(Boolean).slice(0, 14)
    : [];
}

function assignmentKind(item = {}) {
  const type = String(item.type || "").toLowerCase();
  const itemTitle = title(item);
  if (type === "exam" || /중간|기말|시험\s*범위/.test(itemTitle)) return "exam";
  if (type === "preparation" || /숙제|과제|준비물/.test(itemTitle)) return "preparation";
  return "assessment";
}

function assignmentLabel(item = {}) {
  return {
    assessment: "수행평가",
    exam: "시험",
    preparation: "숙제",
  }[assignmentKind(item)];
}

function assignments() {
  return (collections().classAssignments || [])
    .filter((item) => !item.deleted && item.published !== false)
    .sort((a, b) => (dateOf(a) || "9999").localeCompare(dateOf(b) || "9999"));
}

function academicItems() {
  return (collections().academicSchedules || [])
    .filter((item) => !item.deleted)
    .sort((a, b) => (dateOf(a) || "9999").localeCompare(dateOf(b) || "9999"));
}

function eventItems() {
  return (collections().events || [])
    .filter((item) => !item.deleted && item.status !== "draft")
    .sort((a, b) => (dateOf(a) || "9999").localeCompare(dateOf(b) || "9999"));
}

function scheduleItems() {
  const rows = [];

  for (const item of assignments()) {
    rows.push({
      item,
      date: dateOf(item),
      kind: assignmentKind(item),
      label: assignmentLabel(item),
      title: title(item),
      subject: subjectName(item.subject),
    });
  }

  for (const item of academicItems()) {
    rows.push({
      item,
      date: dateOf(item),
      kind: "academic",
      label: "학사",
      title: title(item),
      subject: "학교 일정",
    });
  }

  for (const item of eventItems()) {
    rows.push({
      item,
      date: dateOf(item),
      kind: "event",
      label: "학급",
      title: title(item),
      subject: "학급 행사",
    });
  }

  return rows.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
}

function upcomingAssignments(limit = 8) {
  const today = isoDate(new Date());
  return assignments()
    .filter((item) => !dateOf(item) || dateOf(item) >= today)
    .slice(0, limit);
}

function periodTitle(period = {}) {
  return subjectName(
    period.subject || period.subjectName || period.name || period.className || "수업"
  );
}

function periodSupport(period = {}) {
  return clean(
    period.teacher ||
      period.teacherName ||
      period.room ||
      period.classroom ||
      period.place ||
      period.note ||
      ""
  );
}

function periodTime(period = {}) {
  const start = clean(period.startTime || period.startsAt || period.start || "");
  const end = clean(period.endTime || period.endsAt || period.end || "");
  return [start, end].filter(Boolean).join("–");
}

function navButton(route) {
  return `<button class="nav-button ${state.route === route.id ? "is-active" : ""}" data-route="${route.id}" ${state.route === route.id ? 'aria-current="page"' : ""}>
    ${icon(route.icon)}<span>${route.label}</span></button>`;
}

function syncLabel() {
  if (state.data?.online === false) return state.data?.usingCache ? "오프라인 · 저장된 정보" : "오프라인";
  if (state.data?.error) return "일부 정보를 불러오지 못했어요";
  if (state.data?.syncing || !state.data?.ready) return "정보 업데이트 중";
  if (state.data?.usingCache) return "저장된 정보";
  return "최신 정보";
}

function shell(content) {
  const p = profile();
  return `<div class="app-shell">
    <aside class="desktop-rail"><img src="../assets/pincon-icon.svg" alt="PinCon" /><nav aria-label="주요 메뉴">${ROUTES.map(navButton).join("")}</nav><span class="rail-caption">FLOW<br>Beta</span></aside>
    <div class="main-column">
      <header class="topline"><div class="brand-lockup"><img src="../assets/pincon-icon.svg" alt="" /><div><strong>PinCon Flow</strong><span>${esc(p?.grade || "-")}학년 ${esc(p?.classNumber || "-")}반 · Beta</span></div></div>
        <div class="topline__actions"><span class="sync-status" role="status">${esc(syncLabel())}</span><button class="soft-button classic-button" data-action="classic">기존 PinCon ${icon("open")}</button><button class="icon-button" data-action="refresh" aria-label="새로고침">${icon("refresh")}</button></div>
      </header>${content}
    </div>
    <nav class="dock" aria-label="주요 메뉴">${ROUTES.map(navButton).join("")}</nav>
  </div>`;
}

function intro(eyebrow, headline, copy = "") {
  return `<div class="page-intro"><div><small>${esc(eyebrow)}</small><h1 tabindex="-1">${esc(headline)}</h1></div>${copy ? `<p>${esc(copy)}</p>` : ""}</div>`;
}

function empty(text) { return `<div class="empty-state">${esc(text)}</div>`; }
function missing(collection, text) {
  const status = state.data?.collectionStatus?.[collection];
  if (status === "error") return empty("정보를 불러오지 못했어요. 위의 새로고침을 눌러 주세요.");
  if ((!state.data?.ready || status === "loading") && !state.data?.error && state.data?.online !== false) return empty("정보를 불러오고 있어요.");
  return empty(text);
}
function minutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}
function lessonState(periods, date, now = new Date()) {
  if (date !== isoDate(now)) return { label: "선택한 날", index: -1 };
  if (!periods.length) return { label: "오늘", index: -1 };
  // Never infer a live lesson when the source has no complete bell times.
  const timed = periods.map(p => [minutes(p.startTime || p.startsAt || p.start), minutes(p.endTime || p.endsAt || p.end)]);
  if (timed.some(([start, end]) => start === null || end === null || end <= start)) return { label: "오늘의 수업", index: -1 };
  const time = now.getHours() * 60 + now.getMinutes();
  const current = timed.findIndex(([start, end]) => start <= time && time < end);
  if (current >= 0) return { label: "지금 수업", index: current, current: true };
  const next = timed.findIndex(([start]) => start > time);
  return next >= 0 ? { label: "다음 수업", index: next } : { label: "오늘 수업을 마쳤어요", index: -1, finished: true };
}
function assignmentAttrs(item) {
  return `data-item-kind="assignment" data-item-id="${esc(item.id || "")}" data-item-index="${assignments().indexOf(item)}" aria-haspopup="dialog"`;
}
function periodRow(period, index, date) {
  const live = lessonState(periodsFor(date), date);
  const room = clean(period.room || period.classroom || period.place || "");
  return `<button class="period ${live.index === index && live.current ? "is-now" : ""}" data-lesson="${index}" data-lesson-date="${date}" aria-haspopup="dialog">
    <span class="period__num">${esc(period.period || index + 1)}<small>교시</small></span>
    <span class="period__body"><strong>${esc(periodTitle(period))}</strong><span>${esc([room, clean(period.materials || period.preparations || period.note || "")].filter(Boolean).join(" · ") || periodSupport(period) || "수업 정보 보기")}</span></span>
    <span class="period__room">${esc(periodTime(period))}${icon("chevron")}</span></button>`;
}
function taskRow(item) {
  return `<button class="task-row" ${assignmentAttrs(item)}><span class="due-stamp">${esc(dday(dateOf(item)))}</span><span><strong>${esc(title(item))}</strong><small>${esc(subjectName(item.subject))} · ${esc(assignmentLabel(item))}</small></span>${icon("chevron", "row-chevron")}</button>`;
}
function sectionHead(label, route, action = "전체 보기") {
  return `<div class="section-head"><h2>${esc(label)}</h2>${route ? `<button class="text-button" data-route="${route}">${esc(action)} ${icon("chevron")}</button>` : ""}</div>`;
}
function preparationRows(date) {
  return [...periodsFor(date).map((item, index) => ({ label: `${item.period || index + 1}교시 · ${periodTitle(item)}`, text: clean(item.materials || item.preparations || ""), attrs: `data-lesson="${index}" data-lesson-date="${date}" aria-haspopup="dialog"` })),
    ...assignments().filter(item => dateOf(item) === date).map(item => ({ label: title(item), text: clean(item.materials || ""), attrs: assignmentAttrs(item) }))].filter(row => row.text);
}
function todayPage() {
  const today = isoDate(new Date()), periods = periodsFor(today), tasks = upcomingAssignments(Infinity), dishes = dishList(mealFor(today));
  const live = lessonState(periods, today), lesson = periods[live.index], prep = preparationRows(today);
  return shell(`<main class="canvas" data-page="today">${intro(dateLabel(today), "오늘", "수업부터 마감까지, 오늘 필요한 것.")}
    <div class="today-layout">
      <section class="card focus-card"><div class="focus-caption">${icon("timeline")} ${esc(live.label)}</div>
        <h2>${esc(lesson ? periodTitle(lesson) : live.finished ? "내일을 준비할 시간" : periods.length ? `${periodTitle(periods[0])}부터 ${periods.length}교시` : "오늘 시간표를 확인해요")}</h2>
        <p>${esc(lesson ? `${lesson.period || live.index + 1}교시 · ${periodTime(lesson)}` : periods.length && !live.finished ? "수업 시각이 등록되지 않아 교시 순서로 안내해요." : "준비물과 가까운 마감을 아래에서 확인하세요.")}</p>
        <button class="soft-button" ${lesson ? `data-lesson="${live.index}" data-lesson-date="${today}" aria-haspopup="dialog"` : 'data-route="timetable"'}>${lesson ? "수업 준비 확인" : "시간표 열기"} ${icon("arrow")}</button>
        <div class="status-rail"><button data-route="timetable"><small>오늘 수업</small><strong>${periods.length}<span>교시</span></strong></button><button data-route="assessment"><small>오늘 마감</small><strong>${tasks.filter(x => dateOf(x) === today).length}<span>건</span></strong></button><button data-route="meal"><small>점심 메뉴</small><strong>${dishes.length || "—"}<span>${dishes.length ? "가지" : "확인"}</span></strong></button></div>
      </section>
      <section class="card prep-card">${sectionHead("오늘 챙길 것")}<div class="prep-list">${prep.length ? prep.map(row => `<button class="prep-row" ${row.attrs}>${icon("assignment")}<span><small>${esc(row.label)}</small><strong>${esc(row.text)}</strong></span>${icon("chevron")}</button>`).join("") : missing("neisTimetables", "등록된 준비물이 없어요. 수업별 안내도 확인해 주세요.")}</div></section>
      <section class="card deadlines-card">${sectionHead("가까운 마감", "assessment")}<div class="task-stack">${tasks.length ? tasks.slice(0,4).map(taskRow).join("") : missing("classAssignments", "다가오는 수행평가나 숙제가 없어요.")}</div></section>
      <section class="card today-meal">${sectionHead("오늘 점심", "meal", "급식 보기")}<ul class="menu-preview">${dishes.slice(0,6).map(dish => `<li>${esc(dish)}</li>`).join("")}</ul>${!dishes.length ? missing("meals", "오늘 식단이 아직 등록되지 않았어요.") : ""}</section>
      <section class="card today-periods">${sectionHead("오늘 수업", "timetable")}<div class="period-track">${periods.length ? periods.map((p,i) => periodRow(p,i,today)).join("") : missing("neisTimetables", "오늘 시간표가 아직 등록되지 않았어요.")}</div></section>
    </div></main>`);
}
function dateControl(date, kind = "date") {
  const weekday = new Date(`${date}T12:00:00`).getDay();
  const monday = addDays(date, -((weekday + 6) % 7));
  return `<div class="date-controls"><div class="date-toolbar"><button class="icon-button" data-${kind}="${addDays(date,-7)}" aria-label="이전 주">${icon("chevron", "flip")}</button><label class="date-picker">날짜 선택 <input type="date" data-date-input="${kind}" value="${date}" aria-label="날짜 선택" /></label><button class="icon-button" data-${kind}="${addDays(date,7)}" aria-label="다음 주">${icon("chevron")}</button><button class="text-button" data-${kind}="${isoDate(new Date())}">오늘</button></div>
    <div class="dayrail" aria-label="요일 선택">${Array.from({length:7},(_,i) => addDays(monday,i)).map(d => `<button class="day-chip ${d === date ? "is-selected" : ""}" data-${kind}="${d}" aria-pressed="${d === date}" aria-label="${esc(dateLabel(d))}"><span>${["일","월","화","수","목","금","토"][new Date(`${d}T12:00:00`).getDay()]}</span><strong>${Number(d.slice(-2))}</strong><small>${d === isoDate(new Date()) ? "오늘" : ""}</small></button>`).join("")}</div></div>`;
}
function weekTable(date) {
  const weekday = new Date(`${date}T12:00:00`).getDay();
  const monday = addDays(date,-((weekday+6)%7));
  const dates = Array.from({length:5},(_,i)=>addDays(monday,i));
  const count = Math.max(7,...dates.map(d => periodsFor(d).length));
  return `<div class="week-scroll" tabindex="0" aria-label="주간 시간표, 좁은 화면에서는 좌우로 스크롤"><table class="week-table"><caption>이번 주 수업</caption><thead><tr><th scope="col">교시</th>${dates.map(d=>`<th scope="col"><button class="week-date ${date===d?"is-selected":""}" data-date="${d}" aria-pressed="${date===d}">${esc(shortDate(d))}</button></th>`).join("")}</tr></thead><tbody>${Array.from({length:count},(_,i)=>`<tr><th scope="row">${i+1}</th>${dates.map(d=>{const periods=periodsFor(d),index=periods.findIndex((p,j)=>Number(p.period||j+1)===i+1),p=periods[index];return `<td class="${date===d?"selected-day":""}">${p?`<button class="week-lesson" data-lesson="${index}" data-lesson-date="${d}" aria-haspopup="dialog" aria-label="${esc(dateLabel(d))} ${i+1}교시 ${esc(periodTitle(p))}">${esc(periodTitle(p))}</button>`:'<span class="no-lesson">—</span>'}</td>`}).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function timetablePage() {
  const date=state.selectedDate, periods=periodsFor(date);
  return shell(`<main class="canvas" data-page="timetable">${intro("수업과 준비물", "시간표")} ${dateControl(date)}
    <div class="timetable-layout"><section class="card lesson-day">${sectionHead(dateLabel(date))}<p class="section-note">${periods.length ? `${periods.length}교시 · 수업을 누르면 준비물과 장소를 볼 수 있어요.` : "등록된 수업이 없어요."}</p><div class="period-track">${periods.length ? periods.map((p,i)=>periodRow(p,i,date)).join("") : missing("neisTimetables","이 날짜의 시간표가 아직 등록되지 않았어요.")}</div></section>
    <section class="card week-overview">${weekTable(date)}</section></div></main>`);
}
function scheduleDay(date, rows) {
  return `<section class="agenda-day"><div class="agenda-date"><strong>${date ? Number(date.slice(-2)) : "—"}</strong><span>${date ? esc(dateLabel(date)) : "날짜 미정"}</span><small>${esc(dday(date))}</small></div><div class="event-list">${rows.map(row=>`<button class="event" data-kind="${row.kind}" data-schedule-index="${scheduleItems().findIndex(r=>r.item===row.item && r.kind===row.kind)}" aria-haspopup="dialog"><span class="event-type">${esc(row.label)}</span><span><strong>${esc(row.title)}</strong><small>${esc(row.subject)}</small></span>${icon("chevron")}</button>`).join("")}</div></section>`;
}
function filtersMarkup(filters, kind, selected, items) {
  return `<div class="filter-row" role="group" aria-label="종류 선택">${filters.map(([value,label])=>`<button class="chip ${selected===value?"is-active":""}" data-${kind}-filter="${value}" aria-pressed="${selected===value}">${label}<span>${items.filter(x=>value==="all" || (x.kind || assignmentKind(x))===value).length}</span></button>`).join("")}</div>`;
}
function schedulePage() {
  const today=isoDate(new Date()), all=scheduleItems().filter(row=>!row.date||row.date>=today), rows=all.filter(row=>state.scheduleFilter==="all"||row.kind===state.scheduleFilter);
  const dates=[...new Set(rows.map(row=>row.date).filter(Boolean))];
  if(rows.some(row=>!row.date))dates.push("");
  return shell(`<main class="canvas" data-page="schedule">${intro("다가오는 날부터", "일정", "날짜를 따라 읽고, 필요한 일정을 눌러 확인해요.")}
    ${filtersMarkup([["all","전체"],["assessment","수행"],["exam","시험"],["preparation","숙제"],["academic","학사"],["event","학급"]],"schedule",state.scheduleFilter,all)}
    <div class="agenda-board">${dates.length?dates.map(date=>scheduleDay(date,rows.filter(row=>row.date===date))).join(""):missing("classAssignments","다가오는 일정이 없어요.")}</div></main>`);
}
function mission(item) {
  return `<button class="mission" ${assignmentAttrs(item)}><span class="mission__top"><span class="subject-pill">${esc(subjectName(item.subject))}</span><strong class="urgency">${esc(dday(dateOf(item)))}</strong></span><strong class="mission-title">${esc(title(item))}</strong><span class="mission-copy">${esc(clean(item.description || item.evaluationRange || "세부 내용을 확인해 주세요."))}</span><span class="mission__foot"><span>${esc(assignmentLabel(item))}</span><span>${esc(dateLabel(dateOf(item)))}</span>${icon("chevron")}</span></button>`;
}
function assessmentPage() {
  const today=isoDate(new Date()), soon=addDays(today,1), all=upcomingAssignments(Infinity), items=all.filter(item=>state.assessmentFilter==="all"||assignmentKind(item)===state.assessmentFilter);
  const groups=[["오늘·내일","먼저 확인해요",items.filter(x=>dateOf(x)&&dateOf(x)<=soon)], ["다가오는 평가","미리 준비해요",items.filter(x=>dateOf(x)>soon)], ["날짜 미정","공지 확인이 필요해요",items.filter(x=>!dateOf(x))]];
  return shell(`<main class="canvas" data-page="assessment">${intro("마감 순서대로", "수행평가", "수행평가·시험·숙제를 한곳에서 확인해요.")}${filtersMarkup([["all","전체"],["assessment","수행평가"],["exam","시험"],["preparation","숙제"]],"assessment",state.assessmentFilter,all)}
    <div class="assessment-board">${groups.filter(([, ,rows])=>rows.length).map(([name,copy,rows],i)=>`<section class="assessment-group ${i===0&&name==="오늘·내일"?"is-urgent":""}"><div class="group-heading"><h2>${name}<span>${rows.length}</span></h2><p>${copy}</p></div><div class="mission-grid">${rows.map(mission).join("")}</div></section>`).join("") || missing("classAssignments","조건에 맞는 평가가 없어요.")}</div></main>`);
}
function mealPage() {
  const date=state.mealDate, meal=mealFor(date), dishes=dishList(meal), future=Array.from({length:5},(_,i)=>addDays(date,i+1));
  return shell(`<main class="canvas" data-page="meal">${intro("오늘 뭐 먹지?", "급식")}${dateControl(date,"meal-date")}
    <div class="meal-layout"><section class="card menu-sheet"><div class="menu-sheet__head"><div><small>${esc(dateLabel(date))}</small><h2>${esc(meal?.mealType||"점심")}</h2></div>${icon("restaurant")}</div><ol class="menu-list">${dishes.map((dish,i)=>`<li><span>${String(i+1).padStart(2,"0")}</span><strong>${esc(dish)}</strong></li>`).join("")}</ol>${!dishes.length?missing("meals","이 날짜의 급식 메뉴가 아직 등록되지 않았어요."):""}<button class="soft-button" data-action="meal-detail" aria-haspopup="dialog">원산지·급식 정보 ${icon("chevron")}</button></section>
    <section class="meal-next">${sectionHead("다음 식단")}<div class="meal-days">${future.map(d=>{const nextMeal=mealFor(d),menu=dishList(nextMeal);return `<button class="meal-day ${menu.length?"":"is-empty"}" data-meal-date="${d}"><span>${esc(shortDate(d))}</span><strong>${esc(menu.length?menu.slice(0,2).join(" · "):"식단 미등록")}</strong>${icon("chevron")}</button>`}).join("")}</div><p class="section-note">메뉴 옆 번호는 학교에서 제공하는 알레르기 표시예요.</p></section></div></main>`);
}
function quickAction(attrs, name, copy, glyph) {
  return `<button class="quick-action" ${attrs}><em>${icon(glyph)}</em><span><strong>${esc(name)}</strong><small>${esc(copy)}</small></span>${icon("chevron")}</button>`;
}
function hubPage() {
  const p=profile();
  return shell(`<main class="canvas" data-page="hub">${intro("학교생활 도구", "허브")}<div class="hub-layout"><section class="hub-section">${sectionHead("매일 쓰는 것")}<div class="hub-grid">${quickAction('data-route="meal"',"급식","날짜별 메뉴와 급식 정보","restaurant")}${quickAction('data-route="timetable"',"수업과 준비물","교시별 장소와 준비물 확인","timeline")}${quickAction('data-route="assessment"',"평가와 숙제","다가오는 마감 확인","assignment")}</div></section><section class="hub-section">${sectionHead("학급과 설정")}<div class="hub-grid">${quickAction('data-classic-route="classroom"',"학급 운영","자리배치 · 행사 · 자료실","group")}${quickAction('data-classic-route="schedule"',"일정 편집","기존 편집 화면 열기","event")}${quickAction('data-classic-route="more"',"알림과 계정","알림 · 계정 · 앱 설치","settings")}</div></section><section class="hub-section hub-account">${sectionHead("현재 학급")}<div class="hub-grid">${quickAction('data-action="change-class"',`${p?.grade||"-"}학년 ${p?.classNumber||"-"}반`,"학급 다시 선택","group")}${quickAction('data-action="classic"',"기존 PinCon","전체 기능 열기","open")}</div></section></div></main>`);
}

function profileGate() {
  return `<main class="profile-gate">
    <img src="../assets/pincon-icon.svg" alt="PinCon" />
    <h1>어느 반인가요?</h1>
    <p>학급을 선택하면 시간표와 급식, 평가 일정을 볼 수 있어요.</p>
    <form class="profile-fields" id="profileForm">
      <select name="grade" aria-label="학년">
        <option value="1">1학년</option>
        <option value="2">2학년</option>
        <option value="3">3학년</option>
      </select>
      <select name="classNumber" aria-label="반">
        ${Array.from({ length: 10 }, (_, index) => `<option value="${index + 1}">${index + 1}반</option>`).join("")}
      </select>
      <button class="soft-button">Flow 시작</button>
    </form>
  </main>`;
}

function hideBoot() {
  if (!boot?.classList.contains("is-hidden")) {
    boot?.classList.add("is-hidden");
    window.dispatchEvent(new Event("pincon-flow-ready"));
  }
}
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let renderFrame = 0, transitionTimer = 0, pendingRender = {}, lastMarkup = "";
function focusKey(element) {
  if (!element?.dataset) return "";
  return element.tagName + JSON.stringify(Object.entries(element.dataset));
}
function render(options = {}) {
  pendingRender.motion ||= Boolean(options.motion);
  pendingRender.routeChange ||= Boolean(options.routeChange);
  if (renderFrame || transitionTimer) return;
  renderFrame = requestAnimationFrame(() => {
    renderFrame = 0;
    if (pendingRender.motion && !reducedMotion.matches && app.querySelector(".canvas")) {
      app.querySelector(".canvas").classList.add("is-leaving");
      transitionTimer = setTimeout(() => { transitionTimer = 0; commitRender(); }, 90);
    } else commitRender();
  });
}
function commitRender() {
  const options = pendingRender;
  pendingRender = {};
  try {
    const pages = { today: todayPage, timetable: timetablePage, schedule: schedulePage, assessment: assessmentPage, meal: mealPage, hub: hubPage };
    const markup = !profile() || state.choosingClass ? profileGate() : (pages[state.route] || todayPage)();
    if (markup === lastMarkup) { app.querySelector(".canvas")?.classList.remove("is-leaving"); hideBoot(); return; }
    lastMarkup = markup;
    const active = document.activeElement;
    const activeKey = app.contains(active) ? focusKey(active) : "";
    const filterScroll = app.querySelector(".filter-row")?.scrollLeft || 0;
    const weekScroll = app.querySelector(".week-scroll")?.scrollLeft || 0;
    const template = document.createElement("template");
    template.innerHTML = markup;
    const current = app.querySelector(".canvas"), next = template.content.querySelector(".canvas");
    if (current && next) {
      current.replaceWith(next);
      app.querySelectorAll(".nav-button").forEach(button => {
        const selected = button.dataset.route === state.route;
        button.classList.toggle("is-active", selected);
        if (selected) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
      });
      const status = app.querySelector(".sync-status");
      if (status) status.textContent = syncLabel();
      const brand = app.querySelector(".brand-lockup span");
      if (brand) brand.textContent = `${profile()?.grade}학년 ${profile()?.classNumber}반 · Beta`;
    } else app.replaceChildren(template.content);
    if (options.motion) app.querySelector(".canvas")?.classList.add("is-entering");
    const filter = app.querySelector(".filter-row"), week = app.querySelector(".week-scroll");
    if (filter) filter.scrollLeft = filterScroll;
    if (week) week.scrollLeft = weekScroll;
    if (!sheet.open) {
      if (options.routeChange) {
        window.scrollTo({top:0,behavior:"instant"});
        app.querySelector("h1")?.focus({preventScroll:true});
      } else if (activeKey && !active?.isConnected) {
        [...app.querySelectorAll("button,input,select")].find(el => focusKey(el) === activeKey && el.getClientRects().length)?.focus({preventScroll:true});
      }
    }
    hideBoot();
  } catch (error) { fail(error); }
}
let sheetTimer = 0, sheetTrigger = null, sheetTriggerKey = "";
function showSheet() {
  clearTimeout(sheetTimer);
  sheetTrigger = document.activeElement;
  sheetTriggerKey = focusKey(sheetTrigger);
  sheetTrigger?.setAttribute?.("aria-expanded", "true");
  if (!sheet.open) sheet.showModal();
  sheet.scrollTop = 0;
  requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add("is-visible")));
}
function closeSheet() {
  if (!sheet.open) return;
  clearTimeout(sheetTimer);
  sheet.classList.remove("is-visible");
  const finish = () => {
    sheet.close();
    const trigger = sheetTrigger?.isConnected ? sheetTrigger : [...app.querySelectorAll("button")].find(el => focusKey(el) === sheetTriggerKey && el.getClientRects().length);
    trigger?.removeAttribute("aria-expanded");
    trigger?.focus({preventScroll:true});
    sheetTrigger = null;
  };
  if (reducedMotion.matches) finish(); else sheetTimer = setTimeout(finish, 180);
}
sheet?.addEventListener("cancel", event => { event.preventDefault(); closeSheet(); });
sheet?.querySelector("form")?.addEventListener("submit", event => { event.preventDefault(); closeSheet(); });
sheet?.addEventListener("click", event => {
  if (event.target !== sheet) return;
  const r = sheet.getBoundingClientRect();
  if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeSheet();
});
function openLesson(index, date) {
  const period = periodsFor(date)[Number(index)];
  if (!period) return;
  const room = clean(period.room || period.classroom || period.place || "");
  const related = assignments().filter(item => dateOf(item) === date && subjectName(item.subject) === periodTitle(period));
  sheetContent.innerHTML = `<h2 class="sheet-title" id="flowSheetTitle">${esc(periodTitle(period))}</h2><div class="sheet-meta">${esc(dateLabel(date))} · ${esc(period.period || Number(index)+1)}교시</div><div class="sheet-section"><h3>시간과 장소</h3><p>${esc(periodTime(period) || "수업 시각 미등록")}<br>${esc(room || "장소 미등록")}</p></div><div class="sheet-section"><h3>준비물</h3><p>${esc(clean(period.materials || period.preparations || "등록된 준비물이 없어요."))}</p></div>${period.note?`<div class="sheet-section"><h3>수업 안내</h3><p>${esc(clean(period.note))}</p></div>`:""}${related.length?`<div class="sheet-section"><h3>이날의 평가·숙제</h3>${related.map(item=>`<p>${esc(title(item))}${item.materials?` · 준비물: ${esc(clean(item.materials))}`:""}</p>`).join("")}</div>`:""}`;
  showSheet();
}
function openSchedule(index) {
  const row = scheduleItems()[Number(index)];
  if (!row) return;
  if (["assessment","exam","preparation"].includes(row.kind)) { openAssignment(assignments().indexOf(row.item), row.item.id); return; }
  const item = row.item;
  sheetContent.innerHTML = `<h2 class="sheet-title" id="flowSheetTitle">${esc(row.title)}</h2><div class="sheet-meta">${esc(row.label)} · ${esc(dateLabel(row.date))}</div><div class="sheet-section"><h3>일정 안내</h3><p>${esc(clean(item.description || item.question || item.body || item.content || "추가 안내가 아직 없어요."))}</p></div>${item.place || item.location?`<div class="sheet-section"><h3>장소</h3><p>${esc(clean(item.place || item.location))}</p></div>`:""}`;
  showSheet();
}

function openMeal() {
  const date = state.route === "meal" ? state.mealDate : isoDate(new Date());
  const meal = mealFor(date);
  const dishes = dishList(meal);

  sheetContent.innerHTML = `<h2 class="sheet-title" id="flowSheetTitle">급식 정보</h2>
    <div class="sheet-meta">${esc(dateLabel(date))} · ${esc(meal?.mealType || "중식")}</div>
    <div class="sheet-section">
      <h3>메뉴</h3>
      <div class="meal-card__menu">
        ${dishes.length ? dishes.map((dish) => `<span class="dish">${esc(dish)}</span>`).join("") : empty("급식 메뉴가 없습니다.")}
      </div>
    </div>
    <div class="sheet-section">
      <h3>급식 정보</h3>
      <p>${esc(meal?.calories || "열량 정보 없음")}<br>${esc(clean(meal?.origin || meal?.source || "NEIS"))}</p>
    </div>`;

  showSheet();
}

function openAssignment(index, id) {
  const list = assignments();
  const item =
    (id && list.find((candidate) => String(candidate.id) === String(id))) ||
    list[Number(index)] ||
    null;

  if (!item) return;

  const date = dateOf(item);
  sheetContent.innerHTML = `<h2 class="sheet-title" id="flowSheetTitle">${esc(title(item))}</h2>
    <div class="sheet-meta">${esc(subjectName(item.subject))} · ${esc(assignmentLabel(item))} · ${esc(dday(date))}</div>
    <div class="sheet-section"><h3>언제?</h3><p>${esc(date ? dateLabel(date) : "날짜가 아직 정해지지 않았습니다.")}</p></div>
    <div class="sheet-section"><h3>무엇을?</h3><p>${esc(clean(item.description || item.evaluationMethod || item.evaluationRange || "세부 설명이 아직 없습니다."))}</p></div>
    ${item.materials ? `<div class="sheet-section"><h3>준비물</h3><p>${esc(clean(item.materials))}</p></div>` : ""}
    ${item.points ? `<div class="sheet-section"><h3>배점</h3><p>${esc(clean(item.points))}</p></div>` : ""}`;

  showSheet();
}

function fail(error) {
  console.error("[PinCon Flow]", error);
  hideBoot();
  lastMarkup = "";

  app.innerHTML = `<main class="profile-gate">
    <img src="../assets/pincon-icon.svg" alt="PinCon" />
    <h1>Flow를 열지 못했습니다.</h1>
    <p>${esc(error?.message || "알 수 없는 오류가 발생했습니다.")}</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
      <button data-action="retry-flow">다시 시도</button>
      <button data-action="classic">기존 PinCon 열기</button>
    </div>
  </main>`;
}

app.addEventListener("click", async (event) => {
  const routeButton = event.target.closest("[data-route]");
  if (routeButton) {
    go(routeButton.dataset.route);
    return;
  }

  const dateButton = event.target.closest("[data-date]");
  if (dateButton) {
    state.selectedDate = dateButton.dataset.date;
    render({ motion: true });
    return;
  }

  const scheduleFilter = event.target.closest("[data-schedule-filter]");
  if (scheduleFilter) {
    state.scheduleFilter = scheduleFilter.dataset.scheduleFilter;
    render({ motion: true });
    return;
  }

  const assessmentFilter = event.target.closest("[data-assessment-filter]");
  if (assessmentFilter) {
    state.assessmentFilter = assessmentFilter.dataset.assessmentFilter;
    render({ motion: true });
    return;
  }

  const mealDate = event.target.closest("[data-meal-date]");
  if (mealDate) { state.mealDate = mealDate.dataset.mealDate; render({ motion: true }); return; }
  const lesson = event.target.closest("[data-lesson]");
  if (lesson) { openLesson(lesson.dataset.lesson, lesson.dataset.lessonDate); return; }
  const schedule = event.target.closest("[data-schedule-index]");
  if (schedule) { openSchedule(schedule.dataset.scheduleIndex); return; }
  const action = event.target.closest("[data-action]")?.dataset.action;

  if (action === "meal-detail") {
    openMeal();
    return;
  }

  if (action === "refresh") {
    const button = event.target.closest("button");
    if (button.disabled) return;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
      await gateway.retry();
      state.data = gateway.snapshot();
      render();
    } catch (error) {
      fail(error);
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
    return;
  }

  if (action === "classic") {
    location.href = "../";
    return;
  }

  if (action === "change-class") {
    state.choosingClass = true;
    render({ motion: true });
    return;
  }

  if (action === "retry-flow") {
    location.reload();
    return;
  }

  const classic = event.target.closest("[data-classic-route]");
  if (classic) {
    location.href = `../#${classic.dataset.classicRoute}`;
    return;
  }

  const item = event.target.closest("[data-item-kind=assignment]");
  if (item) {
    openAssignment(item.dataset.itemIndex, item.dataset.itemId);
  }
});

app.addEventListener("submit", async (event) => {
  if (event.target.id !== "profileForm") return;
  event.preventDefault();

  try {
    const form = new FormData(event.target);
    saveClassProfile(Number(form.get("grade")), Number(form.get("classNumber")));
    state.choosingClass = false;
    await gateway.retry();
    state.data = gateway.snapshot();
    render();
  } catch (error) {
    fail(error);
  }
});

function syncRoute() {
  const route = routeFromHash();
  if (route === state.route) return;
  state.route = route;
  if (sheet.open) closeSheet();
  render({ motion: true, routeChange: true });
}
window.addEventListener("popstate", syncRoute);
window.addEventListener("hashchange", syncRoute);
app.addEventListener("change", event => {
  const input = event.target.closest("[data-date-input]");
  if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(input.value)) return;
  if (input.dataset.dateInput === "meal-date") state.mealDate = input.value;
  else state.selectedDate = input.value;
  render({ motion: true });
});
let observedToday = isoDate(new Date());
function refreshClock() {
  if (document.hidden) return;
  const today = isoDate(new Date());
  if (today !== observedToday) {
    if (state.selectedDate === observedToday) state.selectedDate = today;
    if (state.mealDate === observedToday) state.mealDate = today;
    observedToday = today;
  }
  render(); // Identical markup is skipped, and background updates never animate.
}
setInterval(refreshClock, 60000);
document.addEventListener("visibilitychange", refreshClock);

window.addEventListener("error", (event) => {
  if (!boot?.classList.contains("is-hidden")) {
    fail(event.error || new Error(event.message || "페이지 오류"));
  }
});

window.addEventListener("unhandledrejection", (event) => {
  if (!boot?.classList.contains("is-hidden")) {
    fail(event.reason instanceof Error ? event.reason : new Error(String(event.reason || "데이터 오류")));
  }
});

gateway.addEventListener("change", (event) => {
  state.data = event.detail;
  render();
});

async function start() {
  state.route = routeFromHash();
  render();

  if (!profile()) return;

  try {
    await gateway.start();
    state.data = gateway.snapshot();
    render();
  } catch (error) {
    fail(error);
  }
}

start();

