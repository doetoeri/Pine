import { NextDataGateway, readClassProfile, saveClassProfile } from "../core/data-gateway.js";

const app = document.querySelector("#flowApp");
const boot = document.querySelector("#flowBoot");
const sheet = document.querySelector("#flowSheet");
const sheetContent = document.querySelector("#flowSheetContent");
const gateway = new NextDataGateway();

const ROUTES = [
  { id: "today", label: "오늘", icon: "●" },
  { id: "timetable", label: "시간표", icon: "▥" },
  { id: "schedule", label: "일정", icon: "◫" },
  { id: "assessment", label: "수행", icon: "◆" },
  { id: "hub", label: "허브", icon: "✦" },
];

const SUBJECT_NAMES = {
  공영: "공통영어",
  공수: "공통수학",
  공국: "공통국어",
  통사: "통합사회",
  통과: "통합과학",
};

const state = {
  route: "today",
  data: gateway.snapshot(),
  selectedDate: isoDate(new Date()),
  scheduleFilter: "all",
  assessmentFilter: "all",
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
  render();
}

function timetableDoc(date) {
  return (collections().neisTimetables || []).find((item) => item.date === date) || null;
}

function periodsFor(date) {
  const doc = timetableDoc(date);
  return Array.isArray(doc?.periods) ? doc.periods : [];
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
  const active = state.route === route.id ? "is-active" : "";
  const dock = matchMedia("(min-width:980px)").matches ? "" : "dock__item";
  return `<button class="${active} ${dock}" data-route="${route.id}">
    <b>${route.icon}</b>${route.label}
  </button>`;
}

function shell(content) {
  const p = profile();
  const grade = p?.grade || "-";
  const cls = p?.classNumber || "-";

  return `<div class="app-shell">
    <aside class="desktop-rail">
      <img src="../assets/pincon-icon.svg" alt="PinCon" />
      <nav>${ROUTES.map(navButton).join("")}</nav>
    </aside>
    <div class="main-column">
      <header class="topline">
        <div class="brand-lockup">
          <img src="../assets/pincon-icon.svg" alt="" />
          <div>
            <strong>PinCon Flow</strong>
            <span>${grade}학년 ${cls}반 · Private Beta</span>
          </div>
        </div>
        <div class="topline__actions">
          <button class="soft-button" data-action="classic">기존 PinCon</button>
          <button class="icon-button" data-action="refresh" aria-label="새로고침">↻</button>
        </div>
      </header>
      ${content}
    </div>
    <nav class="dock" aria-label="주요 메뉴">${ROUTES.map(navButton).join("")}</nav>
  </div>`;
}

function intro(eyebrow, headline, copy = "") {
  return `<div class="page-intro">
    <div><small>${esc(eyebrow)}</small><h1>${esc(headline)}</h1></div>
    ${copy ? `<p class="desktop-only">${esc(copy)}</p>` : ""}
  </div>`;
}

function empty(text) {
  return `<div class="empty-state">${esc(text)}</div>`;
}

function periodRow(period, index) {
  return `<div class="period">
    <div class="period__num">${esc(period.period || index + 1)}교시</div>
    <div>
      <strong>${esc(periodTitle(period))}</strong>
      <span>${esc(periodSupport(period) || periodTime(period) || "세부 정보 없음")}</span>
    </div>
    <div class="period__room">${esc(periodTime(period))}</div>
  </div>`;
}

function taskRow(item) {
  const date = dateOf(item);
  return `<button class="task-row"
    data-item-kind="assignment"
    data-item-id="${esc(item.id || "")}"
    data-item-index="${assignments().indexOf(item)}">
    <span class="task-dot"></span>
    <span>
      <strong>${esc(title(item))}</strong>
      <span>${esc(subjectName(item.subject))} · ${esc(assignmentLabel(item))}</span>
    </span>
    <span class="d-day">${esc(dday(date))}</span>
  </button>`;
}

