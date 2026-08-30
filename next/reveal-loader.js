const boot = document.querySelector("#pinconBoot");
const field = document.querySelector("#pinconBootField");

if (boot && field) {
  document.body.classList.add("pincon-reveal-loader");

  const style = document.createElement("style");
  style.dataset.pinconRevealLoader = "true";
  style.textContent = `
    body.pincon-reveal-loader #app {
      visibility: visible !important;
    }

    #pinconBoot {
      overflow: hidden !important;
      background:
        radial-gradient(circle at 50% 42%, rgba(117, 217, 75, .12), transparent 34%),
        var(--md-sys-color-background, #f7f9f1) !important;
      transition: opacity 220ms cubic-bezier(.2, 0, 0, 1), visibility 220ms step-end !important;
    }

    #pinconBoot.pincon-loader--leaving {
      opacity: 0 !important;
      visibility: hidden !important;
    }

    #pinconBootField {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      padding: max(28px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right)) max(28px, env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left));
      box-sizing: border-box;
      pointer-events: none;
    }

    .pincon-loader__content {
      width: min(280px, calc(100vw - 48px));
      display: grid;
      justify-items: center;
      color: var(--md-sys-color-on-background, #191d16);
      text-align: center;
      animation: pincon-loader-enter 420ms cubic-bezier(.2, .8, .2, 1) both;
    }

    .pincon-loader__mark {
      width: 104px;
      height: 112px;
      display: grid;
      place-items: center;
      margin-bottom: 20px;
      filter: drop-shadow(0 16px 24px rgba(45, 170, 0, .16));
    }

    .pincon-loader__leaf {
      width: 88px;
      height: 112px;
      display: block;
      background: linear-gradient(155deg, #ffe62b 0%, #8bec32 28%, #49d716 58%, #2daa00 100%);
      background-size: 180% 180%;
      -webkit-mask: url("./assets/loader-drop.svg") center / contain no-repeat;
      mask: url("./assets/loader-drop.svg") center / contain no-repeat;
      animation: pincon-loader-gradient 1.8s ease-in-out infinite alternate;
    }

    .pincon-loader__title {
      margin: 0;
      font: 700 24px/1.2 "Noto Sans KR", system-ui, sans-serif;
      letter-spacing: -.035em;
    }

    .pincon-loader__message {
      margin: 8px 0 0;
      color: var(--md-sys-color-on-surface-variant, #43483e);
      font: 500 13px/1.5 "Noto Sans KR", system-ui, sans-serif;
      letter-spacing: -.015em;
    }

    .pincon-boot__sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    @keyframes pincon-loader-enter {
      from { opacity: 0; transform: translateY(8px) scale(.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    @keyframes pincon-loader-gradient {
      0% { background-position: 0% 0%; transform: translateY(2px) scale(.98); }
      100% { background-position: 100% 100%; transform: translateY(-2px) scale(1.02); }
    }

    @media (prefers-reduced-motion: reduce) {
      .pincon-loader__content { animation: none !important; }
      .pincon-loader__leaf { animation: none !important; background-position: 50% 50%; }
    }
  `;
  document.head.append(style);

  field.innerHTML = `
    <div class="pincon-loader__content">
      <div class="pincon-loader__mark" aria-hidden="true"><span class="pincon-loader__leaf"></span></div>
      <p class="pincon-loader__title">PinCon</p>
      <p class="pincon-loader__message">오늘의 학교 정보를 준비하고 있어요</p>
    </div>`;

  let finishRequested = false;
  const minimumVisibleUntil = performance.now() + 480;
  const removeBoot = () => boot.parentNode?.removeChild(boot);

  function complete() {
    document.body.classList.add("pincon-boot-done");
    document.body.classList.remove("pincon-reveal-loader");
    removeBoot();
    style.remove();
    globalThis.PinConRevealLoader = null;
  }

  function beginExit() {
    boot.classList.add("pincon-loader--leaving");
    document.body.classList.add("pincon-boot-done");
    window.setTimeout(complete, 240);
  }

  function finish() {
    if (finishRequested) return;
    finishRequested = true;
    window.setTimeout(beginExit, Math.max(0, minimumVisibleUntil - performance.now()));
  }

  boot.remove = finish;
  globalThis.PinConRevealLoader = Object.freeze({ finish });
  window.setTimeout(finish, 3200);
}
