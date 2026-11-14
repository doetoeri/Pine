import { NextDataGateway, readClassProfile, saveClassProfile } from "../next/core/data-gateway.js";
import { patchPage } from "../next/core/region-renderer.js";
import { calendarDate, calendarDateLabel, shiftCalendarDay } from "../new/calendar.js?v=20261013-grid1";
import { kstDate } from "../pincon-class-ops-core.js";
import {
  ALLERGENS, academicEvents, classEvents, dailyMeals, dailyTimetable, deadlineLabel,
  importantNotices, lessonTiming, schoolWeek, upcomingAssessments,
} from "./model.js?v=20261114-school-life";

const pages = { home: "학교생활", meals: "급식", timetable: "시간표", schedule: "학급 일정" };
const dateFormat = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric", weekday: "long" });
const weekdays = ["월", "화", "수", "목", "금", "토", "일"];
const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const main = document.querySelector("#main");
const classButton = document.querySelector("#class-select");
const classDialog = document.querySelector("#class-dialog");
const classForm = document.querySelector("#class-form");
const maxReadAge = 5 * 60 * 1000;

if (!readClassProfile()) saveClassProfile(1, 8);
const gateway = new NextDataGateway();
const weekReads = new Map();
let paintedPage = "";
let changingClass = false;
let pendingRetry = false;

function pageFromUrl() {
  const [name, date] = location.hash.slice(1).split("/");
  const page = ["meals", "timetable", "schedule"].includes(name) ? name : "home";
  return { page, date: calendarDate(date) || kstDate() };
}

function schoolDate(date) {
  return dateFormat.format(new Date(`${date}T12:00:00+09:00`));
}

function heading(title, date, description = "") {
  return `<header class="page-heading" data-render-key="heading"><p><time datetime="${date}">${schoolDate(date)}</time></p>
    <h1 tabindex="-1">${title}</h1>${description ? `<p>${escape(description)}</p>` : ""}</header>`;
}

function panel(key, title, body, link = "", theme = "") {
  return `<section class="panel ${theme}" data-render-key="${key}" aria-labelledby="${key}-title">
    <div class="panel-heading"><h2 id="${key}-title">${title}</h2>${link}</div>${body}</section>`;
}

function pageLink(href, label) {
  return `<a class="text-link" href="${href}">${label}<span aria-hidden="true"> ↗</span></a>`;
}

function unavailable(names, snapshot, empty, context = {}) {
  const { historical = false, read } = context;
  if (read?.status === "success") return `<p class="state">${empty}</p>`;
  const results = names.map(name => snapshot.collectionStatus?.[name]);
  const loading = read?.status === "loading" || results.some(status => status === "idle" || status === "loading")
    || (!snapshot.ready && !snapshot.error);
  const error = !snapshot.online || Boolean(snapshot.error && results.every(status => !status))
    || results.some(status => ["error", "cached-error"].includes(status)) || read?.status === "error";
  if (loading && !error) return '<p class="state" role="status">자료를 불러오는 중…</p>';
  if (error) return `<div class="retry-row"><p class="state" role="status">최신 자료를 불러오지 못했어요.</p><button class="chip" type="button" data-retry>다시 시도</button></div>`;
  if (historical) {
    return '<p class="state">저장된 자료에서 이 날짜의 정보를 확인할 수 없어요.</p>';
  }
  if (results.includes("cached")) return '<p class="state">저장된 자료에 표시할 항목이 없어요.</p>';
  return `<p class="state">${empty}</p>`;
}

function weekQuery(snapshot, page, date, today) {
  const key = snapshot.profile?.classKey;
  if (!key) return null;
  const names = {
    home: ["meals", "neisTimetables"], meals: ["meals"], timetable: ["neisTimetables"], schedule: ["academicSchedules"],
  }[page];
  const days = page === "home" ? [today] : schoolWeek(date);
  return { key, names, from: days[0], through: days.at(-1), id: `${key}/${days[0]}/${days.at(-1)}/${names.join("+")}` };
}

