const root = document.documentElement;
const body = document.body;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

function syncScrollState() {
  body.classList.toggle("flow-scrolled", scrollY > 10);
}

addEventListener("scroll", syncScrollState, { passive: true });
addEventListener("pageshow", syncScrollState, { passive: true });
syncScrollState();

document.addEventListener("pointerdown", (event) => {
  if (reduceMotion.matches) return;
  const target = event.target.closest(
    ".nav-button,.soft-button,.icon-button,.text-button,.prep-row,.task-row,.period,.event,.mission,.quick-action,.meal-day,.day-chip,.chip"
  );
  if (!target || target.disabled) return;
  target.classList.add("flow-pressed");
}, { passive: true });

function releasePressed(event) {
  const target = event.target.closest?.(".flow-pressed");
  if (!target) return;
  requestAnimationFrame(() => target.classList.remove("flow-pressed"));
}

document.addEventListener("pointerup", releasePressed, { passive: true });
document.addEventListener("pointercancel", releasePressed, { passive: true });

window.addEventListener("pincon-flow-ready", () => {
  if (reduceMotion.matches) return;
  root.classList.add("flow-ready-detail");
  setTimeout(() => root.classList.remove("flow-ready-detail"), 900);
}, { once: true });