function todayPage() {
  const today = isoDate(new Date());
  const periods = periodsFor(today);
  const meal = mealFor(today);
  const tasks = upcomingAssignments(5);
  const first = periods[0] || null;
  const next = periods[1] || null;
  const dishes = dishList(meal);
  const p = profile();
  const headline = first
    ? `${periodTitle(first)}부터 시작하는 날`
    : "오늘도 필요한 것만 빠르게.";

  return shell(`<main class="canvas">
    ${intro(
      `${p?.grade || "-"}학년 ${p?.classNumber || "-"}반`,
      "오늘",
      "시간표, 급식, 수행평가를 한 흐름으로 이어서 봅니다."
    )}

    <div class="flow-grid flow-grid--today">
      <section class="card hero-day">
        <div class="hero-day__top">
          <div class="hero-day__date">${esc(dateLabel(today))}</div>
          <div class="hero-pill">${state.data?.online === false ? "오프라인 캐시" : "● 동기화됨"}</div>
        </div>
        <div>
          <div class="hero-day__headline">${esc(headline)}</div>
          <div class="hero-day__meta">
            <span class="hero-pill">${periods.length}교시</span>
            <span class="hero-pill">${meal ? "급식 있음" : "급식 확인 중"}</span>
            <span class="hero-pill">수행 ${tasks.filter((x) => assignmentKind(x) === "assessment").length}개 예정</span>
          </div>
        </div>
      </section>

      <section class="card now-strip">
        <div class="now-badge">NOW</div>
        <div>
          <strong>${first ? esc(periodTitle(first)) : "수업 정보 없음"}</strong>
          <span>${first ? esc(periodSupport(first) || "첫 수업") : "시간표가 아직 없습니다."}</span>
        </div>
        <div class="next-time">${next ? `→ ${esc(periodTitle(next))}` : ""}</div>
      </section>

      <section class="card meal-card" data-action="meal-detail">
        <div class="card-label">오늘의 급식</div>
        <h2>${meal?.mealType ? esc(meal.mealType) : "점심"}</h2>
        <div class="meal-card__menu">
          ${
            dishes.length
              ? dishes.slice(0, 6).map((dish) => `<span class="dish">${esc(dish)}</span>`).join("")
              : empty("식단을 불러오는 중입니다.")
          }
        </div>
        <div class="meal-card__footer">
          <span class="meal-cal">${esc(meal?.calories || "")}</span>
          <button class="soft-button" data-action="meal-detail">식판 열기</button>
        </div>
      </section>

      <section class="card timeline-card">
        <div class="card-label">오늘의 흐름</div>
        <h2>시간표</h2>
        <div class="period-track">
          ${
            periods.length
              ? periods.slice(0, 7).map(periodRow).join("")
              : empty("오늘 시간표가 아직 등록되지 않았습니다.")
          }
        </div>
      </section>

      <section class="card tasks-card">
        <div class="card__pad">
          <div class="card-label">다가오는 일</div>
          <h2>놓치면 곤란한 것</h2>
          <div class="task-stack">
            ${tasks.length ? tasks.map(taskRow).join("") : empty("다가오는 수행평가나 숙제가 없습니다.")}
          </div>
        </div>
      </section>
    </div>
  </main>`);
}

function timetablePage() {
  const dates = Array.from({ length: 9 }, (_, index) =>
    addDays(isoDate(new Date()), index - 2)
  );
  const periods = periodsFor(state.selectedDate);
  const week = dates.slice(2, 7);

  return shell(`<main class="canvas">
    ${intro(
      "하루를 표가 아니라 흐름으로",
      "시간표",
      "모바일에서는 한 교시씩, 넓은 화면에서는 여러 날을 동시에 비교합니다."
    )}

    <div class="dayrail">
      ${dates
        .map(
          (date) => `<button class="day-chip ${date === state.selectedDate ? "is-selected" : ""}" data-date="${date}">
            <strong>${esc(shortDate(date))}</strong>
            <span>${date === isoDate(new Date()) ? "오늘" : ""}</span>
          </button>`
        )
        .join("")}
    </div>

    <div class="split-2">
      <section class="card timeline-card">
        <div class="card-label">${esc(dateLabel(state.selectedDate))}</div>
        <h2>${periods.length ? `${periods.length}개의 수업` : "수업 없음"}</h2>
        <div class="period-track">
          ${periods.length ? periods.map(periodRow).join("") : empty("이 날짜의 시간표가 없습니다.")}
        </div>
      </section>

      <section class="card card__pad">
        <div class="card-label">5일 미리보기</div>
        <h2>이번 흐름</h2>
        <div class="task-stack">
          ${week
            .map((date) => {
              const dayPeriods = periodsFor(date);
              return `<button class="task-row" data-date="${date}">
                <span class="task-dot"></span>
                <span>
                  <strong>${esc(shortDate(date))}</strong>
                  <span>${esc(dayPeriods.slice(0, 4).map(periodTitle).join(" · ") || "시간표 없음")}</span>
                </span>
                <span class="d-day">${dayPeriods.length}교시</span>
              </button>`;
            })
            .join("")}
        </div>
      </section>
    </div>
  </main>`);
}

