const CLASSIC_RETURN_VERSION = "20260823-2";
let userOpenedOps = new URL(location.href).searchParams.get("class-ops") === "1";
let scheduled = false;

function shell() {
  return document.querySelector(".pincon-ops-shell");
}

function cleanOpsUrl() {
  const url = new URL(location.href);
  url.searchParams.delete("class-ops");
  url.searchParams.delete("class-tab");
  history.replaceState(history.state, "", url);
}

function markHome() {
  if (userOpenedOps) return;
  document.body.classList.add("pincon-classic-home");
  document.body.classList.remove("pincon-classic-ops-open", "pincon-ops-open", "pincon-unified-ready");
  const host = shell();
  if (host) {
    host.dataset.open = "false";
    host.setAttribute("aria-hidden", "true");
  }
  cleanOpsUrl();
}

function ensureLaunchCard() {
  if (userOpenedOps) return;
  const view = document.querySelector(".app-shell:not(.onboarding-shell) .app-main .view-layout");
  if (!view || view.querySelector(":scope > .pincon-classic-launch-card")) return;

  const card = document.createElement("section");
  card.className = "pincon-classic-launch-card";
  card.setAttribute("aria-label", "PinCon 학급 운영 도구");
  card.innerHTML = `
    <div class="pincon-classic-launch-copy">
      <p class="pincon-classic-launch-kicker">학급 운영</p>
      <h2>기존 PinCon은 그대로, 필요한 도구만 더했습니다</h2>
      <p>공지·수행평가·학습지 DB·공용 물품·익명 의견을 한곳에서 확인합니다.</p>
    </div>
    <md-filled-tonal-button data-pincon-classic-open>
      <md-icon slot="icon">dashboard</md-icon>
      전체 보기
    </md-filled-tonal-button>`;

  const hero = view.querySelector(":scope > .hero-area");
  if (hero) hero.after(card);
  else view.prepend(card);
}

function ensureBackButton() {
  if (!userOpenedOps) return;
  const topbar = document.querySelector(".pincon-ops-shell .pincon-ops-topbar");
  if (!topbar) return;

  if (!topbar.querySelector(":scope > .pincon-classic-back")) {
    const back = document.createElement("md-filled-tonal-icon-button");
    back.className = "pincon-classic-back";
    back.setAttribute("aria-label", "기존 PinCon으로 돌아가기");
    back.setAttribute("data-pincon-classic-close", "");
    back.innerHTML = "<md-icon>arrow_back</md-icon>";
    topbar.prepend(back);
  }

  const brand = topbar.querySelector(".pincon-ops-mobile-brand");
  if (brand) {
    const strong = brand.querySelector("strong");
    if (strong) strong.textContent = "PinCon 학급 운영";
  }
}

function exposeOpsShell() {
  const host = shell();
  if (!host) return;
  host.dataset.open = "true";
  host.setAttribute("aria-hidden", "false");
}

function openOps(tab = "today") {
  userOpenedOps = true;
  document.body.classList.remove("pincon-classic-home");
  document.body.classList.add("pincon-classic-ops-open", "pincon-ops-open", "pincon-unified-ready");
  exposeOpsShell();

  const url = new URL(location.href);
  url.searchParams.set("class-ops", "1");
  if (!url.searchParams.get("class-tab")) url.searchParams.set("class-tab", tab);
  history.replaceState(history.state, "", url);
  ensureBackButton();
  requestAnimationFrame(() => document.querySelector(".pincon-ops-main")?.focus?.());
}

function closeOps() {
  userOpenedOps = false;
  document.body.classList.add("pincon-classic-home");
  document.body.classList.remove("pincon-classic-ops-open", "pincon-ops-open", "pincon-unified-ready");

  const host = shell();
  if (host) {
    host.dataset.open = "false";
    host.setAttribute("aria-hidden", "true");
  }
  cleanOpsUrl();
  ensureLaunchCard();
}

function repair() {
  scheduled = false;
  if (userOpenedOps) {
    document.body.classList.remove("pincon-classic-home");
    document.body.classList.add("pincon-classic-ops-open", "pincon-ops-open", "pincon-unified-ready");
    exposeOpsShell();
    ensureBackButton();
  } else {
    markHome();
    ensureLaunchCard();
  }
}

function scheduleRepair() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(repair);
}

function start() {
  if (!userOpenedOps) document.body.classList.add("pincon-classic-home");
  else document.body.classList.add("pincon-classic-ops-open");

  document.addEventListener("click", (event) => {
    const path = event.composedPath?.() || [];
    const openTarget = path.find((node) => node?.dataset?.pinconClassicOpen !== undefined);
    if (openTarget) {
      event.preventDefault();
      openOps();
      return;
    }
    const closeTarget = path.find((node) => node?.dataset?.pinconClassicClose !== undefined);
    if (closeTarget) {
      event.preventDefault();
      event.stopPropagation();
      closeOps();
    }
  }, true);

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
