await globalThis.PINCON_MATERIAL_READY;

const STORAGE_KEY = "pincon-design-system-v1";
const DEFAULT_MODE = "material-expressive";
const LAB_MODE = "material-expressive-lab";
const MODES = Object.freeze({
  "material-expressive": {
    label: "Material You Expressive",
    badge: "기본",
    source: "Google @material/web 2.4.1",
    note: "PinCon의 기본 화면입니다. 공식 Material Web 컴포넌트와 안정적인 정보 계층, 넉넉한 형태, 절제된 Expressive 모션을 사용합니다.",
  },
  [LAB_MODE]: {
    label: "Material Expressive Lab",
    badge: "BETA",
    source: "Google @material/web 2.4.1 + PinCon Lab layout",
    note: "기존 화면을 단순히 크게 만드는 대신, 지금 필요한 정보 하나를 중심으로 화면 구조가 바뀌는 상황 중심 실험 모드입니다.",
  },
});

let renderQueued = false;

function normalizeMode(value) {
  if (value === "material-expressive-beta") return LAB_MODE;
  return MODES[value] ? value : DEFAULT_MODE;
}

function storedMode() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const mode = normalizeMode(raw);
    if (raw !== mode) localStorage.setItem(STORAGE_KEY, mode);
    return mode;
  } catch {
    return DEFAULT_MODE;
  }
}

function updateThemeMeta(mode) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", mode === LAB_MODE ? "#EEF8E9" : "#F7FBF3");
}

function commitMode(mode, persist) {
  const next = normalizeMode(mode);
  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, next); } catch {}
  }
  document.documentElement.dataset.pinconDesign = next;
  document.body?.classList.toggle("pincon-expressive-lab", next === LAB_MODE);
  updateThemeMeta(next);
  syncCard();
  window.dispatchEvent(new CustomEvent("pincon-design-system-change", {
    detail: { theme: next, family: "material-expressive", lab: next === LAB_MODE },
  }));
}

function applyMode(mode, { persist = true } = {}) {
  const next = normalizeMode(mode);
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (!reduced && document.startViewTransition && document.documentElement.dataset.pinconDesign !== next) {
    document.startViewTransition(() => commitMode(next, persist));
    return;
  }
  commitMode(next, persist);
}

function optionMarkup(value, config, selected) {
  return `<md-select-option value="${value}" ${selected ? "selected" : ""}><div slot="headline">${config.label}${config.badge === "BETA" ? " · β" : ""}</div></md-select-option>`;
}

function selectorMarkup(mode) {
  return `<md-outlined-select label="Material 스타일" data-pincon-design-select>${Object.entries(MODES).map(([value, config]) => optionMarkup(value, config, value === mode)).join("")}</md-outlined-select>`;
}

function cardMarkup(mode) {
  const current = MODES[mode];
  const isLab = mode === LAB_MODE;
  return `<div class="section-heading">
      <div><p class="md-typescale-label-large">화면 스타일</p><h2 class="md-typescale-headline-small">Material You Expressive</h2></div>
      <md-assist-chip label="${current.badge}"></md-assist-chip>
    </div>
    <md-list>
      <md-list-item>
        <md-icon slot="start">palette</md-icon>
        <div slot="headline">Expressive 모드</div>
        <div slot="supporting-text">기본은 안정적으로, Lab은 상황 중심 레이아웃과 의미 있는 모션을 더 강하게 사용합니다.</div>
      </md-list-item>
      <md-list-item>
        <div slot="headline" class="pincon-design-system-select-wrap">${selectorMarkup(mode)}</div>
        <div slot="supporting-text" class="pincon-design-system-note">${current.note}</div>
      </md-list-item>
      ${isLab ? `<md-list-item><md-icon slot="start">science</md-icon><div slot="headline">Lab 기능</div><div slot="supporting-text">지금 엔진 · 변경 타임라인 · 7일 학업 부하 · 스마트 브리핑 · 통합 검색</div></md-list-item>` : ""}
      <md-list-item><div slot="headline">컴포넌트 소스</div><div slot="supporting-text">${current.source}</div></md-list-item>
    </md-list>`;
}

function attachSelectHandler(host) {
  const select = host?.querySelector("[data-pincon-design-select]");
  if (!select || select.dataset.pinconBound === "1") return;
  select.dataset.pinconBound = "1";
  select.addEventListener("change", () => applyMode(select.value));
}

function syncCard() {
  const card = document.querySelector(".pincon-design-system-card");
  if (!card) return;
  const mode = storedMode();
  if (card.dataset.mode !== mode || !card.querySelector("[data-pincon-design-select]")) {
    card.dataset.mode = mode;
    card.innerHTML = cardMarkup(mode);
  }
  attachSelectHandler(card);
}

function findSettingsHost() {
  const grid = document.querySelector(".settings-grid");
  if (grid) return grid;
  const moreTitle = document.getElementById("more-title");
  const view = moreTitle?.closest(".view-layout") || moreTitle?.parentElement?.parentElement;
  if (!view) return null;
  let fallback = view.querySelector(":scope > .pincon-design-system-fallback-host");
  if (!fallback) {
    fallback = document.createElement("div");
    fallback.className = "pincon-design-system-fallback-host";
    const heading = moreTitle.closest(".page-heading");
    if (heading?.parentElement === view) heading.insertAdjacentElement("afterend", fallback);
    else view.prepend(fallback);
  }
  return fallback;
}

function ensureCard() {
  const host = findSettingsHost();
  if (!host) return false;
  let card = document.querySelector(".pincon-design-system-card");
  if (!card) {
    card = document.createElement("section");
    card.className = "content-section pincon-design-system-card";
    card.setAttribute("aria-label", "Material You Expressive 화면 스타일");
  }
  if (card.parentElement !== host) host.prepend(card);
  syncCard();
  return true;
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    ensureCard();
  });
}

const initialMode = storedMode();
document.documentElement.dataset.pinconDesign = initialMode;
updateThemeMeta(initialMode);
if (document.body) document.body.classList.toggle("pincon-expressive-lab", initialMode === LAB_MODE);
else window.addEventListener("DOMContentLoaded", () => document.body.classList.toggle("pincon-expressive-lab", initialMode === LAB_MODE), { once: true });

const root = document.getElementById("root");
if (root) new MutationObserver(scheduleRender).observe(root, { childList: true, subtree: true });
window.addEventListener("pageshow", scheduleRender, { passive: true });
window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY) applyMode(storedMode(), { persist: false });
});
scheduleRender();

globalThis.PINCON_EXPRESSIVE_MODE = Object.freeze({
  current: storedMode,
  apply: applyMode,
  lab: LAB_MODE,
});
