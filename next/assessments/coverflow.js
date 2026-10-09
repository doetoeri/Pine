const escape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const controllers = new WeakMap();
const selections = new Map();
const introduced = new Set();
const lightingControllers = new Set();
const LIGHTING_KEY = "pincon-cover-lighting-v1";
let lightingEnabled = true;
try { lightingEnabled = globalThis.localStorage?.getItem(LIGHTING_KEY) !== "off"; } catch {}

export function coverLightingEnabled() { return lightingEnabled; }
export function setCoverLightingEnabled(enabled) {
  lightingEnabled = Boolean(enabled);
  try { localStorage.setItem(LIGHTING_KEY, lightingEnabled ? "on" : "off"); } catch {}
  for (const controller of lightingControllers) controller.updateLighting();
}

export function assessmentDue(date, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return "미정";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const today = ["year", "month", "day"].map(key => parts.find(part => part.type === key).value).join("-");
  const days = Math.round((Date.parse(date + "T00:00:00+09:00") - Date.parse(today + "T00:00:00+09:00")) / 86400000);
  return days < 0 ? "마감 지남" : days === 0 ? "D-DAY" : `D−${days}`;
}

// Subject identity survives sorting, edits, new assignments and another device.
export function subjectTheme(subject) {
  const key = String(subject || "수행평가").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  const groups = [
    /^(수학|공통수학|확률|미적분|기하)/,
    /^(국어|공통국어|문학|독서|화법|언어와매체)/,
    /^(과학|통합과학|물리|화학|생명|지구|과탐|과학탐구)/,
    /^(사회|통합사회|한국사|역사|세계사|지리|정치|경제|윤리|도덕)/,
    /^(영어|공통영어|공영|영독|영작)/,
    /^(체육|음악|미술|기술|가정|정보|한문|중국어|일본어)/
  ];
  const group = groups.findIndex(pattern => pattern.test(key));
  if (group >= 0) return group;
  let hash = 2166136261;
  for (const ch of key) hash = Math.imul(hash ^ ch.codePointAt(0), 16777619);
  return (hash >>> 0) % groups.length;
}

function face(row) {
  return `<div class="pc-face"><span class="pc-surface-light" aria-hidden="true"></span><div class="pc-head"><span>${escape(row.subject || "수행평가")}</span><span>${escape(row.kind || "수행평가")}</span></div><div class="pc-title">${escape(row.title)}</div><div class="pc-bottom"><div class="pc-deadline"><span class="pc-date">${escape(row.dueDate ? row.dueDate.slice(5).replace("-", ".") : "날짜 미정")}</span><span>${escape(assessmentDue(row.dueDate))}</span></div><div class="pc-meta"><span>${escape((row.confirmed || row.verificationStatus === "verified") ? "공식 자료 확인" : "확인 중")}</span><span>${[row.noticeAttachment && "안내문", row.worksheetPack && "학습지팩"].filter(Boolean).join(" · ")}</span></div></div></div>`;
}

export function coverflowMarkup(rows, classKey = "") {
  if (!rows.length) return `<section class="pc-flow pc-flow-empty" data-render-key="assessment-flow"><p>등록된 수행평가가 없습니다.</p></section>`;
  return `<section class="pc-flow" data-render-key="assessment-flow" data-class-key="${escape(classKey)}" aria-label="수행평가">
    <div class="pc-scene" tabindex="0" role="region" aria-roledescription="캐러셀" aria-label="수행평가 커버플로우. 좌우 드래그 또는 방향키로 선택하고 가운데 커버를 누르면 상세 내용을 엽니다.">
      ${rows.map((row, index) => `<button type="button" class="pc-cover pc-theme-${subjectTheme(row.subject)}" data-index="${index}" data-assessment-id="${escape(row.id)}" data-detail-key="${escape(row.detailKey)}" data-detail-route="classroom" aria-pressed="false" tabindex="-1" aria-label="${escape((row.subject || '수행평가') + ' · ' + row.title)}">${face(row)}<span class="pc-reflection" aria-hidden="true">${face(row)}</span></button>`).join("")}
    </div><div class="pc-caption"><p class="pc-caption-title"></p><p class="pc-caption-subject"></p></div><p class="sr-only pc-announcement" aria-live="polite" aria-atomic="true"></p>
  </section>`;
}

