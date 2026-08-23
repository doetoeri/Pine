import { NextDataGateway } from "./core/data-gateway.js";
import { brandTaglineFor } from "./core/brand-settings.js";

const LOGO_URL = "./assets/pincon-icon.svg";
const app = document.querySelector("#app");
const gateway = new NextDataGateway();
let snapshot = gateway.snapshot();
let bootReleased = false;
let routeTimer = 0;

function logoMarkup(extra = "") {
  return `<img class="pincon-brand-logo ${extra}" src="${LOGO_URL}" alt="" decoding="async" />`;
}

function currentTagline() {
  return brandTaglineFor(snapshot.data || {}, snapshot.profile?.classKey || "");
}

function applyBrandTagline(root = document) {
  const tagline = currentTagline();

  const topBadge = root.querySelector?.(".brand__title .beta-badge") || document.querySelector(".brand__title .beta-badge");
  if (topBadge) {
    topBadge.textContent = tagline;
    topBadge.title = tagline;
    topBadge.hidden = !tagline;
  }

  const railTagline = root.querySelector?.(".rail__tagline") || document.querySelector(".rail__tagline");
  if (railTagline) {
    railTagline.textContent = tagline;
    railTagline.title = tagline;
    railTagline.hidden = !tagline;
  }
}

function applyBranding(root = document) {
  const topMark = root.querySelector?.(".brand__mark");
  if (topMark && !topMark.querySelector(".pincon-brand-logo")) {
    topMark.innerHTML = logoMarkup();
  }

  const splashMark = root.querySelector?.(".splash__mark");
  if (splashMark && !splashMark.querySelector(".pincon-brand-logo")) {
    splashMark.innerHTML = logoMarkup();
  }

  const railMark = root.querySelector?.(".rail__brand");
  if (railMark && !railMark.querySelector(".pincon-brand-logo")) {
    railMark.innerHTML = `${logoMarkup()}<span class="rail__wordmark"><span>PinCon</span><small class="rail__tagline"></small></span>`;
  }

  applyBrandTagline(root);
}

function releaseBootWhenStable() {
  if (bootReleased || !app?.querySelector(".shell, .splash")) return;
  bootReleased = true;

  // Let Material elements and the first data snapshot settle underneath the boot cover.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.body.classList.add("pincon-boot-done");
      window.setTimeout(() => document.querySelector("#pinconBoot")?.remove(), 220);
    });
  });
}

function reconcile(root = document) {
  applyBranding(root);
  releaseBootWhenStable();
}

function animateRouteOnce() {
  document.body.classList.remove("pincon-route-transition");
  // Force the next route render to opt in while ordinary data refreshes remain static.
  requestAnimationFrame(() => document.body.classList.add("pincon-route-transition"));
  window.clearTimeout(routeTimer);
  routeTimer = window.setTimeout(() => document.body.classList.remove("pincon-route-transition"), 220);
}

gateway.addEventListener("change", (event) => {
  snapshot = event.detail;
  reconcile();
});

document.addEventListener("click", (event) => {
  const path = event.composedPath?.() || [];
  const routeControl = path.find((node) => node instanceof HTMLElement && node.hasAttribute?.("data-route"));
  if (routeControl) animateRouteOnce();
}, true);

const observer = new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node instanceof HTMLElement) reconcile(node);
    }
  }
  reconcile();
});

if (app) observer.observe(app, { childList: true, subtree: true });
reconcile();

// Never leave users behind an overlay if a third-party module fails to settle.
window.setTimeout(() => {
  if (!bootReleased) {
    bootReleased = true;
    document.body.classList.add("pincon-boot-done");
  }
}, 4500);
