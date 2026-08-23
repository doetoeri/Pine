const CLASSIC_RETURN_VERSION = "20260823-smooth3";
let userOpenedOps = new URL(location.href).searchParams.get("class-ops") === "1";
let scheduled = false;
let closing = false;
let transition = null;

function shell() {
  return document.querySelector(".pincon-ops-shell");
}

function reducedMotion() {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
}

function cleanOpsUrl() {
  const url = new URL(location.href);
  url.searchParams.delete("class-ops");
  url.searchParams.delete("class-tab");
  history.replaceState(history.state, "", url);
}

function removeLegacyLaunchCards() {
  document.querySelectorAll(".pincon-classic-launch-card,.pincon-ops-launch-card").forEach((card) => card.remove());
}

function syncTriggerState(trigger = document.querySelector(".pincon-class-ops-trigger")) {
  if (!trigger) return;
  const icon = trigger.querySelector("md-icon");
  trigger.dataset.state = userOpenedOps ? "open" : "home";
  trigger.setAttribute("aria-expanded", userOpenedOps ? "true" : "false");
  trigger.setAttribute("aria-label", userOpenedOps ? "PinCon 학급운영 닫기" : "PinCon 학급운영 열기");
  trigger.title = userOpenedOps ? "학급운영 닫기" : "PinCon 학급운영";
  if (icon) icon.textContent = userOpenedOps ? "close" : "add";
}

function ensureDockTrigger() {
  const app = document.querySelector(".app-shell:not(.onboarding-shell)");
  let trigger = document.querySelector(".pincon-class-ops-trigger");

  if (!app) {
    trigger?.remove();
    return null;
  }

  if (!trigger) {
    trigger = document.createElement("md-filled-tonal-icon-button");
    trigger.className = "pincon-class-ops-trigger";
    trigger.setAttribute("data-pincon-dock-toggle", "");
    trigger.setAttribute("aria-controls", "pincon-class-ops-sheet");
    trigger.innerHTML = "<md-icon>add</md-icon>";
    document.body.appendChild(trigger);
  }

  syncTriggerState(trigger);
  return trigger;
}

function markHome() {
  if (userOpenedOps) return;
  document.body.classList.add("pincon-classic-home");
  document.body.classList.remove("pincon-classic-ops-open", "pincon-ops-open", "pincon-unified-ready");

  const host = shell();
  if (host) {
    host.id = "pincon-class-ops-sheet";
    host.style.removeProperty("opacity");
    host.style.removeProperty("transform");
    host.style.removeProperty("pointer-events");
  }

  removeLegacyLaunchCards();
  ensureDockTrigger();
  cleanOpsUrl();
}

function prepareOpsShell() {
  const host = shell();
  if (!host) return null;
  host.id = "pincon-class-ops-sheet";
  host.dataset.open = "true";
  host.setAttribute("aria-hidden", "false");
  return host;
}

function syncOpsHeader() {
  if (!userOpenedOps) return;
  const topbar = document.querySelector(".pincon-ops-shell .pincon-ops-topbar");
  if (!topbar) return;

  topbar.querySelectorAll(".pincon-classic-back").forEach((button) => button.remove());
  const brand = topbar.querySelector(".pincon-ops-mobile-brand");
  if (brand) {
    const strong = brand.querySelector("strong");
    if (strong) strong.textContent = "PinCon 학급운영";
  }
}

async function animateSheet(host, opening) {
  if (!host) return;

  transition?.cancel?.();
  transition = null;

  if (reducedMotion() || typeof host.animate !== "function") {
    host.style.removeProperty("opacity");
    host.style.removeProperty("transform");
    return;
  }

  const frames = opening
    ? [
        { opacity: 0, transform: "translateY(22px)" },
        { opacity: 1, transform: "translateY(0)" },
      ]
    : [
        { opacity: 1, transform: "translateY(0)" },
        { opacity: 0, transform: "translateY(16px)" },
      ];

  try {
    transition = host.animate(frames, {
      duration: opening ? 240 : 170,
      easing: opening ? "cubic-bezier(.2, .8, .2, 1)" : "cubic-bezier(.4, 0, 1, 1)",
      fill: "both",
    });
    await transition.finished;
  } catch {
    // A newer open/close action superseded this one.
  } finally {
    transition?.cancel?.();
    transition = null;
    if (opening) {
      host.style.removeProperty("opacity");
      host.style.removeProperty("transform");
    }
  }
}

