import { calendarDateLabel, shiftCalendarDay } from "../new/calendar.js?v=20261013-grid1";
import {
  ALLERGENS, academicEvents, classEvents, dailyMeals, dailyTimetable, deadlineLabel,
  importantNotices, lessonTiming, schoolWeek, upcomingAssessments,
} from "./model.js?v=20261114-school-life";

export const pages = { home: "학교생활", meals: "급식", timetable: "시간표", schedule: "학급 일정", notices: "공지" };
const themes = { home: 5, meals: 2, timetable: 0, assessment: 4, schedule: 1, notices: 3 };
const weekdays = ["월", "화", "수", "목", "금", "토", "일"];
const koreanDate = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "long" });
const koreanYear = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric" });

const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const schoolDate = date => koreanDate.format(new Date(`${date}T12:00:00+09:00`));
const line = (value, label = "") => ({ label, value });

export function heading(title, date, weekly = false, undated = false) {
  return `<header class="page-heading" data-render-key="heading">
    <h1 tabindex="-1">${title}</h1><p><time data-stage-date datetime="${date}">${undated ? "날짜 미정" : stageDate(date, weekly)}</time></p>
  </header>`;
}

function stageDate(date, weekly) {
  return weekly ? schoolDate(date) : `${koreanYear.format(new Date(`${date}T12:00:00+09:00`))} ${schoolDate(date)}`;
}

export function updateStageDate(root, date, undated = false) {
  const time = root.querySelector("[data-stage-date]");
  time.dateTime = date;
  time.textContent = undated ? "날짜 미정" : stageDate(date, true);
  for (const link of root.querySelectorAll("[data-day]")) {
    if (!undated && link.dataset.day === date) link.setAttribute("aria-current", "date");
    else link.removeAttribute("aria-current");
  }
}

export function weekNav(page, date, today, undated = false) {
  const days = schoolWeek(date);
  const start = days[0], end = days.at(-1);
  return `<div class="date-navigation" data-render-key="week-nav">
    <nav class="week-controls" aria-label="주간 탐색">
      <a class="chip week-arrow" data-week="prev" href="#${page}/${shiftCalendarDay(start, -7)}" aria-label="이전 주"><span aria-hidden="true">‹</span></a>
      <p>${calendarDateLabel(start)}–${calendarDateLabel(end)}</p>
      <a class="chip week-arrow" data-week="next" href="#${page}/${shiftCalendarDay(start, 7)}" aria-label="다음 주"><span aria-hidden="true">›</span></a>
      <a class="chip week-today" data-week="today" href="#${page}/${today}">오늘</a>
    </nav>
    <nav aria-label="날짜별 보기"><ul class="week-days">${days.map((day, index) => `<li>
      <a href="#${page}/${day}" data-day="${day}" aria-label="${schoolDate(day)}" ${!undated && day === date ? 'aria-current="date"' : ""}>
        <span>${weekdays[index]}</span><strong>${Number(day.slice(8))}</strong>
      </a></li>`).join("")}</ul></nav>
  </div>`;
}

function status(names, snapshot, empty, read) {
  if (read?.status === "success") return { message: empty };
  const results = names.map(name => snapshot.collectionStatus?.[name]);
  if (!snapshot.online || results.some(value => ["error", "cached-error"].includes(value))
    || read?.status === "error" || snapshot.error && results.every(value => !value)) {
    return { message: "최신 자료를 불러오지 못했어요.", retry: true };
  }
  if (read?.status === "loading" || results.some(value => value === "idle" || value === "loading")
    || !snapshot.ready) return { message: "자료를 불러오는 중…" };
  return { message: results.includes("cached") ? "저장된 자료에 표시할 항목이 없어요." : empty };
}

function sourceNote(name, snapshot, read) {
  return snapshot.collectionStatus?.[name] === "success" || read?.status === "success"
    ? "" : '<p class="paper-note">저장된 자료 · 최신 정보는 연결 후 확인할 수 있어요.</p>';
}

const lesson = period => `${period.period}교시 ${period.subject}`;
const dishNames = (meal, count) => meal.dishes.slice(0, count).map(dish => dish.name).join(" · ")
  + (meal.dishes.length > count ? ` 외 ${meal.dishes.length - count}가지` : "");