export function mountCoverflow(root, openDetail) {
  const host = root?.querySelector(".pc-flow"), scene = host?.querySelector(".pc-scene");
  if (!scene || controllers.has(host)) return;
  const cards = [...scene.querySelectorAll(".pc-cover")], reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const selectionKey = host.dataset.classKey;
  const lights = cards.map(card => ({ nodes: [...card.querySelectorAll(".pc-surface-light")], pose: "", opacity: "", hint: "" }));
  const visibility = [], hints = [];
  let selected = -1, width = 340, sceneWidth = 0, frame = 0, last = 0, drag = null, wheelTimer = 0;
  let position = Math.max(0, cards.findIndex(card => card.dataset.assessmentId === selections.get(selectionKey)));
  let target = position, velocity = 0, ignoreClick = 0, entering = !reduced.matches && !introduced.has(selectionKey), start = performance.now();
  introduced.add(selectionKey);
  const center = position;
  const entranceDuration = 460, stagger = 28;
  const entranceEnd = entranceDuration + Math.min(Math.max(center, cards.length - 1 - center), 6) * stagger;
  const controller = { destroy, updateLighting };
  controllers.set(host, controller);
  lightingControllers.add(controller);
  host.dataset.lighting = lightingEnabled ? "on" : "off";
  const disconnected = new MutationObserver(() => { if (!host.isConnected) destroy(); });
  disconnected.observe(root, { childList: true, subtree: true });
  const resize = new ResizeObserver(() => { width = cards[0].offsetWidth || 340; sceneWidth = scene.clientWidth; paint(); });
  resize.observe(scene);
  const listen = new AbortController(), options = { signal: listen.signal };

  function destroy() { cancelAnimationFrame(frame); clearTimeout(wheelTimer); resize.disconnect(); disconnected.disconnect(); listen.abort(); controllers.delete(host); lightingControllers.delete(controller); }
  function updateLighting() { host.dataset.lighting = lightingEnabled ? "on" : "off"; paint(); }
  function paintLight(index, yaw, x, z, cardScale, moving, visible) {
    if (!lightingEnabled) return;
    const light = lights[index];
    let pose = light.pose, opacity = "0", hint = "auto";
    if (visible) {
      const sin = Math.sin(yaw), cos = Math.cos(yaw), half = width * cardScale / 2;
      // Match the scene's 1600px perspective without measuring DOM bounds per frame.
      const a = 1600 * (x - cos * half) / (1600 - z - sin * half);
      const b = 1600 * (x + cos * half) / (1600 - z + sin * half);
      const onScreen = Math.max(a, b) > -sceneWidth / 2 - 20 && Math.min(a, b) < sceneWidth / 2 + 20;
      if (onScreen) {
        const viewYaw = Math.atan2(-x, 1600 - z);
        const halfYaw = (viewYaw - .38) / 2;
        const mismatch = yaw - halfYaw;
        const facing = clamp(Math.cos(yaw - viewYaw), 0, 1);
        const shift = clamp(-mismatch * 1.5, -1.4, 1.4) * width;
        const stretch = .85 + (1 - facing) * .5;
        // The rotated softbox must also intersect the cover's local clip.
        const lightHalf = width * (.33 * stretch * .9511 + .75 * .3091);
        if (Math.abs(shift) < width / 2 + lightHalf) {
          const fresnel = .04 + .96 * Math.pow(1 - facing, 5);
          const specular = Math.exp(-Math.pow(mismatch / .44, 2));
          pose = `translate3d(${shift.toFixed(2)}px,0,0) rotate(-18deg) scaleX(${stretch.toFixed(3)})`;
          opacity = (.1 + specular * .4 + fresnel * .2).toFixed(3);
          hint = moving ? "transform,opacity" : "auto";
        }
      }
    }
    if (pose === light.pose && opacity === light.opacity && hint === light.hint) return;
    // Two matching layers: the cover and its floor reflection. Only composite
    // their transform/opacity; the small softbox gradient itself never changes.
    for (const node of light.nodes) {
      if (pose !== light.pose) node.style.transform = pose;
      if (opacity !== light.opacity) node.style.opacity = opacity;
      if (hint !== light.hint) node.style.willChange = hint;
    }
    light.pose = pose; light.opacity = opacity; light.hint = hint;
  }
  function paint() {
    // Resize callbacks and animation frames share one monotonic entrance clock.
    const now = performance.now(), scale = width / 384;
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i], delta = i - position, distance = Math.abs(delta), visible = distance < 6.6;
      if (visibility[i] !== visible) {
        card.style.visibility = visible ? "visible" : "hidden";
        card.style.pointerEvents = visible ? "auto" : "none";
        visibility[i] = visible;
      }
      const hint = visible && (entering || last || drag) ? "transform" : "auto";
      if (hint !== hints[i]) { card.style.willChange = hint; hints[i] = hint; }
      if (!visible) { paintLight(i, 0, 0, 0, 1, false, false); continue; }
      const turn = Math.sin(Math.min(distance, 1) * Math.PI / 2), sign = Math.sign(delta);
      const delay = Math.min(Math.abs(i - center), 6) * stagger;
      const t = entering ? clamp((now - start - delay) / entranceDuration, 0, 1) : 1;
      // Critically damped: approach the resting layout without overshooting it.
      const spread = t === 1 ? 1 : (1 - (1 + 7 * t) * Math.exp(-7 * t)) / (1 - 8 * Math.exp(-7));
      const remaining = 1 - spread;
      const x = (delta * 82 + sign * 152 * turn) * scale, z = (-134 * turn - Math.max(0, distance - 1) * 5) * scale;
      const yaw = -sign * 65 * turn, cardScale = .985 + .015 * spread;
      const renderX = x - sign * 18 * remaining * scale, renderZ = z - 18 * remaining * scale;
      card.style.transform = `translate3d(${renderX}px,${14 * remaining * scale}px,${renderZ}px) rotateY(${yaw}deg) scale(${cardScale})`;
      card.style.opacity = String(1 - Math.pow(1 - clamp(t * 2.4, 0, 1), 3));
      card.style.zIndex = String(1000 - Math.round(distance * 100));
      paintLight(i, yaw * Math.PI / 180, renderX, renderZ, cardScale, Boolean(entering || last || drag), true);
    }
    const index = clamp(Math.round(position), 0, cards.length - 1);
    if (index !== selected) {
      selected = index;
      selections.set(selectionKey, cards[index].dataset.assessmentId);
      cards.forEach((card, i) => { card.tabIndex = i === index ? 0 : -1; card.setAttribute("aria-pressed", String(i === index)); });
      host.querySelector(".pc-caption-title").textContent = cards[index].querySelector(".pc-title").textContent;
      host.querySelector(".pc-caption-subject").textContent = cards[index].querySelector(".pc-head span").textContent;
      host.querySelector(".pc-announcement").textContent = `${cards[index].getAttribute("aria-label")} · ${index + 1} / ${cards.length}`;
    }
    scene.dataset.motion = entering ? "entering" : last ? "animating" : drag ? "dragging" : "resting";
  }
  function animate() { if (!frame && !document.hidden) frame = requestAnimationFrame(tick); }
  function tick(now) {
    frame = 0;
    if (!host.isConnected) return destroy();
    const dt = last ? Math.min((now - last) / 1000, .05) : 1 / 60; last = now;
    if (entering) {
      if (now - start >= entranceEnd || reduced.matches) entering = false;
    } else if (!drag) {
      if (reduced.matches) { position = target; velocity = 0; }
      else { const offset = position - target, decay = Math.exp(-18 * dt), approach = velocity + 18 * offset; position = target + (offset + approach * dt) * decay; velocity = (velocity - 18 * approach * dt) * decay; }
    }
    const moving = Math.abs(position - target) > .00015 || Math.abs(velocity) > .002;
    if (!moving && !drag && !entering) { position = target; velocity = 0; last = 0; }
    paint();
    if (entering || moving && !drag) animate();
  }
  function go(index) { entering = false; clearTimeout(wheelTimer); target = clamp(Math.round(index), 0, cards.length - 1); last = 0; animate(); }
  function activate(index) { entering = false; if (index === Math.round(position) && Math.abs(position - index) < .08) openDetail(cards[index].dataset.detailKey, cards[index]); else go(index); }
  scene.addEventListener("click", event => { const card = event.target.closest(".pc-cover"); if (!card) return; event.stopPropagation(); if (performance.now() > ignoreClick) activate(Number(card.dataset.index)); }, options);
  scene.addEventListener("pointerdown", event => {
    if (event.button !== 0 || event.isPrimary === false) return;
    entering = false; cancelAnimationFrame(frame); frame = 0; velocity = 0; clearTimeout(wheelTimer); target = position;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, position, moved: false, samples: [{ time: performance.now(), position }], index: event.target.closest(".pc-cover")?.dataset.index };
    scene.setPointerCapture(event.pointerId); scene.focus({ preventScroll: true });
  }, options);
  scene.addEventListener("pointermove", event => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && (Math.abs(dx) < 5 || Math.abs(dy) > Math.abs(dx) * 1.2)) return;
    drag.moved = true;
    position = clamp(drag.position - dx / (220 * width / 384), -.35, cards.length - .65); target = position;
    const now = performance.now(); drag.samples.push({ time: now, position });
    while (drag.samples.length > 2 && now - drag.samples[0].time > 90) drag.samples.shift();
    animate();
  }, options);
  function endDrag(event, cancelled = false) {
    if (!drag || drag.id !== event.pointerId) return;
    const old = drag; drag = null;
    if (scene.hasPointerCapture(event.pointerId)) scene.releasePointerCapture(event.pointerId);
    ignoreClick = performance.now() + 400;
    if (old.moved && !cancelled) { const a = old.samples[0], b = old.samples.at(-1); velocity = b.time - a.time >= 8 && performance.now() - b.time < 100 ? clamp((b.position - a.position) * 1000 / (b.time - a.time), -12, 12) : 0; go(position + velocity * .2); }
    else if (!cancelled && old.index !== undefined) activate(Number(old.index));
    else go(position);
  }
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) scene.addEventListener(name, event => endDrag(event, name !== "pointerup"), options);
  scene.addEventListener("keydown", event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const delta = { ArrowLeft: -1, ArrowRight: 1, PageUp: -4, PageDown: 4 }[event.key];
    if (delta) { event.preventDefault(); go(target + delta); scene.focus({ preventScroll: true }); }
    else if (event.key === "Home" || event.key === "End") { event.preventDefault(); go(event.key === "Home" ? 0 : cards.length - 1); }
    else if (event.target === scene && ["Enter", " "].includes(event.key)) { event.preventDefault(); activate(selected); }
  }, options);
  scene.addEventListener("wheel", event => {
    if (event.ctrlKey || event.metaKey || drag) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    event.preventDefault(); entering = false;
    if (event.deltaMode || Math.abs(delta) >= 60) go(target + Math.sign(delta));
    else { target = clamp(target + delta / (220 * width / 384), 0, cards.length - 1); animate(); clearTimeout(wheelTimer); wheelTimer = setTimeout(() => go(target), 140); }
  }, { ...options, passive: false });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; entering = false; drag = null; position = target = clamp(Math.round(position), 0, cards.length - 1); velocity = 0; last = 0; paint(); } }, options);
  reduced.addEventListener("change", () => { if (reduced.matches) { entering = false; go(target); } }, options);
  width = cards[0].offsetWidth || 340; sceneWidth = scene.clientWidth; paint(); if (entering) animate();
}
