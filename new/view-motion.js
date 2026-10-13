const SELECTOR = ".pc-cover, .pc-calendar-tile";
const MAX_TILES = 12;
const DURATION = 420;
const EASING = "cubic-bezier(.22,.75,.18,1)";
const visible = rect => rect.width > 1 && rect.height > 1 && rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight;

function viewportMatrix(node, rect) {
  if (!node.classList.contains("pc-cover")) return new DOMMatrix().translate(rect.left, rect.top);
  const scene = node.closest(".pc-scene"), bounds = scene.getBoundingClientRect();
  const sceneStyle = getComputedStyle(scene), style = getComputedStyle(node);
  const [px, py] = sceneStyle.perspectiveOrigin.split(" ").map(Number.parseFloat);
  const [ox, oy] = style.transformOrigin.split(" ").map(Number.parseFloat);
  const perspective = new DOMMatrix();
  perspective.m34 = -1 / (Number.parseFloat(sceneStyle.perspective) || 1600);
  // Preserve the projected corners of the actual tilted sheet. A bounding-box
  // clone would abruptly turn every angled cover into a flat rectangle.
  return new DOMMatrix().translate(bounds.left + px, bounds.top + py)
    .multiply(perspective)
    .translate(Number.parseFloat(style.left) + ox - px, Number.parseFloat(style.top) + oy - py)
    .multiply(new DOMMatrix(style.transform === "none" ? undefined : style.transform))
    .translate(-ox, -oy);
}

function tiles(root) {
  const found = new Map();
  for (const node of root.querySelectorAll(SELECTOR)) {
    const id = node.dataset.assessmentId;
    if (found.has(id) || getComputedStyle(node).visibility === "hidden") continue;
    const face = node.classList.contains("pc-cover") ? node.querySelector(":scope > .pc-face") : node;
    const rect = face.getBoundingClientRect(), style = getComputedStyle(face);
    if (!visible(rect)) continue;
    found.set(id, {
      id, node, face, rect, matrix: viewportMatrix(node, rect),
      width: Number.parseFloat(style.width), height: Number.parseFloat(style.height),
      background: style.backgroundImage, depth: Number(getComputedStyle(node).zIndex) || 0,
    });
  }
  return [...found.values()];
}

function cloneFace(tile) {
  const clone = tile.face.cloneNode(true);
  clone.removeAttribute("id"); clone.classList.remove("pc-view-hidden");
  clone.removeAttribute("data-calendar-anchor");
  clone.querySelectorAll("[id]").forEach(node => node.removeAttribute("id"));
  clone.style.visibility = "visible";
  clone.style.background = tile.background;
  const lights = tile.face.querySelectorAll(".pc-surface-light");
  clone.querySelectorAll(".pc-surface-light").forEach((node, i) => { node.style.display = getComputedStyle(lights[i]).display; });
  return clone;
}

function snapshotSkins(proxy) {
  const skins = [];
  for (const node of proxy.querySelectorAll('.pc-view-skin')) {
    if (!node.firstElementChild?.matches('.pc-face,.pc-calendar-tile')) continue;
    let opacity = 1, matrix = new DOMMatrix();
    for (let parent = node; parent !== proxy; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      opacity *= Number(style.opacity);
      if (style.transform !== 'none') matrix = new DOMMatrix(style.transform).multiply(matrix);
    }
    if (opacity > .02) skins.push({ node, opacity, matrix, order: skins.length });
  }
  // Keep at most two visible skins. Repeated reversals must never accumulate
  // recursively nested snapshots or an ever-growing set of paper textures.
  return skins.sort((a, b) => b.opacity - a.opacity).slice(0, 2).sort((a, b) => a.order - b.order).map(({ node, opacity, matrix }) => {
    const clone = node.cloneNode(true);
    clone.style.opacity = String(opacity); clone.style.transform = matrix.toString();
    return clone;
  });
}

export function captureAssessmentTiles(root) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !globalThis.DOMMatrix) return [];
  const moving = [];
  // A reversal starts at the current painted pose, not the hidden end layout.
  // Freeze the two skins' opacity once so their cross-fade also stays intact.
  for (const proxy of document.querySelectorAll('.pc-view-transition > .pc-view-proxy')) {
    const rect = proxy.getBoundingClientRect(), style = getComputedStyle(proxy);
    if (!visible(rect) || Number(style.opacity) < .02) continue;
    const clone = document.createElement('div'); clone.className = 'pc-view-snapshot';
    Object.assign(clone.style, { width: style.width, height: style.height, background: style.backgroundImage, opacity: style.opacity });
    clone.append(...snapshotSkins(proxy));
    moving.push({ id: proxy.dataset.assessmentId, rect, matrix: new DOMMatrix(style.transform), width: Number.parseFloat(style.width), height: Number.parseFloat(style.height), background: style.backgroundImage, depth: Number(style.zIndex), clone });
  }
  const ids = new Set(moving.map(tile => tile.id));
  return [...moving, ...tiles(root).filter(tile => !ids.has(tile.id))].sort((a, b) => Math.abs(a.rect.left + a.rect.width / 2 - innerWidth / 2) - Math.abs(b.rect.left + b.rect.width / 2 - innerWidth / 2))
    .slice(0, MAX_TILES).map(tile => ({ ...tile, clone: tile.clone || cloneFace(tile) }));
}

