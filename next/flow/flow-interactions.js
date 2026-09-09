const app = document.querySelector("#flowApp");
const sheet = document.querySelector("#flowSheet");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const routeOrder = ["today", "timetable", "schedule", "assessment", "hub"];
let replayingClick = false;
let mutationFrame = 0;

function closestInteractive(target) {
  return target?.closest?.("button, .meal-card, .mission, .quick-action, .task-row, .event, .day-chip") || null;
}

function setPointVars(element, event, prefix = "press") {
  if (!element || !event) return;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const x = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
  const y = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100));
  element.style.setProperty(`--${prefix}-x`, `${x}%`);
  element.style.setProperty(`--${prefix}-y`, `${y}%`);
}

function releasePress(element) {
  if (!element) return;
  requestAnimationFrame(() => element.classList.remove("is-pressing"));
}

document.addEventListener("pointerdown", (event) => {
  const item = closestInteractive(event.target);
  if (!item) return;
  setPointVars(item, event, "press");
  item.classList.add("is-pressing");
}, { capture: true, passive: true });

document.addEventListener("pointerup", (event) => releasePress(closestInteractive(event.target)), { capture: true, passive: true });
document.addEventListener("pointercancel", (event) => releasePress(closestInteractive(event.target)), { capture: true, passive: true });
document.addEventListener("pointerleave", (event) => releasePress(closestInteractive(event.target)), { capture: true, passive: true });

if (matchMedia("(hover:hover) and (pointer:fine)").matches) {
  document.addEventListener("pointermove", (event) => {
    const surface = event.target.closest?.(".card, .week-day, .mission, .quick-action");
    if (!surface) return;
    setPointVars(surface, event, "pointer");
    if (surface.classList.contains("hero-day")) {
      const rect = surface.getBoundingClientRect();
      const nx = ((event.clientX - rect.left) / rect.width) - .5;
      const ny = ((event.clientY - rect.top) / rect.height) - .5;
      surface.style.transform = `perspective(1100px) rotateX(${(-ny * 1.25).toFixed(2)}deg) rotateY(${(nx * 1.4).toFixed(2)}deg) translateZ(0)`;
    }
  }, { passive: true });
  document.addEventListener("pointerout", (event) => {
    const hero = event.target.closest?.(".hero-day");
    if (hero && !hero.contains(event.relatedTarget)) hero.style.transform = "";
  }, { passive: true });
}

function routeDirection(button) {
  const target = button?.dataset?.route;
  const current = location.hash.replace(/^#\/?/, "").split("?")[0] || "today";
  const from = routeOrder.indexOf(current);
  const to = routeOrder.indexOf(target);
  if (from < 0 || to < 0 || from === to) return "local";
  return to > from ? "forward" : "back";
}

function transitionKind(target) {
  if (target.closest?.("[data-route]")) return routeDirection(target.closest("[data-route]"));
  if (target.closest?.("[data-date], [data-schedule-filter], [data-assessment-filter]")) return "local";
  return "";
}

document.addEventListener("click", (event) => {
  if (replayingClick || event.defaultPrevented || reduceMotion.matches || !document.startViewTransition) return;
  const trigger = event.target.closest?.("[data-route], [data-date], [data-schedule-filter], [data-assessment-filter]");
  if (!trigger) return;
  const direction = transitionKind(trigger);
  if (!direction) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  document.documentElement.dataset.navDirection = direction;
  replayingClick = true;
  const transition = document.startViewTransition(() => {
    trigger.click();
  });
  transition.finished.finally(() => {
    replayingClick = false;
    delete document.documentElement.dataset.navDirection;
  });
}, true);

function syncScrollMaterial() {
  document.body.classList.toggle("is-scrolled", scrollY > 8);
}
window.addEventListener("scroll", syncScrollMaterial, { passive: true });
syncScrollMaterial();

function animateBornObjects() {
  cancelAnimationFrame(mutationFrame);
  mutationFrame = requestAnimationFrame(() => {
    const objects = app?.querySelectorAll?.(".card, .week-day, .mission, .quick-action") || [];
    objects.forEach((item, index) => {
      item.classList.remove("hig-born");
      if (reduceMotion.matches || index > 7) return;
      requestAnimationFrame(() => item.classList.add("hig-born"));
    });
  });
}
if (app) new MutationObserver(animateBornObjects).observe(app, { childList: true });

let sheetClosing = false;
function closeSheetAnimated() {
  if (!sheet?.open || sheetClosing) return;
  sheetClosing = true;
  sheet.classList.remove("is-dragging");
  sheet.classList.add("is-closing");
  sheet.style.removeProperty("--sheet-drag");
  const finish = () => {
    if (sheet.open) sheet.close();
    sheet.classList.remove("is-closing");
    sheetClosing = false;
  };
  if (reduceMotion.matches) finish();
  else setTimeout(finish, 300);
}

sheet?.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeSheetAnimated();
});

document.addEventListener("click", (event) => {
  const closeButton = event.target.closest?.("#flowSheet button[value='cancel']");
  if (!closeButton) return;
  event.preventDefault();
  event.stopPropagation();
  closeSheetAnimated();
}, true);

sheet?.addEventListener("click", (event) => {
  if (event.target !== sheet) return;
  const rect = sheet.getBoundingClientRect();
  const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  if (!inside) closeSheetAnimated();
});

let drag = null;
const chrome = sheet?.querySelector(".flow-sheet__chrome");
chrome?.addEventListener("pointerdown", (event) => {
  if (!sheet?.open || event.target.closest("button")) return;
  drag = { pointerId: event.pointerId, startY: event.clientY, lastY: event.clientY, lastT: performance.now(), velocity: 0 };
  chrome.setPointerCapture?.(event.pointerId);
  sheet.classList.add("is-dragging");
}, { passive: true });

chrome?.addEventListener("pointermove", (event) => {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const now = performance.now();
  const dy = Math.max(0, event.clientY - drag.startY);
  const dt = Math.max(1, now - drag.lastT);
  drag.velocity = (event.clientY - drag.lastY) / dt;
  drag.lastY = event.clientY;
  drag.lastT = now;
  const damped = dy > 180 ? 180 + (dy - 180) * .28 : dy;
  sheet.style.setProperty("--sheet-drag", `${damped}px`);
  sheet.style.setProperty("--sheet-scale", `${Math.max(.985, 1 - damped / 12000)}`);
}, { passive: true });

function finishDrag(event) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const dy = Math.max(0, event.clientY - drag.startY);
  const shouldClose = dy > 105 || (dy > 44 && drag.velocity > .65);
  drag = null;
  sheet.classList.remove("is-dragging");
  sheet.style.removeProperty("--sheet-scale");
  if (shouldClose) closeSheetAnimated();
  else {
    sheet.style.setProperty("--sheet-drag", "0px");
    setTimeout(() => sheet.style.removeProperty("--sheet-drag"), 430);
  }
}
chrome?.addEventListener("pointerup", finishDrag, { passive: true });
chrome?.addEventListener("pointercancel", finishDrag, { passive: true });

window.addEventListener("pincon-flow-ready", () => {
  document.body.classList.add("flow-is-ready");
  setTimeout(() => document.body.classList.remove("flow-is-ready"), 700);
}, { once: true });
