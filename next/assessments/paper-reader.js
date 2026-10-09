import { PageFlip } from "./vendor/page-flip/page-flip.module.js";

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const cancelled = () => new DOMException("Reader closed", "AbortError");
let pdfModule;
async function pdfLibrary() {
  pdfModule ||= import("./vendor/pdfjs/pdf.min.mjs");
  const library = await pdfModule;
  library.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
  return library;
}

// Only the current sheet and nearby sheets have decoded page images.
export async function mountPaperReader(host, attachment, { signal } = {}) {
  const listeners = new AbortController(), options = { signal: listeners.signal };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let disposed = false, loadingTask = null, pdf = null, book = null, resize = null;
  let current = 0, count = 1, aspect = .707, width = 0, height = 0, zoomed = false;
  let phase = "read", busy = false, pointer = null, fan = null, fanAnimations = [], interacted = false;
  const ownedUrls = new Set();
  const cache = new Map(), rendering = new Set();
  let queue = Promise.resolve(), image = null, nodes = [];

  function stopFan() {
    fanAnimations.forEach(animation => animation.cancel());
    fanAnimations = []; fan?.remove(); fan = null;
    host.querySelector(".pc-paper-book")?.classList.remove("pc-paper-entering");
  }
  function destroy() {
    if (disposed) return;
    disposed = true;
    listeners.abort(); resize?.disconnect(); stopFan();
    signal?.removeEventListener("abort", destroy);
    if (book) {
      const render = book.getRender();
      render.pcStopped = true; cancelAnimationFrame(render.pcFrame);
      book.destroy(); book = null;
    }
    rendering.forEach(task => task.cancel());
    loadingTask?.destroy().catch(() => {});
    ownedUrls.forEach(url => URL.revokeObjectURL(url)); ownedUrls.clear();
    cache.clear();
    if (image) image.src = "";
  }
  signal?.addEventListener("abort", destroy, { once: true });
  if (signal?.aborted) { destroy(); throw cancelled(); }

  try {
    if (attachment.contentType.startsWith("image/")) {
      image = new Image(); image.src = attachment.url;
      await image.decode();
      aspect = clamp(image.naturalWidth / image.naturalHeight, .2, 3);
    } else {
      const library = await pdfLibrary();
      if (disposed) throw cancelled();
      loadingTask = library.getDocument({
        url: attachment.url,
        cMapUrl: new URL("./vendor/pdfjs/cmaps/", import.meta.url).href, cMapPacked: true,
        standardFontDataUrl: new URL("./vendor/pdfjs/standard_fonts/", import.meta.url).href,
        wasmUrl: new URL("./vendor/pdfjs/wasm/", import.meta.url).href,
        isEvalSupported: false, enableXfa: false, useSystemFonts: true,
        canvasMaxAreaInBytes: 16000000
      });
      pdf = await loadingTask.promise;
      count = pdf.numPages;
      const first = await pdf.getPage(1), bounds = first.getViewport({ scale: 1 });
      aspect = bounds.width / bounds.height;
    }
    if (disposed) throw cancelled();

    host.removeAttribute("role");
    host.classList.add("pc-paper-reader");
    host.innerHTML = `<div class="pc-paper-stage" tabindex="0" role="region" aria-busy="true" aria-label="문서 페이지. 좌우로 밀거나 방향키로 넘길 수 있어요."><div class="pc-paper-book"></div><span class="pc-paper-loading">첫 페이지를 준비하는 중…</span></div>
      <div class="pc-paper-controls"><button type="button" data-paper-prev aria-label="이전 페이지" disabled>‹</button><label class="pc-paper-page-number"><input type="number" min="1" max="${count}" value="1" inputmode="numeric" aria-label="페이지 번호" disabled><span>/ ${count}</span></label><button type="button" data-paper-next aria-label="다음 페이지" disabled>›</button><button type="button" data-paper-zoom aria-label="페이지 확대" disabled>확대</button></div>
      <p class="pc-paper-help">${count === 1 ? "한 장의 자료예요. 확대해서 자세히 볼 수 있어요." : "좌우로 밀거나 종이 가장자리를 눌러 넘겨 보세요."}</p><p class="pc-paper-status" role="status" aria-live="polite"></p><p class="sr-only pc-paper-announcement" aria-live="polite"></p><p class="sr-only pc-paper-text"></p>`;
    const stage = host.querySelector(".pc-paper-stage"), container = host.querySelector(".pc-paper-book");
    const previous = host.querySelector("[data-paper-prev]"), next = host.querySelector("[data-paper-next]");
    const pageNumber = host.querySelector("input"), status = host.querySelector(".pc-paper-status");
    container.dataset.stack = count > 1 ? "multiple" : "single";
    nodes = Array.from({ length: count }, (_, index) => {
      const page = document.createElement("div");
      page.className = "pc-paper-sheet"; page.dataset.paperPage = index + 1;
      page.setAttribute("aria-hidden", index ? "true" : "false");
      const picture = document.createElement("img");
      picture.alt = `${attachment.fileName} · ${index + 1}페이지`; picture.draggable = false;
      const placeholder = document.createElement("span");
      placeholder.className = "pc-paper-placeholder"; placeholder.textContent = "페이지를 준비하는 중…";
      page.append(picture, placeholder); return page;
    });
    function wake() { book?.getRender()?.pcWake?.(); }
    function updateControls() {
      if (disposed) return;
      const locked = busy || phase !== "read";
      previous.disabled = locked || current === 0; next.disabled = locked || current === count - 1;
      pageNumber.disabled = locked; pageNumber.value = String(current + 1);
      stage.dataset.phase = phase;
      stage.dataset.page = current + 1;
      nodes.forEach((node, index) => node.setAttribute("aria-hidden", index === current ? "false" : "true"));
    }
    function layout() {
      if (disposed) return;
      const fit = Math.max(80, Math.min(stage.clientWidth - 32, (stage.clientHeight - 28) * aspect, 730));
      width = fit * (zoomed ? 1.85 : 1); height = width / aspect;
      container.style.width = `${width}px`; container.style.height = `${height}px`;
      if (book) {
        Object.assign(book.getSettings(), { width, height, minWidth: width, maxWidth: width, minHeight: height, maxHeight: height });
        book.getRender().update(); wake();
      }
    }
    layout();

    async function renderPage(index, pixels) {
      if (disposed) throw cancelled();
      if (image) return { url: attachment.url, pixels: Infinity, owned: false };
      const page = await pdf.getPage(index + 1), base = page.getViewport({ scale: 1 });
      const scale = Math.min(pixels / base.width, Math.sqrt(2200000 / (base.width * base.height)));
      const viewport = page.getViewport({ scale }), canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      const task = page.render({ canvasContext: canvas.getContext("2d", { alpha: false }), viewport });
      rendering.add(task);
      try { await task.promise; } finally { rendering.delete(task); }
      if (disposed) { canvas.width = canvas.height = 0; throw cancelled(); }
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      canvas.width = canvas.height = 0;
      page.cleanup();
      if (!blob || disposed) throw cancelled();
      const url = URL.createObjectURL(blob); ownedUrls.add(url);
      return { url, pixels, owned: true };
    }
    async function ensure(index) {
      if (index < 0 || index >= count || disposed) return;
      const pixels = Math.ceil(width * Math.min(devicePixelRatio || 1, 2));
      const old = cache.get(index);
      if (old && old.pixels >= pixels) return old.promise;
      const entry = { pixels, promise: null, url: "", owned: false };
      entry.promise = queue.then(async () => {
        const result = await renderPage(index, pixels);
        if (disposed || cache.get(index) !== entry) { if (result.owned) URL.revokeObjectURL(result.url); throw cancelled(); }
        Object.assign(entry, result);
        const img = nodes[index].querySelector("img");
        img.src = entry.url; await img.decode();
        if (disposed) throw cancelled();
        nodes[index].classList.add("pc-paper-loaded");
        if (old?.owned) URL.revokeObjectURL(old.url);
        return entry;
      }).catch(error => {
        if (cache.get(index) === entry) cache.delete(index);
        if (entry.owned) URL.revokeObjectURL(entry.url);
        throw error;
      });
      cache.set(index, entry);
      queue = entry.promise.catch(() => {});
      return entry.promise;
    }
    function prune() {
      for (const [index, entry] of cache) {
        if (Math.abs(index - current) <= 2 || !entry.url) continue;
        if (entry.owned) URL.revokeObjectURL(entry.url);
        nodes[index].querySelector("img").removeAttribute("src");
        nodes[index].classList.remove("pc-paper-loaded"); cache.delete(index);
      }
    }
    async function nearby() {
      const center = current;
      try {
        for (const offset of [0, 1, -1, 2, -2]) if (!disposed && center === current) await ensure(center + offset);
        if (!disposed) prune();
      } catch (error) { if (!disposed && error.name !== "AbortError") status.textContent = "일부 페이지를 불러오지 못했어요. 넘기면 다시 시도해요."; }
    }
    async function describe() {
      if (!pdf) return;
      const index = current;
      try {
        const page = await pdf.getPage(index + 1), text = await page.getTextContent();
        if (!disposed && index === current) host.querySelector(".pc-paper-text").textContent = text.items.map(item => item.str || "").join(" ");
      } catch {}
    }
    async function go(index) {
      index = clamp(index, 0, count - 1);
      if (disposed || busy || phase !== "read" || index === current) return;
      interacted = true; stopFan(); busy = true; updateControls(); status.textContent = "페이지를 준비하는 중…";
      try {
        await ensure(index);
        if (disposed) return;
        status.textContent = "";
        if (reduced.matches || zoomed || Math.abs(index - current) !== 1) { book.turnToPage(index); wake(); }
        else if (index > current) book.flipNext("bottom");
        else book.flipPrev("bottom");
      } catch (error) { if (!disposed) status.textContent = "페이지를 불러오지 못했어요. 다시 넘겨 주세요."; }
      finally { busy = false; updateControls(); }
    }

    await ensure(0);
    if (disposed) throw cancelled();
    book = new PageFlip(container, { width, height, size: "fixed", autoSize: false, usePortrait: true, useMouseEvents: false, showCover: false, showPageCorners: false, drawShadow: true, maxShadowOpacity: .22, flippingTime: 440, mobileScrollSupport: false });
    book.on("flip", event => {
      current = event.data; status.textContent = "";
      host.querySelector(".pc-paper-announcement").textContent = `${current + 1} / ${count}페이지`;
      updateControls(); nearby(); describe(); wake();
    });
    book.on("changeState", event => { phase = event.data; updateControls(); });
    book.loadFromHTML(nodes);
    stage.removeAttribute("aria-busy"); stage.querySelector(".pc-paper-loading")?.remove();
    host.querySelector("[data-paper-zoom]").disabled = false;
    updateControls(); describe();
    resize = new ResizeObserver(() => { stopFan(); layout(); if (phase === "read") nearby(); });
    resize.observe(stage);
    previous.addEventListener("click", () => go(current - 1), options);
    next.addEventListener("click", () => go(current + 1), options);
    pageNumber.addEventListener("change", () => { const target = Number(pageNumber.value); if (Number.isInteger(target) && target >= 1 && target <= count) go(target - 1); else pageNumber.value = String(current + 1); }, options);
    stage.addEventListener("keydown", event => {
      const key = event.key;
      if (!["ArrowRight", "ArrowLeft", "PageDown", "PageUp", "Home", "End"].includes(key)) return;
      event.preventDefault(); go(key === "Home" ? 0 : key === "End" ? count - 1 : current + (["ArrowRight", "PageDown"].includes(key) ? 1 : -1));
    }, options);
    host.querySelector("[data-paper-zoom]").addEventListener("click", event => {
      if (phase !== "read" || busy) return;
      interacted = true; stopFan(); zoomed = !zoomed; stage.classList.toggle("pc-paper-zoomed", zoomed);
      event.currentTarget.textContent = zoomed ? "맞춤" : "확대";
      event.currentTarget.setAttribute("aria-label", zoomed ? "페이지 화면에 맞추기" : "페이지 확대");
      layout(); nearby(); stage.scrollLeft = stage.scrollTop = 0;
    }, options);

    stage.addEventListener("pointerdown", event => {
      if (pointer) { endPointer(true); return; }
      if (count < 2 || busy || phase !== "read" || zoomed || (event.pointerType === "mouse" && event.button !== 0)) return;
      interacted = true; stopFan();
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, rect: container.getBoundingClientRect(), moved: false, direction: 0 };
      stage.setPointerCapture(event.pointerId);
    }, options);
    stage.addEventListener("pointermove", event => {
      if (!pointer || pointer.id !== event.pointerId || zoomed || reduced.matches) return;
      const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
      if (!pointer.moved && Math.abs(dx) < 7) return;
      if (!pointer.moved) {
        pointer.direction = dx < 0 ? 1 : -1;
        const target = current + pointer.direction;
        if (target < 0 || target >= count) return;
        if (!nodes[target].classList.contains("pc-paper-loaded")) { ensure(target).catch(() => {}); return; }
        pointer.moved = true;
        pointer.origin = { x: pointer.direction > 0 ? width - 1 : -width + 1, y: clamp(pointer.y - pointer.rect.top, 1, height - 1) };
        book.startUserTouch(pointer.origin);
        // A single-sheet view maps a screen-width swipe across both sides of
        // the paper. Seed the chosen corner before a coalesced large move.
        book.userMove({ x: pointer.origin.x - pointer.direction * 8, y: pointer.origin.y }, true);
      }
      book.userMove({ x: pointer.origin.x + dx * 2, y: clamp(pointer.origin.y + dy, 1, height - 1) }, true);
      wake();
    }, options);
    function endPointer(cancel, event) {
      if (!pointer || (event && event.pointerId !== pointer.id)) return;
      const held = pointer; pointer = null;
      if (held.moved) {
        if (cancel) book.userMove(held.origin, true);
        book.userStop(held.origin); wake();
      } else if (!cancel && event) {
        const dx = event.clientX - held.x;
        const direction = Math.abs(dx) > 24 ? (dx < 0 ? 1 : -1) : (held.x - held.rect.left > width / 2 ? 1 : -1);
        go(current + direction);
      }
      if (stage.hasPointerCapture(held.id)) stage.releasePointerCapture(held.id);
    }
    stage.addEventListener("pointerup", event => endPointer(false, event), options);
    stage.addEventListener("pointercancel", event => endPointer(true, event), options);
    stage.addEventListener("lostpointercapture", event => endPointer(true, event), options);
    reduced.addEventListener("change", event => { if (event.matches) { endPointer(true); stopFan(); book?.getRender().finishAnimation(); wake(); } }, options);

    // Fan the first actual sheets, then settle them into the same reading position.
    const showFan = async () => {
      await ensure(1); await ensure(2);
      if (disposed || interacted || zoomed || reduced.matches || current || phase !== "read") return;
      fan = document.createElement("div"); fan.className = "pc-paper-fan"; fan.setAttribute("aria-hidden", "true");
      const total = Math.min(count, 3);
      for (let index = total - 1; index >= 0; index--) {
        const sheet = document.createElement("div"); sheet.className = "pc-paper-fan-sheet";
        sheet.style.cssText = `width:${width}px;height:${height}px;left:calc(50% - ${width / 2}px);top:calc(50% - ${height / 2}px);z-index:${5 - index}`;
        const picture = nodes[index].querySelector("img").cloneNode(); picture.alt = ""; sheet.append(picture); fan.append(sheet);
        fanAnimations.push(sheet.animate([
          { transform: `translate(${index * 12}px,${24 + index * 10}px) rotate(${-1.4 * (index + 1)}deg)`, opacity: 0 },
          { opacity: 1, offset: .2 },
          { transform: "none", opacity: 1 }
        ], { duration: 420, delay: (total - 1 - index) * 28, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" }));
      }
      stage.append(fan); container.classList.add("pc-paper-entering");
      Promise.all(fanAnimations.map(animation => animation.finished)).then(stopFan, () => {});
    };
    if (!reduced.matches) showFan().catch(() => {});
    nearby();
    return { destroy };
  } catch (error) {
    destroy();
    if (signal?.aborted) throw cancelled();
    if (error.name === "PasswordException") throw new Error("암호가 걸린 PDF예요. 원본을 다운로드해서 열어 주세요.");
    throw error;
  }
}
