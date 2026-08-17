await globalThis.PINCON_MATERIAL_READY;

const STORAGE_KEY = "pincon-design-system-v1";
const DEFAULT_MODE = "material-expressive";
const MODES = Object.freeze({
  "material-expressive": {
    label: "Material You Expressive",
    badge: "기본",
    source: "Google @material/web 2.4.1",
    note: "PinCon의 기본 화면입니다. 공식 Material Web 컴포넌트를 중심으로 넉넉한 형태, 명확한 계층, 부드러운 Expressive 모션을 적용합니다.",
  },
  "material-expressive-beta": {
    label: "Material You Expressive · Bold β",
    badge: "BETA",
    source: "Google @material/web 2.4.1 + PinCon Expressive layout beta",
    note: "같은 공식 Material Web 컴포넌트를 사용하되, 더 큰 타이포그래피·비대칭 7:5 그리드·큰 형태 변화·스프링 모션을 과감하게 적용하는 실험 모드입니다.",
  },
});

let renderQueued = false;

function normalizeMode(value) {
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
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  meta.setAttribute("content", mode === "material-expressive-beta" ? "#EEF8E9" : "#F7FBF3");
}

function commitMode(mode, persist) {
  const next = normalizeMode(mode);
  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, next); } catch {}
  }
  document.documentElement.dataset.pinconDesign = next;
  updateThemeMeta(next);
  syncCard();
  syncDialog();
  window.dispatchEvent(new CustomEvent("pincon-design-system-change", { detail: { theme: next, family: "material-expressive" } }));
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
  return `<md-select-option value="${value}" ${selected ? "selected" : ""}><div slot="headline">${config.label}</div></md-select-option>`;
}

function selectorMarkup(mode, context) {
  return `<md-outlined-select label="Expressive 강도" data-pincon-design-select="${context}">${Object.entries(MODES).map(([value, config]) => optionMarkup(value, config, value === mode)).join("")}</md-outlined-select>`;
}

function previewMarkup(mode) {
  if (mode === "material-expressive-beta") {
    return `<md-filled-button type="button"><md-icon slot="icon">animation</md-icon>Bold Expressive β</md-filled-button><md-filled-tonal-button type="button"><md-icon slot="icon">dashboard_customize</md-icon>과감한 레이아웃</md-filled-tonal-button><md-assist-chip label="공식 Material Web"></md-assist-chip>`;
  }
  return `<md-filled-button type="button"><md-icon slot="icon">palette</md-icon>Material Expressive</md-filled-button><md-assist-chip label="공식 @material/web 2.4.1"></md-assist-chip>`;
}

function cardMarkup(mode) {
  const current = MODES[mode];
  return `<div class="section-heading"><div><p class="md-typescale-label-large">Google Material</p><h2 class="md-typescale-headline-small">Material You Expressive</h2></div><md-assist-chip label="${current.badge}"></md-assist-chip></div>
    <md-list>
      <md-list-item><md-icon slot="start">palette</md-icon><div slot="headline">Expressive 스타일</div><div slot="supporting-text">다른 디자인 시스템은 제거했습니다. 기본과 과감한 베타 두 가지 Material Expressive만 사용합니다.</div></md-list-item>
      <md-list-item><div slot="headline" class="pincon-design-system-select-wrap">${selectorMarkup(mode, "card")}</div><div slot="supporting-text" class="pincon-design-system-note">${current.note}</div></md-list-item>
      <md-list-item><div slot="headline">컴포넌트 소스</div><div slot="supporting-text">${current.source}</div></md-list-item>
      <md-list-item><div slot="headline" class="pincon-design-system-preview">${previewMarkup(mode)}</div></md-list-item>
    </md-list>`;
}

function attachSelectHandler(host) {
  host?.querySelectorAll("[data-pincon-design-select]").forEach((select) => {
    if (select.dataset.pinconBound === "1") return;
    select.dataset.pinconBound = "1";
    select.addEventListener("change", () => applyMode(select.value));
  });
}

function syncCard() {
  const card = document.querySelector(".pincon-design-system-card");
  if (!card) return;
  const mode = storedMode();
  if (card.dataset.theme !== mode || !card.querySelector("[data-pincon-design-select]")) {
    card.dataset.theme = mode;
    card.innerHTML = cardMarkup(mode);
  }
  attachSelectHandler(card);
}

function findSettingsHost() {
  const grid = document.querySelector(".settings-grid");
  if (grid) return { host: grid, mode: "grid" };

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
  return { host: fallback, mode: "fallback" };
}

function ensureCard() {
  const target = findSettingsHost();
  if (!target) return false;

  let card = document.querySelector(".pincon-design-system-card");
  if (!card) {
    card = document.createElement("section");
    card.className = "content-section pincon-design-system-card";
    card.setAttribute("aria-label", "Material You Expressive 모드");
  }

  if (card.parentElement !== target.host) {
    if (target.mode === "grid") target.host.prepend(card);
    else target.host.appendChild(card);
  }
  syncCard();
  return true;
}

function ensureDialog() {
  let dialog = document.getElementById("pincon-design-system-dialog");
  if (dialog) return dialog;
  dialog = document.createElement("md-dialog");
  dialog.id = "pincon-design-system-dialog";
  dialog.setAttribute("aria-label", "Material You Expressive 모드 선택");
  document.body.appendChild(dialog);
  return dialog;
}

function syncDialog() {
  const dialog = document.getElementById("pincon-design-system-dialog");
  if (!dialog) return;
  const mode = storedMode();
  const current = MODES[mode];
  dialog.innerHTML = `<div slot="headline">Material You Expressive</div><div slot="content" class="pincon-theme-dialog-content">${selectorMarkup(mode, "dialog")}<p class="md-typescale-body-medium">${current.note}</p><md-list><md-list-item><md-icon slot="start">verified</md-icon><div slot="headline">Google Material 기반</div><div slot="supporting-text">${current.source}</div></md-list-item></md-list></div><div slot="actions"><md-filled-button type="button" data-pincon-theme-close>완료</md-filled-button></div>`;
  attachSelectHandler(dialog);
  dialog.querySelector("[data-pincon-theme-close]")?.addEventListener("click", () => { dialog.open = false; });
}

function ensureLauncher() {
  let launcher = document.querySelector(".pincon-theme-launcher");
  const inMore = Boolean(document.getElementById("more-title"));
  if (!launcher) {
    launcher = document.createElement("md-fab");
    launcher.className = "pincon-theme-launcher";
    launcher.setAttribute("variant", "tertiary");
    launcher.setAttribute("label", "Expressive");
    launcher.setAttribute("aria-label", "Material You Expressive 모드 바꾸기");
    launcher.innerHTML = '<md-icon slot="icon">animation</md-icon>';
    launcher.addEventListener("click", () => {
      const dialog = ensureDialog();
      syncDialog();
      dialog.open = true;
    });
    document.body.appendChild(launcher);
  }
  launcher.hidden = !inMore;
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    ensureCard();
    ensureLauncher();
  });
}

const initialMode = storedMode();
document.documentElement.dataset.pinconDesign = initialMode;
updateThemeMeta(initialMode);

const root = document.getElementById("root");
if (root) new MutationObserver(scheduleRender).observe(root, { childList: true, subtree: true });
window.addEventListener("pageshow", scheduleRender, { passive: true });
window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY) applyMode(storedMode(), { persist: false });
});
scheduleRender();