const note = message => `<p class="paper-note">${escape(message)}</p>`;
const action = (href, text) => `<a class="paper-link" href="${href}">${text}<span aria-hidden="true"> ↗</span></a>`;

function paper(id, theme, title, kicker, context, lines, footer, body = "", retry = false) {
  return { id, theme: themes[theme], title, kicker, context, lines, footer, body, retry };
}

function emptyPaper(page, date, context, message) {
  return paper(date, page, context || "중요 학급 공지", pages[page], "", [line(message.message)], "자료 확인", note(message.message), message.retry);
}

function mealPaper(data, snapshot, calls, date) {
  const meals = dailyMeals(data.meals || [], date);
  const context = schoolDate(date);
  if (!meals.length) return emptyPaper("meals", date, context, status(["meals"], snapshot, "이날 등록된 급식이 없어요.", calls.meals));
  const groups = meals.map(meal => `<section class="paper-section">
    <h3>${escape(meal.mealType || "식단")}</h3>${meal.calories ? note(meal.calories) : ""}
    <ul class="paper-meals">${meal.dishes.map(({ name, codes }) => `<li>${escape(name)}
      ${codes.length ? `<small>알레르기 표시 · ${codes.map(code => ALLERGENS[code]).join(", ")}</small>` : ""}</li>`).join("")}</ul>
    ${meal.dishes.some(dish => dish.codes.length) ? "" : note("나이스에 표시된 알레르기 번호가 없어요.")}
  </section>`).join("");
  return paper(date, "meals", context, "급식", "", meals.slice(0, 3).map(meal => line(dishNames(meal, 3), meal.mealType)),
    "전체 식단과 알레르기", groups + note("출처 · 나이스 교육정보 개방 포털") + sourceNote("meals", snapshot, calls.meals));
}

function timingSummary(timing) {
  if (!timing) return [];
  if (!timing.available) return [line("교시 시각이 등록되면 다음 수업을 표시해요.")];
  return [
    ...(timing.current ? [line(lesson(timing.current), "현재 수업")] : []),
    timing.next ? line(lesson(timing.next), "다음 수업") : line("오늘의 다음 수업이 없어요."),
  ];
}

function timetablePaper(data, snapshot, calls, date, now) {
  const { row, periods } = dailyTimetable(data.neisTimetables || [], date, snapshot.profile?.classKey);
  const context = schoolDate(date);
  if (!periods.length) return emptyPaper("timetable", date, context, status(["neisTimetables"], snapshot, "이날 등록된 수업이 없어요.", calls.neisTimetables));
  const timing = lessonTiming(periods, date, now);
  const source = { COMCIGAN: "컴시간", NEIS: "나이스" }[row.source] || row.source;
  const list = `<ol class="paper-rows lesson-rows" aria-label="교시별 수업">${periods.map(period => {
    const state = timing?.current === period ? "현재 수업" : timing?.next === period ? "다음 수업" : "";
    const time = [period.startTime || period.startsAt, period.endTime || period.endsAt].filter(Boolean).join("–");
    return `<li${state ? ' class="current-lesson"' : ""}>
      <span>${escape(period.period)}교시</span><div><strong>${escape(period.subject)}</strong>${time || state ? note([time, state].filter(Boolean).join(" · ")) : ""}</div>
    </li>`;
  }).join("")}</ol>`;
  return paper(date, "timetable", context, "시간표", `${periods.length}개 수업`,
    [...timingSummary(timing), ...periods.slice(0, 2).map(period => line(period.subject, `${period.period}교시`))].slice(0, 3),
    "교시별 수업", (timing && !timing.available ? note("교시별 시작·종료 시각이 등록되면 현재와 다음 수업을 표시해요.") : "")
      + list + (source ? note(`출처 · ${source}`) : "") + sourceNote("neisTimetables", snapshot, calls.neisTimetables));
}

function eventList(rows, showDate = false) {
  return `<ul class="paper-rows">${rows.map(row => `<li class="paper-event"><strong>${escape(row.title)}</strong>
    ${note([showDate && row.date ? schoolDate(row.date) : "", row.category].filter(Boolean).join(" · "))}
    ${row.location ? note(`장소 · ${row.location}`) : ""}${row.body ? `<p class="paper-copy">${escape(row.body)}</p>` : ""}
  </li>`).join("")}</ul>`;
}

