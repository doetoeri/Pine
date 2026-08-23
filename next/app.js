import { NextDataGateway, readClassProfile, saveClassProfile } from "./core/data-gateway.js";

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

const state = {
  route: routeFromLocation(),
  data: gateway.snapshot(),
  timetableDate: localIsoDate(new Date()),
};

function routeFromLocation() {
  const route = location.hash.replace(/^#\/?/, "");
  return ROUTES.some((item) => item.id === route) ? route : "today";
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

function plainTextFromHtml(value) {
  const node = document.createElement("div");
  node.innerHTML = String(value || "").replace(/<br\s*\/?\s*>/gi, "\n");
  return (node.textContent || "").replace(/\s*\n\s*/g, " · ").replace(/\s+/g, " ").trim();
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
  if (!dateString) return "";
  const today = new Date(`${localIsoDate(new Date())}T12:00:00`);
  const target = new Date(`${dateString}T12:00:00`);
  if (Number.isNaN(target.getTime())) return "";
  const days = Math.round((target - today) / 86_400_000);
  if (days === 0) return "오늘";
  if (days === 1) return "내일";
  if (days > 1) return `D-${days}`;
  return `D+${Math.abs(days)}`;
}

function itemDate(item) {
  const raw = item?.dueDate || item?.date || item?.startsOn || item?.startDate || item?.dueAt || "";
  if (typeof raw !== "string") return "";
  const match = raw.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] || "";
}

function itemTitle(item, fallback = "제목 없음") {
  return item?.title || item?.name || item?.subject || item?.body || fallback;
}

function collections() {
  return state.data.data || Object.create(null);
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

function scheduleItems() {
  const rows = [];
  for (const item of collections().classAssignments || []) {
    rows.push({
      kind: item.type || "수행·숙제",
      title: itemTitle(item),
      date: itemDate(item),
      subject: item.subject || "",
      source: item,
    });
  }
  for (const item of collections().events || []) {
    rows.push({
      kind: "학급 행사",
      title: itemTitle(item),
      date: itemDate(item),
      subject: item.location || "",
      source: item,
    });
  }
  for (const item of collections().academicSchedules || []) {
    rows.push({
      kind: "학사일정",
      title: itemTitle(item),
      date: itemDate(item),
      subject: "",
      source: item,
    });
  }
  return rows
    .filter((item) => item.title)
    .sort((a, b) => (a.date || "9999-99-99").localeCompare(b.date || "9999-99-99"));
}

function upcomingSchedule(limit = 6) {
  const today = localIsoDate(new Date());
  return scheduleItems().filter((item) => !item.date || item.date >= today).slice(0, limit);
}

function announcements(limit = 5) {
  return [...(collections().announcements || [])]
    .filter((item) => !item.deleted)
    .sort((a, b) => String(b.updatedAtMs || b.createdAtMs || b.date || "").localeCompare(String(a.updatedAtMs || a.createdAtMs || a.date || "")))
    .slice(0, limit);
}

function searchIndex() {
  const rows = [];
  const sources = [
    ["공지", collections().announcements || []],
    ["수행·숙제", collections().classAssignments || []],
    ["학급 행사", collections().events || []],
    ["학사일정", collections().academicSchedules || []],
    ["학습 자료", collections().resources || []],
    ["분실물", collections().lostItems || []],
  ];
  for (const [kind, items] of sources) {
    for (const item of items) {
      if (item?.deleted) continue;
      rows.push({
        kind,
        title: itemTitle(item),
        support: [item.subject, item.description, item.body, item.location].filter(Boolean).join(" · "),
        date: itemDate(item),
      });
    }
  }
  return rows;
}

function navMarkup(className) {
  return `<nav class="${className}" aria-label="주요 메뉴">
    ${ROUTES.map((route) => {
      const selected = route.id === state.route;
      const tag = selected ? "md-filled-tonal-button" : "md-text-button";
      return `<${tag} data-route="${route.id}" ${selected ? 'aria-current="page"' : ""}>
        <md-icon slot="icon">${route.icon}</md-icon>${route.label}
      </${tag}>`;
    }).join("")}
  </nav>`;
}

function syncMarkup() {
  if (state.data.syncing && !state.data.ready) {
    return `<div class="sync-line" role="status">
      <md-linear-progress indeterminate></md-linear-progress>
      <span>학급 데이터를 불러오는 중</span>
    </div>`;
  }
  return `<div class="sync-line">
    <span class="status-dot ${state.data.online ? "" : "status-dot--offline"}"></span>
    <span>${state.data.online ? "실시간 데이터 연결됨" : "오프라인 · 저장된 데이터 표시 중"}</span>
    ${state.data.syncing ? "<md-linear-progress indeterminate></md-linear-progress>" : ""}
  </div>`;
}

function emptyMarkup(icon, title, support) {
  return `<div class="empty">
    <md-icon>${icon}</md-icon>
    <strong>${escapeHtml(title)}</strong>
    <span>${escapeHtml(support)}</span>
  </div>`;
}

function periodRows(periods) {
  if (!periods.length) {
    return emptyMarkup("calendar_today", "등록된 수업이 없습니다", "컴시간 동기화 결과가 들어오면 이곳에 표시됩니다.");
  }
  return `<div class="list">
    ${periods.map((item) => `<div class="row">
      <div class="row__leading">${escapeHtml(item.period)}교시</div>
      <div class="row__body"><p class="row__title">${escapeHtml(item.subject)}</p></div>
      <div class="row__trailing"></div>
    </div>`).join("")}
  </div>`;
}

function scheduleRows(items, emptySupport = "등록되면 이곳에서 한 번에 확인할 수 있습니다.") {
  if (!items.length) return emptyMarkup("event_available", "예정된 항목이 없습니다", emptySupport);
  return `<div class="list">
    ${items.map((item) => `<div class="row">
      <div class="row__leading">${escapeHtml(timeDistance(item.date) || item.kind)}</div>
      <div class="row__body">
        <p class="row__title">${escapeHtml(item.title)}</p>
        <p class="row__support">${escapeHtml([item.kind, item.subject].filter(Boolean).join(" · "))}</p>
      </div>
      <div class="row__trailing">${escapeHtml(item.date ? dateLabel(item.date, { weekday: false }) : "")}</div>
    </div>`).join("")}
  </div>`;
}

function todayPage() {
  const today = localIsoDate(new Date());
  const periods = periodsFor(today);
  const meal = mealFor(today);
  const tasks = upcomingSchedule(4);
  const notice = announcements(1)[0];
  const profile = state.data.profile || readClassProfile();

  return `<section class="view-enter" aria-labelledby="today-title">
    <div class="surface surface--hero">
      <p class="hero-kicker">${escapeHtml(dateLabel(today))}</p>
      <h1 class="hero-title" id="today-title">오늘 필요한 것부터.</h1>
      <div class="hero-meta">
        <span class="meta-pill"><md-icon>school</md-icon>${escapeHtml(profile ? `${profile.grade}학년 ${profile.classNumber}반` : "학급 미선택")}</span>
        <span class="meta-pill"><md-icon>schedule</md-icon>${periods.length ? `${periods.length}개 수업` : "시간표 확인 중"}</span>
        <span class="meta-pill"><md-icon>task_alt</md-icon>${tasks.length ? `예정 ${tasks.length}건` : "예정 없음"}</span>
      </div>
    </div>

    ${syncMarkup()}

    ${state.data.error ? `<div class="surface surface--error notice-banner" role="alert"><md-icon>error</md-icon><p>${escapeHtml(state.data.error)}</p></div>` : ""}

    <div class="grid grid--2">
      <article class="surface">
        <div class="surface__header"><h2 class="surface__title">오늘 시간표</h2><span class="surface__meta">컴시간 우선 동기화</span></div>
        ${periodRows(periods.slice(0, 7))}
      </article>

      <article class="surface">
        <div class="surface__header"><h2 class="surface__title">다가오는 일정</h2><span class="surface__meta">${tasks.length}건</span></div>
        ${scheduleRows(tasks)}
      </article>

      <article class="surface surface--lowest">
        <div class="surface__header"><h2 class="surface__title">오늘 급식</h2><span class="surface__meta">NEIS</span></div>
        ${meal
          ? `<div class="row"><div class="row__leading"><md-icon>restaurant</md-icon></div><div class="row__body"><p class="row__title">${escapeHtml(meal.mealType || "중식")}</p><p class="row__support">${escapeHtml(plainTextFromHtml(meal.dishesHtml) || "식단 정보 없음")}</p></div><div class="row__trailing">${escapeHtml(meal.calories || "")}</div></div>`
          : emptyMarkup("restaurant", "급식 정보가 없습니다", "NEIS 동기화 결과가 들어오면 자동으로 표시됩니다.")}
      </article>

      <article class="surface surface--lowest">
        <div class="surface__header"><h2 class="surface__title">중요 공지</h2><span class="surface__meta">최신</span></div>
        ${notice
          ? `<div class="row"><div class="row__leading"><md-icon>campaign</md-icon></div><div class="row__body"><p class="row__title">${escapeHtml(itemTitle(notice))}</p><p class="row__support">${escapeHtml(notice.body || notice.description || "")}</p></div></div>`
          : emptyMarkup("notifications_none", "새 공지가 없습니다", "새 공지가 등록되면 알림함과 함께 표시됩니다.")}
      </article>
    </div>
  </section>`;
}

function timetablePage() {
  const dates = Array.from({ length: 7 }, (_, index) => addDays(localIsoDate(new Date()), index - 1));
  const periods = periodsFor(state.timetableDate);
  const document = timetableDocument(state.timetableDate);

  return `<section class="view-enter" aria-labelledby="timetable-title">
    <div class="page-head">
      <div class="page-head__copy">
        <p class="page-eyebrow">수업</p>
        <h1 class="page-title" id="timetable-title">시간표</h1>
        <p class="page-subtitle">행마다 같은 동기화 문구를 반복하지 않고, 원본과 갱신 상태는 한 번만 보여줍니다.</p>
      </div>
    </div>
    ${syncMarkup()}
    <div class="day-strip" aria-label="날짜 선택">
      ${dates.map((date) => date === state.timetableDate
        ? `<md-filled-tonal-button data-date="${date}">${escapeHtml(dateLabel(date, { weekday: false }))}</md-filled-tonal-button>`
        : `<md-text-button data-date="${date}">${escapeHtml(dateLabel(date, { weekday: false }))}</md-text-button>`).join("")}
    </div>
    <article class="surface">
      <div class="surface__header">
        <h2 class="surface__title">${escapeHtml(dateLabel(state.timetableDate))}</h2>
        <span class="surface__meta">${escapeHtml(document?.source || "컴시간/NEIS")}</span>
      </div>
      ${periodRows(periods)}
    </article>
  </section>`;
}

function schedulePage() {
  const rows = upcomingSchedule(30);
  return `<section class="view-enter" aria-labelledby="schedule-title">
    <div class="page-head">
      <div class="page-head__copy">
        <p class="page-eyebrow">한 곳에서 보는 날짜 정보</p>
        <h1 class="page-title" id="schedule-title">일정</h1>
        <p class="page-subtitle">학사일정, 수행·숙제, 학급 행사를 같은 날짜 체계로 정렬합니다.</p>
      </div>
    </div>
    ${syncMarkup()}
    <article class="surface">${scheduleRows(rows)}</article>
  </section>`;
}

function classroomPage() {
  const assignments = (collections().classAssignments || []).filter((item) => !item.deleted).slice(0, 5);
  const events = (collections().events || []).filter((item) => !item.deleted && item.status !== "draft").slice(0, 5);
  const resources = (collections().resources || []).filter((item) => !item.deleted && (!item.moderationStatus || item.moderationStatus === "approved")).slice(0, 5);
  const lostItems = (collections().lostItems || []).filter((item) => !item.deleted && item.status !== "resolved").slice(0, 5);

  const basicRows = (items, kind) => items.map((item) => ({
    kind,
    title: itemTitle(item),
    date: itemDate(item),
    subject: item.subject || item.location || item.category || "",
  }));

  return `<section class="view-enter" aria-labelledby="classroom-title">
    <div class="page-head">
      <div class="page-head__copy">
        <p class="page-eyebrow">PinCon 학급운영 통합</p>
        <h1 class="page-title" id="classroom-title">학급</h1>
        <p class="page-subtitle">별도의 두 번째 앱 없이, 학급 운영 기능을 하나의 전역 내비게이션 안으로 합칩니다.</p>
      </div>
    </div>
    ${syncMarkup()}
    <div class="grid grid--2">
      <article class="surface"><div class="surface__header"><h2 class="surface__title">수행·숙제</h2><span class="surface__meta">${assignments.length}건</span></div>${scheduleRows(basicRows(assignments, "수행·숙제"))}</article>
      <article class="surface"><div class="surface__header"><h2 class="surface__title">학급 행사</h2><span class="surface__meta">${events.length}건</span></div>${scheduleRows(basicRows(events, "학급 행사"))}</article>
      <article class="surface"><div class="surface__header"><h2 class="surface__title">학습 자료</h2><span class="surface__meta">${resources.length}건</span></div>${resources.length ? `<div class="list">${resources.map((item) => `<div class="row"><div class="row__leading"><md-icon>description</md-icon></div><div class="row__body"><p class="row__title">${escapeHtml(itemTitle(item))}</p><p class="row__support">${escapeHtml([item.subject, item.materialType, item.category].filter(Boolean).join(" · "))}</p></div></div>`).join("")}</div>` : emptyMarkup("description", "등록된 자료가 없습니다", "승인된 학습 자료만 표시합니다.")}</article>
      <article class="surface"><div class="surface__header"><h2 class="surface__title">분실물</h2><span class="surface__meta">${lostItems.length}건</span></div>${lostItems.length ? `<div class="list">${lostItems.map((item) => `<div class="row"><div class="row__leading"><md-icon>inventory_2</md-icon></div><div class="row__body"><p class="row__title">${escapeHtml(itemTitle(item))}</p><p class="row__support">${escapeHtml([item.location, item.description].filter(Boolean).join(" · "))}</p></div><div class="row__trailing">${escapeHtml(item.status || "보관 중")}</div></div>`).join("")}</div>` : emptyMarkup("inventory_2", "등록된 분실물이 없습니다", "회수 흐름과 해결 상태는 Next 데이터 모델에서 통일합니다.")}</article>
    </div>
  </section>`;
}

function morePage() {
  const profile = state.data.profile || readClassProfile();
  const roleLabel = state.data.isManager ? "학급 관리자" : "학생 · 읽기 전용 Beta";
  return `<section class="view-enter" aria-labelledby="more-title">
    <div class="page-head">
      <div class="page-head__copy">
        <p class="page-eyebrow">설정과 계정</p>
        <h1 class="page-title" id="more-title">더보기</h1>
        <p class="page-subtitle">운영 진단과 QA 도구는 학생 화면에서 제거했습니다. 관리 기능은 별도 영역으로 분리합니다.</p>
      </div>
    </div>
    <div class="grid grid--2">
      <article class="surface">
        <div class="surface__header"><h2 class="surface__title">내 학급</h2><span class="surface__meta">${escapeHtml(roleLabel)}</span></div>
        <div class="list">
          <div class="row"><div class="row__leading"><md-icon>school</md-icon></div><div class="row__body"><p class="row__title">${escapeHtml(profile ? `${profile.grade}학년 ${profile.classNumber}반` : "학급 미선택")}</p><p class="row__support">고촌고등학교</p></div><md-text-button id="changeClass">변경</md-text-button></div>
          <div class="row"><div class="row__leading"><md-icon>${state.data.online ? "cloud_done" : "cloud_off"}</md-icon></div><div class="row__body"><p class="row__title">${state.data.online ? "온라인" : "오프라인"}</p><p class="row__support">공용 데이터는 현재 Next에서 읽기 전용입니다.</p></div></div>
        </div>
      </article>
      <article class="surface">
        <div class="surface__header"><h2 class="surface__title">Next Beta 원칙</h2><span class="beta-badge">SAFE REBUILD</span></div>
        <div class="notice-banner"><md-icon>verified_user</md-icon><p>새 권한 모델이 서버 규칙으로 검증되기 전에는 Next에서 공용 데이터 쓰기를 열지 않습니다. 기존 PinCon 데이터와 운영 화면은 그대로 보존됩니다.</p></div>
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
      <md-outlined-text-field id="searchField" label="공지, 일정, 자료 검색" type="search" style="width:100%"></md-outlined-text-field>
      <div id="searchResults" class="section-stack" style="margin-top:16px"></div>
    </div>
    <div slot="actions"><md-text-button id="closeSearch">닫기</md-text-button></div>
  </md-dialog>
  <md-dialog id="notificationDialog">
    <div slot="headline">알림함</div>
    <div slot="content" id="notificationContent"></div>
    <div slot="actions"><md-text-button id="closeNotifications">닫기</md-text-button></div>
  </md-dialog>`;
}

function renderProfileSetup() {
  app.innerHTML = `<main class="splash">
    <section class="splash__surface" aria-labelledby="profile-title">
      <div class="splash__mark"><md-icon>hub</md-icon></div>
      <span class="beta-badge">PINCON NEXT BETA</span>
      <h1 id="profile-title" style="margin-top:14px">내 학급을 선택하세요.</h1>
      <p>학급을 선택하면 시간표·일정·급식 등 현재 PinCon의 실제 데이터를 읽기 전용으로 연결합니다.</p>
      <div class="profile-form">
        <md-outlined-select id="gradeSelect" label="학년" value="1">
          <md-select-option value="1"><div slot="headline">1학년</div></md-select-option>
          <md-select-option value="2"><div slot="headline">2학년</div></md-select-option>
          <md-select-option value="3"><div slot="headline">3학년</div></md-select-option>
        </md-outlined-select>
        <md-outlined-select id="classSelect" label="반" value="1">
          ${Array.from({ length: 10 }, (_, index) => `<md-select-option value="${index + 1}"><div slot="headline">${index + 1}반</div></md-select-option>`).join("")}
        </md-outlined-select>
        <md-filled-button id="saveProfile"><md-icon slot="icon">arrow_forward</md-icon>PinCon Next 열기</md-filled-button>
      </div>
    </section>
  </main>`;

  app.querySelector("#saveProfile")?.addEventListener("click", () => {
    const grade = app.querySelector("#gradeSelect")?.value;
    const classNumber = app.querySelector("#classSelect")?.value;
    try {
      saveClassProfile(grade, classNumber);
      location.reload();
    } catch (error) {
      console.error(error);
    }
  });
}

function render() {
  const profile = state.data.profile || readClassProfile();
  if (!profile) {
    renderProfileSetup();
    return;
  }

  app.innerHTML = `<div class="shell">
    <aside class="rail" aria-label="PinCon 내비게이션">
      <div class="rail__brand" aria-hidden="true"><md-icon>hub</md-icon></div>
      ${navMarkup("rail__nav")}
      <span class="beta-badge" style="margin-top:auto">NEXT</span>
    </aside>
    <div class="app-frame">
      <header class="topbar">
        <div class="brand">
          <div class="brand__mark" aria-hidden="true"><md-icon>hub</md-icon></div>
          <div class="brand__text"><span class="brand__title">PinCon <span class="beta-badge">NEXT</span></span><span class="brand__meta">고촌고등학교 · ${escapeHtml(`${profile.grade}학년 ${profile.classNumber}반`)}</span></div>
        </div>
        <div class="topbar__actions">
          <md-icon-button id="openSearch" aria-label="통합 검색"><md-icon>search</md-icon></md-icon-button>
          <md-icon-button id="openNotifications" aria-label="알림함"><md-icon>notifications</md-icon></md-icon-button>
        </div>
      </header>
      <main class="content-wrap" id="mainContent">${pageMarkup()}</main>
      ${navMarkup("bottom-nav")}
    </div>
    ${dialogsMarkup()}
  </div>`;

  bindInteractions();
}

function navigate(route, { push = true } = {}) {
  if (!ROUTES.some((item) => item.id === route)) route = "today";
  if (state.route === route) return;
  state.route = route;
  if (push) history.pushState({ route }, "", `#${route}`);
  render();
  requestAnimationFrame(() => document.querySelector("#mainContent")?.focus?.({ preventScroll: true }));
  window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

function renderSearchResults(query) {
  const target = app.querySelector("#searchResults");
  if (!target) return;
  const normalized = String(query || "").trim().toLocaleLowerCase("ko-KR");
  if (!normalized) {
    target.innerHTML = emptyMarkup("search", "검색어를 입력하세요", "공지, 일정, 자료, 분실물을 한 번에 찾습니다.");
    return;
  }
  const results = searchIndex().filter((item) => `${item.title} ${item.support} ${item.kind}`.toLocaleLowerCase("ko-KR").includes(normalized)).slice(0, 30);
  target.innerHTML = results.length
    ? `<div class="list">${results.map((item) => `<div class="row"><div class="row__leading">${escapeHtml(item.kind)}</div><div class="row__body"><p class="row__title">${escapeHtml(item.title)}</p><p class="row__support">${escapeHtml(item.support || item.kind)}</p></div><div class="row__trailing">${escapeHtml(item.date ? dateLabel(item.date, { weekday: false }) : "")}</div></div>`).join("")}</div>`
    : emptyMarkup("search_off", "검색 결과가 없습니다", `“${query}”와 일치하는 항목을 찾지 못했습니다.`);
}

function renderNotifications() {
  const target = app.querySelector("#notificationContent");
  if (!target) return;
  const notices = announcements(12);
  target.innerHTML = notices.length
    ? `<div class="list">${notices.map((item) => `<div class="row"><div class="row__leading"><md-icon>campaign</md-icon></div><div class="row__body"><p class="row__title">${escapeHtml(itemTitle(item))}</p><p class="row__support">${escapeHtml(item.body || item.description || "학급 공지")}</p></div></div>`).join("")}</div>`
    : emptyMarkup("notifications_none", "알림이 없습니다", "새 공지가 생기면 과거 기록과 함께 이곳에 남습니다.");
}

function bindInteractions() {
  app.querySelectorAll("[data-route]").forEach((button) => {
    button.addEventListener("click", () => navigate(button.dataset.route));
  });

  app.querySelectorAll("[data-date]").forEach((button) => {
    button.addEventListener("click", () => {
      state.timetableDate = button.dataset.date;
      render();
    });
  });

  const searchDialog = app.querySelector("#searchDialog");
  app.querySelector("#openSearch")?.addEventListener("click", () => {
    renderSearchResults("");
    searchDialog?.show?.();
    requestAnimationFrame(() => app.querySelector("#searchField")?.focus?.());
  });
  app.querySelector("#closeSearch")?.addEventListener("click", () => searchDialog?.close?.());
  app.querySelector("#searchField")?.addEventListener("input", (event) => renderSearchResults(event.target.value));

  const notificationDialog = app.querySelector("#notificationDialog");
  app.querySelector("#openNotifications")?.addEventListener("click", () => {
    renderNotifications();
    notificationDialog?.show?.();
  });
  app.querySelector("#closeNotifications")?.addEventListener("click", () => notificationDialog?.close?.());

  app.querySelector("#changeClass")?.addEventListener("click", () => {
    localStorage.removeItem("pincon-profile-v2");
    gateway.dispose();
    state.data = gateway.snapshot();
    renderProfileSetup();
  });
}

gateway.addEventListener("change", (event) => {
  state.data = event.detail;
  render();
});

window.addEventListener("popstate", () => {
  state.route = routeFromLocation();
  render();
});

if (!location.hash) history.replaceState({ route: state.route }, "", `#${state.route}`);

render();
await gateway.start();
