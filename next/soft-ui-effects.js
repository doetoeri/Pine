const DEFAULT_EFFECTS = Object.freeze({ shadow: 24, light: 100 });
const STORAGE_KEY = "pincon-soft-effects-v1";
const state = { ...DEFAULT_EFFECTS, ...readStored() };
let opener = null;
let observer = null;

function clamp(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

function readStored() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return {};
    const out = {};
    if (Number.isFinite(Number(parsed.shadow))) out.shadow = clamp(parsed.shadow);
    if (Number.isFinite(Number(parsed.light))) out.light = clamp(parsed.light);
    return out;
  } catch {
    return {};
  }
}

function store() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

function applyEffects() {
  const shadow = Math.pow(state.shadow / 100, .92);
  const light = Math.pow(state.light / 100, .90);
  const style = document.documentElement.style;
  style.setProperty("--fx-shadow-near", (shadow * .085).toFixed(4));
  style.setProperty("--fx-shadow-far", (shadow * .070).toFixed(4));
  style.setProperty("--fx-shadow-dock", (shadow * .135).toFixed(4));
  style.setProperty("--fx-shadow-pressed", (shadow * .087).toFixed(4));
  style.setProperty("--fx-light-bright", (light * .190).toFixed(4));
  style.setProperty("--fx-light-soft", (light * .0684).toFixed(4));
  style.setProperty("--fx-light-tint", (light * .012).toFixed(4));
  style.setProperty("--fx-light-rim", (light * .034).toFixed(4));

  document.querySelectorAll("[data-pincon-effect]").forEach((input) => {
    const key = input.dataset.pinconEffect;
    const value = state[key];
    input.value = String(value);
    input.setAttribute("aria-valuetext", `${value}퍼센트`);
    input.style.setProperty("--range-fill", `${value}%`);
  });
  document.querySelectorAll("[data-pincon-effect-output]").forEach((output) => {
    output.textContent = `${state[output.dataset.pinconEffectOutput]}%`;
  });
}

function controls(scope) {
  return `<div class="pincon-effect-list">
    ${[
      ["shadow", "그림자", "오른쪽 아래로 부드럽게 퍼지는 깊이"],
      ["light", "광원", "왼쪽 위에서 번지는 부드러운 빛"]
    ].map(([key, label, hint]) => `<div class="pincon-effect-control">
      <div class="pincon-effect-label">
        <label for="pincon-effect-${scope}-${key}">${label}</label>
        <output for="pincon-effect-${scope}-${key}" data-pincon-effect-output="${key}">${state[key]}%</output>
      </div>
      <input class="pincon-effect-range" id="pincon-effect-${scope}-${key}" type="range" min="0" max="100" step="1" value="${state[key]}" data-pincon-effect="${key}" aria-valuetext="${state[key]}퍼센트" aria-describedby="pincon-effect-${scope}-${key}-hint">
      <div class="pincon-effect-scale"><span>없음</span><span>강하게</span></div>
      <span class="sr-only" id="pincon-effect-${scope}-${key}-hint">${hint}</span>
    </div>`).join("")}
  </div>
  <div class="pincon-effect-actions">
    <button class="pincon-effect-action" type="button" data-pincon-effects-action="off">효과 끄기</button>
    <button class="pincon-effect-action" type="button" data-pincon-effects-action="reset">기본값으로</button>
  </div>`;
}

function ensurePanel() {
  let panel = document.getElementById("pinconEffectsPanel");
  if (panel) return panel;
  panel = document.createElement("section");
  panel.id = "pinconEffectsPanel";
  panel.className = "pincon-effects-panel";
  panel.hidden = true;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-labelledby", "pinconEffectsTitle");
  panel.innerHTML = `<div class="pincon-effects-head">
    <h2 id="pinconEffectsTitle">화면 효과</h2>
    <button class="pincon-effects-close" type="button" data-pincon-effects-action="close" aria-label="화면 효과 닫기"><span class="material-symbols-rounded" aria-hidden="true">close</span></button>
  </div>
  <p class="pincon-effects-note">기본 광원은 100%, 그림자는 24%예요. 화면을 보며 필요한 만큼만 조절해요.</p>
  ${controls("panel")}`;
  document.body.append(panel);
  return panel;
}

