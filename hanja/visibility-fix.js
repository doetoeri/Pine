(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  let observer = null;
  let retryTimer = 0;

  function currentChar() {
    try {
      if (Array.isArray(hanjaSet) && hanjaSet.length) {
        const i = Number.isFinite(index) ? index : 0;
        return hanjaSet[((i % hanjaSet.length) + hanjaSet.length) % hanjaSet.length]?.char || '';
      }
    } catch (_) {}
    return $('#mainChar')?.textContent?.trim() || '';
  }

  function ensureFallback() {
    const disc = $('.lens-disc');
    if (!disc) return null;
    let fallback = $('#flatGlyphFallback');
    if (!fallback) {
      fallback = document.createElement('span');
      fallback.id = 'flatGlyphFallback';
      fallback.className = 'flat-glyph-fallback';
      fallback.setAttribute('aria-hidden', 'true');
      const strokeLayer = $('#strokeLayer');
      if (strokeLayer) disc.insertBefore(fallback, strokeLayer);
      else disc.appendChild(fallback);
    }
    return fallback;
  }

  function forceCurrentCellVisible() {
    const current = $('.dial-cell-v3[data-current]');
    if (!current) return false;
    current.style.setProperty('opacity', '1', 'important');
    current.style.setProperty('visibility', 'visible', 'important');
    current.style.setProperty('display', 'grid', 'important');
    const target = $('.dial-glyph-target-v3', current);
    if (target) {
      target.style.setProperty('opacity', '1', 'important');
      target.style.setProperty('visibility', 'visible', 'important');
    }
    const svg = $('svg', current);
    if (svg) {
      svg.style.setProperty('display', 'block', 'important');
      svg.style.setProperty('opacity', '1', 'important');
      svg.style.setProperty('visibility', 'visible', 'important');
      return true;
    }
    return false;
  }

  function syncVisibility() {
    document.documentElement.classList.add('hanja-lens-flat');
    const fallback = ensureFallback();
    if (!fallback) return;

    const char = currentChar();
    fallback.textContent = char;

    const hasDialVector = forceCurrentCellVisible();
    const staticVector = $('.vector-glyph-layer svg');
    const hasStaticVector = Boolean(staticVector);

    document.body.classList.toggle('dial-vector-ok', hasDialVector);
    document.body.classList.toggle('dial-vector-fallback', !hasDialVector);
    document.body.classList.toggle('static-vector-ok', hasStaticVector);

    // Prefer the moving HanziWriter glyph. If it is unavailable for any reason,
    // fall back to the already-rendered static vector, then finally to text.
    fallback.classList.toggle('is-visible', !hasDialVector && !hasStaticVector);

    const staticLayer = $('.vector-glyph-layer');
    if (staticLayer) {
      staticLayer.style.setProperty('opacity', hasDialVector ? '0' : '1', 'important');
      staticLayer.style.setProperty('visibility', 'visible', 'important');
    }

    const main = $('#mainChar');
    if (main) {
      const useText = !hasDialVector && !hasStaticVector;
      main.style.setProperty('opacity', useText ? '1' : '0', 'important');
      main.style.setProperty('color', useText ? '#1d1d1a' : 'transparent', 'important');
    }
  }

  function schedule() {
    cancelAnimationFrame(retryTimer);
    retryTimer = requestAnimationFrame(syncVisibility);
  }

  function install() {
    syncVisibility();
    const disc = $('.lens-disc');
    if (disc) {
      observer = new MutationObserver(schedule);
      observer.observe(disc, { childList:true, subtree:true, attributes:true, attributeFilter:['class','data-current','style'] });
    }
    document.addEventListener('pincon:hanja-set-updated', () => {
      setTimeout(syncVisibility, 0);
      setTimeout(syncVisibility, 180);
      setTimeout(syncVisibility, 520);
    });
    window.addEventListener('resize', () => setTimeout(syncVisibility, 180), { passive:true });
    // Hanzi Writer and the expanded school set arrive asynchronously. A few
    // short retries make the display robust on slower phones/tablets.
    [80, 220, 500, 900, 1500, 2400].forEach((ms) => setTimeout(syncVisibility, ms));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();