function getWeek(snapshot, query) {
  if (!query || !gateway.repository?.api || !snapshot.ready || !snapshot.online || changingClass) return {};
  return Object.fromEntries(query.names.map(name => {
    const id = `${query.id}/${name}`;
    const existing = weekReads.get(id);
    if (existing && (existing.status === "loading" || Date.now() - existing.time < maxReadAge)) return [name, existing];
    const result = { status: "loading", time: Date.now(), rows: [] };
    weekReads.set(id, result);
    if (weekReads.size > 20) weekReads.delete(weekReads.keys().next().value);
    let timeout;
    const timed = new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error("학교 정보 연결이 지연됐어요.")), 8_000);
    });
    Promise.race([gateway.repository.readSchoolDates(name, query), timed])
      .then(rows => { result.rows = rows; result.status = "success"; })
      .catch(() => { result.status = "error"; })
      .finally(() => { clearTimeout(timeout); result.time = Date.now(); render(); });
    return [name, result];
  }));
}

function updatedData(snapshot, query, results) {
  const data = { ...snapshot.data };
  for (const [name, result] of Object.entries(results)) {
    if (result.status !== "success") continue;
    const newer = snapshot.collectionStatus?.[name] === "success" ? (data[name] || []) : [];
    const byId = new Map(result.rows.map(row => [row.id, row]));
    // The shared listener may have a record that changed after the week was read.
    for (const row of newer) {
      if (row.date >= query.from && row.date <= query.through) byId.set(row.id, row);
    }
    data[name] = [...byId.values()];
  }
  return data;
}

function sourceOf(row) {
  if (row?.source === "COMCIGAN") return "컴시간";
  return row?.source === "NEIS" ? "나이스" : escape(row?.source || "");
}

function entryStatus(label, snapshot, read) {
  return snapshot.collectionStatus?.[label] === "success" || read?.status === "success"
    ? "" : '<p class="meta week-source">저장된 자료 · 최신 정보는 연결 후 확인할 수 있어요.</p>';
}

function mealSummary(meals) {
  const meal = meals.find(item => item.mealType === "중식") || meals[0];
  return `<p class="lead">${escape(meal.mealType || "식단")}</p><p class="meta">${meal.dishes.slice(0, 4).map(dish => escape(dish.name)).join(" · ")}${meal.dishes.length > 4 ? ` 외 ${meal.dishes.length - 4}가지` : ""}</p>`;
}

function timetableSummary(timetable, date, now) {
  const timing = lessonTiming(timetable.periods, date, now);
  const lesson = item => `${escape(item.period)}교시 ${escape(item.subject)}`;
  if (!timing.available) return `<p class="lead">${timetable.periods.length}개 수업</p>
    <p class="meta">${timetable.periods.slice(0, 3).map(lesson).join(" · ")}</p><p class="state">교시 시각이 등록되면 다음 수업을 표시해요.</p>`;
  return `<p class="lead">${timing.next ? `다음 수업 · ${lesson(timing.next)}` : "오늘의 다음 수업이 없어요."}</p>
    <p class="meta">${timing.current ? `현재 수업 · ${lesson(timing.current)}` : `오늘 ${timetable.periods.length}개 수업`}</p>`;
}

function assessmentList(rows, today) {
  return `<ul class="list">${rows.map(row => `<li><a class="assignment-row" href="./new/?assignment=${encodeURIComponent(row.id)}">
    <span class="assignment-copy"><strong>${escape(row.title)}</strong><small class="meta">${escape(row.subject || "수행평가")} · <time datetime="${row.date}">${calendarDateLabel(row.date)}</time></small></span>
    <span class="deadline">${deadlineLabel(row.date, today)}</span></a></li>`).join("")}</ul>`;
}

function noticesList(rows) {
  return `<ul class="list">${rows.map(row => `<li class="event-row"><details data-render-key="${escape(row.id)}">
    <summary><strong>${escape(row.title)}</strong><small class="meta">${row.priority === "urgent" || row.urgent ? "긴급 공지" : "중요 공지"}</small></summary>
    <p>${escape(row.body || "등록된 상세 안내가 없어요.")}</p></details></li>`).join("")}</ul>`;
}

function eventList(rows, summary = false) {
  return `<ul class="list">${rows.map(row => {
    const meta = `${row.date ? `<time datetime="${row.date}">${calendarDateLabel(row.date)}</time> · ` : ""}${row.category}`;
    if (summary) return `<li><div class="assignment-row"><span class="assignment-copy"><strong>${escape(row.title)}</strong><small class="meta">${meta}</small></span></div></li>`;
    if (!row.location && !row.body) return `<li><div class="assignment-row"><span class="assignment-copy"><strong>${escape(row.title)}</strong><small class="meta">${meta}</small></span></div></li>`;
    return `<li class="event-row"><details><summary><strong>${escape(row.title)}</strong><small class="meta">${meta}</small></summary>
      ${row.location ? `<p>장소 · ${escape(row.location)}</p>` : ""}<p>${escape(row.body || "등록된 상세 내용이 없어요.")}</p></details></li>`;
  }).join("")}</ul>`;
}

