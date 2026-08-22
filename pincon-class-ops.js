import {
  CLASS_OPS_VERSION,
  FEEDBACK_STATUSES,
  NOTIFICATION_DEFAULTS,
  RESOURCE_CATEGORIES,
  RIGHTS_BASES,
  SUPPLY_STATUSES,
  WORKSHEET_TYPES,
  aggregateAnswers,
  buildClassNotice,
  buildPatchDraft,
  buildTodayFeed,
  dateToMs,
  formatKoreanDate,
  isExamPeriod,
  isOpenWindow,
  itemDate,
  itemPriority,
  kstDate,
  monthKey,
  nextPatchVersion,
  plainText,
  relativeDateLabel,
  safeExternalUrl,
  searchAll,
  timestampMs,
} from "./pincon-class-ops-core.js";
import { SCHOOL, classOpsRepository } from "./pincon-class-ops-data.js";

await Promise.resolve(globalThis.PINCON_MATERIAL_READY).catch(() => null);

const FEEDBACK_CATEGORIES = ["시설", "학급 규칙", "공용품", "행사", "학습", "청소", "기타"];
const EVENT_KINDS = [
  ["survey34", "우리반 34명에게 물었습니다"],
  ["family-arcade", "가족오락관"],
  ["quiz", "퀴즈"],
  ["balance", "밸런스게임"],
  ["class-vote", "반 전체 투표"],
  ["survey", "익명 설문"],
  ["mini-game", "미니 게임"],
];

const NAV_ITEMS = [
  ["today", "오늘", "today"],
  ["schedule", "일정", "calendar_month"],
  ["class", "학급", "groups"],
  ["resources", "자료", "folder_open"],
  ["more", "더보기", "more_horiz"],
];

