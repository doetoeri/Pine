const escape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const controllers = new WeakMap();
const selections = new Map();

export function assessmentDue(date, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return "미정";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const today = ["year", "month", "day"].map(key => parts.find(part => part.type === key).value).join("-");
  const days = Math.round((Date.parse(date + "T00:00:00+09:00") - Date.parse(today + "T00:00:00+09:00")) / 86400000);
  return days < 0 ? "마감 지남" : days === 0 ? "D-DAY" : `D−${days}`;
}

function face(row) {
  return `<div class="pc-face"><div class="pc-head"><span>${escape(row.subject || "수행평가")}</span><span>${escape(row.kind || "수행평가")}</span></div><div class="pc-title">${escape(row.title)}</div><div class="pc-bottom"><div class="pc-deadline"><span class="pc-date">${escape(row.dueDate ? row.dueDate.slice(5).replace("-", ".") : "날짜 미정")}</span><span>${escape(assessmentDue(row.dueDate))}</span></div><div class="pc-meta"><span>${escape((row.confirmed || row.verificationStatus === "verified") ? "공식 자료 확인" : "확인 중")}</span><span>${[row.noticeAttachment && "JPG", row.worksheetPack && "PDF"].filter(Boolean).join(" · ")}</span></div></div></div>`;
}

export function coverflowMarkup(rows, classKey = "") {
  if (!rows.length) return `<section class="pc-flow pc-flow-empty" data-render-key="assessment-flow"><p>등록된 수행평가가 없습니다.</p></section>`;
  return `<section class="pc-flow" data-render-key="assessment-flow" data-class-key="${escape(classKey)}" aria-label="수행평가">
    <div class="pc-scene" tabindex="0" role="region" aria-roledescription="캐러셀" aria-label="수행평가 커버플로우. 좌우 드래그 또는 방향키로 선택하고 가운데 커버를 누르면 상세 내용을 엽니다.">
      ${rows.map((row, index) => `<button type="button" class="pc-cover pc-theme-${index % 6}" data-index="${index}" data-assessment-id="${escape(row.id)}" data-detail-key="${escape(row.detailKey)}" data-detail-route="classroom" aria-pressed="false" tabindex="-1" aria-label="${escape(row.subject + ' · ' + row.title)}">${face(row)}<span class="pc-reflection" aria-hidden="true">${face(row)}</span></button>`).join("")}
    </div><div class="pc-caption"><p class="pc-caption-title"></p><p class="pc-caption-subject"></p></div><p class="sr-only pc-announcement" aria-live="polite" aria-atomic="true"></p>
  </section>`;
}

export function mountCoverflow(root, openDetail) {
  const host = root?.querySelector(".pc-flow"), scene = host?.querySelector(".pc-scene");
  if (!scene || controllers.has(host)) return;
  const cards = [...scene.querySelectorAll(".pc-cover")], reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const selectionKey = host.dataset.classKey;
  let selected = -1, width = 340, frame = 0, last = 0, drag = null, wheelTimer = 0;
  let position = Math.max(0, cards.findIndex(card => card.dataset.assessmentId === selections.get(selectionKey)));
  let target = position, velocity = 0, ignoreClick = 0, entering = !reduced.matches, start = performance.now();
  const center = position;
  const controller = { destroy };
  controllers.set(host, controller);
  const disconnected = new MutationObserver(() => { if (!host.isConnected) destroy(); });
  disconnected.observe(root, { childList: true, subtree: true });
  const resize = new ResizeObserver(() => { width = cards[0].offsetWidth || 340; paint(); });
  resize.observe(scene);
  const listen = new AbortController(), options = { signal: listen.signal };

  function destroy() { cancelAnimationFrame(frame); clearTimeout(wheelTimer); resize.disconnect(); disconnected.disconnect(); listen.abort(); controllers.delete(host); }
  function paint(now = performance.now()) {
    const scale = width / 384;
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i], delta = i - position, distance = Math.abs(delta), visible = distance < 6.6;
      card.style.visibility = visible ? "visible" : "hidden";
      card.style.pointerEvents = visible ? "auto" : "none";
      card.style.willChange = visible && (entering || last || drag) ? "transform" : "auto";
      if (!visible) continue;
      const turn = Math.sin(Math.min(distance, 1) * Math.PI / 2), sign = Math.sign(delta);
      const delay = Math.min(Math.abs(i - center), 6) * 64 + (i > center ? 26 : 0);
      const t = entering ? clamp((now - start - delay) / 760, 0, 1) : 1;
      const spread = t === 1 ? 1 : 1 - Math.exp(-8.5 * t) * (Math.cos(7 * t) + 1.214 * Math.sin(7 * t));
      const x = (delta * 82 + sign * 152 * turn) * scale, z = (-134 * turn - Math.max(0, distance - 1) * 5) * scale;
      card.style.transform = `translate3d(${x * spread}px,${(44 + distance * 8) * (1 - spread) * scale}px,${z * spread - 90 * (1 - spread) * scale}px) rotateY(${-sign * 65 * turn * spread + sign * 42 * (1 - spread)}deg) rotateX(${5 * (1 - spread)}deg) scale(${.91 + .09 * spread})`;
      card.style.opacity = String(1 - Math.pow(1 - clamp(t * 2.3, 0, 1), 3));
      card.style.zIndex = String(1000 - Math.round(distance * 100));
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
      if (now - start > 1170) entering = false;
    } else if (!drag) {
      if (reduced.matches) { position = target; velocity = 0; }
      else { const offset = position - target, decay = Math.exp(-12 * dt), cos = Math.cos(6 * dt), sin = Math.sin(6 * dt), v = velocity; position = target + decay * (offset * cos + (v + 12 * offset) / 6 * sin); velocity = decay * (v * cos - (12 * v + 180 * offset) / 6 * sin); }
    }
    const moving = Math.abs(position - target) > .00015 || Math.abs(velocity) > .002;
    if (!moving && !drag && !entering) { position = target; velocity = 0; last = 0; }
    paint(now);
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
  width = cards[0].offsetWidth || 340; paint(); if (entering) animate();
}