function eventSection(title, rows, state, showDate = false) {
  return `<section class="paper-section"><h3>${title}</h3>${rows.length ? eventList(rows, showDate) : note(state.message)}</section>`;
}

function schedulePapers(data, snapshot, calls, days) {
  const events = classEvents(data.events || [], snapshot.profile?.classKey);
  const academic = academicEvents(data.academicSchedules || [], snapshot.profile?.grade);
  const undated = events.filter(event => !event.date);
  const classState = status(["events"], snapshot, "등록된 학급 일정이 없어요.");
  const schoolState = status(["academicSchedules"], snapshot, "등록된 학사 일정이 없어요.", calls.academicSchedules);
  const covers = days.map(date => {
    const listed = events.filter(event => event.date === date);
    const school = academic.filter(event => event.date === date);
    const lines = [...listed.slice(0, 2), ...school.slice(0, listed.length >= 2 ? 1 : 3 - listed.length)].map(event => line(event.title, event.category));
    return paper(date, "schedule", schoolDate(date), "학급 일정", "",
      lines.length ? lines : [line(classState.retry ? classState.message : "학급 일정과 학사 일정 확인")], "일정 상세",
      eventSection("학급 일정 및 행사", listed, classState) + eventSection("학사 일정", school, schoolState),
      !listed.length && classState.retry || !school.length && schoolState.retry);
  });
  if (undated.length) {
    covers.push(paper("undated", "schedule", "날짜 미정", "학급 일정", `${undated.length}개 행사`,
      undated.slice(0, 3).map(event => line(event.title, event.category)), "행사 상세", eventList(undated)));
  }
  const weekEvents = events.filter(event => days.includes(event.date)).sort((a, b) => a.date.localeCompare(b.date));
  const weekAcademic = academic.filter(event => days.includes(event.date)).sort((a, b) => a.date.localeCompare(b.date));
  return {
    covers, weekEvents,
    overview: eventSection("학급 일정 및 행사", weekEvents, classState, true) + eventSection("학사 일정", weekAcademic, schoolState, true)
      + (undated.length ? eventSection("날짜 미정", undated, classState) : ""),
    retry: !weekEvents.length && classState.retry || !weekAcademic.length && schoolState.retry,
  };
}

const priority = item => item.priority === "urgent" || item.urgent ? "긴급 공지" : "중요 공지";

function noticePapers(data, snapshot) {
  const rows = importantNotices(data, snapshot.profile?.classKey);
  if (!rows.length) return [emptyPaper("notices", "notices", "", status(["announcements", "content"], snapshot, "표시할 중요 공지가 없어요."))];
  return rows.map(row => paper(`notice-${row.id}`, "notices", row.title, priority(row), "",
    row.body ? [line(row.body)] : [], "공지 읽기", `<p class="paper-copy">${escape(row.body || "등록된 상세 안내가 없어요.")}</p>`));
}

function assignmentRows(rows, today) {
  if (!rows.length) return "";
  return `<ul class="paper-rows">${rows.map(row => `<li>
    <a class="paper-link assignment-link" href="./new/?assignment=${encodeURIComponent(row.id)}">
      <span><strong>${escape(row.title)}</strong><small>${escape(row.subject || "수행평가")} ·
      <time datetime="${row.date}">${calendarDateLabel(row.date)}</time></small></span>
      <span class="assignment-deadline">${deadlineLabel(row.date, today)}</span>
    </a></li>`).join("")}</ul>`;
}

