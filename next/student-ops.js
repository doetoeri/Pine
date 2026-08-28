import { NextDataGateway } from "./core/data-gateway.js";
import { accountRequest, changeStudentPin, signOutStudent } from "./core/student-auth.js";

const accountContext = globalThis.PINCON_ACCOUNT;
if (accountContext?.mode === "student" && accountContext.account) {
  const gateway = new NextDataGateway();
  let home = null;
  let homeError = "";
  let refreshPromise = null;
  let renderQueued = false;

  const ROLE_LABELS = Object.freeze({
    STUDENT: "학생",
    DEPARTMENT_HEAD: "학급자치회 부장",
    SUBJECT_MANAGER: "과목 관리자",
    CLASS_PRESIDENT: "학급 회장",
    TEACHER: "교사",
    ADMIN: "관리자",
  });
  const PHONE_LABELS = Object.freeze({
    SUBMITTED: "제출 완료",
    NOT_SUBMITTED: "미제출",
    NOT_BROUGHT: "미지참",
    TEACHER_APPROVED: "교사 허가",
    ABSENT: "결석",
    EARLY_LEAVE: "조퇴",
    CHECK_REQUIRED: "확인 필요",
  });
  const SUBJECT_LABELS = Object.freeze({ 공영: "공통영어", 공수: "공통수학", 공국: "공통국어", 통사: "통합사회", 통과: "통합과학" });

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function dateKey(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const get = (type) => parts.find((item) => item.type === type)?.value || "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  }

  function koDate(date = new Date()) {
    return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "long" }).format(date);
  }

  function normalizeSubject(value) {
    const raw = String(value || "").replace(/\s+/g, "").trim();
    return String(SUBJECT_LABELS[raw] || raw).replace(/\s+/g, "");
  }

  function minutesNow() {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
    const hour = Number(parts.find((item) => item.type === "hour")?.value || 0);
    const minute = Number(parts.find((item) => item.type === "minute")?.value || 0);
    return hour * 60 + minute;
  }

  function timeMinutes(value) {
    const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function currentTimetable() {
    const snapshot = gateway.snapshot();
    const today = dateKey();
    const document = (snapshot.data?.neisTimetables || []).find((item) => item.date === today) || null;
    return { document, periods: Array.isArray(document?.periods) ? document.periods : [] };
  }

  function nextLessonInfo() {
    const { periods } = currentTimetable();
    if (!periods.length) return null;
    const now = minutesNow();
    const timed = periods.filter((item) => timeMinutes(item.startTime) !== null);
    let lesson = timed.find((item) => timeMinutes(item.startTime) >= now) || null;
    let timing = "";
    if (lesson) {
      const diff = timeMinutes(lesson.startTime) - now;
      timing = diff === 0 ? "곧 시작" : `${diff}분 뒤 시작`;
    } else if (timed.length) {
      const ongoing = [...timed].reverse().find((item) => {
        const start = timeMinutes(item.startTime);
        const end = timeMinutes(item.endTime);
        return start !== null && end !== null && start <= now && now <= end;
      });
      if (ongoing) {
        const index = periods.indexOf(ongoing);
        lesson = periods[index + 1] || ongoing;
        timing = lesson === ongoing ? "현재 수업" : "다음 수업";
      }
    }
    if (!lesson) {
      lesson = periods[0];
      timing = "오늘 시간표";
    }

    const subject = normalizeSubject(lesson.subject);
    const entries = home?.today?.subjectEntries || [];
    const related = entries.filter((entry) => normalizeSubject(entry.subject) === subject);
    const classroomChange = related.find((entry) => entry.type === "CLASSROOM_CHANGE" && (!entry.dueDate || entry.dueDate === dateKey()));
    const materialEntry = related.find((entry) => entry.type === "MATERIAL" && (!entry.dueDate || entry.dueDate === dateKey()));
    const classroom = classroomChange?.classroom || lesson.room || lesson.classroom || lesson.location || "";
    const materials = materialEntry?.materials || materialEntry?.body || lesson.materials || lesson.preparation || lesson.supplies || "";
    const movement = Boolean(classroomChange || classroom);
    return {
      ...lesson,
      subject: lesson.subject || "수업",
      classroom,
      materials,
      movement,
      timing,
      minutesUntil: lesson.startTime ? Math.max(0, timeMinutes(lesson.startTime) - now) : null,
    };
  }

  function upcomingTasks() {
    const items = gateway.snapshot().data?.classAssignments || [];
    const today = dateKey();
    return items
      .filter((item) => !item.deleted && item.published !== false)
      .map((item) => ({ ...item, date: String(item.dueDate || "").slice(0, 10) }))
      .filter((item) => item.date && item.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 3);
  }

  function roleTimingLabel(role) {
    const timing = role?.timing || "";
    return ({ MORNING: "아침", LUNCH: "점심", CLEANING_TIME: "청소 시간", BEFORE_LEAVING: "종례 전후", WEEKLY: "주 1회" })[timing] || "상시";
  }

  function roleTimingActive(role) {
    const now = minutesNow();
    if (role?.timing === "MORNING") return now < 9 * 60 + 30;
    if (role?.timing === "LUNCH") return now >= 11 * 60 + 30 && now <= 14 * 60;
    if (role?.timing === "CLEANING_TIME") return now >= 14 * 60 + 30 && now <= 17 * 60 + 30;
    if (role?.timing === "BEFORE_LEAVING") return now >= 15 * 60;
    return false;
  }

  function phoneMarkup() {
    const state = home?.today?.phone;
    if (!state) return `<div class="pincon-phone-state"><md-icon>smartphone</md-icon><div><strong>제출 확인 전</strong><span>담당자가 실제 보관함을 확인하면 표시됩니다.</span></div></div>`;
    const label = PHONE_LABELS[state.status] || "확인 필요";
    const time = state.submittedAtMs ? new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(new Date(state.submittedAtMs)) : "";
    return `<div class="pincon-phone-state"><md-icon>${state.status === "SUBMITTED" ? "check_circle" : "smartphone"}</md-icon><div><strong>${escapeHtml(label)}</strong><span>${state.status === "SUBMITTED" ? `${escapeHtml(time)} 확인${state.returned ? " · 반환 완료" : ""}` : "담당자 확인 기준"}</span></div></div>`;
  }

  function lessonMarkup() {
    const lesson = nextLessonInfo();
    if (!lesson) return `<div class="pincon-next-lesson"><div><strong>오늘 수업 없음</strong><span>시간표에 등록된 수업이 없습니다.</span></div><md-icon>event_available</md-icon></div>`;
    const moveText = lesson.movement
      ? `${lesson.classroom ? `${lesson.classroom} · ` : ""}${lesson.minutesUntil !== null ? `이동수업까지 ${lesson.minutesUntil}분` : lesson.timing}`
      : lesson.timing;
    const phonePolicy = home?.settings?.phoneMovementPolicy;
    const prep = [];
    if (lesson.movement) prep.push({ icon: "edit", text: "필통" });
    if (lesson.materials) prep.push({ icon: "inventory_2", text: lesson.materials });
    if (lesson.movement) prep.push({
      icon: "smartphone",
      text: phonePolicy === "TAKE" ? "휴대폰 지참" : "휴대폰은 교실 보관",
    });
    return `<div class="pincon-next-lesson"><div><strong>${escapeHtml(lesson.subject)}${lesson.classroom ? ` · ${escapeHtml(lesson.classroom)}` : ""}</strong><span>${escapeHtml(moveText)}</span></div><md-icon>${lesson.movement ? "directions_walk" : "menu_book"}</md-icon></div>
      ${prep.length ? `<div class="pincon-prep-list">${prep.map((item) => `<div class="pincon-prep-item"><md-icon>${item.icon}</md-icon><span>${escapeHtml(item.text)}</span></div>`).join("")}</div>` : ""}`;
  }

  function rolesMarkup() {
    const rows = [];
    const cleaning = home?.today?.cleaning;
    if (cleaning) rows.push({ icon: "cleaning_services", title: "대걸레 당번", support: cleaning.status === "COMPLETED" ? "수행 완료" : "오늘 청소 역할", active: cleaning.status !== "COMPLETED" });
    const one = home?.today?.onePersonRole;
    if (one) rows.push({ icon: one.permissions?.includes("MANAGE_PHONE") ? "smartphone" : "task_alt", title: one.name, support: `1인1역 · ${roleTimingLabel(one)}`, active: roleTimingActive(one) });
    for (const subjectRole of home?.today?.subjectRoles || []) rows.push({ icon: "menu_book", title: `${subjectRole.subject} 관리자`, support: "과목 공지·숙제·준비물 관리", active: false });
    if (!rows.length) return `<p class="pincon-personal-card__meta">오늘 별도로 배정된 역할이 없습니다.</p>`;
    return `<div class="pincon-role-list">${rows.map((item) => `<div class="pincon-role-item" data-active="${item.active}"><md-icon>${item.icon}</md-icon><div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.support)}</span></div>${item.active ? "<md-icon>notifications_active</md-icon>" : ""}</div>`).join("")}</div>`;
  }

  function cleaningActions() {
    const cleaning = home?.today?.cleaning;
    if (!cleaning || cleaning.status === "COMPLETED") return "";
    const actions = [];
    if (cleaning.status === "ASSIGNED") actions.push(`<md-filled-button data-personal-action="cleaning-accept">수락</md-filled-button>`);
    if (["ASSIGNED", "ACCEPTED"].includes(cleaning.status)) {
      actions.push(`<md-filled-tonal-button data-personal-action="cleaning-exchange">교환 요청</md-filled-tonal-button>`);
      actions.push(`<md-text-button data-personal-action="cleaning-exemption">면제 요청</md-text-button>`);
    }
    if (["ASSIGNED", "ACCEPTED"].includes(cleaning.status)) actions.push(`<md-text-button data-personal-action="cleaning-complete">완료 표시</md-text-button>`);
    return actions.length ? `<div class="pincon-personal-actions">${actions.join("")}</div>` : "";
  }

  function tasksMarkup() {
    const tasks = upcomingTasks();
    if (!tasks.length) return `<p class="pincon-personal-card__meta">가까운 수행평가·숙제가 없습니다.</p>`;
    return `<div class="pincon-personal-tasks">${tasks.map((item) => `<div class="pincon-personal-task"><md-icon>assignment</md-icon><div><strong>${escapeHtml(item.title || item.subject || "할 일")}</strong><span>${escapeHtml(item.subject || "")} · ${escapeHtml(item.date)}</span></div></div>`).join("")}</div>`;
  }

  function managementMarkup() {
    const management = home?.management;
    if (!management) return "";
    const pending = management.pending || {};
    const total = Number(pending.cleaningRequests || 0) + Number(pending.subjectReviews || 0) + Number(pending.phoneChecks || 0);
    const account = home.account;
    const canClean = account.roles?.includes("DEPARTMENT_HEAD") || management.canManageClass;
    const canSubject = account.roles?.includes("SUBJECT_MANAGER") || management.canManageClass;
    if (!canClean && !canSubject && !management.canManagePhone) return "";
    return `<article class="pincon-personal-card pincon-personal-card--wide ${total ? "pincon-personal-card--attention" : ""}">
      <div class="pincon-personal-card__head"><h2>내가 관리할 것</h2><span class="pincon-personal-card__meta">정상 항목은 숨김</span></div>
      <div class="pincon-manage-summary">
        ${canClean ? `<span class="pincon-manage-chip">청소 요청 ${Number(pending.cleaningRequests || 0)}건</span>` : ""}
        ${management.canManagePhone ? `<span class="pincon-manage-chip">휴대폰 확인 ${Number(pending.phoneChecks || 0)}건</span>` : ""}
        ${canSubject ? `<span class="pincon-manage-chip">과목 검토 ${Number(pending.subjectReviews || 0)}건</span>` : ""}
      </div>
      <div class="pincon-personal-actions">
        ${canClean ? `<md-filled-tonal-button data-personal-action="manage-cleaning"><md-icon slot="icon">cleaning_services</md-icon>청소 관리</md-filled-tonal-button>` : ""}
        ${management.canManagePhone ? `<md-filled-tonal-button data-personal-action="manage-phone"><md-icon slot="icon">smartphone</md-icon>제출 현황</md-filled-tonal-button>` : ""}
        ${canSubject ? `<md-filled-tonal-button data-personal-action="manage-subject"><md-icon slot="icon">menu_book</md-icon>과목 관리</md-filled-tonal-button>` : ""}
        ${management.canManageClass ? `<md-text-button data-personal-action="open-admin">학급 운영 설정</md-text-button>` : ""}
      </div>
    </article>`;
  }

  function personalMarkup() {
    if (homeError) return `<section class="pincon-personal-home" id="pinconPersonalHome"><article class="pincon-personal-card pincon-personal-card--wide"><div class="pincon-personal-card__head"><h2>내 정보</h2></div><p>${escapeHtml(homeError)}</p><div class="pincon-personal-actions"><md-filled-tonal-button data-personal-action="refresh">다시 시도</md-filled-tonal-button><md-text-button data-personal-action="profile">프로필</md-text-button></div></article></section>`;
    if (!home) return `<section class="pincon-personal-home" id="pinconPersonalHome"><article class="pincon-personal-card pincon-personal-card--wide"><div class="pincon-personal-card__head"><h2>내 정보를 불러오는 중</h2></div><md-linear-progress indeterminate></md-linear-progress></article></section>`;
    return `<section class="pincon-personal-home" id="pinconPersonalHome" aria-label="개인화된 학급 운영 정보">
      <div class="pincon-personal-grid">
        <article class="pincon-personal-card pincon-personal-card--wide">
          <div class="pincon-personal-card__head"><h2>다음 수업</h2><md-icon-button class="pincon-profile-trigger" data-personal-action="profile" aria-label="프로필 열기"><md-icon>account_circle</md-icon></md-icon-button></div>
          ${lessonMarkup()}
        </article>
        <article class="pincon-personal-card"><div class="pincon-personal-card__head"><h2>오늘의 역할</h2><span class="pincon-personal-card__meta">${escapeHtml(koDate())}</span></div>${rolesMarkup()}${cleaningActions()}</article>
        <article class="pincon-personal-card"><div class="pincon-personal-card__head"><h2>스마트폰</h2></div>${phoneMarkup()}</article>
        <article class="pincon-personal-card pincon-personal-card--wide"><div class="pincon-personal-card__head"><h2>오늘 할 일</h2><span class="pincon-personal-card__meta">가까운 일정 우선</span></div>${tasksMarkup()}</article>
        ${managementMarkup()}
      </div>
    </section>`;
  }

  function routeIsToday() {
    const route = location.hash.replace(/^#\/?/, "").split("?")[0];
    return !route || route === "today";
  }

  function renderPersonal() {
    renderQueued = false;
    if (!routeIsToday()) return;
    const main = document.querySelector("#mainContent");
    const hero = main?.querySelector(".surface--hero");
    if (!main || !hero) return;
    const title = hero.querySelector(".hero-title");
    if (title && home?.account?.name) title.textContent = `안녕하세요, ${home.account.name}님.`;
    const kicker = hero.querySelector(".hero-kicker");
    if (kicker) kicker.textContent = koDate();
    main.querySelector("#pinconPersonalHome")?.remove();
    hero.insertAdjacentHTML("afterend", personalMarkup());
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(renderPersonal);
  }

  async function refreshHome() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = accountRequest("/api/class-ops/home")
      .then((data) => { home = data; homeError = ""; })
      .catch(() => { homeError = "내 학급 운영 정보를 불러오지 못했습니다."; })
      .finally(() => { refreshPromise = null; queueRender(); });
    return refreshPromise;
  }

  function dialogElement(title, body, { actions = "" } = {}) {
    document.querySelector("#pinconOpsDialog")?.remove();
    const dialog = document.createElement("md-dialog");
    dialog.id = "pinconOpsDialog";
    dialog.className = "pincon-ops-dialog";
    dialog.innerHTML = `<div slot="headline">${escapeHtml(title)}</div><div slot="content" class="pincon-dialog-body">${body}</div><div slot="actions">${actions}<md-text-button data-dialog-close>닫기</md-text-button></div>`;
    document.body.appendChild(dialog);
    dialog.querySelector("[data-dialog-close]")?.addEventListener("click", () => dialog.close?.());
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    dialog.show?.();
    return dialog;
  }

  async function doAction(path, body, statusNode = null) {
    try {
      if (statusNode) { statusNode.textContent = "처리 중…"; statusNode.dataset.error = "false"; }
      const result = await accountRequest(path, { method: "POST", body });
      if (statusNode) statusNode.textContent = "처리했습니다.";
      await refreshHome();
      return result;
    } catch (error) {
      if (statusNode) { statusNode.textContent = "처리하지 못했습니다. 권한 또는 현재 상태를 확인해주세요."; statusNode.dataset.error = "true"; }
      throw error;
    }
  }

  async function openExchangeDialog() {
    const targets = home?.today?.exchangeTargets || [];
    if (!targets.length) return dialogElement("청소 교환 요청", `<p>현재 교환을 요청할 수 있는 같은 부서 학생이 없습니다.</p>`);
    const dialog = dialogElement("청소 교환 요청", `<form class="pincon-dialog-form" id="pinconExchangeForm">
      <md-outlined-select id="pinconExchangeTarget" label="교환할 학생" required>${targets.map((item) => `<md-select-option value="${escapeHtml(item.uid)}"><div slot="headline">${item.number}번 ${escapeHtml(item.name)}</div></md-select-option>`).join("")}</md-outlined-select>
      <md-outlined-text-field id="pinconExchangeNote" label="메모 (선택)" maxlength="160"></md-outlined-text-field>
      <div class="pincon-dialog-status" id="pinconExchangeStatus"></div>
      <md-filled-button type="submit">요청 보내기</md-filled-button>
    </form>`);
    dialog.querySelector("#pinconExchangeForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const targetUid = dialog.querySelector("#pinconExchangeTarget")?.value || "";
      if (!targetUid) return;
      const status = dialog.querySelector("#pinconExchangeStatus");
      await doAction("/api/class-ops/cleaning", { action: "EXCHANGE_REQUEST", assignmentId: home.today.cleaning.id, targetUid, note: dialog.querySelector("#pinconExchangeNote")?.value || "" }, status).catch(() => {});
    });
  }

  async function openExemptionDialog() {
    const policy = home?.settings?.cleaningExemptionPolicy || {};
    const options = Object.entries(policy).filter(([, item]) => item?.enabled !== false);
    const dialog = dialogElement("청소 면제 요청", `<form class="pincon-dialog-form" id="pinconExemptionForm">
      <md-outlined-select id="pinconExemptionReason" label="사유" required>${options.map(([code, item]) => `<md-select-option value="${escapeHtml(code)}"><div slot="headline">${escapeHtml(item.label || code)}</div></md-select-option>`).join("")}</md-outlined-select>
      <md-outlined-text-field id="pinconExemptionNote" label="간단한 설명 (선택)" maxlength="160" supporting-text="건강 정보 등 민감한 세부내용은 적지 않아도 됩니다."></md-outlined-text-field>
      <div class="pincon-dialog-status" id="pinconExemptionStatus"></div>
      <md-filled-button type="submit">면제 요청</md-filled-button>
    </form>`);
    dialog.querySelector("#pinconExemptionForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const reasonCode = dialog.querySelector("#pinconExemptionReason")?.value || "";
      if (!reasonCode) return;
      await doAction("/api/class-ops/cleaning", { action: "EXEMPTION_REQUEST", assignmentId: home.today.cleaning.id, reasonCode, note: dialog.querySelector("#pinconExemptionNote")?.value || "" }, dialog.querySelector("#pinconExemptionStatus")).catch(() => {});
    });
  }

  async function openCleaningManager() {
    const departmentId = home?.management?.departmentId;
    if (!departmentId && !home?.management?.canManageClass) return;
    const query = departmentId ? `?departmentId=${encodeURIComponent(departmentId)}` : "";
    let data;
    try { data = await accountRequest(`/api/class-ops/cleaning${query}`); }
    catch { return dialogElement("청소 관리", `<p>관리할 부서를 확인하지 못했습니다.</p>`); }
    const assignment = data.todayAssignment;
    const dialog = dialogElement("청소 관리", `<section class="pincon-dialog-section">
      <h3>오늘 대걸레 담당</h3><p>${assignment ? `${escapeHtml(assignment.assigneeName)} · ${escapeHtml(assignment.selectionReason || assignment.status)}` : "아직 정해지지 않았습니다."}</p>
      <div class="pincon-personal-actions"><md-filled-button id="pinconRecommendCleaning">추천</md-filled-button><md-filled-tonal-button id="pinconAutoCleaning">공정 자동 배정</md-filled-tonal-button></div>
      <div class="pincon-dialog-status" id="pinconCleaningManagerStatus"></div>
    </section>
    <section class="pincon-dialog-section"><h3>처리 필요</h3>${data.pendingRequests.length ? data.pendingRequests.map((item) => `<div class="pincon-dialog-row"><div class="pincon-dialog-row__copy"><strong>${escapeHtml(item.requesterName)} · ${item.type === "EXEMPTION" ? "면제 요청" : "교환 요청"}</strong><span>${escapeHtml(item.reasonLabel || item.note || "")}</span></div>${item.type === "EXEMPTION" ? `<div><md-filled-tonal-button data-cleaning-approve="${escapeHtml(item.id)}">승인</md-filled-tonal-button><md-text-button data-cleaning-reject="${escapeHtml(item.id)}">거절</md-text-button></div>` : ""}</div>`).join("") : "<p>미처리 요청이 없습니다.</p>"}</section>`);
    const status = dialog.querySelector("#pinconCleaningManagerStatus");
    dialog.querySelector("#pinconRecommendCleaning")?.addEventListener("click", async () => {
      try {
        const result = await doAction("/api/class-ops/cleaning", { action: "RECOMMEND", departmentId: data.departmentId, date: data.date }, status);
        status.textContent = `추천: ${result.candidate.number}번 ${result.candidate.name} · ${result.reason}`;
      } catch {}
    });
    dialog.querySelector("#pinconAutoCleaning")?.addEventListener("click", async () => {
      try {
        const result = await doAction("/api/class-ops/cleaning", { action: "AUTO_ASSIGN", departmentId: data.departmentId, date: data.date }, status);
        status.textContent = `배정: ${result.assigneeName} · ${result.selectionReason}`;
      } catch {}
    });
    dialog.querySelectorAll("[data-cleaning-approve]").forEach((button) => button.addEventListener("click", () => doAction("/api/class-ops/cleaning", { action: "REQUEST_DECIDE", requestId: button.dataset.cleaningApprove, approve: true }, status).catch(() => {})));
    dialog.querySelectorAll("[data-cleaning-reject]").forEach((button) => button.addEventListener("click", () => doAction("/api/class-ops/cleaning", { action: "REQUEST_DECIDE", requestId: button.dataset.cleaningReject, approve: false }, status).catch(() => {})));
  }

  async function openPhoneManager() {
    let data;
    try { data = await accountRequest("/api/class-ops/phone"); }
    catch { return dialogElement("스마트폰 제출", `<p>제출 현황을 열 권한이 없거나 데이터를 불러오지 못했습니다.</p>`); }
    const statusOptions = Object.entries(PHONE_LABELS).map(([value, label]) => `<md-select-option value="${value}"><div slot="headline">${label}</div></md-select-option>`).join("");
    const dialog = dialogElement("스마트폰 제출", `<section class="pincon-dialog-section"><h3>${data.counts.submitted} / ${data.counts.total} 제출</h3><p>미지참 ${data.counts.notBrought} · 교사 허가 ${data.counts.teacherApproved} · 확인 필요 ${data.counts.checkRequired}</p><div class="pincon-personal-actions"><md-filled-button id="pinconBulkSubmit">전체 제출</md-filled-button><md-filled-tonal-button id="pinconStartReturn">반환 관리 시작</md-filled-tonal-button></div><div class="pincon-dialog-status" id="pinconPhoneStatus"></div></section>
      <div class="pincon-phone-roster">${data.students.map((item) => `<div class="pincon-phone-row"><div><strong>${item.number}번 ${escapeHtml(item.name)}</strong><span>${escapeHtml(PHONE_LABELS[item.state.status] || "미제출")}${item.state.returned ? " · 반환 완료" : ""}</span></div><md-outlined-select data-phone-status="${escapeHtml(item.uid)}" value="${escapeHtml(item.state.status)}" label="상태">${statusOptions}</md-outlined-select><md-filled-tonal-button data-phone-return="${escapeHtml(item.uid)}" ${item.state.status !== "SUBMITTED" ? "disabled" : ""}>${item.state.returned ? "반환 취소" : "반환 확인"}</md-filled-tonal-button></div>`).join("")}</div>`);
    const status = dialog.querySelector("#pinconPhoneStatus");
    dialog.querySelector("#pinconBulkSubmit")?.addEventListener("click", () => doAction("/api/class-ops/phone", { action: "BULK_SUBMIT", date: data.date }, status).catch(() => {}));
    dialog.querySelector("#pinconStartReturn")?.addEventListener("click", () => doAction("/api/class-ops/phone", { action: "START_RETURN", date: data.date }, status).catch(() => {}));
    dialog.querySelectorAll("[data-phone-status]").forEach((select) => select.addEventListener("change", () => doAction("/api/class-ops/phone", { action: "SET_STATUS", date: data.date, userUid: select.dataset.phoneStatus, status: select.value }, status).catch(() => {})));
    dialog.querySelectorAll("[data-phone-return]").forEach((button) => button.addEventListener("click", () => {
      const user = data.students.find((item) => item.uid === button.dataset.phoneReturn);
      return doAction("/api/class-ops/phone", { action: "MARK_RETURNED", date: data.date, userUid: button.dataset.phoneReturn, returned: user?.state?.returned !== true }, status).catch(() => {});
    }));
  }

  async function openSubjectManager() {
    const subjects = home?.account?.subjectRoles?.map((item) => item.subject) || [];
    if (!subjects.length && !home?.management?.canManageClass) return dialogElement("과목 관리", `<p>담당 과목이 없습니다.</p>`);
    const subject = subjects[0] || home?.management?.subjectQueue?.[0]?.subject || "";
    if (!subject) return dialogElement("과목 관리", `<p>과목 관리 항목이 없습니다.</p>`);
    let data;
    try { data = await accountRequest(`/api/class-ops/subject?subject=${encodeURIComponent(subject)}`); }
    catch { return dialogElement("과목 관리", `<p>해당 과목을 관리할 권한이 없습니다.</p>`); }
    const dialog = dialogElement(`${subject} 관리`, `<form class="pincon-dialog-form" id="pinconSubjectForm">
      <md-outlined-select id="pinconSubjectType" label="종류" value="HOMEWORK"><md-select-option value="HOMEWORK"><div slot="headline">숙제</div></md-select-option><md-select-option value="MATERIAL"><div slot="headline">준비물</div></md-select-option><md-select-option value="WORKSHEET"><div slot="headline">학습지</div></md-select-option><md-select-option value="NOTICE"><div slot="headline">과목 공지</div></md-select-option><md-select-option value="ASSESSMENT"><div slot="headline">수행평가 제안</div></md-select-option><md-select-option value="CLASSROOM_CHANGE"><div slot="headline">교실 변경</div></md-select-option></md-outlined-select>
      <md-outlined-text-field id="pinconSubjectTitle" label="제목" maxlength="120" required></md-outlined-text-field>
      <md-outlined-text-field id="pinconSubjectBody" label="내용" type="textarea" rows="3" maxlength="1600"></md-outlined-text-field>
      <md-outlined-text-field id="pinconSubjectDate" label="날짜" type="date"></md-outlined-text-field>
      <md-outlined-text-field id="pinconSubjectMaterials" label="준비물"></md-outlined-text-field>
      <md-outlined-text-field id="pinconSubjectClassroom" label="교실"></md-outlined-text-field>
      <md-outlined-text-field id="pinconSubjectUrl" label="학습지 링크" type="url"></md-outlined-text-field>
      <div class="pincon-dialog-status" id="pinconSubjectStatus"></div><md-filled-button type="submit">등록</md-filled-button>
    </form><section class="pincon-dialog-section"><h3>최근 항목</h3>${data.entries.slice(0, 8).map((item) => `<div class="pincon-dialog-row"><div class="pincon-dialog-row__copy"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.type)} · ${item.status === "PENDING_REVIEW" ? "검토 필요" : item.status === "APPROVED" ? "공개됨" : item.status}</span></div></div>`).join("") || "<p>등록된 항목이 없습니다.</p>"}</section>`);
    dialog.querySelector("#pinconSubjectForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = dialog.querySelector("#pinconSubjectStatus");
      await doAction("/api/class-ops/subject", {
        action: "UPSERT", subject,
        type: dialog.querySelector("#pinconSubjectType")?.value,
        title: dialog.querySelector("#pinconSubjectTitle")?.value,
        body: dialog.querySelector("#pinconSubjectBody")?.value,
        dueDate: dialog.querySelector("#pinconSubjectDate")?.value,
        materials: dialog.querySelector("#pinconSubjectMaterials")?.value,
        classroom: dialog.querySelector("#pinconSubjectClassroom")?.value,
        resourceUrl: dialog.querySelector("#pinconSubjectUrl")?.value,
      }, status).catch(() => {});
    });
  }

  function openProfile() {
    const account = home?.account || accountContext.account;
    const roles = (account.roles || []).map((role) => `<span class="pincon-profile-role">${escapeHtml(ROLE_LABELS[role] || role)}</span>`).join("");
    const dialog = dialogElement("내 계정", `<section class="pincon-dialog-section"><h3>${escapeHtml(account.name)}</h3><p>${account.grade}학년 ${account.classNumber}반 ${account.number}번 · 학번 ${escapeHtml(account.studentNumber)}</p><div class="pincon-profile-roles">${roles}</div></section>
      <form class="pincon-dialog-form" id="pinconChangePinForm"><h3>PIN 변경</h3><md-outlined-text-field id="pinconProfilePin" label="새 PIN" type="password" inputmode="numeric" minlength="6" maxlength="12"></md-outlined-text-field><md-outlined-text-field id="pinconProfilePinConfirm" label="PIN 확인" type="password" inputmode="numeric" minlength="6" maxlength="12"></md-outlined-text-field><div class="pincon-dialog-status" id="pinconProfileStatus"></div><md-filled-tonal-button type="submit">PIN 변경</md-filled-tonal-button></form>
      <md-filled-button id="pinconLogout"><md-icon slot="icon">logout</md-icon>로그아웃</md-filled-button>`);
    dialog.querySelector("#pinconChangePinForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const pin = String(dialog.querySelector("#pinconProfilePin")?.value || "");
      const confirm = String(dialog.querySelector("#pinconProfilePinConfirm")?.value || "");
      const status = dialog.querySelector("#pinconProfileStatus");
      if (pin !== confirm) { status.textContent = "PIN 확인 값이 일치하지 않습니다."; status.dataset.error = "true"; return; }
      try { await changeStudentPin(pin); status.textContent = "PIN을 변경했습니다."; status.dataset.error = "false"; }
      catch (error) { status.textContent = error?.message || "PIN을 변경하지 못했습니다."; status.dataset.error = "true"; }
    });
    dialog.querySelector("#pinconLogout")?.addEventListener("click", async () => { await signOutStudent(); location.reload(); });
  }

  document.addEventListener("click", async (event) => {
    const trigger = event.target.closest?.("[data-personal-action]");
    if (!trigger) return;
    const action = trigger.dataset.personalAction;
    if (action === "profile") openProfile();
    else if (action === "refresh") refreshHome();
    else if (action === "cleaning-accept") await doAction("/api/class-ops/cleaning", { action: "ACCEPT", assignmentId: home.today.cleaning.id }).catch(() => {});
    else if (action === "cleaning-complete") await doAction("/api/class-ops/cleaning", { action: "COMPLETE", assignmentId: home.today.cleaning.id }).catch(() => {});
    else if (action === "cleaning-exchange") openExchangeDialog();
    else if (action === "cleaning-exemption") openExemptionDialog();
    else if (action === "manage-cleaning") openCleaningManager();
    else if (action === "manage-phone") openPhoneManager();
    else if (action === "manage-subject") openSubjectManager();
    else if (action === "open-admin") location.assign("./admin/");
  });

  gateway.addEventListener("change", queueRender);
  window.addEventListener("hashchange", queueRender);
  new MutationObserver(queueRender).observe(document.querySelector("#app"), { childList: true, subtree: true });
  await refreshHome();
  queueRender();
}
