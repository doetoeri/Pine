import { buildTodayFeed, dateToMs, formatKoreanDate, itemDate, kstDate, plainText } from "./pincon-class-ops-core.js";

await Promise.resolve(globalThis.PINCON_MATERIAL_READY).catch(() => null);

const TYPE_LABELS = Object.freeze({
  announcement: "공지",
  assessment: "수행평가",
  exam: "시험",
  preparation: "준비물",
  academic: "학사일정",
  timetable: "시간표",
  meal: "급식",
  event: "행사",
  notice: "안내",
  supply: "준비물",
});

const TYPE_ICONS = Object.freeze({
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

function uniqueItems(rows = []) {
  const seen = new Set();
  return rows.filter((item) => {
    const key = `${item.__collection || item.type || item.feedKind || "item"}:${item.id || item.title}:${itemDate(item)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeItem(item = {}, collection = "") {
  const type = item.feedKind || item.type || (collection === "announcements" ? "announcement" : collection === "events" ? "event" : "notice");
  return {
    ...item,
    __collection: collection || item.__collection || "",
    __printType: type,
    __printKey: `${collection || item.__collection || type}:${item.id || item.title || cryptoRandomId()}`,
  };
}

function cryptoRandomId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function active(rows = []) {
  return rows.filter((item) => !item.deleted);
}

function bodyText(item = {}, detail = "short") {
  const raw = item.body || item.description || item.details || item.question || item.summary || (Array.isArray(item.events) ? item.events.join(" · ") : "");
  const cleaned = plainText(String(raw || "").replace(/<br\s*\/?\s*>/gi, " · ").replace(/<[^>]+>/g, " "), detail === "full" ? 420 : 130);
  if (detail === "full") return cleaned;
  return cleaned.length > 126 ? `${cleaned.slice(0, 125)}…` : cleaned;
}

function dateLabel(item = {}) {
  const date = itemDate(item);
  if (!date) return item.__printType === "announcement" ? "학급 공지" : "날짜 미정";
  return formatKoreanDate(date, { weekday: true, year: false });
}

function pageUrlFor(item) {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("class-ops", "1");
  const tab = item.__printType === "announcement" ? "today" : item.__printType === "event" ? "class" : "schedule";
  url.searchParams.set("class-tab", tab);
  if (item.id) url.searchParams.set("pincon-item", `${item.__collection || item.__printType}:${item.id}`);
  return url.href;
}

function qrImageUrl(url) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=0&data=${encodeURIComponent(url)}`;
}

class PinconPrintCenter {
  constructor(repository) {
    this.repo = repository;
    this.state = repository?.snapshot?.() || { data: {}, isPresident: false };
    this.opened = false;
    this.overlay = null;
    this.selected = new Set();
    this.settings = {
      preset: "today",
      paper: "a4",
      cardsPerPage: 8,
      qr: true,
      monochrome: false,
      detail: "short",
    };
    this.pageStyle = null;
    this.repo?.addEventListener?.("change", (event) => {
      this.state = event.detail || this.repo.snapshot();
      if (this.opened) this.render();
      this.injectManageButton();
    });
  }

  init() {
    document.addEventListener("click", (event) => this.onDocumentClick(event));
    document.addEventListener("change", (event) => this.onDocumentChange(event));
    window.addEventListener("afterprint", () => this.finishPrint());

    const observer = new MutationObserver(() => this.injectManageButton());
    observer.observe(document.getElementById("root") || document.body, { childList: true, subtree: true });
    observer.observe(document.body, { childList: true, subtree: false });
    this.injectManageButton();

    globalThis.PINCON_PRINT_CENTER = Object.freeze({
      open: () => this.open(),
      close: () => this.close(),
      print: () => this.print(),
      version: "1.0.0",
    });
  }

  injectManageButton() {
    const actionGrids = [...document.querySelectorAll(".pincon-ops-view .pincon-ops-action-grid")];
    const manageGrid = actionGrids.find((grid) => grid.querySelector('[data-action="announcement-create"]'));
    if (!manageGrid || manageGrid.querySelector("[data-pincon-print-open]")) return;
    const button = document.createElement("md-filled-tonal-button");
    button.dataset.pinconPrintOpen = "";
    button.innerHTML = '<md-icon slot="icon">print</md-icon>인쇄 센터';
    manageGrid.appendChild(button);
  }

  allItems() {
    const data = this.state.data || {};
    const now = Date.now();
    const today = kstDate(now);
    const weekEnd = dateToMs(kstDate(now, 7), true);

    const feed = buildTodayFeed(data, now).map((item) => normalizeItem(item, item.__collection || "feed"));
    const announcements = active(data.announcements || []).map((item) => normalizeItem(item, "announcements"));
    const assignments = active(data.classAssignments || data.assignments || []).map((item) => normalizeItem(item, "classAssignments"));
    const events = active(data.events || []).filter((item) => item.status !== "draft").map((item) => normalizeItem({ ...item, type: "event" }, "events"));
    const academic = active(data.academicSchedules || []).map((item) => normalizeItem({ ...item, type: "academic" }, "academicSchedules"));

    const recentOrFuture = [...announcements, ...assignments, ...events, ...academic].filter((item) => {
      const date = itemDate(item);
      if (!date) return item.__printType === "announcement";
      return dateToMs(date, true) >= dateToMs(today) && dateToMs(date) <= weekEnd;
    });

    return uniqueItems([...feed, ...recentOrFuture]).sort((a, b) => {
      const aDate = dateToMs(itemDate(a)) || Number.MAX_SAFE_INTEGER;
      const bDate = dateToMs(itemDate(b)) || Number.MAX_SAFE_INTEGER;
      return aDate - bDate || String(a.title || "").localeCompare(String(b.title || ""), "ko");
    });
  }

  presetItems(preset = this.settings.preset) {
    const data = this.state.data || {};
    const now = Date.now();
    const today = kstDate(now);
    const weekEnd = dateToMs(kstDate(now, 7), true);
    const all = this.allItems();

    if (preset === "today") {
      return buildTodayFeed(data, now).map((item) => normalizeItem(item, item.__collection || "feed"));
    }
    if (preset === "assessments") {
      return all.filter((item) => ["assessment", "exam", "preparation"].includes(item.__printType));
    }
    if (preset === "announcements") {
      return all.filter((item) => item.__printType === "announcement");
    }
    if (preset === "week") {
      return all.filter((item) => {
        if (item.__printType === "announcement" && !itemDate(item)) return true;
        const ms = dateToMs(itemDate(item));
        return ms >= dateToMs(today) && ms <= weekEnd;
      });
    }
    return all;
  }

  resetSelection() {
    this.selected = new Set(this.presetItems().map((item) => item.__printKey));
  }

  open() {
    this.state = this.repo?.snapshot?.() || this.state;
    if (!this.state.isPresident) return;
    this.opened = true;
    this.resetSelection();
    this.ensureOverlay();
    this.overlay.dataset.open = "true";
    document.body.classList.add("pincon-print-center-open");
    this.render();
  }

  close() {
    if (!this.overlay) return;
    this.opened = false;
    this.overlay.dataset.open = "false";
    document.body.classList.remove("pincon-print-center-open");
    this.finishPrint();
  }

  ensureOverlay() {
    if (this.overlay) return;
    this.overlay = document.createElement("div");
    this.overlay.className = "pincon-print-overlay";
    this.overlay.dataset.open = "false";
    this.overlay.setAttribute("role", "dialog");
    this.overlay.setAttribute("aria-modal", "true");
    this.overlay.setAttribute("aria-label", "PinCon 인쇄 센터");
    document.body.appendChild(this.overlay);
  }

  selectedItems() {
    const rows = this.presetItems(this.settings.preset);
    return rows.filter((item) => this.selected.has(item.__printKey));
  }

  render() {
    if (!this.overlay) return;
    const rows = this.presetItems();
    if (!this.selected.size && rows.length) this.resetSelection();
    const selected = this.selectedItems();
    const profile = this.state.profile || {};
    const classLabel = profile.grade && profile.classNumber ? `${profile.grade}학년 ${profile.classNumber}반` : "학급";

    this.overlay.innerHTML = `
      <div class="pincon-print-dialog">
        <header class="pincon-print-topbar">
          <md-filled-tonal-icon-button data-print-action="close" aria-label="인쇄 센터 닫기"><md-icon>close</md-icon></md-filled-tonal-icon-button>
          <div><p>PinCon Print Center</p><h1>인쇄 센터</h1></div>
          <md-filled-button data-print-action="print" ${selected.length ? "" : "disabled"}><md-icon slot="icon">print</md-icon>인쇄 · PDF 저장</md-filled-button>
        </header>
        <div class="pincon-print-workspace">
          <aside class="pincon-print-config">
            <section>
              <h2>무엇을 인쇄할까요?</h2>
              <md-outlined-select data-print-setting="preset" label="카드 묶음" value="${attr(this.settings.preset)}">
                <md-select-option value="today" ${this.settings.preset === "today" ? "selected" : ""}><span slot="headline">오늘 카드</span></md-select-option>
                <md-select-option value="week" ${this.settings.preset === "week" ? "selected" : ""}><span slot="headline">이번 주 카드</span></md-select-option>
                <md-select-option value="assessments" ${this.settings.preset === "assessments" ? "selected" : ""}><span slot="headline">수행평가·준비물</span></md-select-option>
                <md-select-option value="announcements" ${this.settings.preset === "announcements" ? "selected" : ""}><span slot="headline">공지</span></md-select-option>
                <md-select-option value="all" ${this.settings.preset === "all" ? "selected" : ""}><span slot="headline">전체 선택</span></md-select-option>
              </md-outlined-select>
              <div class="pincon-print-list-heading"><span>${rows.length}개 중 ${selected.length}개 선택</span><md-text-button data-print-action="toggle-all">${selected.length === rows.length && rows.length ? "모두 해제" : "모두 선택"}</md-text-button></div>
              <div class="pincon-print-item-list">${rows.length ? rows.map((item) => this.itemSelector(item)).join("") : '<div class="pincon-print-empty"><md-icon>inbox</md-icon><strong>인쇄할 항목이 없습니다</strong><span>PinCon에 일정이나 공지를 등록하면 여기에 자동으로 나타납니다.</span></div>'}</div>
            </section>
            <section>
              <h2>종이와 카드</h2>
              <div class="pincon-print-setting-grid">
                <md-outlined-select data-print-setting="paper" label="용지" value="${attr(this.settings.paper)}">
                  <md-select-option value="a4" ${this.settings.paper === "a4" ? "selected" : ""}><span slot="headline">A4</span></md-select-option>
                  <md-select-option value="a5" ${this.settings.paper === "a5" ? "selected" : ""}><span slot="headline">A5</span></md-select-option>
                </md-outlined-select>
                <md-outlined-select data-print-setting="cardsPerPage" label="한 장당 카드" value="${this.settings.cardsPerPage}">
                  <md-select-option value="2" ${this.settings.cardsPerPage === 2 ? "selected" : ""}><span slot="headline">2장</span></md-select-option>
                  <md-select-option value="4" ${this.settings.cardsPerPage === 4 ? "selected" : ""}><span slot="headline">4장</span></md-select-option>
                  <md-select-option value="8" ${this.settings.cardsPerPage === 8 ? "selected" : ""}><span slot="headline">8장</span></md-select-option>
                </md-outlined-select>
                <md-outlined-select data-print-setting="detail" label="설명" value="${attr(this.settings.detail)}">
                  <md-select-option value="short" ${this.settings.detail === "short" ? "selected" : ""}><span slot="headline">짧게</span></md-select-option>
                  <md-select-option value="full" ${this.settings.detail === "full" ? "selected" : ""}><span slot="headline">자세히</span></md-select-option>
                </md-outlined-select>
              </div>
              <label class="pincon-print-check"><md-checkbox data-print-setting="qr" ${this.settings.qr ? "checked" : ""}></md-checkbox><span><strong>QR 표시</strong><small>온라인일 때 PinCon 연결 QR을 함께 인쇄합니다.</small></span></label>
              <label class="pincon-print-check"><md-checkbox data-print-setting="monochrome" ${this.settings.monochrome ? "checked" : ""}></md-checkbox><span><strong>흑백 인쇄 모드</strong><small>학교 프린터 토너를 덜 괴롭히는 버전입니다.</small></span></label>
            </section>
          </aside>
          <main class="pincon-print-preview ${this.settings.monochrome ? "is-monochrome" : ""}">
            <div class="pincon-print-preview-heading"><div><p>미리보기</p><h2>${esc(classLabel)} 자동 인쇄 카드</h2></div><span>${selected.length}장</span></div>
            ${this.sheetMarkup(selected, classLabel)}
          </main>
        </div>
      </div>`;
  }

  itemSelector(item) {
    const checked = this.selected.has(item.__printKey);
    const type = item.__printType || "notice";
    return `<label class="pincon-print-item"><md-checkbox data-print-item="${attr(item.__printKey)}" ${checked ? "checked" : ""}></md-checkbox><md-icon>${TYPE_ICONS[type] || "info"}</md-icon><span><strong>${esc(item.title || item.name || "학급 안내")}</strong><small>${esc(`${TYPE_LABELS[type] || "안내"} · ${dateLabel(item)}`)}</small></span></label>`;
  }

  sheetMarkup(items, classLabel) {
    if (!items.length) {
      return '<div class="pincon-print-preview-empty"><md-icon>print_disabled</md-icon><strong>카드를 선택하세요</strong><span>왼쪽에서 인쇄할 항목을 고르면 실제 종이 배치를 바로 확인할 수 있습니다.</span></div>';
    }
    const count = Number(this.settings.cardsPerPage) || 8;
    const pages = [];
    for (let i = 0; i < items.length; i += count) pages.push(items.slice(i, i + count));
    return `<div class="pincon-print-sheet" data-paper="${attr(this.settings.paper)}" data-cards="${count}">${pages.map((page, pageIndex) => `<section class="pincon-print-page" data-page="${pageIndex + 1}">${page.map((item) => this.cardMarkup(item, classLabel)).join("")}</section>`).join("")}</div>`;
  }

  cardMarkup(item, classLabel) {
    const type = item.__printType || "notice";
    const link = pageUrlFor(item);
    const body = bodyText(item, this.settings.detail);
    const metaParts = [dateLabel(item)];
    if (item.subject) metaParts.push(item.subject);
    if (item.location) metaParts.push(item.location);
    return `<article class="pincon-print-card" data-type="${attr(type)}">
      <div class="pincon-print-card-main">
        <div class="pincon-print-card-topline"><span class="pincon-print-kind"><md-icon>${TYPE_ICONS[type] || "info"}</md-icon>${esc(TYPE_LABELS[type] || "안내")}</span><span class="pincon-print-class">${esc(classLabel)}</span></div>
        <h3>${esc(item.title || item.name || "학급 안내")}</h3>
        <p class="pincon-print-meta">${esc(metaParts.filter(Boolean).join(" · "))}</p>
        ${body ? `<p class="pincon-print-body">${esc(body)}</p>` : ""}
        <div class="pincon-print-footer"><span><strong>PinCon</strong><small>학교에서 발견하고, PinCon에서 이어갑니다.</small></span>${this.settings.qr ? `<div class="pincon-print-qr"><img src="${attr(qrImageUrl(link))}" alt="PinCon QR" referrerpolicy="no-referrer"><small>자세히 보기</small></div>` : ""}</div>
      </div>
    </article>`;
  }

  onDocumentClick(event) {
    const path = event.composedPath?.() || [];
    const openButton = path.find((node) => node?.dataset?.pinconPrintOpen !== undefined);
    if (openButton) {
      event.preventDefault();
      return this.open();
    }
    const target = path.find((node) => node?.dataset?.printAction) || event.target?.closest?.("[data-print-action]");
    if (!target) return;
    const action = target.dataset.printAction;
    if (action === "close") return this.close();
    if (action === "print") return this.print();
    if (action === "toggle-all") {
      const rows = this.presetItems();
      const allSelected = rows.length && rows.every((item) => this.selected.has(item.__printKey));
      this.selected = allSelected ? new Set() : new Set(rows.map((item) => item.__printKey));
      return this.render();
    }
  }

  onDocumentChange(event) {
    if (!this.opened || !this.overlay?.contains(event.target)) return;
    const target = event.target;
    if (target.dataset?.printItem) {
      if (target.checked) this.selected.add(target.dataset.printItem);
      else this.selected.delete(target.dataset.printItem);
      return this.render();
    }
    const setting = target.dataset?.printSetting;
    if (!setting) return;
    if (setting === "qr" || setting === "monochrome") this.settings[setting] = Boolean(target.checked);
    else if (setting === "cardsPerPage") this.settings.cardsPerPage = Number(target.value || 8);
    else this.settings[setting] = target.value;
    if (setting === "preset") this.resetSelection();
    this.render();
  }

  applyPageStyle() {
    this.pageStyle?.remove?.();
    this.pageStyle = document.createElement("style");
    this.pageStyle.dataset.pinconPrintPage = "";
    this.pageStyle.textContent = `@page { size: ${this.settings.paper === "a5" ? "A5" : "A4"} portrait; margin: 0; }`;
    document.head.appendChild(this.pageStyle);
  }

  print() {
    if (!this.selectedItems().length) return;
    this.applyPageStyle();
    document.body.classList.add("pincon-printing");
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }

  finishPrint() {
    document.body.classList.remove("pincon-printing");
    this.pageStyle?.remove?.();
    this.pageStyle = null;
  }
}

const repository = globalThis.PINCON_CLASS_OPS?.repository;
if (repository) {
  new PinconPrintCenter(repository).init();
} else {
  window.addEventListener("load", () => {
    const delayedRepository = globalThis.PINCON_CLASS_OPS?.repository;
    if (delayedRepository) new PinconPrintCenter(delayedRepository).init();
  }, { once: true });
}