function home(snapshot, data, today, now, reads) {
  const classKey = snapshot.profile?.classKey;
  const days = schoolWeek(today);
  const begins = days[0], ends = days.at(-1);
  const assessments = upcomingAssessments(data.classAssignments || [], classKey, today, now).slice(0, 3);
  const notices = importantNotices(data, classKey).slice(0, 3);
  const events = classEvents(data.events || [], classKey).filter(row => row.date >= begins && row.date <= ends).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
  const meals = dailyMeals(data.meals || [], today);
  const timetable = dailyTimetable(data.neisTimetables || [], today, classKey);
  const school = globalThis.PINCON_SCHOOL_CONFIG?.name || "";
  return heading("오늘의 학교생활", today, school) + `<div class="home-grid" data-render-group data-render-key="home-grid">
    ${panel("today-meals", "오늘의 급식", meals.length ? mealSummary(meals) + entryStatus("meals", snapshot, reads.meals) : unavailable(["meals"], snapshot, "오늘 등록된 급식이 없어요.", { read: reads.meals }), pageLink("#meals", "식단·알레르기"), "panel--meal")}
    ${panel("today-timetable", "오늘의 시간표", timetable.periods.length ? timetableSummary(timetable, today, now) + entryStatus("neisTimetables", snapshot, reads.neisTimetables) : unavailable(["neisTimetables"], snapshot, "오늘 등록된 수업이 없어요.", { read: reads.neisTimetables }), pageLink("#timetable", "주간 시간표"), "panel--timetable")}
    ${panel("due-assessments", "다가오는 수행평가", assessments.length ? assessmentList(assessments, today) : unavailable(["classAssignments"], snapshot, "다가오는 마감일이 없어요."), pageLink("./new/", "수행평가 전체"))}
    ${panel("week-events", "이번 주 학급 일정", events.length ? eventList(events, true) : unavailable(["events"], snapshot, "이번 주 등록된 학급 일정이 없어요."), pageLink("#schedule", "이번 주 일정"), "panel--schedule")}
    ${panel("class-announcements", "중요 학급 공지", notices.length ? noticesList(notices) : unavailable(["announcements", "content"], snapshot, "표시할 중요 공지가 없어요."), "", "wide")}
    </div>`;
}

function weekNav(page, date, today) {
  const days = schoolWeek(date);
  const start = days[0], through = days.at(-1);
  return `<section class="panel" data-render-key="week-nav" aria-label="날짜 선택">
    <nav class="week-controls" aria-label="주간 탐색">
      <a class="chip" data-week="prev" href="#${page}/${shiftCalendarDay(start, -7)}" aria-label="이전 주">‹</a>
      <a class="chip" data-week="today" href="#${page}/${today}">오늘</a>
      <p>${calendarDateLabel(start)}–${calendarDateLabel(through)}</p>
      <a class="chip" data-week="next" href="#${page}/${shiftCalendarDay(start, 7)}" aria-label="다음 주">›</a>
    </nav>
    <nav aria-label="날짜별 보기"><ul class="week-days">${days.map((day, index) => `<li><a href="#${page}/${day}" data-day="${day}" aria-label="${schoolDate(day)}" ${day === date ? 'aria-current="date"' : ""}>
      <span>${weekdays[index]}</span><strong>${Number(day.slice(8))}</strong></a></li>`).join("")}</ul></nav>
  </section>`;
}

function mealSection(meal) {
  return `<section class="meal-group"><h3>${escape(meal.mealType || "식단")}</h3>
    ${meal.calories ? `<p class="meta">${escape(meal.calories)}</p>` : ""}
    <ul class="meal-items">${meal.dishes.map(({ name, codes }) => `<li>${escape(name)}${codes.length ? `<small class="meta">알레르기 표시 · ${codes.map(code => ALLERGENS[code]).join(", ")}</small>` : ""}</li>`).join("")}</ul>
    ${meal.dishes.some(dish => dish.codes.length) ? "" : '<p class="state">나이스에 표시된 알레르기 번호가 없어요.</p>'}
    </section>`;
}

