const REFERENCE_DOCK_VERSION = "20260823-ref1";
let queued = false;

function syncTrigger() {
  queued = false;
  const trigger = document.querySelector(".pincon-class-ops-trigger");
  if (!trigger) return;
  const icon = trigger.querySelector("md-icon");
  if (!icon) return;
  const open = trigger.getAttribute("aria-expanded") === "true" || trigger.dataset.state === "open";
  const next = open ? "close" : "add";
  if (icon.textContent?.trim() !== next) icon.textContent = next;
}

function scheduleSync() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(syncTrigger);
}

new MutationObserver(scheduleSync).observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["aria-expanded", "data-state", "class"],
});

document.addEventListener("click", scheduleSync, true);
window.addEventListener("pageshow", scheduleSync, { passive: true });
scheduleSync();

globalThis.PINCON_REFERENCE_DOCK_VERSION = REFERENCE_DOCK_VERSION;
