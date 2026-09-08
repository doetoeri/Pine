const root = document.querySelector("#adminApp");

const ANGLES = Object.freeze({
  "↑": 0,
  "→": 90,
  "↓": 180,
  "←": 270,
});

function installRealRotationStyles() {
  if (document.querySelector("#pinconRealDeskRotationStyles")) return;
  const style = document.createElement("style");
  style.id = "pinconRealDeskRotationStyles";
  style.textContent = `
    #pinconFreeGroupDeskEditor .pincon-free-desk {
      width: 88% !important;
      height: 58% !important;
      position: relative;
      transform: rotate(var(--desk-angle, 0deg));
      transform-origin: 50% 50%;
      transition: transform .2s cubic-bezier(.2,.8,.2,1), box-shadow .16s ease !important;
      overflow: visible;
    }

    #pinconFreeGroupDeskEditor .pincon-free-desk::before {
      content: "";
      position: absolute;
      left: 17%;
      right: 17%;
      bottom: -8px;
      height: 5px;
      border-radius: 999px;
      background: hsl(var(--group-hue) 38% 48% / .72);
      box-shadow: 0 1px 2px rgb(0 0 0 / .10);
      pointer-events: none;
    }

    #pinconFreeGroupDeskEditor .pincon-free-desk::after {
      content: "";
      position: absolute;
      left: 50%;
      bottom: -13px;
      width: 26%;
      height: 8px;
      transform: translateX(-50%);
      border: 1px solid hsl(var(--group-hue) 36% 58% / .75);
      border-radius: 4px 4px 8px 8px;
      background: hsl(var(--group-hue) 48% 89%);
      pointer-events: none;
    }

    #pinconFreeGroupDeskEditor .pincon-free-desk > small,
    #pinconFreeGroupDeskEditor .pincon-free-desk > strong {
      transform: rotate(var(--desk-counter-angle, 0deg));
      transform-origin: center;
      transition: transform .2s cubic-bezier(.2,.8,.2,1);
    }

    #pinconFreeGroupDeskEditor .pincon-free-desk > b {
      display: none !important;
    }

    #pinconFreeGroupDeskEditor .pincon-free-desk-shell {
      background: hsl(var(--group-hue) 55% 93% / .44);
    }

    #pinconFreeGroupDeskEditor .pincon-free-rotation button {
      display: grid;
      place-items: center;
      min-height: 50px;
      line-height: 1.2;
    }

    #pinconFreeGroupDeskEditor .pincon-free-rotation button .pincon-rotation-preview {
      width: 30px;
      height: 17px;
      position: relative;
      border: 1.5px solid currentColor;
      border-radius: 5px;
      transform: rotate(var(--preview-angle, 0deg));
      margin-bottom: 4px;
    }

    #pinconFreeGroupDeskEditor .pincon-free-rotation button .pincon-rotation-preview::after {
      content: "";
      position: absolute;
      left: 27%;
      right: 27%;
      bottom: -5px;
      height: 3px;
      border-radius: 999px;
      background: currentColor;
    }
  `;
  document.head.appendChild(style);
}

function angleFromDesk(desk) {
  const arrow = desk.querySelector("b")?.textContent?.trim() || "↑";
  return ANGLES[arrow] ?? 0;
}

function applyDeskRotations(scope = document) {
  scope.querySelectorAll?.("#pinconFreeGroupDeskEditor .pincon-free-desk").forEach((desk) => {
    const angle = angleFromDesk(desk);
    desk.style.setProperty("--desk-angle", `${angle}deg`);
    desk.style.setProperty("--desk-counter-angle", `${-angle}deg`);
    desk.classList.remove("is-vertical", "is-horizontal");
    desk.dataset.rotation = String(angle);
  });

  scope.querySelectorAll?.("#pinconFreeGroupDeskEditor [data-free-rotate]").forEach((button) => {
    const angle = Number(button.dataset.freeRotate) || 0;
    const text = button.textContent.replace(/[↑→↓←]/g, "").trim();
    button.innerHTML = `<span class="pincon-rotation-preview" style="--preview-angle:${angle}deg" aria-hidden="true"></span><span>${text}</span>`;
  });
}

function refresh() {
  installRealRotationStyles();
  applyDeskRotations(document);
}

if (root) {
  const observer = new MutationObserver(() => requestAnimationFrame(refresh));
  observer.observe(root, { childList: true, subtree: true });
  refresh();
}
