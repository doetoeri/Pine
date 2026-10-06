(() => {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  let dial = null;
  let dialCells = [];
  let drag = null;
  let resizeTimer = 0;
  let strokeTimer = 0;

  function hasData() {
    return typeof hanjaSet !== 'undefined' && Array.isArray(hanjaSet) && hanjaSet.length > 0;
  }

  function activeIndex() {
    if (!hasData()) return 0;
    try {
      return Number.isFinite(index) ? index : 0;
    } catch (_) {
      return 0;
    }
  }

  function circularDistance(itemIndex, currentIndex) {
    const length = hanjaSet.length;
    let delta = itemIndex - currentIndex;
    if (delta > length / 2) delta -= length;
    if (delta < -length / 2) delta += length;
    return delta;
  }

  function directionTo(targetIndex) {
    const currentIndex = activeIndex();
    const delta = circularDistance(targetIndex, currentIndex);
    return delta === 0 ? 0 : delta > 0 ? 1 : -1;
  }

  function jumpTo(targetIndex, source = null) {
    if (!hasData()) return;
    const target = ((targetIndex % hanjaSet.length) + hanjaSet.length) % hanjaSet.length;
    if (target === activeIndex()) {
      syncRosters();
      return;
    }

    const writeDialog = source?.closest?.('#writeDialog');
    const searchDialog = source?.closest?.('#searchDialog');
    if (writeDialog?.open) writeDialog.close();
    if (searchDialog?.open) searchDialog.close();

    const direction = directionTo(target);
    try {
      index = target;
      localStorage.setItem('pincon-hanja-index', String(index));
      if (typeof render === 'function') render(direction);
    } catch (_) {
      return;
    }

    syncAll();

    if (writeDialog && typeof openWrite === 'function') {
      requestAnimationFrame(() => openWrite());
    }
  }

  /* ------------------------------------------------------------------------
     Same Hanja roster in every visible surface
     ------------------------------------------------------------------------ */
  function rosterMarkup(compact = false) {
    if (!hasData()) return '';
    return `
      ${compact ? '' : `<div class="hanja-roster-head"><strong>전체 한자</strong><span>${hanjaSet.length}자 · 어느 화면에서도 같은 순서</span></div>`}
      <div class="hanja-roster" role="listbox" aria-label="전체 한자 목록">
        ${hanjaSet.map((item, i) => `<button type="button" role="option" data-hanja-roster-index="${i}" aria-label="${item.hun} ${item.eum}, ${item.char}">${item.char}</button>`).join('')}
      </div>`;
  }

  function bindRoster(shell) {
    if (!shell || shell.dataset.rosterBound === 'true') return;
    shell.dataset.rosterBound = 'true';
    shell.addEventListener('click', event => {
      const button = event.target.closest('[data-hanja-roster-index]');
      if (!button) return;
      jumpTo(Number(button.dataset.hanjaRosterIndex), button);
    });
  }

  function installRosters() {
    if (!hasData()) return;

    const studyMeta = $('.study-meta');
    if (studyMeta && !$('#hanjaRosterMain')) {
      const shell = document.createElement('section');
      shell.id = 'hanjaRosterMain';
      shell.className = 'hanja-roster-shell';
      shell.setAttribute('aria-label', '전체 한자 빠른 이동');
      shell.innerHTML = rosterMarkup(false);
      studyMeta.insertAdjacentElement('afterend', shell);
      bindRoster(shell);
    }

    const writeDialog = $('#writeDialog');
    if (writeDialog && !$('.dialog-hanja-roster', writeDialog)) {
      const shell = document.createElement('div');
      shell.className = 'dialog-hanja-roster';
      shell.innerHTML = rosterMarkup(true);
      const head = $('.dialog-head', writeDialog);
      if (head) head.insertAdjacentElement('afterend', shell);
      else writeDialog.prepend(shell);
      bindRoster(shell);
    }

    const searchBox = $('.search-box');
    if (searchBox && !$('.dialog-hanja-roster', searchBox)) {
      const shell = document.createElement('div');
      shell.className = 'dialog-hanja-roster';
      shell.innerHTML = rosterMarkup(true);
      const label = $('label', searchBox);
      if (label) label.insertAdjacentElement('afterend', shell);
      else searchBox.prepend(shell);
      bindRoster(shell);
    }
  }

  function syncRosters() {
    const currentIndex = activeIndex();
    $$('.hanja-roster').forEach(roster => {
      const currentButton = $(`[data-hanja-roster-index="${currentIndex}"]`, roster);
      $$('[data-hanja-roster-index]', roster).forEach(button => {
        const active = Number(button.dataset.hanjaRosterIndex) === currentIndex;
        button.classList.toggle('is-current', active);
        button.setAttribute('aria-selected', String(active));
      });
      if (currentButton && !reduced) {
        requestAnimationFrame(() => currentButton.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }));
      }
    });
  }

  /* ------------------------------------------------------------------------
     Parallel dial-like carousel inside the lens
     ------------------------------------------------------------------------ */
  function dialGap() {
    const disc = $('.lens-disc');
    const width = disc?.clientWidth || 330;
    return Math.max(112, Math.min(190, width * .43));
  }

  function createDialGlyph(cell, item, itemIndex, size) {
    const target = $('.dial-glyph-target-v3', cell);
    if (!target) return;
    if (!window.HanziWriter) {
      target.textContent = item.char;
      target.style.fontFamily = 'var(--hanja)';
      target.style.fontSize = `${Math.round(size * .72)}px`;
      return;
    }

    const id = `dialGlyphV3-${itemIndex}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    target.id = id;
    try {
      HanziWriter.create(id, item.char, {
        width: size,
        height: size,
        padding: Math.max(8, Math.round(size * .045)),
        showOutline: false,
        showCharacter: true,
        strokeColor: '#1d1d1a',
        radicalColor: '#bd332e'
      });
    } catch (_) {
      target.textContent = item.char;
      target.style.fontFamily = 'var(--hanja)';
      target.style.fontSize = `${Math.round(size * .72)}px`;
    }
  }

  function buildDial() {
    if (!hasData()) return;
    const disc = $('.lens-disc');
    const strokeLayer = $('#strokeLayer');
    if (!disc) return;

    dial?.remove();
    dial = document.createElement('div');
    dial.className = 'hanja-dial-v3';
    dial.setAttribute('aria-hidden', 'true');

    dialCells = hanjaSet.map((item, itemIndex) => {
      const cell = document.createElement('div');
      cell.className = 'dial-cell-v3';
      cell.dataset.itemIndex = String(itemIndex);
      cell.innerHTML = '<div class="dial-glyph-target-v3"></div>';
      dial.appendChild(cell);
      return cell;
    });

    if (strokeLayer) disc.insertBefore(dial, strokeLayer);
    else disc.appendChild(dial);

    requestAnimationFrame(() => {
      const size = Math.max(118, Math.floor((disc.clientWidth || 330) * .55));
      dialCells.forEach((cell, i) => createDialGlyph(cell, hanjaSet[i], i, size));
      updateDialSlots(true);
    });

    document.body.classList.add('dial-v3-ready');
  }

  function updateDialSlots(immediate = false) {
    if (!dial || !dialCells.length || !hasData()) return;
    const currentIndex = activeIndex();
    if (immediate) dial.classList.add('is-dragging');

    dialCells.forEach((cell, itemIndex) => {
      const slot = circularDistance(itemIndex, currentIndex);
      const distance = Math.abs(slot);
      cell.style.setProperty('--slot', String(slot));
      cell.dataset.distance = distance <= 3 ? String(distance) : 'far';
      cell.toggleAttribute('data-current', distance === 0);
    });

    if (immediate) requestAnimationFrame(() => dial?.classList.remove('is-dragging'));
  }

  function setDialDrag(px) {
    dial?.style.setProperty('--dial-drag-x', `${px.toFixed(1)}px`);
  }

  function installDialDrag() {
    const lens = $('#lens');
    if (!lens || lens.dataset.dialDragV3 === 'true') return;
    lens.dataset.dialDragV3 = 'true';

    lens.addEventListener('pointerdown', event => {
      if (document.body.classList.contains('stroke-mode-v3')) return;
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastT: performance.now(),
        axis: null
      };
      lens.classList.add('is-dial-dragging');
      dial?.classList.add('is-dragging');
      try { lens.setPointerCapture(event.pointerId); } catch (_) {}
    });

    lens.addEventListener('pointermove', event => {
      if (!drag || drag.pointerId !== event.pointerId || document.body.classList.contains('stroke-mode-v3')) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;

      if (!drag.axis && Math.hypot(dx, dy) > 8) drag.axis = Math.abs(dx) > Math.abs(dy) * 1.08 ? 'x' : 'y';
      if (drag.axis !== 'x') return;

      const gap = dialGap();
      const clamped = Math.max(-gap * 1.08, Math.min(gap * 1.08, dx));
      setDialDrag(clamped);
      drag.lastX = event.clientX;
      drag.lastT = performance.now();
    }, { passive: true });

    const finish = event => {
      if (!drag || (event.pointerId != null && drag.pointerId !== event.pointerId)) return;
      const dx = (event.clientX ?? drag.lastX) - drag.startX;
      const dy = (event.clientY ?? drag.startY) - drag.startY;
      const committed = drag.axis === 'x' && Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy) * 1.15;
      const gap = dialGap();

      dial?.classList.remove('is-dragging');
      dial?.classList.add('is-settling');
      setDialDrag(committed ? (dx < 0 ? -gap : gap) : 0);
      lens.classList.remove('is-dial-dragging');

      const pointerId = drag.pointerId;
      drag = null;
      try { lens.releasePointerCapture(pointerId); } catch (_) {}

      window.setTimeout(() => {
        if (!dial) return;
        dial.classList.remove('is-settling');
        if (!committed) setDialDrag(0);
      }, 240);
    };

    lens.addEventListener('pointerup', finish);
    lens.addEventListener('pointercancel', finish);
  }

  /* ------------------------------------------------------------------------
     Easier stroke-order mode
     ------------------------------------------------------------------------ */
  function ensureStrokeDock() {
    const reading = $('.reading-block');
    if (!reading || $('#strokeDockV3')) return;
    const dock = document.createElement('div');
    dock.id = 'strokeDockV3';
    dock.className = 'stroke-dock-v3';
    dock.innerHTML = `
      <div class="stroke-dock-v3-head">
        <strong>획순을 바로 따라보세요</strong>
        <span id="strokeDockCountV3">0획</span>
      </div>
      <div class="stroke-dock-v3-actions">
        <button type="button" data-stroke-v3="play">▶ 처음부터</button>
        <button type="button" data-stroke-v3="slow">½× 천천히</button>
        <button type="button" data-stroke-v3="write">✎ 따라쓰기</button>
      </div>`;
    reading.insertAdjacentElement('afterend', dock);

    dock.addEventListener('click', event => {
      const button = event.target.closest('[data-stroke-v3]');
      if (!button) return;
      const action = button.dataset.strokeV3;
      if (action === 'play') playStrokesV3(false);
      else if (action === 'slow') playStrokesV3(true);
      else if (action === 'write' && typeof openWrite === 'function') openWrite();
    });
  }

  function playStrokesV3(slow = false) {
    if (!hasData() || !window.HanziWriter) {
      if (typeof playStrokeAnimation === 'function') playStrokeAnimation();
      return;
    }

    const layer = $('#strokeLayer');
    if (!layer) return;
    const item = hanjaSet[activeIndex()];
    layer.innerHTML = '<div id="strokeTargetV3"></div>';
    layer.classList.add('is-visible');

    requestAnimationFrame(() => {
      const width = Math.max(190, Math.floor(layer.clientWidth || 240));
      const height = Math.max(190, Math.floor(layer.clientHeight || width));
      try {
        strokeWriter = HanziWriter.create('strokeTargetV3', item.char, {
          width,
          height,
          padding: 14,
          strokeAnimationSpeed: slow ? .62 : 1.12,
          delayBetweenStrokes: slow ? 330 : 165,
          showOutline: true,
          showCharacter: false,
          strokeColor: '#1d1d1a',
          outlineColor: '#d8d6cf',
          radicalColor: '#bd332e'
        });
        strokeWriter.animateCharacter();
      } catch (_) {
        if (typeof playStrokeAnimation === 'function') playStrokeAnimation();
      }
    });
  }

  function updateStrokeMode(autoplay = false) {
    const modeButton = $('.mode-tab.is-active');
    const strokeMode = modeButton?.dataset.mode === 'strokes';
    document.body.classList.toggle('stroke-mode-v3', strokeMode);

    const count = $('#strokeDockCountV3');
    if (count && hasData()) count.textContent = `${hanjaSet[activeIndex()].strokes}획`;

    if (strokeMode && autoplay) {
      clearTimeout(strokeTimer);
      strokeTimer = window.setTimeout(() => playStrokesV3(false), 90);
    }
  }

  function installStrokeMode() {
    ensureStrokeDock();
    $$('.mode-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        requestAnimationFrame(() => updateStrokeMode(tab.dataset.mode === 'strokes'));
      });
    });
    updateStrokeMode(false);
  }

  /* ------------------------------------------------------------------------
     More Lore Glass surfaces, but keep real refraction concentrated in lens
     ------------------------------------------------------------------------ */
  function setSurfacePoint(surface, event) {
    const rect = surface.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    surface.style.setProperty('--lg-x', `${(x * 100).toFixed(1)}%`);
    surface.style.setProperty('--lg-y', `${(y * 100).toFixed(1)}%`);
  }

  function bindGlassSurface(surface) {
    if (!surface || surface.dataset.loreSurfaceBoundV3 === 'true') return;
    surface.dataset.loreSurfaceBoundV3 = 'true';
    surface.dataset.loreSurfaceV3 = 'true';

    if (reduced) return;
    surface.addEventListener('pointermove', event => setSurfacePoint(surface, event), { passive: true });
    surface.addEventListener('pointerdown', event => {
      setSurfacePoint(surface, event);
      surface.dataset.lorePressed = 'true';
    }, { passive: true });
    const release = () => { delete surface.dataset.lorePressed; };
    surface.addEventListener('pointerup', release, { passive: true });
    surface.addEventListener('pointercancel', release, { passive: true });
    surface.addEventListener('pointerleave', release, { passive: true });
  }

  function installGlassSurfaces() {
    const selectors = [
      '.topbar', '.study-meta', '.hanja-roster-shell', '.mode-tabs',
      '.detail-panel', '.weak-section', '.bottom-nav', '.write-dialog',
      '.search-dialog', '.stroke-dock-v3'
    ];
    selectors.forEach(selector => $$(selector).forEach(bindGlassSurface));
  }

  /* ------------------------------------------------------------------------ */
  function syncAll() {
    setDialDrag(0);
    dial?.classList.remove('is-dragging', 'is-settling');
    updateDialSlots(false);
    syncRosters();
    updateStrokeMode(document.body.classList.contains('stroke-mode-v3'));
  }

  function installObservers() {
    const main = $('#mainChar');
    if (main) {
      new MutationObserver(() => {
        syncAll();
      }).observe(main, { childList: true, characterData: true, subtree: true });
    }

    const writeDialog = $('#writeDialog');
    const searchDialog = $('#searchDialog');
    [writeDialog, searchDialog].forEach(dialog => {
      if (!dialog) return;
      new MutationObserver(() => {
        if (dialog.open) {
          syncRosters();
          installGlassSurfaces();
        }
      }).observe(dialog, { attributes: true, attributeFilter: ['open'] });
    });
  }

  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      buildDial();
      installDialDrag();
      syncAll();
    }, 140);
  }

  function init() {
    if (!hasData()) return;
    installRosters();
    buildDial();
    installDialDrag();
    installStrokeMode();
    installGlassSurfaces();
    installObservers();
    syncAll();
    window.addEventListener('resize', onResize, { passive: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
