await globalThis.PINCON_MATERIAL_READY;

const STORAGE_KEY = "pincon-design-system-v1";
const DEFAULT_THEME = "material-expressive";
const THEMES = Object.freeze({
  "material-expressive": {
    label: "Google Material 3 Expressive",
    source: "Google @material/web 2.4.1",
    note: "공식 Material Web 구성요소를 유지하고 Expressive 형태·모션·토큰을 적용합니다.",
  },
  "apple-ios27": {
    label: "Apple HIG · iOS 27",
    source: "Apple Human Interface Guidelines · iOS 27 Design Resources",
    note: "Apple은 웹용 런타임 컴포넌트 패키지를 제공하지 않으므로 가짜 Apple 위젯을 만들지 않고, HIG의 계층·재질·레이아웃 원칙만 앱 셸에 적용합니다.",
  },
  "fluent2": {
    label: "Microsoft Fluent 2",
    source: "@fluentui/web-components 3.0.2",
    note: "Microsoft 공식 Fluent UI Web Components와 공식 테마 토큰을 불러옵니다.",
  },
  "oneui9": {
    label: "Samsung One UI 9",
    source: "Samsung One UI Design Guideline",
    note: "Samsung은 일반 웹용 One UI 컴포넌트 패키지를 제공하지 않으므로 가짜 One UI 위젯을 만들지 않고, 공식 가이드의 구조·도달성·모션 원칙만 앱 셸에 적용합니다.",
  },
});

let fluentPromise = null;
let renderQueued = false;

function storedTheme() {
  const value = localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME;
  return THEMES[value] ? value : DEFAULT_THEME;
}

async function ensureFluent() {
  if (globalThis.PINCON_FLUENT) return globalThis.PINCON_FLUENT;
  if (!fluentPromise) {
    fluentPromise = import("./fluent-web.bundle.js?v=20260817-designsystems1")
      .then(async () => {
        await globalThis.PINCON_FLUENT_READY;
        return globalThis.PINCON_FLUENT;
      })
      .catch((error) => {
        fluentPromise = null;
        console.warn("[PinCon theme] Fluent bundle load failed", error);
        throw error;
      });
  }
  return fluentPromise;
}

function updateThemeMeta(theme) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const colors = {
    "material-expressive": "#F7FBF3",
    "apple-ios27": "#F2F2F7",
    "fluent2": "#F5F5F5",
    "oneui9": "#F7F7F7",
  };
  meta.setAttribute("content", colors[theme] || "#F7FBF3");
}

async function applyTheme(theme, { persist = true } = {}) {
  const next = THEMES[theme] ? theme : DEFAULT_THEME;
  if (persist) localStorage.setItem(STORAGE_KEY, next);
  document.documentElement.dataset.pinconDesign = next;
  updateThemeMeta(next);

  if (next === "fluent2") {
    try {
      const fluent = await ensureFluent();
      fluent?.setTheme?.(fluent.webLightTheme);
    } catch {}
  }

  syncCard();
  window.dispatchEvent(new CustomEvent("pincon-design-system-change", { detail: { theme: next } }));
}

function optionMarkup(value, config, selected) {
  return `<md-select-option value="${value}" ${selected ? "selected" : ""}>
    <div slot="headline">${config.label}</div>
  </md-select-option>`;
}

function previewMarkup(theme) {
  if (theme === "material-expressive") {
    return `<md-filled-button type="button"><md-icon slot="icon">palette</md-icon>Material 공식 버튼</md-filled-button>
      <md-assist-chip label="@material/web 2.4.1"></md-assist-chip>`;
  }
  if (theme === "fluent2") {
    return `<div data-fluent-preview><md-linear-progress indeterminate></md-linear-progress></div>`;
  }
  if (theme === "apple-ios27") {
    return `<md-assist-chip label="HIG 27 · 공식 웹 컴포넌트 없음"></md-assist-chip>`;
  }
  return `<md-assist-chip label="One UI 9 · 공식 웹 컴포넌트 없음"></md-assist-chip>`;
}

async function hydrateFluentPreview(card) {
  const host = card?.querySelector("[data-fluent-preview]");
  if (!host || storedTheme() !== "fluent2") return;
  try {
    await ensureFluent();
    await customElements.whenDefined("fluent-button");
    host.innerHTML = '<fluent-button appearance="accent">Fluent 2 공식 버튼</fluent-button>';
  } catch {
    host.innerHTML = '<md-assist-chip label="Fluent 로드 실패"></md-assist-chip>';
  }
}

function cardMarkup(theme) {
  const current = THEMES[theme];
  return `<md-list>
    <md-list-item>
      <md-icon slot="start">palette</md-icon>
      <div slot="headline">디자인 시스템</div>
      <div slot="supporting-text">공식 공개 구성요소와 각 디자인 시스템의 공식 가이드 범위 안에서 전환합니다.</div>
      <md-assist-chip slot="end" label="${current.label}"></md-assist-chip>
    </md-list-item>
    <md-list-item>
      <div slot="headline">
        <md-outlined-select label="테마" data-pincon-design-select>
          ${Object.entries(THEMES).map(([value, config]) => optionMarkup(value, config, value === theme)).join("")}
        </md-outlined-select>
      </div>
      <div slot="supporting-text" class="pincon-design-system-note">${current.note}</div>
    </md-list-item>
    <md-list-item>
      <div slot="headline">현재 소스</div>
      <div slot="supporting-text">${current.source}</div>
    </md-list-item>
    <md-list-item>
      <div slot="headline" class="pincon-design-system-preview">${previewMarkup(theme)}</div>
    </md-list-item>
  </md-list>`;
}

function syncCard() {
  const card = document.querySelector(".pincon-design-system-card");
  if (!card) return;
  const theme = storedTheme();
  if (card.dataset.theme === theme) return;
  card.dataset.theme = theme;
  card.innerHTML = cardMarkup(theme);
  const select = card.querySelector("[data-pincon-design-select]");
  select?.addEventListener("change", () => applyTheme(select.value));
  hydrateFluentPreview(card);
}

function ensureCard() {
  const grid = document.querySelector(".settings-grid");
  if (!grid) return;
  let card = grid.querySelector(".pincon-design-system-card");
  if (!card) {
    card = document.createElement("section");
    card.className = "pincon-design-system-card";
    card.setAttribute("aria-label", "디자인 시스템 테마");
    grid.prepend(card);
  }
  syncCard();
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    ensureCard();
  });
}

const initialTheme = storedTheme();
document.documentElement.dataset.pinconDesign = initialTheme;
updateThemeMeta(initialTheme);
if (initialTheme === "fluent2") ensureFluent().then((fluent) => fluent?.setTheme?.(fluent.webLightTheme)).catch(() => {});

const root = document.getElementById("root");
if (root) new MutationObserver(scheduleRender).observe(root, { childList: true, subtree: true });
window.addEventListener("pageshow", scheduleRender, { passive: true });
window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY) applyTheme(storedTheme(), { persist: false });
});
scheduleRender();
