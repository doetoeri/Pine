(() => {
  // The optical refraction experiment is intentionally paused. This file remains
  // as a stable bootstrap point so restoring Lore Glass later is a one-file change.
  document.documentElement.classList.add('hanja-lens-flat');

  function loadScript(src, id) {
    if (id && document.getElementById(id)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      if (id) script.id = id;
      script.src = src;
      script.async = false;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`failed-to-load:${src}`));
      document.head.appendChild(script);
    });
  }

  async function boot() {
    try {
      await loadScript('./school-set.js', 'hanjaSchoolSetScript');
      await loadScript('./school-set-patch.js', 'hanjaSchoolSetPatchScript');
      // experience-v3 may already have built the smaller dial. Rebuild it
      // through its existing resize path after the full school list arrives.
      window.dispatchEvent(new Event('resize'));
      await loadScript('./test-mode.js', 'hanjaTestModeScript');
      await loadScript('./visibility-fix.js', 'hanjaVisibilityFixScript');
    } catch (error) {
      console.warn('[hanja-bootstrap] optional module load failed', error);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();