async function openOps(tab = "today") {
  if (userOpenedOps || closing) return;

  const trigger = ensureDockTrigger();
  userOpenedOps = true;
  syncTriggerState(trigger);

  const host = prepareOpsShell();
  if (host) {
    host.style.opacity = "0";
    host.style.transform = "translateY(22px)";
    host.style.pointerEvents = "none";
  }

  document.body.classList.remove("pincon-classic-home");
  document.body.classList.add("pincon-classic-ops-open", "pincon-ops-open", "pincon-unified-ready");

  const url = new URL(location.href);
  url.searchParams.set("class-ops", "1");
  if (!url.searchParams.get("class-tab")) url.searchParams.set("class-tab", tab);
  history.replaceState(history.state, "", url);

  syncOpsHeader();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  if (host) {
    host.style.pointerEvents = "auto";
    await animateSheet(host, true);
  }
  requestAnimationFrame(() => document.querySelector(".pincon-ops-main")?.focus?.());
}

async function closeOps() {
  if (!userOpenedOps || closing) return;
  closing = true;

  const host = shell();
  if (host) {
    host.style.pointerEvents = "none";
    await animateSheet(host, false);
  }

  userOpenedOps = false;
  document.body.classList.add("pincon-classic-home");
  document.body.classList.remove("pincon-classic-ops-open", "pincon-ops-open", "pincon-unified-ready");

  if (host) {
    host.dataset.open = "false";
    host.setAttribute("aria-hidden", "true");
    host.style.removeProperty("opacity");
    host.style.removeProperty("transform");
    host.style.removeProperty("pointer-events");
  }

  cleanOpsUrl();
  removeLegacyLaunchCards();
  syncTriggerState();
  ensureDockTrigger();
  closing = false;
}

function repair() {
  scheduled = false;
  removeLegacyLaunchCards();
  ensureDockTrigger();

  if (userOpenedOps) {
    if (!document.body.classList.contains("pincon-classic-ops-open")) {
      document.body.classList.remove("pincon-classic-home");
      document.body.classList.add("pincon-classic-ops-open", "pincon-ops-open", "pincon-unified-ready");
    }
    prepareOpsShell();
    syncOpsHeader();
  } else {
    /* The class-ops data runtime may mark itself open after a refresh. Keep that
       state invisible and clear its URL flags without observing class changes. */
    markHome();
  }
}

function scheduleRepair() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(repair);
}

function start() {
  if (!userOpenedOps) document.body.classList.add("pincon-classic-home");
  else document.body.classList.add("pincon-classic-ops-open", "pincon-ops-open", "pincon-unified-ready");

  document.addEventListener("click", (event) => {
    const path = event.composedPath?.() || [];
    const dockToggle = path.find((node) => node?.dataset?.pinconDockToggle !== undefined);
    if (dockToggle) {
      event.preventDefault();
      event.stopPropagation();
      (userOpenedOps ? closeOps() : openOps()).catch(() => {});
      return;
    }

    const legacyOpen = path.find((node) => node?.dataset?.pinconClassicOpen !== undefined || node?.dataset?.pinconOpsOpen !== undefined);
    if (legacyOpen) {
      event.preventDefault();
      openOps().catch(() => {});
      return;
    }

    const legacyClose = path.find((node) => node?.dataset?.pinconClassicClose !== undefined);
    if (legacyClose) {
      event.preventDefault();
      event.stopPropagation();
      closeOps().catch(() => {});
    }
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && userOpenedOps) {
      event.preventDefault();
      closeOps().catch(() => {});
    }
  });

  /* Only watch structural rerenders. Watching body classes/data-open created a
     feedback loop with the class-ops runtime and was the source of visible flicker. */
  const observer = new MutationObserver(scheduleRepair);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("pageshow", scheduleRepair, { passive: true });
  scheduleRepair();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}

globalThis.PINCON_CLASSIC_RETURN_VERSION = CLASSIC_RETURN_VERSION;