function skin(tile, clone, width, height) {
  const node = document.createElement("div"); node.className = "pc-view-skin";
  Object.assign(node.style, { width: `${tile.width}px`, height: `${tile.height}px`, transform: `scale(${width / tile.width},${height / tile.height})`, transformOrigin: "0 0" });
  node.style.setProperty("--card", `${tile.width}px`);
  node.append(clone);
  return node;
}

// Only transform/opacity are animated. All geometry is measured once, with a
// bounded set of sheets; no per-frame layout or permanent animation loop.
export function animateAssessmentView(root, before) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  if (reduced.matches || document.hidden || !root.animate || !globalThis.DOMMatrix) return () => {};
  const destinations = tiles(root), after = new Map(destinations.map(tile => [tile.id, tile]));
  const layer = document.createElement("div");
  layer.className = "pc-view-transition"; layer.setAttribute("aria-hidden", "true"); layer.inert = true;
  document.body.append(layer);
  const animations = [], hidden = [], listeners = new AbortController(), matched = new Set();
  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true; listeners.abort();
    animations.splice(0).forEach(animation => animation.cancel());
    hidden.splice(0).forEach(node => node.classList.remove("pc-view-hidden"));
    layer.replaceChildren(); layer.remove(); root.removeAttribute("aria-busy");
  }
  root.setAttribute("aria-busy", "true");
  const calendar = root.querySelector(".pc-calendar");
  const chrome = calendar ? [calendar.querySelector(".pc-calendar-header"), calendar.querySelector(".pc-calendar-weekdays"), calendar.querySelector(".pc-calendar-grid"), ...calendar.querySelectorAll("h2")] : [root.querySelector(".pc-caption")];
  for (const node of chrome.filter(Boolean)) animations.push(node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease-out" }));
  before.forEach((source, index) => {
    const destination = after.get(source.id);
    const proxy = document.createElement("div"); proxy.className = "pc-view-proxy";
    proxy.dataset.assessmentId = source.id;
    Object.assign(proxy.style, { width: `${source.width}px`, height: `${source.height}px`, background: source.background, zIndex: String(Math.max(source.depth, destination?.depth || 0, MAX_TILES - index)) });
    const oldSkin = skin(source, source.clone, source.width, source.height);
    proxy.append(oldSkin); layer.append(proxy);
    const delay = Math.min(index, 6) * 10;
    const from = source.matrix.toString();
    if (!destination) {
      animations.push(proxy.animate([{ opacity: 1, transform: from }, { opacity: 0, transform: from }], { duration: 160, delay, fill: "both", easing: "ease-out" }));
      return;
    }
    matched.add(source.id);
    hidden.push(destination.node); destination.node.classList.add("pc-view-hidden");
    const newSkin = skin(destination, cloneFace(destination), source.width, source.height);
    proxy.append(newSkin);
    const to = destination.matrix.scale(destination.width / source.width, destination.height / source.height).toString();
    animations.push(proxy.animate([{ transform: from }, { transform: to }], { duration: DURATION, delay, easing: EASING, fill: "both" }));
    // Keep the paper continuous while cross-fading the two type sizes. The
    // destination becomes readable as the sheet settles into its date cell.
    const expanding = destination.node.classList.contains('pc-cover');
    animations.push(oldSkin.animate([{ opacity: 1 }, { opacity: 0 }], { duration: expanding ? 80 : 130, delay: delay + (expanding ? 0 : 30), fill: "both" }));
    animations.push(newSkin.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay: delay + (expanding ? 150 : 190), fill: "both" }));
  });
  destinations.filter(tile => !matched.has(tile.id)).slice(0, MAX_TILES).forEach((tile, index) => {
    animations.push(tile.node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: Math.min(index, 6) * 10 + 60, fill: "both", easing: "ease-out" }));
  });
  const options = { signal: listeners.signal };
  const interrupt = event => { if (!event.target.closest?.('#view-toggle')) stop(); };
  for (const type of ["pointerdown", "wheel", "keydown"]) document.addEventListener(type, interrupt, { ...options, capture: true, passive: true });
  window.addEventListener("resize", stop, options);
  window.visualViewport?.addEventListener("resize", stop, options);
  reduced.addEventListener("change", () => { if (reduced.matches) stop(); }, options);
  document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); }, options);
  // An automatic anchor scroll happens before measuring. Its queued event
  // must not cancel the transition; subsequent user scrolling should.
  const initialScroll = calendar?.scrollTop;
  calendar?.addEventListener("scroll", () => { if (Math.abs(calendar.scrollTop - initialScroll) > .5) stop(); }, { ...options, passive: true });
  Promise.allSettled(animations.map(animation => animation.finished)).then(stop);
  return stop;
}