function periodSection({ periods, row }, date, now) {
  const timing = now ? lessonTiming(periods, date, now) : null;
  return `${timing && !timing.available ? '<p class="state">교시별 시작·종료 시각이 등록되면 현재와 다음 수업을 표시해요.</p>' : ""}
    <ol class="list period-list">${periods.map(period => {
      const status = timing?.current === period ? "현재 수업" : timing?.next === period ? "다음 수업" : "";
      const time = [period.startTime || period.startsAt, period.endTime || period.endsAt].filter(Boolean).join("–");
      return `<li${status ? ` class="${timing.current === period ? "is-current" : "is-next"}"` : ""}><b>${escape(period.period)}교시</b>
        <div><strong>${escape(period.subject)}</strong>${time || status ? `<small class="meta">${[escape(time), status].filter(Boolean).join(" · ")}</small>` : ""}</div></li>`;
    }).join("")}</ol>${row.source ? `<p class="meta week-source">출처 · ${sourceOf(row)}</p>` : ""}`;
}

function academicSection(snapshot, data, date, read) {
  const selected = academicEvents(data.academicSchedules || [], snapshot.profile?.grade).filter(row => row.date === date);
  return panel("school-events", "학사 일정", selected.length ? eventList(selected) : unavailable(["academicSchedules"], snapshot, "이날 등록된 학사 일정이 없어요.", { historical: true, read }), "", "panel--timetable");
}

function weeklyTimetable(snapshot, data, date, read) {
  const days = schoolWeek(date);
  const week = days.map((day, index) => ({ day, weekday: weekdays[index], ...dailyTimetable(data.neisTimetables || [], day, snapshot.profile?.classKey) }));
  if (!week.some(day => day.periods.length)) return "";
  return panel("weekly-timetable", "주간 시간표", `<details class="week-overview"><summary>요일별 수업 펼치기</summary>
    <div class="week-lessons">${week.map(({ day, weekday, row, periods }) =>
      periods.length || !["토", "일"].includes(weekday) ? `<section>
        <h3>${weekday}요일 · ${calendarDateLabel(day)}</h3>
        ${periods.length ? periodSection({ periods, row }, day) : unavailable(["neisTimetables"], snapshot, "등록된 시간표가 없어요.", { historical: day < kstDate(), read })}
      </section>` : "").join("")}</div></details>`);
}

function detailsPage(snapshot, data, page, date, today, now, reads) {
  const head = heading(pages[page], date) + weekNav(page, date, today);
  const classKey = snapshot.profile?.classKey;
  let body;
  if (page === "meals") {
    const meals = dailyMeals(data.meals || [], date);
    body = panel("day-meals", "날짜별 식단", meals.length ? meals.map(mealSection).join("") + '<p class="meta week-source">출처 · 나이스 교육정보 개방 포털</p>' + entryStatus("meals", snapshot, reads.meals) : unavailable(["meals"], snapshot, "이날 등록된 급식이 없어요.", { historical: date < today, read: reads.meals }), "", "panel--meal");
  } else if (page === "timetable") {
    const timetable = dailyTimetable(data.neisTimetables || [], date, classKey);
    body = panel("day-timetable", "교시별 수업", timetable.periods.length ? periodSection(timetable, date, now) + entryStatus("neisTimetables", snapshot, reads.neisTimetables) : unavailable(["neisTimetables"], snapshot, "이날 등록된 시간표가 없어요.", { historical: date < today, read: reads.neisTimetables }), "", "panel--timetable")
      + weeklyTimetable(snapshot, data, date, reads.neisTimetables);
  } else {
    const all = classEvents(data.events || [], classKey);
    const dates = schoolWeek(date);
    const week = all.filter(row => row.date >= dates[0] && row.date <= dates.at(-1)).sort((a, b) => a.date.localeCompare(b.date));
    const shown = week.filter(row => row.date === date);
    const otherDays = week.filter(row => row.date !== date);
    const undated = all.filter(row => !row.date);
    const manage = snapshot.canArchiveContent ? pageLink("./next/admin/?content=events#content-center", "학급 일정 관리") : "";
    body = panel("class-events", "학급 일정 및 행사", `<div class="event-section"><h3>선택한 날짜</h3>${shown.length ? eventList(shown) : unavailable(["events"], snapshot, "이날 등록된 학급 일정이 없어요.")}</div>
      ${otherDays.length || shown.length ? `<div class="event-section"><h3>이번 주 다른 날짜</h3>${otherDays.length ? eventList(otherDays) : '<p class="state">다른 날짜에 등록된 일정이 없어요.</p>'}</div>` : ""}
      ${undated.length ? `<div class="event-section"><h3>날짜가 정해지지 않은 행사</h3>${eventList(undated)}</div>` : ""}`, manage, "panel--schedule") + academicSection(snapshot, data, date, reads.academicSchedules);
  }
  return head + `<div class="day-grid" data-render-key="day-grid" data-render-group>${body}</div>`;
}