function ensureToggle() {
  const actions = document.querySelector(".topbar__actions");
  if (!actions || actions.querySelector("#pinconEffectsToggle")) return;
  const button = document.createElement("md-icon-button");
  button.id = "pinconEffectsToggle";
  button.setAttribute("aria-label", "화면 효과 조절");
  button.setAttribute("aria-controls", "pinconEffectsPanel");
  button.setAttribute("aria-expanded", "false");
  button.innerHTML = `<md-icon>tune</md-icon>`;
  const search = actions.querySelector("#openSearch");
  actions.insertBefore(button, search || actions.firstChild);
}

function ensureSettingsCard() {
  const main = document.getElementById("mainContent");
  if (!main) return;
  const isMore = location.hash.replace(/^#/, "").split("/")[0] === "more";
  const old = main.querySelector(".pincon-effects-settings");
  if (!isMore) {
    old?.remove();
    return;
  }
  if (old) return;
  const card = document.createElement("section");
  card.className = "pincon-effects-settings";
  card.setAttribute("aria-labelledby", "pinconEffectsSettingsTitle");
  card.innerHTML = `<h2 id="pinconEffectsSettingsTitle">그림자와 광원</h2>
    <p class="pincon-effects-note">광원 100%를 기본으로 두고, 그림자와 빛의 강도를 바로 조절할 수 있어요.</p>
    ${controls("settings")}`;
  const page = main.querySelector(".view-enter") || main;
  const head = page.querySelector(".page-head");
  if (head?.nextSibling) page.insertBefore(card, head.nextSibling);
  else page.prepend(card);
}

function syncMounts() {
  ensurePanel();
  ensureToggle();
  ensureSettingsCard();
  applyEffects();
}

function setOpen(open, returnFocus = true) {
  const panel = ensurePanel();
  const toggle = document.getElementById("pinconEffectsToggle");
  const wasOpen = !panel.hidden;
  if (open && !wasOpen) opener = document.activeElement;
  panel.hidden = !open;
  toggle?.setAttribute("aria-expanded", String(open));
  if (open && !wasOpen) panel.querySelector("input[type=range]")?.focus({ preventScroll: true });
  if (!open && wasOpen && returnFocus && opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
}

function setEffect(key, value) {
  if (!(key in state)) return;
  state[key] = clamp(value);
  store();
  applyEffects();
}

function resetEffects() {
  state.shadow = DEFAULT_EFFECTS.shadow;
  state.light = DEFAULT_EFFECTS.light;
  store();
  applyEffects();
}

function offEffects() {
  state.shadow = 0;
  state.light = 0;
  store();
  applyEffects();
}

applyEffects();

window.addEventListener("DOMContentLoaded", () => {
  syncMounts();
  observer = new MutationObserver(() => requestAnimationFrame(syncMounts));
  observer.observe(document.getElementById("app") || document.body, { childList: true, subtree: true });
});

window.addEventListener("hashchange", () => requestAnimationFrame(syncMounts));
window.addEventListener("popstate", () => requestAnimationFrame(syncMounts));

document.addEventListener("input", (event) => {
  const input = event.target.closest?.("[data-pincon-effect]");
  if (input) setEffect(input.dataset.pinconEffect, input.value);
});

document.addEventListener("click", (event) => {
  const toggle = event.target.closest?.("#pinconEffectsToggle");
  if (toggle) {
    const panel = ensurePanel();
    setOpen(panel.hidden);
    return;
  }
  const action = event.target.closest?.("[data-pincon-effects-action]")?.dataset.pinconEffectsAction;
  if (action === "close") setOpen(false);
  if (action === "reset") resetEffects();
  if (action === "off") offEffects();
});

document.addEventListener("pointerdown", (event) => {
  const panel = document.getElementById("pinconEffectsPanel");
  if (!panel || panel.hidden) return;
  if (panel.contains(event.target) || event.target.closest?.("#pinconEffectsToggle")) return;
  setOpen(false, false);
});

document.addEventListener("keydown", (event) => {
  const panel = document.getElementById("pinconEffectsPanel");
  if (event.key === "Escape" && panel && !panel.hidden) {
    event.preventDefault();
    setOpen(false);
  }
});
