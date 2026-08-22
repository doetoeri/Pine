const UI_STABILITY_VERSION = "20260823-1";
let scheduled = false;

function stripScale(transform) {
  if (typeof transform !== "string") return transform;
  const next = transform.replace(/\s*scale(?:3d|X|Y)?\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  return next || "none";
}

function sanitizeKeyframes(keyframes) {
  if (Array.isArray(keyframes)) {
    return keyframes.map((frame) => {
      if (!frame || typeof frame !== "object" || !("transform" in frame)) return frame;
      return { ...frame, transform: stripScale(frame.transform) };
    });
  }

  if (!keyframes || typeof keyframes !== "object") return keyframes;
  const next = { ...keyframes };
  if (Array.isArray(next.transform)) next.transform = next.transform.map(stripScale);
  else if (typeof next.transform === "string") next.transform = stripScale(next.transform);
  return next;
}

function stabilizeViewMotion(view) {
  if (!(view instanceof Element) || view.dataset.pinconStableMotion === UI_STABILITY_VERSION) return;
  view.dataset.pinconStableMotion = UI_STABILITY_VERSION;

  const nativeAnimate = Element.prototype.animate;
  if (typeof nativeAnimate !== "function") return;

  try {
    Object.defineProperty(view, "animate", {
      configurable: true,
      value(keyframes, options) {
        const safeFrames = sanitizeKeyframes(keyframes);
        const safeOptions = options && typeof options === "object"
          ? { ...options, duration: Math.min(Number(options.duration) || 140, 140) }
          : options;
        return nativeAnimate.call(this, safeFrames, safeOptions);
      },
    });
  } catch {}
}

function bindTabKeyboard(grid) {
  if (grid.dataset.pinconKeyboardBound === "1") return;
  grid.dataset.pinconKeyboardBound = "1";

  grid.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = [...grid.querySelectorAll("md-primary-tab[data-action=\"tab\"]")];
    if (!tabs.length) return;

    const current = tabs.indexOf(document.activeElement);
    let next = current >= 0 ? current : Math.max(0, tabs.findIndex((tab) => tab.hasAttribute("active")));
    if (event.key === "ArrowRight") next = (next + 1) % tabs.length;
    if (event.key === "ArrowLeft") next = (next - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;

    event.preventDefault();
    tabs[next]?.focus();
    tabs[next]?.click();
  });
}

function stabilizeNavigation(nav) {
  if (!(nav instanceof Element)) return;

  const existingGrid = nav.querySelector(":scope > .pincon-ops-tab-grid");
  if (existingGrid) {
    bindTabKeyboard(existingGrid);
    return;
  }

  const tabsHost = nav.querySelector(":scope > md-tabs");
  if (!tabsHost) return;

  const tabs = [...tabsHost.querySelectorAll(":scope > md-primary-tab")];
  if (!tabs.length) return;

  const grid = document.createElement("div");
  grid.className = "pincon-ops-tab-grid";
  grid.setAttribute("role", "tablist");
  grid.setAttribute("aria-label", nav.getAttribute("aria-label") || "PinCon 주요 메뉴");

  tabs.forEach((tab) => {
    const active = tab.hasAttribute("active");
    tab.setAttribute("aria-selected", active ? "true" : "false");
    tab.tabIndex = active ? 0 : -1;
    grid.append(tab);
  });

  tabsHost.replaceWith(grid);
  bindTabKeyboard(grid);
}

function stabilizeSyncState(root) {
  root.querySelectorAll(".pincon-ops-empty").forEach((empty) => {
    if (!empty.textContent?.includes("학급 정보를 연결하는 중입니다")) return;

    const state = document.createElement("section");
    state.className = "pincon-ops-sync-state";
    state.setAttribute("aria-live", "polite");
    state.innerHTML = `
      <div class="pincon-ops-sync-copy">
        <md-icon aria-hidden="true">sync</md-icon>
        <div>
          <strong>학급 정보를 연결하고 있습니다</strong>
          <span>시간표·식단·학급 기록을 최신 상태로 맞추는 중입니다.</span>
        </div>
      </div>
      <md-linear-progress indeterminate aria-label="학급 정보 동기화 중"></md-linear-progress>`;
    empty.replaceWith(state);
  });
}

function repair() {
  scheduled = false;
  document.querySelectorAll(".pincon-ops-navigation").forEach(stabilizeNavigation);
  document.querySelectorAll(".pincon-ops-view").forEach(stabilizeViewMotion);
  document.querySelectorAll(".pincon-ops-shell").forEach(stabilizeSyncState);
}

function scheduleRepair() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(repair);
}

function start() {
  scheduleRepair();
  const observer = new MutationObserver(scheduleRepair);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("pageshow", scheduleRepair, { passive: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}

globalThis.PINCON_UI_STABILITY_VERSION = UI_STABILITY_VERSION;
