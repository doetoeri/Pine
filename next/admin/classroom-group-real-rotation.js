const root = document.querySelector("#adminApp");

const ANGLES = Object.freeze({ "↑": 0, "→": 90, "↓": 180, "←": 270 });

function installStyles() {
  if (document.querySelector("#pinconRealDeskRotationStyles")) return;

  const style = document.createElement("style");
  style.id = "pinconRealDeskRotationStyles";
  style.textContent = `
    #pinconFreeGroupDeskEditor .pincon-free-desk-shell {
      display: grid !important;
      place-items: center !important;
      overflow: visible !important;
    }

    #pinconFreeGroupDeskEditor .pincon-free-desk {
      display: flex !important;
      position: relative !important;
      z-index: 2 !important;
      width: 76% !important;
      height: 48% !important;
      min-width: 44px !important;
      min-height: 28px !important;
      box-sizing: border-box !important;
      opacity: 1 !important;
      visibility: visible !important;
      overflow: visible !important;
      border: 2px solid hsl(var(--group-hue) 42% 57%) !important;
      border-radius: 9px !important;
      background: hsl(var(--group-hue) 60% 96%) !important;
      color: var(--md-sys-color-on-surface, #1b1c1b) !important;
      box-shadow: 0 3px 9px rgb(0 0 0 / .12) !important;
      transform: rotate(var(--desk-angle, 0deg)) !important;
      transform-origin: center !important;
      transition: transform .2s ease, box-shadow .16s ease !important;
    }

    #pinconFreeGroupDeskEditor .pincon-free-desk::before {
      content: "";
      position: absolute;
      left: 27%;
      right: 27%;
      bottom: -9px;
      height: 6px;
      border-radius: 3px 3px 7px 7px;
      border: 1px solid hsl(var(--group-hue) 36% 55% / .8);
      background: hsl(var(--group-hue) 45% 86%);
      pointer-events: none;
    }

    #pinconFreeGroupDeskEditor .pincon-free-desk > small,
    #pinconFreeGroupDeskEditor .pincon-free-desk > strong {
      display: block !important;
      opacity: 1 !important;
      visibility: visible !important;
      color: inherit !important;
      transform: rotate(var(--desk-counter-angle, 0deg)) !important;
      transform-origin: center !important;
    }

    #pinconFreeGroupDeskEditor .pincon-free-desk > b {
      opacity: 0 !important;
      position: absolute !important;
      pointer-events: none !important;
    }
  `;

  document.head.appendChild(style);
}

function readAngle(desk) {
  const arrow = desk.querySelector("b")?.textContent?.trim() || "↑";
  return ANGLES[arrow] ?? 0;
}

function applyRotations() {
  document.querySelectorAll("#pinconFreeGroupDeskEditor .pincon-free-desk").forEach((desk) => {
    const angle = readAngle(desk);
    desk.style.setProperty("--desk-angle", `${angle}deg`);
    desk.style.setProperty("--desk-counter-angle", `${-angle}deg`);
    desk.dataset.rotation = String(angle);
  });
}

let queued = false;
function refresh() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    installStyles();
    applyRotations();
  });
}

if (root) {
  new MutationObserver(refresh).observe(root, { childList: true, subtree: true });
  refresh();
}
