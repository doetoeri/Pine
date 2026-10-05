(() => {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  const NS = 'http://www.w3.org/2000/svg';

  function smoothstep(a, b, x) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  function buildRadialMap(size = 256) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    const image = ctx.createImageData(size, size);
    const data = image.data;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = ((x + .5) / size) * 2 - 1;
        const ny = ((y + .5) / size) * 2 - 1;
        const r = Math.hypot(nx, ny);
        const i = (y * size + x) * 4;

        let rx = 128;
        let gy = 128;

        if (r <= 1 && r > .0001) {
          const ux = nx / r;
          const uy = ny / r;

          /* lore-glass style profile: nearly flat center, rapidly bending rim,
             plus a small dome contribution so the lens reads as curved glass. */
          const rim = Math.pow(smoothstep(.50, .995, r), 1.42);
          const dome = Math.pow(Math.max(0, 1 - r * r), 1.65) * .13;
          const bend = rim * .95 + dome;

          rx = Math.round(128 + ux * bend * 118);
          gy = Math.round(128 + uy * bend * 118);
        }

        data[i] = Math.max(0, Math.min(255, rx));
        data[i + 1] = Math.max(0, Math.min(255, gy));
        data[i + 2] = 128;
        data[i + 3] = 255;
      }
    }

    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
  }

  function installFilter() {
    if (document.getElementById('pinconLoreRadialDefs')) {
      return document.getElementById('pinconLoreRadialDisplacement');
    }

    const holder = document.createElement('div');
    holder.id = 'pinconLoreRadialDefs';
    holder.setAttribute('aria-hidden', 'true');
    holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');

    const defs = document.createElementNS(NS, 'defs');
    const filter = document.createElementNS(NS, 'filter');
    filter.id = 'pincon-lore-radial-refraction';
    filter.setAttribute('x', '-18%');
    filter.setAttribute('y', '-18%');
    filter.setAttribute('width', '136%');
    filter.setAttribute('height', '136%');
    filter.setAttribute('color-interpolation-filters', 'sRGB');

    const image = document.createElementNS(NS, 'feImage');
    image.setAttribute('href', buildRadialMap(window.innerWidth < 760 ? 192 : 256));
    image.setAttribute('x', '0');
    image.setAttribute('y', '0');
    image.setAttribute('width', '100%');
    image.setAttribute('height', '100%');
    image.setAttribute('preserveAspectRatio', 'none');
    image.setAttribute('result', 'radialMap');

    const displacement = document.createElementNS(NS, 'feDisplacementMap');
    displacement.id = 'pinconLoreRadialDisplacement';
    displacement.setAttribute('in', 'SourceGraphic');
    displacement.setAttribute('in2', 'radialMap');
    displacement.setAttribute('scale', window.innerWidth < 760 ? '24' : '36');
    displacement.setAttribute('xChannelSelector', 'R');
    displacement.setAttribute('yChannelSelector', 'G');
    displacement.setAttribute('result', 'bent');

    const blur = document.createElementNS(NS, 'feGaussianBlur');
    blur.setAttribute('in', 'bent');
    blur.setAttribute('stdDeviation', '.12');

    filter.append(image, displacement, blur);
    defs.appendChild(filter);
    svg.appendChild(defs);
    holder.appendChild(svg);
    document.body.appendChild(holder);
    return displacement;
  }

  function installScene() {
    const disc = document.querySelector('.lens-disc');
    const stroke = document.getElementById('strokeLayer');
    if (!disc) return null;

    let scene = disc.querySelector('.lore-refraction-scene');
    if (!scene) {
      scene = document.createElement('div');
      scene.className = 'lore-refraction-scene';
      scene.setAttribute('aria-hidden', 'true');
      scene.innerHTML = '<span class="lore-refraction-neighbor left"></span><span class="lore-refraction-neighbor right"></span>';
      disc.insertBefore(scene, disc.firstChild);
    }

    if (!disc.querySelector('.lore-glass-caustic')) {
      const caustic = document.createElement('div');
      caustic.className = 'lore-glass-caustic';
      caustic.setAttribute('aria-hidden', 'true');
      if (stroke) disc.insertBefore(caustic, stroke);
      else disc.appendChild(caustic);
    }

    return scene;
  }

  function syncNeighbors(scene) {
    if (!scene) return;
    const left = document.getElementById('prevChar');
    const right = document.getElementById('nextChar');
    const leftInside = scene.querySelector('.lore-refraction-neighbor.left');
    const rightInside = scene.querySelector('.lore-refraction-neighbor.right');

    const update = () => {
      if (leftInside && left) leftInside.textContent = left.textContent.trim();
      if (rightInside && right) rightInside.textContent = right.textContent.trim();
    };
    update();

    [left, right].forEach(el => {
      if (!el) return;
      new MutationObserver(update).observe(el, { childList: true, characterData: true, subtree: true });
    });
  }

  function installPointerOptics(displacement) {
    const lens = document.getElementById('lens');
    const disc = document.querySelector('.lens-disc');
    if (!lens || !disc) return;

    let raf = 0;
    let px = .5;
    let py = .24;
    let pressed = false;

    const render = () => {
      raf = 0;
      const dx = (px - .5) * 7;
      const dy = (py - .5) * 7;
      disc.style.setProperty('--lens-parallax-x', `${(-dx).toFixed(2)}px`);
      disc.style.setProperty('--lens-parallax-y', `${(-dy).toFixed(2)}px`);
      disc.style.setProperty('--lens-edge-light-x', `${(px * 100).toFixed(1)}%`);
      disc.style.setProperty('--lens-edge-light-y', `${(py * 100).toFixed(1)}%`);
      disc.style.setProperty('--lens-refraction-strength', pressed ? '.88' : '.74');
      if (displacement) {
        const base = window.innerWidth < 760 ? 24 : 36;
        const extra = pressed ? 7 : 0;
        displacement.setAttribute('scale', String(base + extra));
      }
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(render);
    };

    const point = event => {
      const rect = lens.getBoundingClientRect();
      px = Math.max(.06, Math.min(.94, (event.clientX - rect.left) / rect.width));
      py = Math.max(.06, Math.min(.94, (event.clientY - rect.top) / rect.height));
      schedule();
    };

    lens.addEventListener('pointermove', point, { passive: true });
    lens.addEventListener('pointerdown', event => {
      point(event);
      pressed = true;
      schedule();
    });
    const release = () => {
      pressed = false;
      schedule();
    };
    lens.addEventListener('pointerup', release, { passive: true });
    lens.addEventListener('pointercancel', release, { passive: true });
    lens.addEventListener('pointerleave', () => {
      pressed = false;
      px = .5;
      py = .24;
      schedule();
    }, { passive: true });

    if (!reduced && 'DeviceOrientationEvent' in window) {
      window.addEventListener('deviceorientation', event => {
        if (event.gamma == null || event.beta == null) return;
        const gx = Math.max(-18, Math.min(18, event.gamma)) / 36;
        const gy = Math.max(-18, Math.min(18, event.beta - 45)) / 36;
        px = .5 + gx * .18;
        py = .24 + gy * .12;
        schedule();
      }, { passive: true });
    }

    render();
  }

  function addLensBreathing() {
    if (reduced) return;
    const disc = document.querySelector('.lens-disc');
    if (!disc?.animate) return;
    disc.animate([
      { boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.95), inset 0 0 0 10px rgba(255,255,255,.22), 0 22px 52px rgba(37,35,31,.095)' },
      { boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.98), inset 0 0 0 10px rgba(255,255,255,.28), 0 24px 58px rgba(37,35,31,.105)' },
      { boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.95), inset 0 0 0 10px rgba(255,255,255,.22), 0 22px 52px rgba(37,35,31,.095)' }
    ], { duration: 6200, iterations: Infinity, easing: 'ease-in-out' });
  }

  function init() {
    const displacement = installFilter();
    const scene = installScene();
    syncNeighbors(scene);
    installPointerOptics(displacement);
    addLensBreathing();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();