function scheduleDay(date, rows) {
  return `<section class="week-day">
    <div class="week-day__head">
      <strong>${esc(shortDate(date))}</strong><span>${esc(dday(date))}</span>
    </div>
    <div class="event-list">
      ${rows
        .map(
          (row) => `<button class="event" data-kind="${esc(row.kind)}">
            <i class="event-bar"></i>
            <span><strong>${esc(row.title)}</strong><span>${esc(row.subject)} · ${esc(row.label)}</span></span>
            <b class="event-time">${esc(dday(row.date))}</b>
          </button>`
        )
        .join("")}
    </div>
  </section>`;
}

function schedulePage() {
  const today = isoDate(new Date());
  const rows = scheduleItems()
    .filter((row) => !row.date || row.date >= today)
    .filter((row) => state.scheduleFilter === "all" || row.kind === state.scheduleFilter);

  const dates = [...new Set(rows.map((row) => row.date).filter(Boolean))].slice(0, 12);

  const filters = [
    ["all", "전체"],
    ["assessment", "수행"],
    ["exam", "시험"],
    ["preparation", "숙제"],
    ["academic", "학사"],
    ["event", "학급"],
  ];

  return shell(`<main class="canvas">
    ${intro(
      "월력보다 가까운 날부터",
      "일정",
      "이번 달 전체보다 실제로 행동해야 하는 순서에 집중합니다."
    )}

    <div class="filter-row">
      ${filters
        .map(
          ([value, label]) =>
            `<button class="chip ${state.scheduleFilter === value ? "is-active" : ""}" data-schedule-filter="${value}">${label}</button>`
        )
        .join("")}
    </div>

    <div class="week-board">
      ${
        dates.length
          ? dates.map((date) => scheduleDay(date, rows.filter((row) => row.date === date))).join("")
          : empty("다가오는 일정이 없습니다.")
      }
    </div>
  </main>`);
}

function mission(item, index) {
  const date = dateOf(item);
  const distance = dday(date);
  let urgency = "calm";

  if (date) {
    const days = Math.round(
      (new Date(`${date}T12:00:00`) - new Date(`${isoDate(new Date())}T12:00:00`)) / 86400000
    );
    if (days <= 1) urgency = "hot";
    else if (days <= 5) urgency = "soon";
  }

  return `<button class="mission"
    data-item-kind="assignment"
    data-item-index="${index}"
    data-item-id="${esc(item.id || "")}">
    <div class="mission__top">
      <span class="subject-pill">${esc(subjectName(item.subject))}</span>
      <span class="urgency ${urgency}">${esc(distance)}</span>
    </div>
    <h3>${esc(title(item))}</h3>
    <p>${esc(clean(item.description || item.evaluationRange || item.materials || "세부 내용이 아직 없습니다."))}</p>
    <div class="mission__foot">
      <span class="muted">${esc(assignmentLabel(item))}</span>
      <strong>${esc(date ? dateLabel(date) : "날짜 미정")}</strong>
    </div>
  </button>`;
}

function assessmentPage() {
  const today = isoDate(new Date());
  let items = assignments().filter((item) => !dateOf(item) || dateOf(item) >= today);

  if (state.assessmentFilter !== "all") {
    items = items.filter((item) => assignmentKind(item) === state.assessmentFilter);
  }

  const nearest = items[0];
  const filters = [
    ["all", "전체"],
    ["assessment", "수행평가"],
    ["exam", "시험"],
    ["preparation", "숙제"],
  ];

  return shell(`<main class="canvas">
    ${intro(
      "일정 속에 묻히지 않게",
      "수행평가",
      "수행평가, 시험, 숙제를 행동 단위의 미션으로 분리합니다."
    )}

    <section class="card assessment-hero">
      <div class="card-label">가장 가까운 마감</div>
      <h2>${
        nearest
          ? `${esc(dday(dateOf(nearest)))} · ${esc(title(nearest))}`
          : "예정된 평가가 없습니다"
      }</h2>
      <p>${
        nearest
          ? `${esc(subjectName(nearest.subject))} · ${esc(
              clean(nearest.description || nearest.evaluationMethod || "세부 내용을 열어 확인하세요.")
            )}`
          : "새 수행평가가 등록되면 여기에 가장 먼저 표시됩니다."
      }</p>
    </section>

    <div class="filter-row" style="margin-top:16px">
      ${filters
        .map(
          ([value, label]) =>
            `<button class="chip ${state.assessmentFilter === value ? "is-active" : ""}" data-assessment-filter="${value}">${label}</button>`
        )
        .join("")}
    </div>

    <div class="mission-grid">
      ${items.length ? items.map(mission).join("") : empty("조건에 맞는 평가가 없습니다.")}
    </div>
  </main>`);
}