const ICONS = Object.freeze({
  announcement: "campaign",
  assessment: "assignment",
  exam: "school",
  preparation: "backpack",
  academic: "event_note",
  timetable: "view_timeline",
  meal: "restaurant",
  event: "celebration",
  notice: "notifications",
  supply: "inventory_2",
});

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function attr(value) {
  return esc(value).replace(/`/g, "&#96;");
}

function nl(value) {
  return esc(value).replace(/\n/g, "<br>");
}

function compact(value, max = 100) {
  const text = plainText(String(value || "").replace(/<br\s*\/?\s*>/gi, " · ").replace(/<[^>]+>/g, " "), max + 1);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function activeRows(rows = []) {
  return rows.filter((item) => !item.deleted);
}

function byNewest(a, b) {
  return timestampMs(b.updatedAtMs || b.createdAtMs) - timestampMs(a.updatedAtMs || a.createdAtMs);
}

function byDate(a, b) {
  return dateToMs(itemDate(a)) - dateToMs(itemDate(b)) || byNewest(a, b);
}

function listDivider(index, size) {
  return index < size - 1 ? "<md-divider inset></md-divider>" : "";
}

function emptyState(icon, title, body, action = "") {
  return `<md-list class="pincon-ops-empty"><md-list-item><md-icon slot="start">${esc(icon)}</md-icon><span slot="headline">${esc(title)}</span><span slot="supporting-text">${esc(body)}</span>${action ? `<span slot="end">${action}</span>` : ""}</md-list-item></md-list>`;
}

function statusPill(label, tone = "") {
  return `<md-assist-chip class="pincon-ops-status-pill" label="${attr(label)}"${tone ? ` data-tone="${attr(tone)}"` : ""}></md-assist-chip>`;
}

function sectionMarkup({ kicker, title, count = "", body, wide = false, action = "" }) {
  return `<section class="pincon-ops-section${wide ? " pincon-ops-wide" : ""}">
    <div class="pincon-ops-section-heading"><div><p>${esc(kicker)}</p><h2>${esc(title)}</h2></div>${action || (count !== "" ? `<span class="pincon-ops-section-count">${esc(count)}</span>` : "")}</div>
    ${body}
  </section>`;
}

function mealDishes(item = {}) {
  const structured = Array.isArray(item.dishes)
    ? item.dishes
    : Array.isArray(item.menu)
      ? item.menu
      : [];
  const rows = structured.length
    ? structured
    : String(item.dishesHtml || item.body || "").split(/<br\s*\/?\s*>|\n|·/gi);
  return rows
    .map((row) => compact(typeof row === "string" ? row : row?.name || row?.dishName || "", 60))
    .filter(Boolean);
}

function timetableSectionBody(timetable) {
  const periods = Array.isArray(timetable?.periods) ? timetable.periods : [];
  return periods.length
    ? `<div class="pincon-ops-surface"><md-list>${periods.map((period, index) => `<md-list-item><md-icon slot="start">counter_${Math.min(9, Number(period.period || index + 1))}</md-icon><span slot="headline">${esc(period.subject || "과목 미정")}</span><span slot="supporting-text">${esc(`${period.period || index + 1}교시${period.room ? ` · ${period.room}` : ""}`)}</span></md-list-item>${listDivider(index, periods.length)}`).join("")}</md-list></div>`
    : emptyState("calendar_view_week", "오늘 시간표를 기다리는 중입니다", "컴시간 또는 NEIS 동기화가 완료되면 자동으로 표시됩니다.");
}

function mealSectionBody(meal) {
  const dishes = mealDishes(meal);
  return meal && dishes.length
    ? `<div class="pincon-ops-surface"><md-list><md-list-item><md-icon slot="start">restaurant</md-icon><span slot="headline">${esc(`${meal.mealType || "중식"} 식단`)}</span><span slot="supporting-text">${esc(dishes.join(" · "))}</span></md-list-item></md-list></div>`
    : emptyState("no_meals", "오늘 식단을 기다리는 중입니다", "NEIS 급식 정보가 연결되면 메뉴를 바로 보여 줍니다.");
}

function academicSectionBody(academic = []) {
  return academic.length
    ? `<div class="pincon-ops-surface"><md-list>${academic.map((item, index) => `<md-list-item><md-icon slot="start">event_note</md-icon><span slot="headline">${esc(item.title || item.eventName || item.events?.join(" · ") || "학교 일정")}</span><span slot="supporting-text">${esc(`${formatKoreanDate(item.date)} · ${item.source || "NEIS"}`)}</span></md-list-item>${listDivider(index, academic.length)}`).join("")}</md-list></div>`
    : emptyState("event_busy", "예정된 학사일정이 없습니다", "NEIS 학사일정이 자동으로 연결되면 표시됩니다.");
}

function groupSectionBody(groups = []) {
  return groups.length
    ? `<div class="pincon-ops-surface"><md-list>${groups.map((item, index) => `<md-list-item><md-icon slot="start">groups_2</md-icon><span slot="headline">${esc([item.subject, item.title || item.groupLabel].filter(Boolean).join(" · ") || "학급 모둠")}</span><span slot="supporting-text">${esc(item.groupLabel || `${Array.isArray(item.members) ? item.members.length : 0}명 · 역할 확인`)}</span></md-list-item>${listDivider(index, groups.length)}`).join("")}</md-list></div>`
    : emptyState("group_off", "등록된 모둠이 없습니다", "기존 PinCon에 모둠과 역할이 등록되면 이곳에 함께 표시됩니다.");
}

function field(name, label, value = "", options = {}) {
  const textarea = options.textarea ? ` type="textarea" rows="${options.rows || 4}"` : ` type="${options.type || "text"}"`;
  return `<md-outlined-text-field data-field="${attr(name)}" label="${attr(label)}" value="${attr(value)}"${textarea}${options.required ? " required" : ""}${options.max ? ` maxlength="${Number(options.max)}"` : ""}${options.support ? ` supporting-text="${attr(options.support)}"` : ""}></md-outlined-text-field>`;
}

function selectField(name, label, options, selected = "") {
  return `<md-outlined-select data-field="${attr(name)}" label="${attr(label)}">${options.map((item) => {
    const [value, text] = Array.isArray(item) ? item : [item, item];
    return `<md-select-option value="${attr(value)}"${String(value) === String(selected) ? " selected" : ""}><span slot="headline">${esc(text)}</span></md-select-option>`;
  }).join("")}</md-outlined-select>`;
}

function checkField(name, label, checked = false) {
  return `<div class="pincon-ops-check-row"><md-checkbox data-field="${attr(name)}"${checked ? " checked" : ""}></md-checkbox><label>${esc(label)}</label></div>`;
}

function fileField(name, label, { imageOnly = false } = {}) {
  return `<div class="pincon-ops-file-field"><strong>${esc(label)}</strong><span>${imageOnly ? "이미지" : "이미지·PDF·문서"}, 최대 10MB</span><input data-file="${attr(name)}" type="file" accept="${imageOnly ? "image/*" : "image/*,.pdf,.txt,.doc,.docx,.ppt,.pptx,.xls,.xlsx"}" hidden><div><md-outlined-button data-file-trigger="${attr(name)}"><md-icon slot="icon">attach_file</md-icon>파일 고르기</md-outlined-button><span data-file-name="${attr(name)}">선택된 파일 없음</span></div></div>`;
}

class PinconClassOpsApp {
  constructor(repository) {
    this.repo = repository;
    this.state = repository.snapshot();
    this.opened = false;
    this.tab = "today";
    this.shell = null;
    this.toastTimer = 0;
    this.presentation = null;
    this.installPrompt = null;
    this.transitionToken = 0;
    this.repo.addEventListener("change", (event) => {
      this.state = event.detail;
      if (!this.state.isPresident && this.tab === "manage") this.tab = "today";
      if (this.state.classKey && !this.opened) this.open(this.tab);
      this.render();
    });
  }

  async init() {
    this.shell = document.createElement("div");
    this.shell.className = "pincon-ops-shell";
    this.shell.dataset.open = "false";
    this.shell.setAttribute("aria-hidden", "true");
    document.body.appendChild(this.shell);
    this.shell.addEventListener("click", (event) => {
      this.onClick(event).catch((error) => this.toast(error?.message || "작업을 완료하지 못했습니다.", true));
    });
    this.shell.addEventListener("change", (event) => this.onChange(event));
    this.shell.addEventListener("input", (event) => this.onInput(event));
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      this.installPrompt = event;
      this.render();
    });
    const observer = new MutationObserver(() => this.syncProfile());
    observer.observe(document.getElementById("root") || document.body, { childList: true, subtree: true });
    this.syncProfile();
    this.render();
    const initialUrl = new URL(location.href);
    this.tab = initialUrl.searchParams.get("class-tab") || "today";
    if (this.state.classKey) this.open(this.tab);
  }

  syncProfile() {
    const changed = this.repo.refreshProfile();
    this.state = this.repo.snapshot();
    if (!this.state.classKey) {
      this.opened = false;
      document.body.classList.remove("pincon-ops-open", "pincon-unified-ready");
      this.shell.dataset.open = "false";
      this.shell.setAttribute("aria-hidden", "true");
      return;
    }
    if (changed || !this.opened) this.open(this.tab);
  }

  data(name) {
    return this.state.data?.[name] || [];
  }

  open(tab = "today") {
    this.opened = true;
    this.tab = tab === "manage" && !this.state.isPresident ? "today" : tab;
    document.body.classList.add("pincon-ops-open", "pincon-unified-ready");
    this.shell.dataset.open = "true";
    this.shell.setAttribute("aria-hidden", "false");
    const url = new URL(location.href);
    url.searchParams.set("class-ops", "1");
    url.searchParams.set("class-tab", this.tab);
    history.replaceState(history.state, "", url);
    this.repo.start().catch((error) => this.repo.recordError(error));
    this.render();
    requestAnimationFrame(() => this.shell.querySelector(".pincon-ops-main")?.focus?.());
  }

  close() {
    this.tab = "more";
    this.render();
  }

  async switchTab(nextTab = "today") {
    const normalizedTab = nextTab === "manage" && !this.state.isPresident ? "today" : nextTab;
    if (normalizedTab === this.tab) return;
    const token = ++this.transitionToken;
    const view = this.shell?.querySelector(".pincon-ops-view");
    const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (view && !reducedMotion && typeof view.animate === "function") {
      view.getAnimations?.().forEach((animation) => animation.cancel());
      const exitEasing = getComputedStyle(this.shell).getPropertyValue("--pincon-motion-emphasized-accelerate").trim()
        || "cubic-bezier(.3, 0, 1, 1)";
      try {
        await view.animate([
          { opacity: 1, transform: "translateY(0) scale(1)" },
          { opacity: 0, transform: "translateY(-6px) scale(.992)" },
        ], {
          duration: 160,
          easing: exitEasing,
          fill: "forwards",
        }).finished;
      } catch {
        // A newer tab selection superseded this transition.
      }
    }
    if (token !== this.transitionToken) return;
    this.tab = normalizedTab;
    const url = new URL(location.href);
    url.searchParams.set("class-ops", "1");
    url.searchParams.set("class-tab", this.tab);
    history.replaceState(history.state, "", url);
    this.render();
    requestAnimationFrame(() => this.shell?.querySelector(".pincon-ops-main")?.focus?.());
  }

  updateLaunchCard() {
    document.querySelectorAll(".pincon-ops-launch-card").forEach((card) => card.remove());
    this.syncProfile();
  }

  render() {
    if (!this.shell) return;
    const profile = this.state.profile;
    const classLabel = profile ? `${profile.grade}학년 ${profile.classNumber}반` : "학급 선택 필요";
    const nav = [...NAV_ITEMS, ...(this.state.isPresident ? [["manage", "관리", "admin_panel_settings"]] : [])];
    const currentNav = nav.find(([key]) => key === this.tab) || nav[0];
    const activeIndex = Math.max(0, nav.findIndex(([key]) => key === this.tab));
    const body = this.renderView();
    this.shell.innerHTML = `
      <aside class="pincon-ops-rail" aria-label="PinCon 탐색 패널">
        <div class="pincon-ops-rail-brand"><span><md-icon>school</md-icon></span><div><strong>PinCon</strong><small>학급생활 허브</small></div></div>
        <md-list class="pincon-ops-rail-nav" aria-label="주요 메뉴">${nav.map(([key, label, icon]) => `<md-list-item type="button" data-action="tab" data-tab="${key}" data-active="${key === this.tab}"${key === this.tab ? ` aria-current="page"` : ""}><md-icon slot="start">${icon}</md-icon><span slot="headline">${label}</span>${key === this.tab ? `<md-icon slot="end">arrow_right</md-icon>` : ""}</md-list-item>`).join("")}</md-list>
        <div class="pincon-ops-rail-footer"><div>${statusPill(this.state.online ? "동기화됨" : "오프라인", this.state.online ? "good" : "")}</div><strong>${esc(classLabel)}</strong><span>${esc(SCHOOL.name)}${this.state.isPresident ? " · 회장 계정" : ""}</span></div>
      </aside>
      <header class="pincon-ops-topbar">
        <div class="pincon-ops-mobile-brand"><strong>PinCon</strong><span>${esc(classLabel)}</span></div>
        <div class="pincon-ops-current"><span>${esc(currentNav[1])}</span><strong>${esc(classLabel)}</strong></div>
        <div class="pincon-ops-top-actions"><md-filled-tonal-icon-button data-action="search" aria-label="통합 검색"><md-icon>search</md-icon></md-filled-tonal-icon-button><md-filled-tonal-icon-button data-action="class-change" aria-label="학급 변경"><md-icon>account_circle</md-icon></md-filled-tonal-icon-button></div>
      </header>
      <main class="pincon-ops-main" tabindex="-1">${body}</main>
      <nav class="pincon-ops-navigation" aria-label="PinCon 주요 메뉴" style="--pincon-tab-count:${nav.length}"><md-tabs active-tab-index="${activeIndex}">${nav.map(([key, label, icon]) => `<md-primary-tab data-action="tab" data-tab="${key}"${key === this.tab ? " active" : ""}><md-icon slot="icon">${icon}</md-icon>${label}</md-primary-tab>`).join("")}</md-tabs></nav>
      ${this.state.isPresident ? `<md-fab class="pincon-unified-fab" label="빠른 등록" data-action="announcement-create"><md-icon slot="icon">add</md-icon></md-fab>` : ""}`;
  }

  renderView() {
    const error = this.state.lastError ? `<div class="pincon-ops-error" role="alert"><md-icon>error</md-icon><span>${esc(this.state.lastError)}</span></div>` : "";
    const loading = !this.state.ready && this.state.syncing
      ? emptyState("sync", "학급 정보를 연결하는 중입니다", "기존 PinCon 데이터와 학급 운영 기록을 안전하게 불러오고 있습니다.")
      : "";
    const content = ({
      today: () => this.renderToday(),
      schedule: () => this.renderSchedule(),
      class: () => this.renderClass(),
      resources: () => this.renderResources(),
      more: () => this.renderMore(),
      manage: () => this.renderManage(),
    }[this.tab] || (() => this.renderToday()))();
    return `<div class="pincon-ops-view">${error}${loading}${content}</div>`;
  }

  pageHeading(kicker, title, body) {
    return `<header class="pincon-ops-page-heading"><p class="pincon-ops-eyebrow">${esc(kicker)}</p><h1>${esc(title)}</h1><p>${esc(body)}</p></header>`;
  }

  feedCard(item, priority = false) {
    const date = itemDate(item);
    const body = item.body || item.description || (item.periods ? `${item.periods.length}교시` : "");
    return `<md-list class="pincon-ops-feed-card"${priority ? " data-priority=\"top\"" : ""}><md-list-item>
      <md-icon slot="start">${ICONS[item.feedKind || item.type || item.kind] || "info"}</md-icon>
      <span slot="headline">${esc(item.title || item.name || "학급 안내")}</span>
      <span slot="supporting-text">${esc(compact(body, 120) || item.subject || "자세한 내용을 확인하세요.")} · ${esc(date ? relativeDateLabel(date) : "오늘")} · ${esc(item.sourceLabel || item.source || "학급 입력")}</span>
    </md-list-item></md-list>`;
  }

  renderToday() {
    const feed = buildTodayFeed(this.state.data || {});
    const exam = isExamPeriod(this.state.data || {});
    const urgent = feed.filter((item) => itemPriority(item) <= 3);
    const regular = feed.filter((item) => itemPriority(item) > 3);
    const today = kstDate();
    const timetable = activeRows(this.data("neisTimetables")).find((item) => item.date === today);
    const meal = activeRows(this.data("meals")).find((item) => item.date === today);
    const groups = activeRows(this.data("content")).filter((item) => item.kind === "group").sort(byNewest).slice(0, 6);
    const academic = activeRows(this.data("academicSchedules")).filter((item) => dateToMs(item.date) >= dateToMs(today)).sort(byDate).slice(0, 5);
    const title = exam.active ? `${exam.title}까지 D-${exam.days}` : "오늘, 우리 반이 해야 할 일";
    const heroBody = urgent.length
      ? `${urgent[0].title}${urgent.length > 1 ? ` 외 ${urgent.length - 1}개를 먼저 확인하세요.` : "을 먼저 확인하세요."}`
      : "긴급하거나 놓치면 안 되는 일정이 없습니다.";
    const hero = `<section class="pincon-ops-hero" data-tone="${exam.active ? "exam" : urgent.length ? "urgent" : "default"}"><div class="pincon-ops-status-line">${statusPill(formatKoreanDate(today, { long: true }), "")}${exam.active ? statusPill(`시험 D-${exam.days}`, "good") : ""}${!this.state.online ? statusPill("오프라인 캐시", "") : statusPill("동기화됨", "good")}</div><h2>${esc(title)}</h2><p class="pincon-ops-hero-body">${esc(heroBody)}</p><div class="pincon-ops-hero-actions"><md-filled-button data-action="tab" data-tab="schedule"><md-icon slot="icon">calendar_month</md-icon>전체 일정</md-filled-button>${this.state.isPresident ? `<md-filled-tonal-button data-action="notice-share"><md-icon slot="icon">share</md-icon>카카오톡 공지 만들기</md-filled-tonal-button>` : ""}<md-outlined-button data-action="feedback-create"><md-icon slot="icon">forum</md-icon>익명 의견 남기기</md-outlined-button></div></section>`;
    const examResources = activeRows(this.data("resources"))
      .filter((item) => this.state.isPresident || item.moderationStatus === "approved")
      .filter((item) => item.category === "시험범위" || /시험\s*범위/.test(`${item.title || ""} ${item.description || ""}`))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || byNewest(a, b)).slice(0, 8);
    const weekEnd = dateToMs(kstDate(Date.now(), 7), true);
    const weekAssessments = activeRows(this.data("classAssignments"))
      .filter((item) => ["assessment", "exam"].includes(item.type))
      .filter((item) => dateToMs(itemDate(item)) >= dateToMs(today) && dateToMs(itemDate(item)) <= weekEnd)
      .sort(byDate).slice(0, 8);
    const scopeBody = examResources.length
      ? `<div class="pincon-ops-surface"><md-list>${examResources.map((item, index) => { const url = safeExternalUrl(item.url); return `<md-list-item${url ? ` href="${attr(url)}" target="_blank"` : ""}><md-icon slot="start">menu_book</md-icon><span slot="headline">${esc(item.title)}</span><span slot="supporting-text">${esc([item.subject, item.category].filter(Boolean).join(" · ") || "시험범위")}</span></md-list-item>${listDivider(index, examResources.length)}`; }).join("")}</md-list></div>`
      : emptyState("menu_book", "등록된 시험범위가 없습니다", "회장이 시험범위 자료를 등록하면 과목별로 모아 보여 줍니다.");
    const weekBody = weekAssessments.length
      ? `<div class="pincon-ops-surface"><md-list>${weekAssessments.map((item, index) => `<md-list-item><md-icon slot="start">assignment</md-icon><span slot="headline">${esc(item.title)}</span><span slot="supporting-text">${esc([item.subject, relativeDateLabel(itemDate(item))].filter(Boolean).join(" · "))}</span></md-list-item>${listDivider(index, weekAssessments.length)}`).join("")}</md-list></div>`
      : emptyState("task_alt", "이번 주 평가가 없습니다", "새 수행평가가 등록되면 시험 정보와 함께 우선 표시됩니다.");
    const examFocus = exam.active ? `<div class="pincon-ops-exam-grid">${sectionMarkup({ kicker: "시험기간 모드", title: "시험범위", count: examResources.length, body: scopeBody })}${sectionMarkup({ kicker: "이번 주", title: "수행평가", count: weekAssessments.length, body: weekBody })}</div>` : "";
    const essentials = `<div class="pincon-essential-grid pincon-desktop-essentials">${sectionMarkup({ kicker: timetable?.source || "자동 연동", title: "오늘 시간표", count: timetable?.periods?.length || 0, body: timetableSectionBody(timetable) })}${sectionMarkup({ kicker: meal?.source || "NEIS", title: "오늘 식단", count: mealDishes(meal).length, body: mealSectionBody(meal) })}${sectionMarkup({ kicker: "기존 PinCon", title: "모둠과 역할", count: groups.length, body: groupSectionBody(groups) })}${sectionMarkup({ kicker: "NEIS", title: "학사일정", count: academic.length, body: academicSectionBody(academic) })}</div>`;
    const timetableSummary = timetable?.periods?.length
      ? timetable.periods.map((period) => period.subject || "과목 미정").join(" · ")
      : "시간표 연동을 기다리고 있습니다.";
    const dishes = mealDishes(meal);
    const mealSummary = dishes.length ? dishes.join(" · ") : "오늘 식단 연동을 기다리고 있습니다.";
    const groupSummary = groups.length
      ? groups.map((item) => item.title || item.groupLabel || item.subject || "학급 모둠").join(" · ")
      : "등록된 모둠과 역할이 없습니다.";
    const firstAcademic = academic[0];
    const academicSummary = firstAcademic
      ? `${formatKoreanDate(firstAcademic.date)} · ${firstAcademic.title || firstAcademic.eventName || firstAcademic.events?.join(" · ") || "학교 일정"}`
      : "예정된 학사일정이 없습니다.";
    const mobileEssentialsBody = `<div class="pincon-ops-surface"><md-list><md-list-item><md-icon slot="start">view_timeline</md-icon><span slot="headline">오늘 시간표</span><span slot="supporting-text">${esc(compact(timetableSummary, 110))}</span></md-list-item><md-divider inset></md-divider><md-list-item><md-icon slot="start">restaurant</md-icon><span slot="headline">오늘 식단</span><span slot="supporting-text">${esc(compact(mealSummary, 110))}</span></md-list-item><md-divider inset></md-divider><md-list-item><md-icon slot="start">groups_2</md-icon><span slot="headline">모둠과 역할</span><span slot="supporting-text">${esc(compact(groupSummary, 110))}</span></md-list-item><md-divider inset></md-divider><md-list-item><md-icon slot="start">event_note</md-icon><span slot="headline">학사일정</span><span slot="supporting-text">${esc(compact(academicSummary, 110))}</span></md-list-item></md-list></div>`;
    const mobileEssentials = `<div class="pincon-mobile-essentials">${sectionMarkup({ kicker: "오늘 한눈에", title: "우리 반 정보", body: mobileEssentialsBody })}</div>`;
    const importantBody = urgent.length ? `<div class="pincon-ops-feed-list">${urgent.map((item) => this.feedCard(item, true)).join("")}</div>` : emptyState("done_all", "오늘의 필수 확인 완료", "새 긴급 공지나 오늘 수행평가가 등록되면 가장 먼저 표시됩니다.");
    const restBody = regular.length ? `<div class="pincon-ops-feed-list">${regular.slice(0, 10).map((item) => this.feedCard(item)).join("")}</div>` : emptyState("inbox", "추가 안내가 없습니다", "급식·시간표·학사 일정과 학급 입력 자료가 연결되면 이곳에 모입니다.");
    return `${this.pageHeading("오늘", title, "기존 PinCon 정보와 학급 운영 기록을 한 흐름으로 정리했습니다.")}<div class="pincon-today-stage"><div class="pincon-today-lead">${hero}</div><aside class="pincon-today-focus">${sectionMarkup({ kicker: "먼저 확인", title: "놓치면 안 되는 정보", count: urgent.length, body: importantBody })}</aside></div>${essentials}${mobileEssentials}${examFocus}${sectionMarkup({ kicker: "오늘과 이번 주", title: "이어서 확인하기", count: regular.length, body: restBody, wide: true })}`;
  }

  renderSchedule() {
    const today = kstDate();
    const assignments = activeRows(this.data("classAssignments")).filter((item) => dateToMs(itemDate(item)) >= dateToMs(today)).sort(byDate);
    const academic = activeRows(this.data("academicSchedules")).filter((item) => dateToMs(item.date) >= dateToMs(today)).sort(byDate).slice(0, 20);
    const timetable = activeRows(this.data("neisTimetables")).find((item) => item.date === today);
    const meal = activeRows(this.data("meals")).find((item) => item.date === today);
    const changes = activeRows(this.data("content")).filter((item) => item.kind === "schedule").sort(byNewest).slice(0, 20);
    const assignmentBody = assignments.length ? `<div class="pincon-ops-surface"><md-list>${assignments.slice(0, 30).map((item, index) => `<md-list-item><md-icon slot="start">${ICONS[item.type] || "event"}</md-icon><span slot="headline">${esc(item.title)}</span><span slot="supporting-text">${esc([item.subject, relativeDateLabel(itemDate(item)), item.type === "preparation" ? "준비물" : "수행·시험"].filter(Boolean).join(" · "))}</span>${this.state.isPresident ? `<span slot="end"><md-text-button data-action="assignment-edit" data-id="${attr(item.id)}">수정</md-text-button><md-text-button data-action="item-delete" data-collection="classAssignments" data-id="${attr(item.id)}">삭제</md-text-button></span>` : ""}</md-list-item>${listDivider(index, assignments.length)}`).join("")}</md-list></div>` : emptyState("event_available", "등록된 수행평가가 없습니다", "회장이 수행평가와 준비물을 등록하면 날짜순으로 표시됩니다.");
    const timetableBody = timetableSectionBody(timetable);
    const mealBody = mealSectionBody(meal);
    const academicBody = academicSectionBody(academic);
    const changeBody = changes.length ? `<div class="pincon-ops-surface"><md-list>${changes.map((item, index) => `<md-list-item><md-icon slot="start">move_up</md-icon><span slot="headline">${esc(item.title || `${item.day || ""} ${item.period || ""}교시 ${item.subject || "수업 변경"}`)}</span><span slot="supporting-text">${esc([item.status, item.room, compact(item.body, 100)].filter(Boolean).join(" · ") || "기존 PinCon에서 등록된 변경")}</span></md-list-item>${listDivider(index, changes.length)}`).join("")}</md-list></div>` : emptyState("event_repeat", "등록된 수업 변경이 없습니다", "시간표·교실 이동이 등록되면 자동 시간표와 함께 표시됩니다.");
    return `${this.pageHeading("일정", "수행평가·식단·학사일정", "기존 PinCon의 수업 변경과 NEIS·학급 입력을 출처별로 함께 보여 줍니다.")}<div class="pincon-ops-grid">${sectionMarkup({ kicker: "학급 입력", title: "수행평가·준비물", count: assignments.length, body: assignmentBody })}${sectionMarkup({ kicker: timetable?.source || "자동 연동", title: "오늘 시간표", count: timetable?.periods?.length || 0, body: timetableBody })}${sectionMarkup({ kicker: meal?.source || "NEIS", title: "오늘 식단", count: mealDishes(meal).length, body: mealBody })}${sectionMarkup({ kicker: "NEIS", title: "학사일정", count: academic.length, body: academicBody })}${sectionMarkup({ kicker: "기존 PinCon", title: "수업 변경·교실 이동", count: changes.length, body: changeBody, wide: true })}</div>`;
  }

  feedbackCard(item) {
    const status = FEEDBACK_STATUSES[item.status] || "접수";
    const tone = item.status === "completed" ? "good" : item.status === "difficult" ? "urgent" : "";
    return `<article class="pincon-ops-card"><div class="pincon-ops-card-top"><span class="pincon-ops-card-icon"><md-icon>forum</md-icon></span>${statusPill(status, tone)}</div><div>${statusPill(item.category || "기타")}<h3>${esc(item.title)}</h3></div><p>${esc(compact(item.body, 180))}</p>${item.officialReply ? `<div class="pincon-ops-answer"><strong>회장 공식 답변</strong><br>${nl(item.officialReply)}</div>` : ""}<div class="pincon-ops-card-actions">${this.state.isPresident ? `<md-text-button data-action="feedback-reply" data-id="${attr(item.id)}">답변·상태 변경</md-text-button>` : ""}</div></article>`;
  }

  eventCard(item) {
    const responded = this.repo.hasRespondedToEvent(item.id);
    const results = (item.resultsVisible || this.state.isPresident) && Array.isArray(item.publishedResults) ? item.publishedResults : [];
    const upcoming = item.status === "open" && Number(item.startsAtMs || 0) > Date.now();
    const open = isOpenWindow(item) && !upcoming;
    const statusLabel = item.status === "draft" ? "준비 중" : upcoming ? "예정" : open ? "참여 중" : "종료";
    return `<article class="pincon-ops-card"><div class="pincon-ops-card-top"><span class="pincon-ops-card-icon"><md-icon>celebration</md-icon></span>${statusPill(statusLabel, open ? "good" : "")}</div><div><p>${esc(EVENT_KINDS.find(([key]) => key === item.kind)?.[1] || "학급 행사")}</p><h3>${esc(item.title)}</h3></div><p>${esc(compact(item.question || item.description, 180) || relativeDateLabel(item.date || kstDate(item.startsAtMs)))}</p>${results.length ? `<div class="pincon-ops-answer">결과 ${results.slice(0, 3).map((row) => `${esc(row.label)} ${Number(row.count)}표`).join(" · ")}</div>` : ""}<div class="pincon-ops-card-actions">${open && !responded ? `<md-filled-tonal-button data-action="event-respond" data-id="${attr(item.id)}">익명 참여</md-filled-tonal-button>` : responded ? `<md-text-button disabled>응답 완료</md-text-button>` : ""}${results.length || this.state.isPresident ? `<md-text-button data-action="event-present" data-id="${attr(item.id)}">진행 화면</md-text-button>` : ""}${this.state.isPresident ? `<md-text-button data-action="event-aggregate" data-id="${attr(item.id)}">집계·공개</md-text-button><md-text-button data-action="event-edit" data-id="${attr(item.id)}">수정</md-text-button><md-text-button data-action="item-delete" data-collection="events" data-id="${attr(item.id)}">삭제</md-text-button>` : ""}</div></article>`;
  }

  pollCard(item) {
    const open = isOpenWindow(item);
    return `<article class="pincon-ops-card"><div class="pincon-ops-card-top"><span class="pincon-ops-card-icon"><md-icon>how_to_vote</md-icon></span>${statusPill(open ? "투표 중" : "마감", open ? "good" : "")}</div><h3>${esc(item.question || item.title)}</h3><p>${esc((item.options || []).join(" · "))}</p><div class="pincon-ops-card-actions">${open ? `<md-filled-tonal-button data-action="poll-vote" data-id="${attr(item.id)}">투표하기</md-filled-tonal-button>` : ""}<md-text-button data-action="poll-results" data-id="${attr(item.id)}">결과</md-text-button>${this.state.isPresident ? `<md-text-button data-action="poll-edit" data-id="${attr(item.id)}">관리</md-text-button><md-text-button data-action="item-delete" data-collection="polls" data-id="${attr(item.id)}">삭제</md-text-button>` : ""}</div></article>`;
  }

  patchCard(item) {
    const groups = [["Added", item.added], ["Improved", item.improved], ["Fixed", item.fixed], ["Reviewing", item.reviewing]].filter(([, rows]) => Array.isArray(rows) && rows.length);
    return `<article class="pincon-ops-card" data-pinned="${item.pinned === true}"><div class="pincon-ops-card-top"><span class="pincon-ops-card-icon"><md-icon>new_releases</md-icon></span>${statusPill(item.version || item.month || "업데이트", "good")}</div><h3>${esc(item.title || `${item.month} 학급 패치노트`)}</h3>${groups.map(([label, rows]) => `<div class="pincon-ops-patch-section"><h4>${label}</h4><ul>${rows.slice(0, 6).map((row) => `<li>${esc(typeof row === "string" ? row : row.label || row.title)}</li>`).join("")}</ul></div>`).join("")}${item.feedbackSummary ? `<div class="pincon-ops-answer">이번 달 의견 ${Number(item.feedbackSummary.total || 0)}건 · 처리 완료 ${Number(item.feedbackSummary.completed || 0)}건 · 검토 중 ${Number(item.feedbackSummary.reviewing || 0)}건 · 실행 어려움 ${Number(item.feedbackSummary.difficult || 0)}건</div>` : ""}${this.state.isPresident ? `<div class="pincon-ops-card-actions"><md-text-button data-action="item-delete" data-collection="patchNotes" data-id="${attr(item.id)}">보관 취소</md-text-button></div>` : ""}</article>`;
  }

  renderClass() {
    const feedback = activeRows(this.data("feedback")).sort(byNewest);
    const events = activeRows(this.data("events")).filter((item) => this.state.isPresident || item.status !== "draft").sort(byDate);
    const polls = activeRows(this.data("polls")).filter((item) => item.official === true).sort(byNewest);
    const patches = activeRows(this.data("patchNotes")).sort((a, b) => String(b.month || "").localeCompare(String(a.month || "")));
    const groups = activeRows(this.data("content")).filter((item) => item.kind === "group").sort(byNewest);
    const feedbackBody = feedback.length ? `<div class="pincon-ops-card-grid">${feedback.map((item) => this.feedbackCard(item)).join("")}</div>` : emptyState("forum", "아직 공개된 건의가 없습니다", "익명 의견을 남기면 접수부터 처리 결과까지 공개됩니다.", `<md-filled-tonal-button data-action="feedback-create">첫 의견 남기기</md-filled-tonal-button>`);
    const eventBody = events.length ? `<div class="pincon-ops-card-grid">${events.map((item) => this.eventCard(item)).join("")}</div>` : emptyState("celebration", "예정된 학급 행사가 없습니다", "첫 행사 템플릿은 ‘우리반 34명에게 물었습니다’입니다.", this.state.isPresident ? `<md-filled-tonal-button data-action="event-template">첫 행사 만들기</md-filled-tonal-button>` : "");
    const pollBody = polls.length ? `<div class="pincon-ops-card-grid">${polls.map((item) => this.pollCard(item)).join("")}</div>` : emptyState("how_to_vote", "진행 중인 공식 투표가 없습니다", "다음 행사 아이디어나 학급 선택을 공정하게 투표할 수 있습니다.");
    const patchBody = patches.length ? `<div class="pincon-ops-card-grid">${patches.map((item) => this.patchCard(item)).join("")}</div>` : emptyState("new_releases", "첫 패치노트를 준비 중입니다", "처리된 의견과 운영 변경을 모아 월별로 공개합니다.");
    const groupBody = groupSectionBody(groups);
    return `${this.pageHeading("학급", "우리 반이 바뀌는 과정", "모둠·의견·행사·투표와 처리 결과를 한 흐름으로 확인하세요.")}<div class="pincon-ops-status-line"><md-filled-button data-action="feedback-create"><md-icon slot="icon">add_comment</md-icon>익명 의견</md-filled-button>${this.state.isPresident ? `<md-outlined-button data-action="event-create">행사 만들기</md-outlined-button><md-outlined-button data-action="poll-create">투표 만들기</md-outlined-button>` : ""}</div>${sectionMarkup({ kicker: "기존 PinCon", title: "모둠과 역할", count: groups.length, body: groupBody, wide: true })}${sectionMarkup({ kicker: "학생 의견 → 처리", title: "학급 개선 건의", count: feedback.length, body: feedbackBody, wide: true })}${sectionMarkup({ kicker: "함께 참여", title: "학급 행사", count: events.length, body: eventBody, wide: true })}${sectionMarkup({ kicker: "선택", title: "행사 아이디어 투표", count: polls.length, body: pollBody, wide: true })}${sectionMarkup({ kicker: "월별 기록", title: "학급 패치노트", count: patches.length, body: patchBody, wide: true })}`;
  }

  supplyCard(item) {
    const reports = this.data("supplyReports").filter((report) => report.supplyId === item.id && Number(report.createdAtMs || 0) >= Number(item.updatedAtMs || 0)).length;
    const activeLoan = activeRows(this.data("supplyLoans")).find((loan) => loan.supplyId === item.id && loan.status === "loaned");
    const status = item.loanable ? (activeLoan ? "대여 중" : "사용 가능") : (SUPPLY_STATUSES[item.status] || item.status || "충분");
    return `<article class="pincon-ops-card"><div class="pincon-ops-card-top"><span class="pincon-ops-card-icon"><md-icon>${item.loanable ? "charger" : "inventory_2"}</md-icon></span>${statusPill(status, ["부족", "없음"].includes(status) ? "urgent" : "")}</div><h3>${esc(item.name)}</h3><p>${esc(`${item.quantity ?? 0}${item.unit || "개"} · ${item.location || "위치 미정"}${reports ? ` · 부족 신고 ${reports}건` : ""}`)}</p><div class="pincon-ops-card-actions">${item.loanable ? (!activeLoan ? `<md-filled-tonal-button data-action="supply-borrow" data-id="${attr(item.id)}">대여</md-filled-tonal-button>` : this.state.isPresident ? `<md-filled-tonal-button data-action="loan-return" data-id="${attr(activeLoan.id)}">반환 완료</md-filled-tonal-button>` : "") : `<md-text-button data-action="supply-report" data-id="${attr(item.id)}"${this.repo.hasReportedSupply(item.id) ? " disabled" : ""}>${this.repo.hasReportedSupply(item.id) ? "신고 완료" : "부족해요"}</md-text-button>`}${this.state.isPresident ? `<md-text-button data-action="supply-edit" data-id="${attr(item.id)}">수정</md-text-button><md-text-button data-action="item-delete" data-collection="supplies" data-id="${attr(item.id)}">삭제</md-text-button>` : ""}</div></article>`;
  }

  renderResources() {
    const resources = activeRows(this.data("resources")).filter((item) => this.state.isPresident || item.moderationStatus === "approved").sort((a, b) => Number(b.pinned) - Number(a.pinned) || byNewest(a, b));
    const supplies = activeRows(this.data("supplies")).sort((a, b) => String(a.name).localeCompare(String(b.name), "ko"));
    const lost = activeRows(this.data("lostItems")).filter((item) => item.status !== "claimed").sort(byNewest);
    const subjects = [...new Set(resources.map((item) => plainText(item.subject || "공통", 40)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
    const typeLabel = (value) => WORKSHEET_TYPES.find(([key]) => key === value)?.[1] || "기타 자료";
    const rightsLabel = (value) => RIGHTS_BASES.find(([key]) => key === value)?.[1] || "권리 확인 전";
    const filters = resources.length ? `<div class="pincon-resource-filters" aria-label="학습지 검색과 필터"><md-outlined-text-field data-resource-search label="제목·과목·단원 검색"><md-icon slot="leading-icon">search</md-icon></md-outlined-text-field><md-outlined-select data-resource-subject label="과목"><md-select-option value="" selected><span slot="headline">전체 과목</span></md-select-option>${subjects.map((subject) => `<md-select-option value="${attr(subject)}"><span slot="headline">${esc(subject)}</span></md-select-option>`).join("")}</md-outlined-select><md-outlined-select data-resource-type label="자료 유형"><md-select-option value="" selected><span slot="headline">전체 유형</span></md-select-option>${WORKSHEET_TYPES.map(([value, label]) => `<md-select-option value="${attr(value)}"><span slot="headline">${esc(label)}</span></md-select-option>`).join("")}</md-outlined-select></div>` : "";
    const resourceBody = resources.length ? `${filters}<div class="pincon-ops-card-grid" data-resource-grid>${resources.map((item) => {
      const url = safeExternalUrl(item.url);
      const subject = plainText(item.subject || "공통", 40);
      const materialType = plainText(item.materialType || "other", 30);
      const searchable = [item.title, subject, item.unit, item.description, item.category, item.version, item.sourceAttribution, typeLabel(materialType)].filter(Boolean).join(" ").toLocaleLowerCase("ko");
      const academic = [item.schoolYear ? `${Number(item.schoolYear)}년` : "", item.semester ? `${Number(item.semester)}학기` : "", item.version, item.pageCount ? `${Number(item.pageCount)}쪽` : ""].filter(Boolean);
      const rightsTone = item.rightsConfirmed && item.personalDataRemoved ? "good" : "urgent";
      const openButton = item.storagePath
        ? `<md-filled-tonal-button data-action="resource-open" data-id="${attr(item.id)}">파일 열기</md-filled-tonal-button>`
        : url ? `<md-filled-tonal-button href="${attr(url)}" target="_blank" rel="noopener noreferrer">링크 열기</md-filled-tonal-button>` : statusPill("링크 확인 필요", "urgent");
      return `<article class="pincon-ops-card pincon-resource-card" data-resource-card data-resource-search="${attr(searchable)}" data-resource-subject="${attr(subject)}" data-resource-type="${attr(materialType)}" data-pinned="${item.pinned === true}"><div class="pincon-ops-card-top"><span class="pincon-ops-card-icon"><md-icon>${item.fileName ? "draft" : "link"}</md-icon></span><div class="pincon-ops-status-line">${statusPill(typeLabel(materialType))}${item.moderationStatus !== "approved" ? statusPill("승인 대기", "urgent") : ""}</div></div><div><p>${esc([subject, item.unit].filter(Boolean).join(" · "))}</p><h3>${esc(item.title)}</h3></div>${academic.length ? `<div class="pincon-resource-meta">${academic.map((value) => `<span>${esc(value)}</span>`).join("")}</div>` : ""}<p>${esc(compact(item.description, 150) || item.fileName || "링크 자료")}</p>${item.sourceAttribution ? `<p class="pincon-resource-source"><strong>출처</strong> ${esc(compact(item.sourceAttribution, 180))}</p>` : ""}<div class="pincon-resource-rights">${statusPill(rightsLabel(item.rightsBasis), rightsTone)}<small>${item.rightsConfirmed && item.personalDataRemoved ? "권리·개인정보 확인됨" : "공개 전 권리 확인 필요"}</small></div><div class="pincon-ops-card-actions">${openButton}${this.state.isPresident ? `<md-text-button data-action="resource-pin" data-id="${attr(item.id)}">${item.pinned ? "고정 해제" : "상단 고정"}</md-text-button>${item.moderationStatus !== "approved" ? `<md-text-button data-action="resource-approve" data-id="${attr(item.id)}">승인</md-text-button>` : ""}<md-text-button data-action="item-delete" data-collection="resources" data-id="${attr(item.id)}">삭제</md-text-button>` : ""}</div></article>`;
    }).join("")}</div><div data-resource-filter-empty hidden>${emptyState("search_off", "조건에 맞는 학습지가 없습니다", "검색어를 줄이거나 과목·유형 필터를 바꿔 보세요.")}</div>` : emptyState("folder_open", "학습지 DB가 비어 있습니다", "직접 제작했거나 공유 권한이 확인된 학습지를 등록할 수 있습니다.");
    const supplyBody = supplies.length ? `<div class="pincon-ops-card-grid">${supplies.map((item) => this.supplyCard(item)).join("")}</div>` : emptyState("inventory_2", "공용 물품 목록이 없습니다", "회장이 볼펜·샤프심·가위·테이프 등의 수량과 위치를 등록할 수 있습니다.");
    const lostBody = lost.length ? `<div class="pincon-ops-card-grid">${lost.map((item) => { const photoUrl = safeExternalUrl(item.photoUrl); return `<article class="pincon-ops-card">${photoUrl ? `<img src="${attr(photoUrl)}" alt="${attr(item.name)}" loading="lazy" style="width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:16px">` : `<span class="pincon-ops-card-icon"><md-icon>find_in_page</md-icon></span>`}<h3>${esc(item.name)}</h3><p>${esc(`${item.foundLocation || "발견 위치 미정"} · ${formatKoreanDate(item.foundDate, { weekday: false })}`)}</p>${this.state.isPresident ? `<div class="pincon-ops-card-actions"><md-text-button data-action="lost-claimed" data-id="${attr(item.id)}">주인 찾음</md-text-button><md-text-button data-action="item-delete" data-collection="lostItems" data-id="${attr(item.id)}">삭제</md-text-button></div>` : ""}</article>`; }).join("")}</div>` : emptyState("search", "보관 중인 분실물이 없습니다", "발견한 물건을 사진과 함께 등록할 수 있습니다.");
    return `${this.pageHeading("자료", "학습지 DB와 학급 도구", "과목·단원·유형으로 학습지를 찾고, 공유 권한이 확인된 자료만 등록하세요.")}<div class="pincon-ops-action-grid"><md-filled-tonal-button data-action="resource-create"><md-icon slot="icon">upload_file</md-icon>학습지 등록</md-filled-tonal-button><md-outlined-button data-action="lost-create"><md-icon slot="icon">add_a_photo</md-icon>분실물 등록</md-outlined-button>${this.state.isPresident ? `<md-outlined-button data-action="supply-create"><md-icon slot="icon">inventory</md-icon>공용품 추가</md-outlined-button><md-outlined-button data-action="resource-categories"><md-icon slot="icon">category</md-icon>자료 분류 관리</md-outlined-button>` : ""}</div><div class="pincon-ops-legal-note"><md-icon>verified_user</md-icon><span>교재·문제집 스캔본과 학생 개인정보가 든 파일은 올리지 마세요. 선생님 허락, 직접 제작, 공개 라이선스 또는 기관 공개 자료만 등록할 수 있습니다.</span></div>${sectionMarkup({ kicker: "검색 가능한 학습 자료", title: "학습지 DB", count: resources.length, body: resourceBody, wide: true })}${sectionMarkup({ kicker: "공유 도구", title: "공용 물품함", count: supplies.length, body: supplyBody, wide: true })}${sectionMarkup({ kicker: "찾아가세요", title: "분실물", count: lost.length, body: lostBody, wide: true })}`;
  }

  renderMore() {
    const prefs = this.state.notificationPreferences || NOTIFICATION_DEFAULTS;
    const labels = {
      assessmentTomorrow: ["수행평가 하루 전", "내일 할 평가를 한 번에 안내"],
      assessmentToday: ["수행평가 당일", "오늘 평가를 등교 전 확인"],
      importantPreparation: ["중요한 준비물", "실험복 등 꼭 챙길 준비물"],
      timetableChange: ["시간표 변경", "컴시간·NEIS 변경 감지"],
      eventStart: ["행사 시작", "학급 행사 시작 전 안내"],
      pollClosing: ["투표 마감", "참여하지 못한 투표 마감 안내"],
      urgentAnnouncement: ["회장 긴급 공지", "긴급으로 발행된 학급 공지"],
    };
    const notificationBody = `<div class="pincon-ops-surface" style="padding:12px 18px">${Object.entries(labels).map(([key, [title, body]]) => `<div class="pincon-ops-notification-row"><div><strong>${esc(title)}</strong><span>${esc(body)}</span></div><md-switch data-pref="${key}"${prefs[key] ? " selected" : ""}></md-switch></div>`).join("")}<div style="padding:14px 0 4px"><md-filled-button data-action="notifications-enable"><md-icon slot="icon">notifications_active</md-icon>이 기기에서 알림 켜기</md-filled-button></div></div>`;
    const accountLabel = this.state.user?.displayName || (this.state.isPresident ? "학급 회장 계정" : this.state.user ? "학생 참여 계정" : "읽기 전용");
    const installed = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    const classLabel = this.state.profile ? `${this.state.profile.grade}학년 ${this.state.profile.classNumber}반` : "학급 미선택";
    const accountBody = `<div class="pincon-ops-surface"><md-list><md-list-item type="button" data-action="class-change"><md-icon slot="start">school</md-icon><span slot="headline">${esc(classLabel)}</span><span slot="supporting-text">표시할 학년과 반 변경</span><md-icon slot="end">chevron_right</md-icon></md-list-item><md-divider inset></md-divider><md-list-item><md-icon slot="start">${this.state.isPresident ? "verified_user" : "account_circle"}</md-icon><span slot="headline">${esc(accountLabel)}</span><span slot="supporting-text">${esc(this.state.isPresident ? "학급 회장 전용 관리 권한이 확인되었습니다." : this.state.user ? "학생 참여 계정" : "의견·투표 참여 시 이름 설정 또는 Google 로그인이 필요합니다.")}</span>${!this.state.isPresident ? `<md-text-button slot="end" data-action="president-login">회장 로그인</md-text-button>` : ""}</md-list-item><md-divider inset></md-divider><md-list-item type="button" data-action="install-app"><md-icon slot="start">${installed ? "download_done" : "install_mobile"}</md-icon><span slot="headline">${installed ? "PinCon이 설치되어 있습니다" : "홈 화면에 PinCon 설치"}</span><span slot="supporting-text">${installed ? "독립 실행과 오프라인 앱 셸을 사용 중입니다." : "휴대폰·태블릿·크롬북에서 앱처럼 실행합니다."}</span>${installed ? "" : `<md-icon slot="end">chevron_right</md-icon>`}</md-list-item><md-divider inset></md-divider><md-list-item><md-icon slot="start">sync</md-icon><span slot="headline">${this.state.online ? "온라인 동기화 중" : "오프라인 캐시 사용 중"}</span><span slot="supporting-text">새로고침 후에도 공개 학급 정보가 유지됩니다.</span></md-list-item><md-divider inset></md-divider><md-list-item><md-icon slot="start">privacy_tip</md-icon><span slot="headline">익명성과 개인정보 보호</span><span slot="supporting-text">익명 건의·행사 답변에는 이메일이나 UID를 저장하지 않습니다.</span></md-list-item><md-divider inset></md-divider><md-list-item type="button" data-action="legal-info"><md-icon slot="start">gavel</md-icon><span slot="headline">공유·저작권 안내</span><span slot="supporting-text">카카오톡 공유와 학습지 등록 전에 확인할 원칙</span><md-icon slot="end">chevron_right</md-icon></md-list-item></md-list></div>`;
    return `${this.pageHeading("더보기", "알림과 개인정보 설정", "필요한 알림만 선택하고 계정·동기화 상태를 확인하세요.")}<div class="pincon-ops-action-grid"><md-filled-tonal-button data-action="search"><md-icon slot="icon">search</md-icon>통합 검색</md-filled-tonal-button><md-outlined-button data-action="feedback-create"><md-icon slot="icon">forum</md-icon>익명 의견</md-outlined-button>${this.state.isPresident ? `<md-outlined-button data-action="tab" data-tab="manage"><md-icon slot="icon">admin_panel_settings</md-icon>관리 대시보드</md-outlined-button>` : ""}</div><div class="pincon-ops-grid">${sectionMarkup({ kicker: "기기별 설정", title: "알림 종류", body: notificationBody })}${sectionMarkup({ kicker: `PinCon Class Ops ${CLASS_OPS_VERSION}`, title: "계정·데이터", body: accountBody })}</div>`;
  }

  renderManage() {
    if (!this.state.isPresident) return `${this.pageHeading("관리", "회장 계정이 필요합니다", "Google 로그인 후 서버에서 학급 운영 권한을 확인합니다.")}${emptyState("admin_panel_settings", "관리 권한이 없습니다", "버튼을 숨기는 데서 끝나지 않고 Firestore 권한 규칙에서도 모든 관리 작업을 차단합니다.", `<md-filled-button data-action="president-login">회장 계정 로그인</md-filled-button>`)}`;
    const feedback = activeRows(this.data("feedback"));
    const unread = feedback.filter((item) => item.status === "received");
    const reviewing = feedback.filter((item) => ["reviewing", "planned"].includes(item.status));
    const events = activeRows(this.data("events")).filter((item) => item.status === "draft" || isOpenWindow(item));
    const supplies = activeRows(this.data("supplies"));
    const reportCounts = new Map(supplies.map((supply) => [supply.id, this.data("supplyReports").filter((report) => report.supplyId === supply.id && Number(report.createdAtMs || 0) >= Number(supply.updatedAtMs || 0)).length]));
    const lowSupplies = supplies.filter((item) => ["low", "empty"].includes(item.status) || (reportCounts.get(item.id) || 0) >= 2);
    const drafts = activeRows(this.data("patchNoteDrafts"));
    const today = kstDate();
    const todaySchedule = buildTodayFeed(this.state.data || {}).filter((item) => itemDate(item) === today && ["assessment", "exam", "preparation", "academic", "event", "timetable"].includes(item.type || item.feedKind));
    const weekEnd = dateToMs(kstDate(Date.now(), 7), true);
    const weekAssessments = activeRows(this.data("classAssignments")).filter((item) => ["assessment", "exam"].includes(item.type) && dateToMs(itemDate(item)) >= dateToMs(today) && dateToMs(itemDate(item)) <= weekEnd);
    const officialItems = [
      ...activeRows(this.data("announcements")).map((item) => ({ ...item, __collection: "announcements", __typeLabel: "공지" })),
      ...activeRows(this.data("classAssignments")).map((item) => ({ ...item, __collection: "classAssignments", __typeLabel: item.type === "preparation" ? "준비물" : "수행평가" })),
    ].sort(byNewest).slice(0, 20);
    const logs = [...this.data("changeLogs")].sort(byNewest).slice(0, 20);
    const trash = Object.entries(this.state.data || {}).flatMap(([collection, rows]) => ADMIN_COLLECTIONS_FOR_UI.has(collection) ? (rows || []).filter((item) => item.deleted).map((item) => ({ ...item, __collection: collection })) : []).sort(byNewest);
    const todaySummary = `<div class="pincon-ops-status-line">${statusPill(formatKoreanDate(today, { long: true }), "good")}${statusPill(`오늘 일정 ${todaySchedule.length}개`)}${todaySchedule.slice(0, 3).map((item) => statusPill(item.title || item.name || "학급 일정")).join("")}</div>`;
    const metrics = `<div class="pincon-ops-metric-grid"><div class="pincon-ops-metric"><md-icon>today</md-icon><strong>${todaySchedule.length}</strong><span>오늘 일정</span></div><div class="pincon-ops-metric"><md-icon>assignment</md-icon><strong>${weekAssessments.length}</strong><span>이번 주 수행평가</span></div><div class="pincon-ops-metric"><md-icon>mark_email_unread</md-icon><strong>${unread.length}</strong><span>미답변 건의</span></div><div class="pincon-ops-metric"><md-icon>pending_actions</md-icon><strong>${reviewing.length}</strong><span>처리 중 건의</span></div><div class="pincon-ops-metric"><md-icon>celebration</md-icon><strong>${events.length}</strong><span>예정된 행사</span></div><div class="pincon-ops-metric"><md-icon>inventory</md-icon><strong>${lowSupplies.length}</strong><span>부족한 공용품</span></div><div class="pincon-ops-metric"><md-icon>edit_note</md-icon><strong>${drafts.length}</strong><span>작성 중 패치노트</span></div></div>`;
    const actions = `<div class="pincon-ops-action-grid"><md-filled-tonal-button data-action="announcement-create">공지 작성</md-filled-tonal-button><md-filled-tonal-button data-action="assignment-create">수행평가 추가</md-filled-tonal-button><md-filled-tonal-button data-action="preparation-create">준비물 추가</md-filled-tonal-button><md-filled-tonal-button data-action="event-create">행사 만들기</md-filled-tonal-button><md-outlined-button data-action="monthly-survey-create">월간 의견 조사</md-outlined-button><md-outlined-button data-action="poll-create">설문·투표</md-outlined-button><md-outlined-button data-action="feedback-first">건의 답변</md-outlined-button><md-outlined-button data-action="patch-draft-create">패치노트 초안</md-outlined-button><md-outlined-button data-action="supply-create">공용품 추가</md-outlined-button><md-outlined-button data-action="resource-categories">자료 분류 관리</md-outlined-button></div>`;
    const officialBody = officialItems.length ? `<div class="pincon-ops-surface"><md-list>${officialItems.map((item, index) => `<md-list-item><md-icon slot="start">${item.__collection === "announcements" ? "campaign" : ICONS[item.type] || "assignment"}</md-icon><span slot="headline">${esc(item.title)}</span><span slot="supporting-text">${esc(`${item.__typeLabel}${itemDate(item) ? ` · ${relativeDateLabel(itemDate(item))}` : ""}`)}</span><span slot="end"><md-text-button data-action="${item.__collection === "announcements" ? "announcement-edit" : "assignment-edit"}" data-id="${attr(item.id)}">수정</md-text-button><md-text-button data-action="item-delete" data-collection="${attr(item.__collection)}" data-id="${attr(item.id)}">삭제</md-text-button></span></md-list-item>${listDivider(index, officialItems.length)}`).join("")}</md-list></div>` : emptyState("edit_calendar", "공식 공지와 일정이 없습니다", "빠른 작업으로 공지·수행평가·준비물을 등록하세요.");
    const queueBody = unread.length || reviewing.length ? `<div class="pincon-ops-surface"><md-list>${[...unread, ...reviewing].slice(0, 15).map((item, index, rows) => `<md-list-item><md-icon slot="start">forum</md-icon><span slot="headline">${esc(item.title)}</span><span slot="supporting-text">${esc(`${item.category} · ${FEEDBACK_STATUSES[item.status] || "접수"}`)}</span><md-text-button slot="end" data-action="feedback-reply" data-id="${attr(item.id)}">답변</md-text-button></md-list-item>${listDivider(index, rows.length)}`).join("")}</md-list></div>` : emptyState("task_alt", "답변을 기다리는 건의가 없습니다", "새 의견이 접수되면 이곳에 표시됩니다.");
    const draftBody = drafts.length ? `<div class="pincon-ops-card-grid">${drafts.map((item) => `<article class="pincon-ops-card"><span class="pincon-ops-card-icon"><md-icon>edit_note</md-icon></span><h3>${esc(item.month)} 패치노트 초안</h3><p>${esc(`Added ${(item.added || []).length} · Improved ${(item.improved || []).length} · Fixed ${(item.fixed || []).length}`)}</p><div class="pincon-ops-card-actions"><md-text-button data-action="patch-edit" data-id="${attr(item.id)}">수정</md-text-button><md-filled-tonal-button data-action="patch-publish" data-id="${attr(item.id)}">발행</md-filled-tonal-button></div></article>`).join("")}</div>` : emptyState("edit_note", "작성 중인 패치노트가 없습니다", "이번 달 변경 기록으로 초안을 자동 생성할 수 있습니다.", `<md-filled-tonal-button data-action="patch-draft-create">자동 초안 만들기</md-filled-tonal-button>`);
    const logBody = logs.length ? `<div class="pincon-ops-surface"><md-list>${logs.map((log, index) => { const targetExists = this.data(log.collection).some((item) => item.id === log.documentId); const canRestore = targetExists && (log.before || log.action === "create"); return `<md-list-item><md-icon slot="start">history</md-icon><span slot="headline">${esc(log.label || "학급 운영 변경")}</span><span slot="supporting-text">${esc(`${log.collection || "학급 정보"} · ${log.action} · ${new Date(log.createdAtMs || Date.now()).toLocaleString("ko-KR")}`)}</span><span slot="end"><md-text-button data-action="history-view" data-id="${attr(log.id)}">이전·변경 내용</md-text-button>${canRestore ? `<md-text-button data-action="history-restore" data-id="${attr(log.id)}">되돌리기</md-text-button>` : ""}</span></md-list-item>${listDivider(index, logs.length)}`; }).join("")}</md-list></div>` : emptyState("history", "변경 기록이 없습니다", "회장 계정의 생성·수정·삭제·복구가 모두 기록됩니다.");
    const trashBody = trash.length ? `<div class="pincon-ops-surface"><md-list>${trash.slice(0, 20).map((item, index) => `<md-list-item><md-icon slot="start">delete</md-icon><span slot="headline">${esc(item.title || item.name || "삭제된 항목")}</span><span slot="supporting-text">${esc(`${item.__collection} · 30일 보관`)}</span><md-text-button slot="end" data-action="trash-restore" data-collection="${attr(item.__collection)}" data-id="${attr(item.id)}">복원</md-text-button></md-list-item>${listDivider(index, trash.length)}`).join("")}</md-list></div>` : emptyState("delete_sweep", "휴지통이 비어 있습니다", "삭제된 중요 항목은 영구 삭제하지 않고 복구 가능하게 보관합니다.");
    return `${this.pageHeading("회장 관리", "오늘의 학급 운영", "처리해야 할 일을 먼저 보여주고 빠른 작업으로 바로 연결합니다.")}${todaySummary}${metrics}${actions}<div class="pincon-ops-grid">${sectionMarkup({ kicker: "공식 정보", title: "공지·수행평가·준비물", count: officialItems.length, body: officialBody, wide: true })}${sectionMarkup({ kicker: "우선 처리", title: "건의 답변", count: unread.length + reviewing.length, body: queueBody })}${sectionMarkup({ kicker: "월간 기록", title: "작성 중인 패치노트", count: drafts.length, body: draftBody })}${sectionMarkup({ kicker: "감사 로그", title: "변경 기록", count: logs.length, body: logBody, wide: true })}${sectionMarkup({ kicker: "30일 보관", title: "휴지통", count: trash.length, body: trashBody, wide: true })}</div>`;
  }

  actionTarget(event) {
    return event.composedPath?.().find((node) => node?.dataset?.action) || event.target?.closest?.("[data-action]");
  }

  async onClick(event) {
    const target = this.actionTarget(event);
    if (!target) return;
    const action = target.dataset.action;
    const id = target.dataset.id || "";
    try {
      if (action === "close") return this.close();
      if (action === "tab") {
        return this.switchTab(target.dataset.tab || "today");
      }
      if (action === "search") return this.openSearch();
      if (action === "class-change") return this.openClassChange();
      if (action === "install-app") return this.installApp();
      if (action === "notice-share") return this.openNoticeShare();
      if (action === "legal-info") return this.showLegalInfo();
      if (action === "feedback-create") return this.openEditor("feedback");
      if (action === "announcement-create") return this.openEditor("announcement");
      if (action === "announcement-edit") return this.openEditor("announcement", id);
      if (action === "assignment-create") return this.openEditor("assignment");
      if (action === "preparation-create") return this.openEditor("preparation");
      if (action === "assignment-edit") return this.openEditor("assignment", id);
      if (action === "event-create") return this.openEditor("event");
      if (action === "event-template") return this.openEditor("event", "", { kind: "survey34", title: "우리반 34명에게 물었습니다", question: "우리 반 친구들에게 묻고 싶은 질문을 입력하세요." });
      if (action === "monthly-survey-create") return this.openEditor("event", "", { kind: "survey", title: `${monthKey()} 월간 학급 개선 조사`, question: "이번 달 우리 반에서 가장 개선되었으면 하는 것은 무엇인가요?", date: kstDate(), endDate: kstDate(Date.now(), 7), status: "open" });
      if (action === "event-edit") return this.openEditor("event", id);
      if (action === "event-respond") return this.respondEvent(id);
      if (action === "event-aggregate") return this.aggregateEvent(id);
      if (action === "event-present") return this.presentEvent(id);
      if (action === "poll-create") return this.openEditor("poll");
      if (action === "poll-edit") return this.openEditor("poll", id);
      if (action === "poll-vote") return this.votePoll(id);
      if (action === "poll-results") return this.showPollResults(id);
      if (action === "feedback-reply") return this.openEditor("feedbackReply", id);
      if (action === "feedback-first") {
        const first = activeRows(this.data("feedback")).find((item) => ["received", "reviewing"].includes(item.status));
        return first ? this.openEditor("feedbackReply", first.id) : this.toast("답변을 기다리는 건의가 없습니다.");
      }
      if (action === "supply-create") return this.openEditor("supply");
      if (action === "supply-edit") return this.openEditor("supply", id);
      if (action === "supply-report") { await this.repo.reportSupply(id); return this.toast("부족 신고를 회장 대시보드에 보냈습니다."); }
      if (action === "supply-borrow") { await this.repo.borrowSupply(id); return this.toast("대여 시작 시간이 기록되었습니다."); }
      if (action === "loan-return") { const item = this.data("supplyLoans").find((row) => row.id === id); await this.repo.adminWrite("supplyLoans", { ...item, status: "returned", returnedAtMs: Date.now() }, { id, label: "공용 물품 반환" }); return this.toast("반환 완료로 기록했습니다."); }
      if (action === "resource-create") return this.openEditor("resource");
      if (action === "resource-open") {
        const item = this.findItem("resources", id);
        if (!item?.storagePath) throw new Error("파일 위치를 찾지 못했습니다.");
        await this.repo.openResourceFile(item.storagePath, item.fileName || item.title);
        return;
      }
      if (action === "resource-categories") return this.openEditor("resourceCategories");
      if (action === "resource-pin") { const item = this.data("resources").find((row) => row.id === id); await this.repo.adminWrite("resources", { ...item, pinned: !item.pinned }, { id, label: `${item.title} 고정 변경` }); return; }
      if (action === "resource-approve") { const item = this.data("resources").find((row) => row.id === id); await this.repo.adminWrite("resources", { ...item, moderationStatus: "approved" }, { id, label: `${item.title} 자료 승인` }); return this.toast("자료를 공개했습니다."); }
      if (action === "lost-create") return this.openEditor("lostItem");
      if (action === "lost-claimed") { const item = this.data("lostItems").find((row) => row.id === id); await this.repo.adminWrite("lostItems", { ...item, status: "claimed" }, { id, label: `${item.name} 주인 찾음` }); return this.toast("분실물 상태를 변경했습니다."); }
      if (action === "patch-draft-create") return this.createPatchDraft();
      if (action === "patch-edit") return this.openEditor("patchDraft", id);
      if (action === "patch-publish") return this.publishPatch(id);
      if (action === "history-view") return this.showHistory(id);
      if (action === "history-restore") { await this.confirm("이 변경을 되돌릴까요?", "선택한 시점의 이전 내용으로 복구하고 새 복구 기록을 남깁니다.", async () => this.repo.restoreFromLog(id)); return; }
      if (action === "item-delete") {
        const collection = target.dataset.collection;
        const item = this.findItem(collection, id);
        if (!item) throw new Error("삭제할 항목을 찾지 못했습니다.");
        await this.confirm("이 항목을 휴지통으로 보낼까요?", "즉시 영구 삭제하지 않으며, 관리 화면의 휴지통과 변경 기록에서 복원할 수 있습니다.", async () => this.repo.softDelete(collection, id, `${item.title || item.name || "항목"} 삭제`));
        return;
      }
      if (action === "trash-restore") { const item = this.data(target.dataset.collection).find((row) => row.id === id); await this.repo.adminWrite(target.dataset.collection, { ...item, deleted: false, deletedAtMs: null }, { id, action: "restore", label: `${item.title || item.name || "항목"} 휴지통 복원` }); return this.toast("항목을 복원했습니다."); }
      if (action === "notifications-enable") { await this.repo.enableNotifications(); return this.toast("선택한 알림을 이 기기에서 받습니다."); }
      if (action === "president-login") return globalThis.PINCON_GOOGLE_AUTH_BRIDGE?.login?.();
    } catch (error) {
      this.toast(error?.message || "작업을 완료하지 못했습니다.", true);
    }
  }

  onChange(event) {
    const path = event.composedPath?.() || [];
    if (path.some((node) => node?.dataset?.resourceSubject !== undefined || node?.dataset?.resourceType !== undefined)) {
      this.applyResourceFilters();
      return;
    }
    const target = path.find((node) => node?.dataset?.pref);
    if (target) {
      const next = { ...(this.state.notificationPreferences || NOTIFICATION_DEFAULTS), [target.dataset.pref]: Boolean(target.selected ?? target.checked) };
      this.repo.updateNotificationPreferences(next).catch((error) => this.toast(error?.message || "알림 설정을 저장하지 못했습니다.", true));
    }
  }

  onInput(event) {
    const target = event.composedPath?.().find((node) => node?.dataset?.resourceSearch !== undefined);
    if (target) this.applyResourceFilters();
  }

  applyResourceFilters() {
    const search = plainText(this.shell.querySelector("[data-resource-search]")?.value || "", 120).toLocaleLowerCase("ko");
    const subject = plainText(this.shell.querySelector("[data-resource-subject]")?.value || "", 40);
    const type = plainText(this.shell.querySelector("[data-resource-type]")?.value || "", 30);
    const cards = [...this.shell.querySelectorAll("[data-resource-card]")];
    let visible = 0;
    for (const card of cards) {
      const matches = (!search || card.dataset.resourceSearch.includes(search))
        && (!subject || card.dataset.resourceSubject === subject)
        && (!type || card.dataset.resourceType === type);
      card.hidden = !matches;
      if (matches) visible += 1;
    }
    const empty = this.shell.querySelector("[data-resource-filter-empty]");
    if (empty) empty.hidden = visible > 0;
  }

  toast(message, error = false) {
    clearTimeout(this.toastTimer);
    document.querySelector(".pincon-ops-toast")?.remove();
    const toast = document.createElement("div");
    toast.className = "pincon-ops-toast";
    toast.setAttribute("role", error ? "alert" : "status");
    toast.textContent = message;
    document.body.appendChild(toast);
    this.toastTimer = setTimeout(() => toast.remove(), error ? 5000 : 3000);
  }

  readForm(dialog) {
    const values = {};
    for (const element of dialog.querySelectorAll("[data-field]")) {
      const key = element.dataset.field;
      if (element.tagName === "MD-CHECKBOX") values[key] = Boolean(element.checked);
      else values[key] = typeof element.value === "string" ? element.value.trim() : element.value;
    }
    return values;
  }

  async copyText(value) {
    const text = String(value || "");
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const fallback = document.createElement("textarea");
    fallback.value = text;
    fallback.setAttribute("readonly", "");
    fallback.style.position = "fixed";
    fallback.style.opacity = "0";
    document.body.appendChild(fallback);
    fallback.select();
    const copied = document.execCommand("copy");
    fallback.remove();
    if (!copied) throw new Error("복사하지 못했습니다. 내용을 길게 눌러 직접 복사해 주세요.");
  }

  async openNoticeShare() {
    if (!this.state.isPresident) throw new Error("학급 회장 계정에서만 공지를 만들 수 있습니다.");
    const profile = this.state.profile;
    const classLabel = profile ? `${profile.grade}학년 ${profile.classNumber}반` : "우리 반";
    const detailUrl = new URL(location.href);
    detailUrl.searchParams.set("class-ops", "1");
    detailUrl.searchParams.set("class-tab", "today");
    const makeNotice = (date) => buildClassNotice(this.state.data || {}, { date, classLabel, detailUrl: detailUrl.href });
    const dialog = document.createElement("md-dialog");
    dialog.className = "pincon-ops-dialog";
    dialog.innerHTML = `<div slot="headline">카카오톡 학급 공지 만들기</div><div slot="content" class="pincon-ops-dialog-form pincon-notice-dialog"><div class="pincon-ops-legal-note"><md-icon>touch_app</md-icon><span>PinCon은 대화방에 몰래 자동 전송하지 않습니다. 내용을 확인한 뒤 공유창에서 카카오톡과 보낼 대상을 직접 선택하세요.</span></div>${field("noticeDate", "공지 날짜", kstDate(Date.now(), 1), { type: "date", required: true })}<md-outlined-text-field data-notice-text label="보낼 공지" type="textarea" rows="14" supporting-text="보내기 전에 날짜·시간표·과제와 개인정보 포함 여부를 확인하세요"></md-outlined-text-field></div><div slot="actions"><md-text-button data-close>취소</md-text-button><md-outlined-button data-copy><md-icon slot="icon">content_copy</md-icon>복사</md-outlined-button><md-filled-button data-share><md-icon slot="icon">share</md-icon>카카오톡으로 공유</md-filled-button></div>`;
    document.body.appendChild(dialog);
    const dateField = dialog.querySelector("[data-field=noticeDate]");
    const textField = dialog.querySelector("[data-notice-text]");
    const refresh = () => { textField.value = makeNotice(dateField.value || kstDate(Date.now(), 1)); };
    refresh();
    dateField.addEventListener("change", refresh);
    dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
    dialog.querySelector("[data-copy]").addEventListener("click", async () => {
      try {
        await this.copyText(textField.value);
        this.toast("공지 내용을 복사했습니다.");
      } catch (error) {
        this.toast(error?.message || "복사하지 못했습니다.", true);
      }
    });
    dialog.querySelector("[data-share]").addEventListener("click", async () => {
      const text = plainText(textField.value, 6000);
      if (!text) return this.toast("공지를 입력해 주세요.", true);
      try {
        if (navigator.share) {
          await navigator.share({ title: `${classLabel} 학급 공지`, text });
          this.toast("공유창으로 공지를 전달했습니다.");
        } else {
          await this.copyText(text);
          this.toast("이 기기는 공유창을 지원하지 않아 공지를 복사했습니다.");
        }
      } catch (error) {
        if (error?.name !== "AbortError") this.toast(error?.message || "공유하지 못했습니다.", true);
      }
    });
    dialog.addEventListener("closed", () => dialog.remove(), { once: true });
    await dialog.show();
  }

  async showLegalInfo() {
    const dialog = document.createElement("md-dialog");
    dialog.className = "pincon-ops-dialog";
    dialog.innerHTML = `<div slot="headline">공유·저작권 안내</div><div slot="content" class="pincon-ops-dialog-form pincon-legal-dialog"><section><md-icon>chat</md-icon><div><strong>카카오톡 공지</strong><p>공지는 사용자가 내용을 확인하고 수신 대상을 직접 선택해 보냅니다. 전화번호나 카카오 친구 목록을 수집하지 않으며, 학교 공식 알림으로 오해되지 않게 발신자를 밝혀 주세요.</p></div></section><section><md-icon>copyright</md-icon><div><strong>학습지 저작권</strong><p>직접 제작했거나 선생님에게 공유 허락을 받은 자료, 공개 라이선스 자료, 학교·공공기관이 공개한 자료만 등록하세요. 시중 교재·문제집을 통째로 스캔한 파일은 올리면 안 됩니다.</p></div></section><section><md-icon>privacy_tip</md-icon><div><strong>개인정보</strong><p>학생 이름, 얼굴, 연락처, 성적, 계정 정보가 들어간 파일은 올리지 마세요. 필요한 경우 모두 지운 뒤 등록하세요.</p></div></section><p class="pincon-ops-legal-footnote">PinCon의 이 안내는 일반적인 안전장치이며 개별 상황에 대한 법률 자문은 아닙니다. 학교 규정과 담당 선생님의 지시가 있으면 그 기준을 우선하세요.</p></div><div slot="actions"><md-filled-button data-close>확인</md-filled-button></div>`;
    document.body.appendChild(dialog);
    dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("closed", () => dialog.remove(), { once: true });
    await dialog.show();
  }

  async formDialog({ headline, content, submitLabel = "저장", onSubmit }) {
    const dialog = document.createElement("md-dialog");
    dialog.className = "pincon-ops-dialog";
    dialog.innerHTML = `<div slot="headline">${esc(headline)}</div><div slot="content" class="pincon-ops-dialog-form">${content}<p class="pincon-ops-form-error" data-form-error hidden></p></div><div slot="actions"><md-text-button data-cancel>취소</md-text-button><md-filled-button data-submit>${esc(submitLabel)}</md-filled-button></div>`;
    document.body.appendChild(dialog);
    const cleanup = () => setTimeout(() => dialog.remove(), 0);
    dialog.addEventListener("closed", cleanup, { once: true });
    dialog.querySelector("[data-cancel]").addEventListener("click", () => dialog.close());
    dialog.querySelectorAll("[data-file-trigger]").forEach((trigger) => {
      const input = dialog.querySelector(`[data-file="${trigger.dataset.fileTrigger}"]`);
      const label = dialog.querySelector(`[data-file-name="${trigger.dataset.fileTrigger}"]`);
      trigger.addEventListener("click", () => input?.click());
      input?.addEventListener("change", () => {
        if (label) label.textContent = input.files?.[0]?.name || "선택된 파일 없음";
      });
    });
    dialog.querySelector("[data-submit]").addEventListener("click", async () => {
      const button = dialog.querySelector("[data-submit]");
      const errorBox = dialog.querySelector("[data-form-error]");
      errorBox.hidden = true;
      button.disabled = true;
      try {
        await onSubmit(this.readForm(dialog), dialog);
        await dialog.close();
        this.toast("저장했습니다.");
      } catch (error) {
        errorBox.textContent = error?.message || "입력 내용을 확인해 주세요.";
        errorBox.hidden = false;
        button.disabled = false;
      }
    });
    await dialog.show();
    return dialog;
  }

  findItem(collection, id) {
    return this.data(collection).find((item) => item.id === id) || null;
  }

  async openEditor(kind, id = "", preset = {}) {
    if (kind === "feedback") {
      return this.formDialog({ headline: "익명 학급 개선 의견", submitLabel: "익명으로 접수", content: `${selectField("category", "카테고리", FEEDBACK_CATEGORIES, "학습")}${field("title", "제목", "", { required: true, max: 100 })}${field("body", "내용", "", { textarea: true, rows: 5, required: true, max: 1600, support: "작성자의 이메일·UID는 의견에 저장되지 않습니다" })}`, onSubmit: async (values) => {
        if (!values.title || !values.body) throw new Error("제목과 내용을 입력해 주세요.");
        await this.repo.submitFeedback(values);
      } });
    }

    if (kind === "announcement") {
      const item = id ? this.findItem("announcements", id) : {};
      return this.formDialog({ headline: id ? "학급 공지 수정" : "학급 공지 작성", content: `${selectField("category", "분류", ["일반 공지", "긴급 공지", "운영 변경", "수업 변경", "학생회"], item.category || "일반 공지")}${selectField("priority", "중요도", [["normal", "일반"], ["important", "중요"], ["urgent", "긴급"]], item.priority || "normal")}${field("title", "제목", item.title, { required: true, max: 100 })}${field("body", "내용", item.body, { textarea: true, rows: 5, required: true, max: 1800 })}${field("expiresDate", "표시 종료일", item.expiresAtMs ? kstDate(item.expiresAtMs) : "", { type: "date" })}${checkField("pinned", "학급 홈 중요 정보로 고정", item.pinned)}`, onSubmit: async (values) => {
        if (!values.title || !values.body) throw new Error("제목과 내용을 입력해 주세요.");
        await this.repo.adminWrite("announcements", { ...item, ...values, expiresAtMs: values.expiresDate ? dateToMs(values.expiresDate, true) : 0 }, { id, label: values.title });
      } });
    }

    if (["assignment", "preparation"].includes(kind)) {
      const item = id ? this.findItem("classAssignments", id) : {};
      const type = kind === "preparation" ? "preparation" : item.type || "assessment";
      return this.formDialog({ headline: type === "preparation" ? "준비물 등록" : id ? "수행평가 수정" : "수행평가 추가", content: `${selectField("type", "종류", [["assessment", "수행평가"], ["exam", "시험"], ["preparation", "준비물"]], type)}<div class="pincon-ops-dialog-grid">${field("subject", "과목", item.subject, { max: 40 })}${field("dueDate", "날짜", item.dueDate || itemDate(item), { type: "date", required: true })}</div>${field("title", type === "preparation" ? "준비물" : "평가명", item.title, { required: true, max: 120 })}${field("description", "설명", item.description, { textarea: true, rows: 4, max: 1200 })}${checkField("important", "중요 알림으로 표시", item.important !== false)}`, onSubmit: async (values) => {
        if (!values.title || !values.dueDate) throw new Error("제목과 날짜를 입력해 주세요.");
        await this.repo.adminWrite("classAssignments", { ...item, ...values, dueAtMs: dateToMs(values.dueDate) }, { id, label: values.title });
      } });
    }

    if (kind === "event") {
      const item = id ? this.findItem("events", id) : preset;
      return this.formDialog({ headline: id ? "학급 행사 수정" : "학급 행사 만들기", content: `${selectField("kind", "행사 유형", EVENT_KINDS, item.kind || "survey34")}${field("title", "행사 이름", item.title || "우리반 34명에게 물었습니다", { required: true, max: 120 })}${field("question", "질문 또는 핵심 안내", item.question, { textarea: true, rows: 3, required: true, max: 500 })}<div class="pincon-ops-dialog-grid">${field("date", "시작일", item.date || kstDate(), { type: "date", required: true })}${field("endDate", "종료일", item.endDate || item.date || kstDate(), { type: "date", required: true })}</div>${selectField("status", "상태", [["draft", "준비 중"], ["open", "참여 중"], ["closed", "종료"]], item.status || "open")}${field("description", "진행 안내·처리 계획", item.description, { textarea: true, rows: 4, max: 1200 })}${checkField("resultsVisible", "집계 결과 공개", item.resultsVisible)}`, onSubmit: async (values) => {
        if (!values.title || !values.question || !values.date || !values.endDate) throw new Error("행사명, 질문, 시작일과 종료일을 입력해 주세요.");
        if (dateToMs(values.endDate) < dateToMs(values.date)) throw new Error("종료일은 시작일보다 빠를 수 없습니다.");
        await this.repo.adminWrite("events", {
          ...item,
          ...values,
          startsAtMs: dateToMs(values.date),
          endsAtMs: dateToMs(values.endDate, true),
          acceptingResponses: values.status === "open",
          publishedResults: values.resultsVisible ? (item.publishedResults || []) : [],
          resultSummary: values.resultsVisible ? (item.resultSummary || {}) : {},
        }, { id, label: values.title });
      } });
    }

    if (kind === "poll") {
      const item = id ? this.findItem("polls", id) : {};
      const questionFields = id
        ? `<div class="pincon-ops-answer"><strong>${esc(item.question)}</strong><br>${esc((item.options || []).join(" · "))}<br><small>투표 무결성을 위해 생성 후 질문과 선택지는 고정됩니다.</small></div>`
        : `${field("question", "질문", "다음 학급 행사로 무엇을 할까요?", { required: true, max: 120 })}${field("optionsText", "선택지 (한 줄에 하나)", ["우리반 34명에게 물었습니다", "가족오락관", "반 대항 퀴즈", "랜덤 팀 게임"].join("\n"), { textarea: true, rows: 6, required: true, max: 800 })}`;
      return this.formDialog({ headline: id ? "공식 투표 관리" : "행사 아이디어 투표", content: `${questionFields}<div class="pincon-ops-dialog-grid">${selectField("status", "상태", [["open", "투표 중"], ["closed", "마감"]], item.status || "open")}${selectField("resultVisibility", "결과 공개", [["live", "실시간"], ["after-close", "마감 후"]], item.resultVisibility || "after-close")}</div>${field("closeDate", "마감일", item.closesAtMs ? kstDate(item.closesAtMs) : kstDate(Date.now(), 7), { type: "date" })}${id ? "" : checkField("multiple", "복수 선택 허용", false)}`, onSubmit: async (values) => {
        const question = id ? item.question : values.question;
        const options = id ? item.options : String(values.optionsText || "").split("\n").map((row) => plainText(row, 80)).filter(Boolean).slice(0, 8);
        const multiple = id ? item.multiple : values.multiple;
        if (!question || options.length < 2) throw new Error("질문과 선택지 두 개 이상을 입력해 주세요.");
        const user = this.state.user;
        await this.repo.adminWrite("polls", { ...item, question, options, multiple, status: values.status, resultVisibility: values.resultVisibility, closesAtMs: values.closeDate ? dateToMs(values.closeDate, true) : 0, official: true, authorUid: item.authorUid || user.uid, authorName: item.authorName || user.displayName || "회장", createdAtMs: item.createdAtMs || Date.now(), updatedAtMs: Date.now(), deleted: false }, { id, label: question });
      } });
    }

    if (kind === "feedbackReply") {
      const item = this.findItem("feedback", id);
      if (!item) throw new Error("건의를 찾지 못했습니다.");
      const replyStatus = item.status === "received" ? "reviewing" : item.status || "reviewing";
      return this.formDialog({ headline: "건의 공식 답변", content: `<div class="pincon-ops-answer"><strong>${esc(item.title)}</strong><br>${nl(item.body)}</div>${selectField("status", "처리 상태", Object.entries(FEEDBACK_STATUSES), replyStatus)}${field("officialReply", "회장 공식 답변", item.officialReply, { textarea: true, rows: 5, required: true, max: 1600, support: "실행이 어려울 때도 삭제하지 말고 이유와 대안을 적어 주세요" })}`, onSubmit: async (values) => {
        if (!values.officialReply) throw new Error("공식 답변을 입력해 주세요.");
        await this.repo.adminWrite("feedback", { ...item, ...values, repliedAtMs: Date.now() }, { id, label: `${item.title} 답변` });
      } });
    }

    if (kind === "supply") {
      const item = id ? this.findItem("supplies", id) : {};
      return this.formDialog({ headline: id ? "공용 물품 수정" : "공용 물품 추가", content: `${field("name", "물품명", item.name, { required: true, max: 80 })}<div class="pincon-ops-dialog-grid">${field("quantity", "수량", item.quantity ?? 1, { type: "number", required: true })}${field("unit", "단위", item.unit || "개", { max: 12 })}</div>${selectField("status", "상태", [["enough", "충분"], ["low", "부족"], ["empty", "없음"]], item.status || "enough")}${field("location", "보관 위치", item.location, { max: 100 })}${checkField("loanable", "대여 방식으로 관리", item.loanable)}`, onSubmit: async (values) => {
        if (!values.name) throw new Error("물품명을 입력해 주세요.");
        const quantity = Math.max(0, Number(values.quantity || 0));
        await this.repo.adminWrite("supplies", { ...item, ...values, quantity }, { id, label: values.name });
      } });
    }

    if (kind === "resource") {
      const categories = this.findItem("classSettings", this.state.classKey)?.resourceCategories || RESOURCE_CATEGORIES;
      const currentYear = Number(kstDate().slice(0, 4));
      return this.formDialog({ headline: "학습지 DB에 등록", submitLabel: "학습지 등록", content: `<div class="pincon-ops-legal-note"><md-icon>copyright</md-icon><span>시중 교재·문제집 스캔본은 등록하지 마세요. 공유 권한이 확인된 자료만 올릴 수 있습니다.</span></div><div class="pincon-ops-dialog-grid">${selectField("category", "카테고리", categories, categories[0])}${selectField("materialType", "자료 유형", WORKSHEET_TYPES, "worksheet")}</div><div class="pincon-ops-dialog-grid">${field("subject", "과목", "", { required: true, max: 40 })}${field("title", "제목", "", { required: true, max: 120 })}</div>${field("unit", "단원", "", { max: 80, support: "예: II. 함수 · 3. 이차함수" })}<div class="pincon-ops-dialog-grid">${field("schoolYear", "학년도", currentYear, { type: "number", required: true })}${selectField("semester", "학기", [[1, "1학기"], [2, "2학기"]], kstDate().slice(5, 7) <= "07" ? 1 : 2)}</div><div class="pincon-ops-dialog-grid">${field("version", "버전·차시", "", { max: 20, support: "예: v2, 3차시" })}${field("pageCount", "쪽 수", "", { type: "number" })}</div>${field("description", "설명", "", { textarea: true, rows: 3, max: 1200 })}${field("url", "링크 (파일 대신 입력 가능)", "", { type: "url", max: 1000 })}${fileField("resource", "파일 선택")}${selectField("rightsBasis", "공유할 수 있는 근거", RIGHTS_BASES, "teacher-approved")}${field("sourceAttribution", "출처·라이선스", "", { max: 300, support: "공개 라이선스·기관 공개 자료는 자료명, 기관, 라이선스 또는 원문 링크를 적으세요" })}${checkField("rightsConfirmed", "이 자료를 학급에 공유할 권한이 있음을 확인했습니다.", false)}${checkField("personalDataRemoved", "학생 개인정보가 포함되지 않았거나 모두 제거했음을 확인했습니다.", false)}${this.state.isPresident ? checkField("pinned", "중요 자료로 상단 고정", false) : ""}`, onSubmit: async (values, dialog) => {
        if (!values.title) throw new Error("자료 제목을 입력해 주세요.");
        if (!values.subject) throw new Error("과목을 입력해 주세요.");
        if (!values.rightsConfirmed) throw new Error("자료 공유 권한을 확인해야 등록할 수 있습니다.");
        if (!values.personalDataRemoved) throw new Error("개인정보 제거 여부를 확인해야 등록할 수 있습니다.");
        if (["open-license", "official-public"].includes(values.rightsBasis) && !values.sourceAttribution) throw new Error("공개 자료의 출처와 라이선스 정보를 입력해 주세요.");
        const file = dialog.querySelector("[data-file=resource]")?.files?.[0] || null;
        await this.repo.createResource(values, file);
      } });
    }

    if (kind === "resourceCategories") {
      const item = this.data("classSettings").find((row) => row.classKey === this.state.classKey) || {};
      const categories = Array.isArray(item.resourceCategories) && item.resourceCategories.length ? item.resourceCategories : RESOURCE_CATEGORIES;
      return this.formDialog({ headline: "자료실 카테고리 관리", content: `${field("categoriesText", "카테고리 (한 줄에 하나)", categories.join("\n"), { textarea: true, rows: 7, required: true, max: 500, support: "2~10개의 짧은 분류를 입력하세요" })}`, onSubmit: async (values) => {
        const next = String(values.categoriesText || "").split("\n").map((row) => plainText(row, 30)).filter(Boolean).filter((row, index, all) => all.indexOf(row) === index).slice(0, 10);
        if (next.length < 2) throw new Error("카테고리를 두 개 이상 입력해 주세요.");
        await this.repo.adminWrite("classSettings", { ...item, resourceCategories: next }, { id: this.state.classKey, label: "자료실 카테고리 변경" });
      } });
    }

    if (kind === "lostItem") {
      return this.formDialog({ headline: "분실물 등록", submitLabel: "보관 중으로 등록", content: `${field("name", "물품명", "", { required: true, max: 100 })}<div class="pincon-ops-dialog-grid">${field("foundLocation", "발견 위치", "교실", { max: 120 })}${field("foundDate", "발견 날짜", kstDate(), { type: "date", required: true })}</div>${fileField("lost", "분실물 사진 (선택)", { imageOnly: true })}`, onSubmit: async (values, dialog) => {
        if (!values.name || !values.foundDate) throw new Error("물품명과 발견 날짜를 입력해 주세요.");
        const file = dialog.querySelector("[data-file=lost]")?.files?.[0] || null;
        await this.repo.createLostItem(values, file);
      } });
    }

    if (kind === "patchDraft") {
      const item = this.findItem("patchNoteDrafts", id) || {};
      return this.formDialog({ headline: "학급 패치노트 초안", content: `<div class="pincon-ops-dialog-grid">${field("month", "월", item.month || monthKey(), { type: "month", required: true })}${field("version", "버전", item.version || "v1.0", { required: true, max: 20 })}</div>${field("title", "제목", item.title || `우리반 ${item.version || "v1.0"}`, { max: 120 })}${field("addedText", "Added (한 줄에 하나)", (item.added || []).join("\n"), { textarea: true, rows: 4 })}${field("improvedText", "Improved", (item.improved || []).join("\n"), { textarea: true, rows: 4 })}${field("fixedText", "Fixed", (item.fixed || []).join("\n"), { textarea: true, rows: 4 })}${field("reviewingText", "Reviewing", (item.reviewing || []).join("\n"), { textarea: true, rows: 4 })}`, onSubmit: async (values) => {
        const lines = (text) => String(text || "").split("\n").map((row) => plainText(row, 180)).filter(Boolean).slice(0, 40);
        await this.repo.adminWrite("patchNoteDrafts", { ...item, month: values.month, version: values.version, title: values.title, added: lines(values.addedText), improved: lines(values.improvedText), fixed: lines(values.fixedText), reviewing: lines(values.reviewingText), feedbackSummary: item.feedbackSummary || {} }, { id, label: `${values.month} 패치노트 초안` });
      } });
    }
  }

  async respondEvent(id) {
    const event = this.findItem("events", id);
    if (!event) throw new Error("행사를 찾지 못했습니다.");
    return this.formDialog({ headline: event.title, submitLabel: "익명으로 답변", content: `<div class="pincon-ops-answer">${nl(event.question)}</div>${field("answersText", "답변", "", { textarea: true, rows: 5, required: true, max: 800, support: "여러 답을 받을 때는 한 줄에 하나씩 입력하세요" })}`, onSubmit: async (values) => {
      const answers = String(values.answersText || "").split("\n").map((row) => plainText(row, 120)).filter(Boolean);
      if (!answers.length) throw new Error("답변을 입력해 주세요.");
      await this.repo.respondToEvent(id, answers);
    } });
  }

  async aggregateEvent(id) {
    const event = this.findItem("events", id);
    const responses = await this.repo.getEventResponses(id);
    const results = aggregateAnswers(responses, 16);
    if (!results.length) throw new Error("아직 집계할 답변이 없습니다.");
    await this.repo.adminWrite("events", { ...event, publishedResults: results, resultSummary: { responses: responses.length, answers: results.reduce((sum, row) => sum + row.count, 0) }, resultsVisible: true }, { id, label: `${event.title} 결과 공개` });
    this.toast(`${responses.length}명의 답변을 집계해 공개했습니다.`);
  }

  async votePoll(id) {
    const poll = this.findItem("polls", id);
    if (!poll) throw new Error("투표를 찾지 못했습니다.");
    const content = `<p style="margin:0">${esc(poll.multiple ? "복수 선택할 수 있습니다." : "한 가지만 선택해 주세요.")}</p>${(poll.options || []).map((option, index) => `<div class="pincon-ops-check-row"><md-checkbox data-poll-option="${index}"></md-checkbox><label>${esc(option)}</label></div>`).join("")}`;
    return this.formDialog({ headline: poll.question, submitLabel: "투표 제출", content, onSubmit: async (_, dialog) => {
      let selected = [...dialog.querySelectorAll("[data-poll-option]")].filter((box) => box.checked).map((box) => Number(box.dataset.pollOption));
      if (!poll.multiple && selected.length > 1) throw new Error("한 가지만 선택해 주세요.");
      await this.repo.votePoll(id, selected);
    } });
  }

  async showPollResults(id) {
    const poll = this.findItem("polls", id);
    if (poll?.official === true && poll.resultVisibility === "after-close" && isOpenWindow(poll) && !this.state.isPresident) {
      throw new Error("이 투표 결과는 마감 후 공개됩니다.");
    }
    const votes = await this.repo.getPollVotes(id);
    const counts = (poll.options || []).map((label, index) => ({ label, count: votes.filter((vote) => (vote.selected || []).includes(index)).length }));
    const max = Math.max(1, ...counts.map((row) => row.count));
    const dialog = document.createElement("md-dialog");
    dialog.className = "pincon-ops-dialog";
    dialog.innerHTML = `<div slot="headline">${esc(poll.question)} 결과</div><div slot="content" class="pincon-ops-dialog-form"><p style="margin:0">참여 ${votes.length}명</p><div class="pincon-ops-results">${counts.map((row) => `<div class="pincon-ops-result-row"><span>${esc(row.label)}</span><span class="pincon-ops-result-bar"><span style="width:${Math.round(row.count / max * 100)}%"></span></span><b>${row.count}</b></div>`).join("")}</div></div><div slot="actions"><md-filled-button data-close>닫기</md-filled-button></div>`;
    document.body.appendChild(dialog);
    dialog.querySelector("[data-close]").onclick = () => dialog.close();
    dialog.addEventListener("closed", () => dialog.remove(), { once: true });
    await dialog.show();
  }

  async presentEvent(id) {
    const event = this.findItem("events", id);
    if (!event) throw new Error("행사를 찾지 못했습니다.");
    const results = event.publishedResults || [];
    const max = Math.max(1, ...results.map((row) => Number(row.count || 0)));
    const dialog = document.createElement("md-dialog");
    dialog.className = "pincon-ops-presentation";
    dialog.innerHTML = `<div slot="content" class="pincon-ops-presentation-content"><div class="pincon-ops-status-line" style="justify-content:center">${statusPill(event.title, "good")}</div><h2>${nl(event.question || event.title)}</h2>${results.length ? `<div class="pincon-ops-results">${results.map((row) => `<div class="pincon-ops-result-row"><span>${esc(row.label)}</span><span class="pincon-ops-result-bar"><span style="width:${Math.round(Number(row.count || 0) / max * 100)}%"></span></span><b>${Number(row.count || 0)}</b></div>`).join("")}</div>` : `<div class="pincon-ops-empty"><md-icon>live_tv</md-icon><strong>행사 진행 화면</strong><p>회장이 결과를 집계·공개하면 큰 글씨로 표시됩니다.</p></div>`}</div><div slot="actions"><md-text-button data-print>인쇄</md-text-button><md-filled-button data-close>닫기</md-filled-button></div>`;
    document.body.appendChild(dialog);
    dialog.querySelector("[data-close]").onclick = () => dialog.close();
    dialog.querySelector("[data-print]").onclick = () => window.print();
    dialog.addEventListener("closed", () => dialog.remove(), { once: true });
    await dialog.show();
  }

  async createPatchDraft() {
    const month = monthKey();
    const existing = activeRows(this.data("patchNoteDrafts")).find((item) => item.month === month);
    if (existing) return this.openEditor("patchDraft", existing.id);
    const draft = buildPatchDraft({ month, feedback: this.data("feedback"), supplies: this.data("supplies"), events: this.data("events"), announcements: this.data("announcements"), changeLogs: this.data("changeLogs") });
    const version = nextPatchVersion(this.data("patchNotes"));
    const id = await this.repo.adminWrite("patchNoteDrafts", { month, version, title: `우리반 ${version} · ${month}`, ...draft, status: "draft" }, { label: `${month} 패치노트 자동 초안` });
    this.toast("이번 달 변경 기록으로 초안을 만들었습니다.");
    return this.openEditor("patchDraft", id);
  }

  async publishPatch(id) {
    const draft = this.findItem("patchNoteDrafts", id);
    if (!draft) throw new Error("패치노트 초안을 찾지 못했습니다.");
    await this.confirm("이 패치노트를 발행할까요?", "발행하면 모든 학생이 월별 기록에서 볼 수 있습니다.", async () => this.repo.publishPatchNote(id, draft));
  }

  async openClassChange() {
    const profile = this.state.profile || { grade: 1, classNumber: 1 };
    return this.formDialog({
      headline: "내 학급 변경",
      submitLabel: "학급 연결",
      content: `<div class="pincon-ops-dialog-grid">${selectField("grade", "학년", [1, 2, 3].map((value) => [value, `${value}학년`]), profile.grade)}${selectField("classNumber", "반", Array.from({ length: 10 }, (_, index) => [index + 1, `${index + 1}반`]), profile.classNumber)}</div><div class="pincon-ops-legal-note"><md-icon>sync</md-icon><span>변경하면 공지·시간표·학급 운영·자료가 선택한 반 기준으로 다시 연결됩니다.</span></div>`,
      onSubmit: async (values) => {
        const grade = Number(values.grade);
        const classNumber = Number(values.classNumber);
        if (!Number.isInteger(grade) || grade < 1 || grade > 3 || !Number.isInteger(classNumber) || classNumber < 1 || classNumber > 10) {
          throw new Error("학년과 반을 올바르게 선택해 주세요.");
        }
        localStorage.setItem("pincon-profile-v2", JSON.stringify({ grade, classNumber }));
        this.repo.refreshProfile();
        this.state = this.repo.snapshot();
        this.tab = "today";
        this.open("today");
        window.dispatchEvent(new CustomEvent("pincon-profile-change", { detail: { grade, classNumber } }));
      },
    });
  }

  async installApp() {
    if (matchMedia("(display-mode: standalone)").matches || navigator.standalone === true) {
      this.toast("PinCon이 이미 앱으로 실행 중입니다.");
      return;
    }
    if (this.installPrompt) {
      await this.installPrompt.prompt();
      await this.installPrompt.userChoice.catch(() => null);
      this.installPrompt = null;
      this.render();
      return;
    }
    const dialog = document.createElement("md-dialog");
    dialog.className = "pincon-ops-dialog";
    dialog.innerHTML = `<div slot="headline">PinCon 설치</div><div slot="content" class="pincon-ops-dialog-form"><md-list><md-list-item><md-icon slot="start">android</md-icon><span slot="headline">Android·Chrome</span><span slot="supporting-text">브라우저 메뉴에서 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 선택하세요.</span></md-list-item><md-divider inset></md-divider><md-list-item><md-icon slot="start">tablet_mac</md-icon><span slot="headline">iPhone·iPad Safari</span><span slot="supporting-text">공유 버튼을 누른 뒤 ‘홈 화면에 추가’를 선택하세요.</span></md-list-item></md-list></div><div slot="actions"><md-filled-button data-close>확인</md-filled-button></div>`;
    document.body.appendChild(dialog);
    dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("closed", () => dialog.remove(), { once: true });
    await dialog.show();
  }

  async openSearch() {
    const dialog = document.createElement("md-dialog");
    dialog.className = "pincon-ops-dialog";
    dialog.innerHTML = `<div slot="headline">PinCon 통합 검색</div><div slot="content" class="pincon-ops-search-results"><md-outlined-text-field class="pincon-ops-search-box" data-search label="공지·수행평가·행사·자료·공용품 검색" autofocus></md-outlined-text-field><div data-results>${emptyState("search", "검색어를 입력하세요", "예: 과학, 수행평가, 가위")}</div></div><div slot="actions"><md-filled-button data-close>닫기</md-filled-button></div>`;
    document.body.appendChild(dialog);
    const fieldEl = dialog.querySelector("[data-search]");
    const resultsEl = dialog.querySelector("[data-results]");
    const update = () => {
      const rows = searchAll({
        ...this.state.data,
        events: this.data("events").filter((item) => this.state.isPresident || item.status !== "draft"),
        resources: this.data("resources").filter((item) => this.state.isPresident || item.moderationStatus === "approved"),
        patchNotes: this.data("patchNotes").map((item) => ({ ...item, __canReadDraft: this.state.isPresident })),
      }, fieldEl.value || "");
      resultsEl.innerHTML = rows.length ? `<div class="pincon-ops-surface"><md-list>${rows.map((row, index) => `<md-list-item><md-icon slot="start">search</md-icon><span slot="headline">${esc(row.title || row.name || "검색 결과")}</span><span slot="supporting-text">${esc(`${row.searchGroup} · ${compact(row.body || row.description || row.subject, 100)}`)}</span></md-list-item>${listDivider(index, rows.length)}`).join("")}</md-list></div>` : emptyState("search_off", "검색 결과가 없습니다", "다른 과목명이나 짧은 단어로 다시 검색해 보세요.");
    };
    fieldEl.addEventListener("input", update);
    dialog.querySelector("[data-close]").onclick = () => dialog.close();
    dialog.addEventListener("closed", () => dialog.remove(), { once: true });
    await dialog.show();
    setTimeout(() => fieldEl.focus?.(), 100);
  }

  async showHistory(id) {
    if (!this.state.isPresident) throw new Error("학급 회장 계정에서만 변경 내용을 볼 수 있습니다.");
    const log = this.findItem("changeLogs", id);
    if (!log) throw new Error("변경 기록을 찾지 못했습니다.");
    const pretty = (value) => value ? JSON.stringify(value, null, 2) : "(내용 없음)";
    const dialog = document.createElement("md-dialog");
    dialog.className = "pincon-ops-dialog";
    dialog.innerHTML = `<div slot="headline">${esc(log.label || "변경 내용")}</div><div slot="content" class="pincon-ops-history-detail"><section><strong>이전 내용</strong><pre>${esc(pretty(log.before))}</pre></section><section><strong>변경 내용</strong><pre>${esc(pretty(log.after))}</pre></section></div><div slot="actions"><md-filled-button data-close>닫기</md-filled-button></div>`;
    document.body.appendChild(dialog);
    dialog.querySelector("[data-close]").onclick = () => dialog.close();
    dialog.addEventListener("closed", () => dialog.remove(), { once: true });
    await dialog.show();
  }

  async confirm(headline, body, action) {
    const dialog = document.createElement("md-dialog");
    dialog.className = "pincon-ops-dialog";
    dialog.innerHTML = `<div slot="headline">${esc(headline)}</div><div slot="content" class="pincon-ops-dialog-form"><p style="margin:0">${esc(body)}</p><p class="pincon-ops-form-error" data-error hidden></p></div><div slot="actions"><md-text-button data-cancel>취소</md-text-button><md-filled-button data-confirm>확인</md-filled-button></div>`;
    document.body.appendChild(dialog);
    dialog.querySelector("[data-cancel]").onclick = () => dialog.close();
    dialog.querySelector("[data-confirm]").onclick = async () => {
      const button = dialog.querySelector("[data-confirm]");
      button.disabled = true;
      try { await action(); await dialog.close(); this.toast("완료했습니다."); }
      catch (error) { const box = dialog.querySelector("[data-error]"); box.textContent = error?.message || "작업을 완료하지 못했습니다."; box.hidden = false; button.disabled = false; }
    };
    dialog.addEventListener("closed", () => dialog.remove(), { once: true });
    await dialog.show();
  }
}

const ADMIN_COLLECTIONS_FOR_UI = new Set(["announcements", "classAssignments", "events", "polls", "feedback", "supplies", "supplyLoans", "lostItems", "resources", "patchNotes", "patchNoteDrafts"]);

const classOpsApp = new PinconClassOpsApp(classOpsRepository);
classOpsApp.init().catch((error) => console.error("PinCon Class Ops init failed", error));

globalThis.PINCON_CLASS_OPS = Object.freeze({
  open: (tab = "today") => classOpsApp.open(tab),
  close: () => classOpsApp.close(),
  repository: classOpsRepository,
  version: CLASS_OPS_VERSION,
});
