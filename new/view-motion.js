const SELECTOR = ".pc-cover, .pc-calendar-tile";
const MAX_TILES = 12;
const visible = rect => rect.width > 1 && rect.height > 1 && rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight;

function tiles(root) {
  const found = new Map();
  for (const node of root.querySelectorAll(SELECTOR)) {
    const id = node.dataset.assessmentId;
    if (found.has(id) || getComputedStyle(node).visibility === "hidden") continue;
    const face = node.classList.contains("pc-cover") ? node.querySelector(":scope > .pc-face") : node;
    const rect = face.getBoundingClientRect();
    if (!visible(rect)) continue;
    found.set(id, { id, node, face, rect, width: face.offsetWidth, height: face.offsetHeight, background: getComputedStyle(face).backgroundImage });
  }
  return [...found.values()];
}

export function captureAssessmentTiles(root) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return [];
  return tiles(root).sort((a, b) => Math.abs(a.rect.left + a.rect.width / 2 - innerWidth / 2) - Math.abs(b.rect.left + b.rect.width / 2 - innerWidth / 2)).slice(0, MAX_TILES).map(tile => ({ ...tile, clone: tile.face.cloneNode(true) }));
}

// Animate a bounded set of flat sheets above both layouts. The calendar's
// cells never clip moving tiles, and no layout work runs on animation frames.
export function animateAssessmentView(root, before) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  if (reduced.matches || document.hidden || !root.animate) return () => {};
  const after = new Map(tiles(root).map(tile => [tile.id, tile]));
  const layer = document.createElement("div");
  layer.className = "pc-view-transition"; layer.setAttribute("aria-hidden", "true"); layer.inert = true;
  document.body.append(layer);
  const animations = [], hidden = [], listeners = new AbortController();
  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true; listeners.abort();
    animations.splice(0).forEach(animation => animation.cancel());
    hidden.splice(0).forEach(node => node.classList.remove("pc-view-hidden"));
    layer.replaceChildren(); layer.remove(); root.removeAttribute("aria-busy");
  }
  root.setAttribute("aria-busy", "true");
  if (root.firstElementChild) animations.push(root.firstElementChild.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" }));
  before.forEach((source, index) => {
    const destination = after.get(source.id), rect = destination?.rect || source.rect;
    const proxy = document.createElement("div");
    proxy.className = "pc-view-proxy";
    Object.assign(proxy.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, background: source.background });
    proxy.style.setProperty("--card", `${rect.width}px`);
    proxy.style.setProperty("--cover-background", source.background);
    source.clone.querySelectorAll(".pc-surface-light, .pc-reflection").forEach(node => node.remove());
    source.clone.removeAttribute("id");
    const oldSkin = document.createElement("div"); oldSkin.className = "pc-view-skin";
    Object.assign(oldSkin.style, { width: `${source.width}px`, height: `${source.height}px`, transform: `scale(${rect.width / source.width},${rect.height / source.height})`, transformOrigin: "0 0" });
    oldSkin.style.setProperty("--card", `${source.width}px`);
    oldSkin.append(source.clone); proxy.append(oldSkin); layer.append(proxy);
    const delay = Math.min(index, 8) * 14;
    if (!destination) {
      animations.push(proxy.animate([{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "translateY(-8px) scale(.97)" }], { duration: 180, delay, fill: "both", easing: "ease-out" }));
      return;
    }
    hidden.push(destination.node); destination.node.classList.add("pc-view-hidden");
    const newSkin = document.createElement("div"); newSkin.className = "pc-view-skin";
    Object.assign(newSkin.style, { width: `${destination.width}px`, height: `${destination.height}px`, transform: `scale(${rect.width / destination.width},${rect.height / destination.height})`, transformOrigin: "0 0" });
    newSkin.style.setProperty("--card", `${destination.width}px`);
    const clone = destination.face.cloneNode(true); clone.removeAttribute("id"); clone.querySelectorAll(".pc-surface-light, .pc-reflection").forEach(node => node.remove());
    clone.classList.remove("pc-view-hidden"); clone.style.visibility = "visible";
    clone.style.setProperty("--cover-background", destination.background); newSkin.append(clone); proxy.append(newSkin);
    const from = `translate(${source.rect.left - rect.left}px,${source.rect.top - rect.top}px) scale(${source.rect.width / rect.width},${source.rect.height / rect.height})`;
    animations.push(proxy.animate([{ transform: from }, { transform: "translate(0,0) scale(1)" }], { duration: 420, delay, easing: "cubic-bezier(.22,.75,.18,1)", fill: "both" }));
    // Let the paper travel first, then reveal the destination typography at
    // its readable size instead of stretching tiny calendar text into a cover.
    animations.push(oldSkin.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, delay, fill: "both" }));
    animations.push(newSkin.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, delay: delay + 280, fill: "both" }));
  });
  const options = { signal: listeners.signal };
  for (const type of ["pointerdown", "wheel", "keydown"]) root.addEventListener(type, stop, { ...options, capture: true, passive: true });
  window.addEventListener("resize", stop, options);
  window.visualViewport?.addEventListener("resize", stop, options);
  reduced.addEventListener("change", () => { if (reduced.matches) stop(); }, options);
  document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); }, options);
  root.querySelector(".pc-calendar")?.addEventListener("scroll", stop, { ...options, passive: true });
  Promise.allSettled(animations.map(animation => animation.finished)).then(stop);
  return stop;
}