function hubPage() {
  const p = profile();

  return shell(`<main class="canvas">
    ${intro(
      "기능을 숨기지 않고 한곳에",
      "허브",
      "학생용 핵심 UX와 학급 운영 도구를 분리해 복잡도를 낮춥니다."
    )}

    <div class="hub-grid">
      <button class="quick-action" data-action="meal-detail">
        <em>🍱</em><b>급식 식판</b><span>오늘 메뉴와 열량을 한 화면에서 봅니다.</span>
      </button>
      <button class="quick-action" data-classic-route="classroom">
        <em>🏫</em><b>학급 운영</b><span>자리배치, 학급 행사, 자료실 등 기존 관리 기능을 엽니다.</span>
      </button>
      <button class="quick-action" data-classic-route="more">
        <em>⚙️</em><b>더보기</b><span>알림, 계정, 설치와 기존 보조 기능을 엽니다.</span>
      </button>
      <button class="quick-action" data-classic-route="schedule">
        <em>✎</em><b>일정 편집 도구</b><span>권한이 있는 사용자는 기존 편집 인터페이스를 사용합니다.</span>
      </button>
      <button class="quick-action" data-action="classic">
        <em>↗</em><b>기존 PinCon 전체</b><span>원래 인터페이스와 비교합니다.</span>
      </button>
      <button class="quick-action" data-action="change-class">
        <em>◉</em><b>${esc(p?.grade || "-")}학년 ${esc(p?.classNumber || "-")}반</b><span>테스트 학급을 다시 선택합니다.</span>
      </button>
    </div>
  </main>`);
}

function profileGate() {
  return `<main class="profile-gate">
    <img src="../assets/pincon-icon.svg" alt="PinCon" />
    <h1>어느 반인가요?</h1>
    <p>PinCon Flow도 기존 PinCon과 같은 학급 데이터를 사용합니다.</p>
    <form class="profile-fields" id="profileForm">
      <select name="grade" aria-label="학년">
        <option value="1">1학년</option>
        <option value="2">2학년</option>
        <option value="3">3학년</option>
      </select>
      <select name="classNumber" aria-label="반">
        ${Array.from({ length: 10 }, (_, index) => `<option value="${index + 1}">${index + 1}반</option>`).join("")}
      </select>
      <button>Flow 시작</button>
    </form>
  </main>`;
}

function hideBoot() {
  boot?.classList.add("is-hidden");
}

function render() {
  try {
    if (!profile()) {
      app.innerHTML = profileGate();
      hideBoot();
      return;
    }

    const pages = {
      today: todayPage,
      timetable: timetablePage,
      schedule: schedulePage,
      assessment: assessmentPage,
      hub: hubPage,
    };

    const page = pages[state.route] || todayPage;
    app.innerHTML = page();
    hideBoot();
  } catch (error) {
    fail(error);
  }
}

function openMeal() {
  const meal = mealFor(isoDate(new Date()));
  const dishes = dishList(meal);

  sheetContent.innerHTML = `<h2 class="sheet-title" id="flowSheetTitle">오늘의 식판</h2>
    <div class="sheet-meta">${esc(dateLabel(isoDate(new Date())))} · ${esc(meal?.mealType || "중식")}</div>
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

  sheet?.showModal?.();
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

  sheet?.showModal?.();
}

function fail(error) {
  console.error("[PinCon Flow]", error);
  hideBoot();

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
    render();
    return;
  }

  const scheduleFilter = event.target.closest("[data-schedule-filter]");
  if (scheduleFilter) {
    state.scheduleFilter = scheduleFilter.dataset.scheduleFilter;
    render();
    return;
  }

  const assessmentFilter = event.target.closest("[data-assessment-filter]");
  if (assessmentFilter) {
    state.assessmentFilter = assessmentFilter.dataset.assessmentFilter;
    render();
    return;
  }

  const action = event.target.closest("[data-action]")?.dataset.action;

  if (action === "meal-detail") {
    openMeal();
    return;
  }

  if (action === "refresh") {
    try {
      await gateway.start();
      state.data = gateway.snapshot();
      render();
    } catch (error) {
      fail(error);
    }
    return;
  }

  if (action === "classic") {
    location.href = "../";
    return;
  }

  if (action === "change-class") {
    localStorage.removeItem("pincon-profile-v2");
    location.reload();
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
    await gateway.start();
    state.data = gateway.snapshot();
    render();
  } catch (error) {
    fail(error);
  }
});

window.addEventListener("popstate", () => {
  state.route = routeFromHash();
  render();
});

window.addEventListener("hashchange", () => {
  state.route = routeFromHash();
  render();
});

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
