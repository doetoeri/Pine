(() => {
  if (globalThis.__PINCON_TOUCH_STABILITY__) return;

  const nativeRAF = window.requestAnimationFrame.bind(window);
  const nativeSetInterval = window.setInterval.bind(window);
  let activePointers = 0;
  let lockUntil = 0;

  const markDown = () => {
    activePointers += 1;
    lockUntil = Number.POSITIVE_INFINITY;
  };
  const markUp = () => {
    activePointers = Math.max(0, activePointers - 1);
    if (!activePointers) lockUntil = performance.now() + 280;
  };
  const locked = () => activePointers > 0 || performance.now() < lockUntil;

  window.addEventListener("pointerdown", markDown, { capture: true, passive: true });
  window.addEventListener("pointerup", markUp, { capture: true, passive: true });
  window.addEventListener("pointercancel", markUp, { capture: true, passive: true });
  window.addEventListener("blur", () => {
    activePointers = 0;
    lockUntil = performance.now() + 120;
  }, { passive: true });

  globalThis.__PINCON_TOUCH_STABILITY__ = Object.freeze({
    locked,
    active: () => activePointers > 0,
    lastUnlockAt: () => Number.isFinite(lockUntil) ? lockUntil : performance.now(),
  });

  // Workspace rerenders replace its entire DOM. If that happens between pointerdown
  // and pointerup, mobile browsers can lose the click. Defer only those renders.
  window.requestAnimationFrame = function pinconStableRAF(callback) {
    let source = "";
    try { source = Function.prototype.toString.call(callback); } catch {}
    if (!source.includes("renderWorkspace")) return nativeRAF(callback);

    const guarded = (timestamp) => {
      if (locked()) {
        window.setTimeout(() => nativeRAF(guarded), 72);
        return;
      }
      callback(timestamp);
    };
    return nativeRAF(guarded);
  };

  // The workspace used to replace its DOM every 20 seconds even while someone was
  // touching a control. Keep background refresh, but only while idle and much less often.
  window.setInterval = function pinconStableInterval(handler, delay, ...args) {
    let source = "";
    try { source = typeof handler === "function" ? Function.prototype.toString.call(handler) : ""; } catch {}
    if (Number(delay) === 20_000 && source.includes("refreshAll")) {
      return nativeSetInterval(() => {
        if (document.visibilityState !== "visible" || locked()) return;
        try { handler(...args); } catch (error) { console.error(error); }
      }, 120_000);
    }
    return nativeSetInterval(handler, delay, ...args);
  };

  const style = document.createElement("style");
  style.id = "pincon-touch-stability-style";
  style.textContent = `
    button, a, summary, label,
    md-filled-button, md-filled-tonal-button, md-outlined-button, md-text-button,
    md-icon-button, md-filled-icon-button, md-filled-tonal-icon-button,
    .pincon-workspace-tabs button, .pincon-progress-buttons button,
    .pincon-poll-option, .floating-navigation {
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    button, [role="button"],
    md-filled-button, md-filled-tonal-button, md-outlined-button, md-text-button {
      min-height: 42px;
    }
    .pincon-next-sheet:not(.open), .pincon-v2-sheet:not(.open) {
      pointer-events: none !important;
    }
    dialog:not([open]) {
      pointer-events: none !important;
    }
    @media (pointer: coarse) {
      .pincon-workspace-tabs button,
      .pincon-progress-buttons button,
      .pincon-native-button {
        min-height: 44px;
      }
      .pincon-feature-actions {
        gap: 10px;
      }
    }
  `;
  document.head.appendChild(style);
})();