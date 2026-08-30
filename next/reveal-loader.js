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
      position: fixed;
      inset: 0;
      z-index: 9999;
      overflow: hidden !important;
      contain: strict;
      background: linear-gradient(145deg, #effbe7 0%, #dff7cf 48%, #c8f2b5 100%) !important;
      opacity: 1;
      visibility: visible;
      transition: opacity 260ms cubic-bezier(.2,0,0,1), visibility 260ms linear;
    }

    #pinconBoot.pincon-boot__revealing {
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
    }

    #pinconBootField {
      position: absolute;
      inset: clamp(28px, 6vw, 72px);
      display: grid;
      grid-template-columns: repeat(var(--pincon-loader-cols, 3), minmax(0, 1fr));
      grid-template-rows: repeat(var(--pincon-loader-rows, 4), minmax(0, 1fr));
      place-items: center;
      gap: clamp(12px, 2.5vw, 30px);
      overflow: hidden;
      pointer-events: none;
      opacity: 0;
      transform: scale(.985);
      transition: opacity 300ms cubic-bezier(.2,0,0,1), transform 420ms cubic-bezier(.2,.8,.2,1);
    }

    #pinconBootField.is-visible {
      opacity: 1;
      transform: scale(1);
    }

    .pincon-reveal-tile {
      width: min(78%, var(--pincon-leaf-size, 112px));
      aspect-ratio: 1 / 1.287;
      display: block;
      background:
        linear-gradient(
          125deg,
          #45c84b 0%,
          #69dc5b 22%,
          #b3ef8b 42%,
          #effbdc 50%,
          #99e879 60%,
          #57d052 78%,
          #3fbd47 100%
        );
      background-size: 280% 280%;
      background-position: 0% 50%;
      -webkit-mask: url("./assets/loader-drop.svg") center / contain no-repeat;
      mask: url("./assets/loader-drop.svg") center / contain no-repeat;
      filter: saturate(.86) brightness(1.02);
      opacity: .92;
      animation: pincon-leaf-gradient 2.8s ease-in-out infinite;
      animation-delay: var(--pincon-flow-delay, 0s);
      will-change: background-position;
    }

    @keyframes pincon-leaf-gradient {
      0%, 100% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
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

    @media (max-width: 599px) {
      #pinconBootField {
        inset: 34px 24px;
        gap: 12px 16px;
      }
      .pincon-reveal-tile {
        width: min(76%, 96px);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      #pinconBootField {
        transition: opacity 120ms linear !important;
        transform: none !important;
      }
      .pincon-reveal-tile {
        animation: none !important;
        background-position: 50% 50% !important;
      }
      #pinconBoot {
        transition: opacity 120ms linear !important;
      }
    }
  `;
  document.head.append(style);

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let finishRequested = false;
  let finishStarted = false;
  let minimumVisibleUntil = performance.now() + (reducedMotion ? 180 : 560);

  function layout() {
    const width = Math.max(window.innerWidth, 280);
    const height = Math.max(window.innerHeight, 420);
    const mobile = width < 600;
    const cols = mobile ? 3 : width < 1000 ? 4 : 5;
    const rows = mobile ? (height < 680 ? 4 : 5) : height < 760 ? 4 : 5;
    const count = cols * rows;
    const shortSide = Math.min(width, height);
    const leafSize = mobile
      ? Math.max(68, Math.min(96, Math.round(shortSide / 4.25)))
      : Math.max(82, Math.min(126, Math.round(shortSide / 5.25)));

    field.style.setProperty("--pincon-loader-cols", String(cols));
    field.style.setProperty("--pincon-loader-rows", String(rows));
    field.style.setProperty("--pincon-leaf-size", `${leafSize}px`);

    const fragment = document.createDocumentFragment();
    for (let index = 0; index < count; index += 1) {
      const tile = document.createElement("span");
      tile.className = "pincon-reveal-tile";
      tile.setAttribute("aria-hidden", "true");
      const row = Math.floor(index / cols);
      const col = index % cols;
      const phase = -(((row * 0.16) + (col * 0.11)) % 1.2);
      tile.style.setProperty("--pincon-flow-delay", `${phase}s`);
      fragment.append(tile);
    }
    field.replaceChildren(fragment);
  }

  function completeReveal() {
    document.body.classList.add("pincon-boot-done");
    document.body.classList.remove("pincon-reveal-loader");
    boot.remove();
    style.remove();
    globalThis.PinConRevealLoader = null;
  }

  function beginReveal() {
    if (finishStarted) return;
    finishStarted = true;
    boot.classList.add("pincon-boot__revealing");
    window.setTimeout(completeReveal, reducedMotion ? 140 : 300);
  }

  function finish() {
    if (finishRequested) return;
    finishRequested = true;
    const wait = Math.max(0, minimumVisibleUntil - performance.now());
    window.setTimeout(beginReveal, wait);
  }

  layout();
  requestAnimationFrame(() => requestAnimationFrame(() => field.classList.add("is-visible")));

  boot.remove = finish;
  globalThis.PinConRevealLoader = Object.freeze({ finish });
  window.setTimeout(finish, 3200);
}
