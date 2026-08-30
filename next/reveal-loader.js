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

    body.pincon-reveal-loader.pincon-boot-done #pinconBoot {
      opacity: 1 !important;
      visibility: visible !important;
    }

    #pinconBoot {
      max-width: 100vw;
      max-height: 100dvh;
      overflow: clip !important;
      contain: strict;
      background: var(--md-sys-color-background, #f7f9f1) !important;
      transition: background-color 120ms linear, opacity 160ms cubic-bezier(.2,0,0,1) !important;
    }

    #pinconBoot.pincon-boot__revealing {
      background: transparent !important;
    }

    #pinconBootField {
      position: absolute;
      inset: 0;
      overflow: clip;
      contain: strict;
      pointer-events: none;
    }

    .pincon-reveal-tile {
      position: absolute;
      width: var(--tile-size);
      height: calc(var(--tile-size) * 1.287);
      display: grid;
      place-items: center;
      opacity: 1;
      margin: 0;
      padding: 0;
      border: 0 !important;
      outline: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      overflow: visible !important;
      transform: translate(-50%, -50%) scale(.82) rotate(var(--tile-rotation));
      transform-origin: center;
      transition:
        opacity 180ms cubic-bezier(.2,0,0,1),
        transform 360ms cubic-bezier(.2,.8,.2,1);
      will-change: opacity, transform;
    }

    .pincon-reveal-tile > img {
      width: 100% !important;
      height: 100% !important;
      display: block;
      margin: 0;
      padding: 0;
      border: 0 !important;
      outline: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      object-fit: fill;
      filter: saturate(1.04);
      user-select: none;
      -webkit-user-drag: none;
    }

    .pincon-reveal-tile.is-visible {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1.18) rotate(var(--tile-rotation));
    }

    .pincon-reveal-tile.is-leaving {
      opacity: 0;
      transform: translate(-50%, -50%) scale(.5) rotate(calc(var(--tile-rotation) + 18deg));
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

    @media (prefers-reduced-motion: reduce) {
      .pincon-reveal-tile {
        transition: opacity 120ms linear !important;
        transform: translate(-50%, -50%) scale(1.18) !important;
      }
    }
  `;
  document.head.append(style);

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const tiles = [];
  let finishRequested = false;
  let finishStarted = false;
  let fillCompleteAt = performance.now();
  const removeBoot = () => boot.parentNode?.removeChild(boot);

  function shuffle(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function seedTiles() {
    const width = Math.max(window.innerWidth, 280);
    const height = Math.max(window.innerHeight, 420);
    const shortSide = Math.min(width, height);
    const spacing = Math.max(84, Math.min(138, Math.round(shortSide / 3.8)));
    const cols = Math.ceil(width / spacing) + 7;
    const rows = Math.ceil(height / spacing) + 7;
    const tileSize = Math.round(spacing * 4.35);
    const fragment = document.createDocumentFragment();

    for (let row = -3; row < rows - 3; row += 1) {
      for (let col = -3; col < cols - 3; col += 1) {
        const tile = document.createElement("span");
        tile.className = "pincon-reveal-tile";
        tile.setAttribute("aria-hidden", "true");

        const jitterX = (Math.random() - 0.5) * spacing * 0.12;
        const jitterY = (Math.random() - 0.5) * spacing * 0.12;
        tile.style.left = `${col * spacing + spacing / 2 + jitterX}px`;
        tile.style.top = `${row * spacing + spacing / 2 + jitterY}px`;
        tile.style.setProperty("--tile-size", `${tileSize * (0.98 + Math.random() * 0.12)}px`);
        tile.style.setProperty("--tile-rotation", `${-30 + Math.random() * 60}deg`);

        const image = document.createElement("img");
        image.src = "./assets/loader-drop.svg";
        image.alt = "";
        image.decoding = "async";
        tile.append(image);
        tiles.push(tile);
        fragment.append(tile);
      }
    }

    field.replaceChildren(fragment);

    if (reducedMotion) {
      tiles.forEach((tile) => tile.classList.add("is-visible"));
      fillCompleteAt = performance.now() + 120;
      return;
    }

    const appearanceOrder = shuffle(tiles);
    const step = Math.max(2, Math.min(10, Math.floor(420 / Math.max(appearanceOrder.length, 1))));
    appearanceOrder.forEach((tile, index) => {
      window.setTimeout(() => tile.classList.add("is-visible"), index * step + Math.random() * 28);
    });
    fillCompleteAt = performance.now() + appearanceOrder.length * step + 300;
  }

  function completeReveal() {
    document.body.classList.add("pincon-boot-done");
    document.body.classList.remove("pincon-reveal-loader");
    removeBoot();
    style.remove();
    globalThis.PinConRevealLoader = null;
  }

  function beginReveal() {
    if (finishStarted) return;
    finishStarted = true;
    boot.classList.add("pincon-boot__revealing");

    if (reducedMotion) {
      tiles.forEach((tile) => tile.classList.add("is-leaving"));
      window.setTimeout(completeReveal, 150);
      return;
    }

    const exitOrder = shuffle(tiles);
    const step = Math.max(3, Math.min(15, Math.floor(680 / Math.max(exitOrder.length, 1))));
    exitOrder.forEach((tile, index) => {
      window.setTimeout(() => {
        tile.classList.remove("is-visible");
        tile.classList.add("is-leaving");
      }, index * step + Math.random() * 40);
    });

    window.setTimeout(completeReveal, exitOrder.length * step + 420);
  }

  function finish() {
    if (finishRequested) return;
    finishRequested = true;
    const wait = Math.max(0, fillCompleteAt - performance.now());
    window.setTimeout(beginReveal, wait);
  }

  seedTiles();
  boot.remove = finish;
  globalThis.PinConRevealLoader = Object.freeze({ finish });

  window.setTimeout(finish, 3200);
}
