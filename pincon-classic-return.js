const CLASSIC_RETURN_VERSION = "20260823-dock1";
let userOpenedOps = new URL(location.href).searchParams.get("class-ops") === "1";
let scheduled = false;
let closing = false;
let lastTriggerRect = null;

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
  if (icon) icon.textContent = userOpenedOps ? "close" : "groups";
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
    trigger.innerHTML = "<md-icon>groups</md-icon>";
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
    host.dataset.open = "false";
    host.setAttribute("aria-hidden", "true");
    host.id = "pincon-class-ops-sheet";
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

function animationOrigin(host) {
  const trigger = ensureDockTrigger();
  const triggerRect = lastTriggerRect || trigger?.getBoundingClientRect?.();
  const hostRect = host.getBoundingClientRect();
  if (!triggerRect || !hostRect.width || !hostRect.height) {
    return { x: hostRect.width - 34, y: hostRect.height - 34, radius: Math.hypot(hostRect.width, hostRect.height) + 48 };
  }

  const x = Math.min(hostRect.width, Math.max(0, triggerRect.left + triggerRect.width / 2 - hostRect.left));
  const y = Math.min(hostRect.height, Math.max(0, triggerRect.top + triggerRect.height / 2 - hostRect.top));
  const farX = Math.max(x, hostRect.width - x);
  const farY = Math.max(y, hostRect.height - y);
  return { x, y, radius: Math.hypot(farX, farY) + 56 };
}

async function animateSheet(host, opening) {
  if (!host || reducedMotion() || typeof host.animate !== "function") return;
  const { x, y, radius } = animationOrigin(host);
  const closedClip = `circle(0px at ${x}px ${y}px)`;
  const openClip = `circle(${Math.ceil(radius)}px at ${x}px ${y}px)`;
  const openingFrames = [
    { clipPath: closedClip, opacity: 0.72, transform: "translateY(18px)" },
    { clipPath: openClip, opacity: 1, transform: "translateY(0)" },
  ];
  const closingFrames = [
    { clipPath: openClip, opacity: 1, transform: "translateY(0)" },
    { clipPath: closedClip, opacity: 0.45, transform: "translateY(14px)" },
  ];

  try {
    const animation = host.animate(opening ? openingFrames : closingFrames, {
      duration: opening ? 380 : 250,
      easing: opening ? "cubic-bezier(.2, 0, 0, 1)" : "cubic-bezier(.4, 0, 1, 1)",
      fill: "both",
    });
    await animation.finished;
    animation.cancel();
  } catch {
    try {
      const fallback = host.animate(
        opening
          ? [{ opacity: 0, transform: "translateY(22px)" }, { opacity: 1, transform: "translateY(0)" }]
          : [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(16px)" }],
        { duration: opening ? 260 : 180, easing: "cubic-bezier(.2, 0, 0, 1)", fill: "both" },
      );
      await fallback.finished;
      fallback.cancel();
    } catch {}
  }
}

async function openOps(tab = "today") {
  if (userOpenedOps) return;
  const trigger = ensureDockTrigger();
  lastTriggerRect = trigger?.getBoundingClientRect?.() || null;
  userOpenedOps = true;
  syncTriggerState(trigger);

  document.body.classList.remove("pincon-classic-home");
  document.body.classList.add("pincon-classic-ops-open", "pincon-ops-open", "pincon-unified-ready");
  const host = prepareOpsShell();

  const url = new URL(location.href);
  url.searchParams.set("class-ops", "1");
  if (!url.searchParams.get("class-tab")) url.searchParams.set("class-tab", tab);
  history.replaceState(history.state, "", url);

  syncOpsHeader();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await animateSheet(host, true);
  requestAnimationFrame(() => document.querySelector(".pincon-ops-main")?.focus?.());
}

async function closeOps() {
  if (!userOpenedOps || closing) return;
  closing = true;
  const trigger = ensureDockTrigger();
  lastTriggerRect = trigger?.getBoundingClientRect?.() || lastTriggerRect;
  const host = shell();

  await animateSheet(host, false);
  userOpenedOps = false;
  document.body.classList.add("pincon-classic-home");
  document.body.classList.remove("pincon-classic-ops-open", "pincon-ops-open", "pincon-unified-ready");

  if (host) {
    host.dataset.open = "false";
    host.setAttribute("aria-hidden", "true");
  }
  cleanOpsUrl();
  removeLegacyLaunchCards();
  syncTriggerState(trigger);
  ensureDockTrigger();
  closing = false;
}

function repair() {
  scheduled = false;
  removeLegacyLaunchCards();
  ensureDockTrigger();

  if (userOpenedOps) {
    document.body.classList.remove("pincon-classic-home");
    document.body.classList.add("pincon-classic-ops-open", "pincon-ops-open", "pincon-unified-ready");
    prepareOpsShell();
    syncOpsHeader();
  } else {
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

  const observer = new MutationObserver(scheduleRepair);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "data-open"] });
  window.addEventListener("pageshow", scheduleRepair, { passive: true });
  scheduleRepair();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}

globalThis.PINCON_CLASSIC_RETURN_VERSION = CLASSIC_RETURN_VERSION;