function render() {
  const { page, date } = pageFromUrl();
  const now = Date.now(), today = kstDate(now);
  const base = gateway.snapshot();
  const snapshot = changingClass ? { ...base, data: {}, ready: false, error: "", collectionStatus: {}, canArchiveContent: false } : base;
  const query = weekQuery(snapshot, page, date, today);
  const reads = getWeek(snapshot, query);
  const data = updatedData(snapshot, query, reads);
  const markup = page === "home"
    ? home(snapshot, data, today, now, reads)
    : detailsPage(snapshot, data, page, date, today, now, reads);

  classButton.textContent = snapshot.profile ? `${snapshot.profile.grade}학년 ${snapshot.profile.classNumber}반` : "학급 선택";
  classButton.setAttribute("aria-label", `학급 선택 · ${classButton.textContent}`);
  for (const link of document.querySelectorAll("[data-page]")) {
    if (link.dataset.page === page) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  document.title = `PinCon · ${pages[page]}`;
  patchPage(main, `<div class="view-enter">${markup}</div>`, paintedPage === page);
  paintedPage = page;
}

function moveFocus(control) {
  const next = control?.dataset.week ? main.querySelector(`[data-week="${control.dataset.week}"]`)
    : control?.dataset.day ? main.querySelector(`[data-day="${control.dataset.day}"]`) : main.querySelector("h1");
  next?.focus();
}

document.addEventListener("click", event => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  const link = event.target.closest("a");
  if (!link) return;
  if (link.id === "skip-content") { event.preventDefault(); moveFocus(); return; }
  const homeLink = link.classList.contains("brand") || link.dataset.page === "home";
  const hash = link.getAttribute("href");
  if (!homeLink && !/^#(?:meals|timetable|schedule)(?:\/|$)/.test(hash || "")) return;
  event.preventDefault();
  const target = location.pathname + location.search + (homeLink ? "" : hash);
  if (target !== location.pathname + location.search + location.hash) history.pushState(null, "", target);
  render(); moveFocus(link);
});
window.addEventListener("popstate", () => { render(); moveFocus(); });
window.addEventListener("hashchange", render);

main.addEventListener("click", async event => {
  const button = event.target.closest("[data-retry]");
  if (!button || pendingRetry || changingClass) return;
  pendingRetry = true;
  const { page, date } = pageFromUrl();
  const query = weekQuery(gateway.snapshot(), page, date, kstDate());
  for (const name of query?.names || []) weekReads.delete(`${query.id}/${name}`);
  const target = event.target.closest("section")?.querySelector("h2")?.id;
  document.getElementById(target || "")?.setAttribute("tabindex", "-1");
  document.getElementById(target || "")?.focus({ preventScroll: true });
  try { await gateway.retry(); }
  finally { pendingRetry = false; render(); }
});
classForm.elements.classNumber.innerHTML = Array.from({ length: 10 }, (_, index) => `<option value="${index + 1}">${index + 1}반</option>`).join("");
classButton.addEventListener("click", () => {
  if (changingClass) return;
  const profile = readClassProfile();
  classForm.elements.grade.value = profile.grade;
  classForm.elements.classNumber.value = profile.classNumber;
  classDialog.showModal();
});
classForm.addEventListener("submit", async event => {
  if (event.submitter?.value !== "apply") return;
  event.preventDefault();
  const oldClass = readClassProfile().classKey;
  const profile = saveClassProfile(classForm.elements.grade.value, classForm.elements.classNumber.value);
  classDialog.close();
  if (oldClass === profile.classKey) return;
  changingClass = true;
  try { await gateway.retry(); }
  finally { changingClass = false; render(); }
});

gateway.addEventListener("change", render);
document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });
setInterval(() => { if (!document.hidden) render(); }, 30_000);
render();
gateway.start();