function homePapers(data, snapshot, calls, today, now) {
  const upcoming = upcomingAssessments(data.classAssignments || [], snapshot.profile?.classKey, today, now).slice(0, 3);
  const nearest = upcoming[0];
  const context = schoolDate(today);
  const mealData = dailyMeals(data.meals || [], today);
  const lunch = mealData.find(meal => meal.mealType === "중식") || mealData[0];
  const mealState = status(["meals"], snapshot, "오늘 등록된 급식이 없어요.", calls.meals);
  const { periods } = dailyTimetable(data.neisTimetables || [], today, snapshot.profile?.classKey);
  const timing = lessonTiming(periods, today, now);
  const next = timing?.next;
  const timetableState = status(["neisTimetables"], snapshot, "오늘 등록된 수업이 없어요.", calls.neisTimetables);
  const schedule = schedulePapers(data, snapshot, calls, schoolWeek(today));
  const events = schedule.weekEvents;
  const notices = noticePapers(data, snapshot);
  const notice = notices[0];
  const hasNotice = notice.id !== "notices";
  const assessmentState = status(["classAssignments"], snapshot, "예정된 마감일이 없어요.");
  const eventState = status(["events"], snapshot, "이번 주 등록된 학급 일정이 없어요.");
  const mealText = lunch ? dishNames(lunch, 3) : mealState.message;
  const timetableText = next ? lesson(next) : timing?.available ? "오늘의 다음 수업이 없어요."
    : periods.length ? `오늘 ${periods.length}개 수업 · 교시 시각 미등록` : timetableState.message;
  const deadlineText = nearest ? `${deadlineLabel(nearest.date, today)} · ${nearest.title}` : assessmentState.message;
  const overview = `<section class="paper-section"><h3>급식과 시간표</h3>
    <p>${escape(mealText)}</p>${action("#meals", "식단·알레르기")}
    <p>${escape(timetableText)}</p>${action("#timetable", "교시별 시간표")}
    </section><section class="paper-section"><h3>다가오는 수행평가</h3>
    ${assignmentRows(upcoming, today) || note(assessmentState.message)}${action("./new/", "수행평가 전체")}
    </section><section class="paper-section"><h3>학급 일정과 공지</h3>
    <p>${escape(events[0]?.title || eventState.message)}</p>${action("#schedule", "이번 주 일정")}
    <p>${escape(hasNotice ? notice.title : notice.lines[0].value)}</p>${action("#notices", "중요 공지")}
    </section>`;
  const covers = [
    paper("meals", "meals", "오늘의 급식", "급식", context, [line(mealText, lunch?.mealType)], "식단과 알레르기"),
    paper("timetable", "timetable", "오늘의 시간표", "시간표", context,
      periods.length ? [...timingSummary(timing), ...periods.slice(0, 2).map(period => line(lesson(period)))].slice(0, 3)
        : [line(timetableState.message)], "교시별 수업"),
    paper("today", "home", "오늘 한눈에 보기", "PinCon", "",
      [line(mealText, "급식"), line(timetableText, "시간표"), line(deadlineText, "수행평가")], "오늘 상세",
      overview, mealState.retry || timetableState.retry || assessmentState.retry || eventState.retry || notice.retry),
    paper("assessment", "assessment", "다가오는 수행평가", "수행평가", context,
      upcoming.length ? upcoming.map(row => line(row.title, deadlineLabel(row.date, today))) : [line(assessmentState.message)], "수행평가 목록"),
    paper("schedule", "schedule", "이번 주 학급 일정", "학급 일정", "",
      events.length ? events.slice(0, 3).map(row => line(row.title, calendarDateLabel(row.date))) : [line(eventState.message)], "이번 주 일정"),
    paper("notices", "notices", "중요 학급 공지", "공지", "",
      hasNotice ? notices.slice(0, 3).map(row => line(row.title, row.kicker)) : notice.lines, "공지 목록"),
  ];
  return covers.map(cover => ({ ...cover, navigation: cover.id !== "today" }));
}

export function schoolPapers(page, date, today, now, snapshot, data, calls) {
  if (page === "home") return { covers: homePapers(data, snapshot, calls, today, now), defaultId: "today" };
  if (page === "notices") return { covers: noticePapers(data, snapshot) };
  const days = schoolWeek(date);
  if (page === "schedule") {
    const { covers, overview, retry } = schedulePapers(data, snapshot, calls, days);
    return { covers, overview: { title: "이번 주 일정", body: overview, retry } };
  }
  const builder = page === "meals" ? mealPaper : (rows, state, reads, dateKey) => timetablePaper(rows, state, reads, dateKey, now);
  const covers = days.map(day => builder(data, snapshot, calls, day));
  const overview = page === "timetable" ? {
    title: "주간 시간표",
    body: covers.map(cover => `<section class="paper-section"><h3>${schoolDate(cover.id)}</h3>${cover.body}</section>`).join(""),
    retry: covers.some(cover => cover.retry),
  } : null;
  return { covers, overview };
}
