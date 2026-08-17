(() => {
  if (globalThis.PINCON_LAB_STABILITY_INSTALLED) return;
  globalThis.PINCON_LAB_STABILITY_INSTALLED = true;

  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  if (!descriptor?.get || !descriptor?.set || descriptor.configurable === false) return;

  const lastRailMarkup = new WeakMap();
  const settleTimers = new WeakMap();

  const style = document.createElement("style");
  style.id = "pincon-lab-stability-style";
  style.textContent = `
    .pincon-lab-rail[data-pincon-settled] .pincon-lab-rail-card {
      animation: none !important;
    }
  `;
  document.head.appendChild(style);

  Object.defineProperty(Element.prototype, "innerHTML", {
    configurable: descriptor.configurable,
    enumerable: descriptor.enumerable,
    get() {
      return descriptor.get.call(this);
    },
    set(value) {
      const isLabRail = this?.classList?.contains?.("pincon-lab-rail");
      if (!isLabRail) {
        descriptor.set.call(this, value);
        return;
      }

      const next = String(value ?? "");
      if (lastRailMarkup.get(this) === next) return;
      lastRailMarkup.set(this, next);
      descriptor.set.call(this, next);

      if (!this.hasAttribute("data-pincon-settled")) {
        clearTimeout(settleTimers.get(this));
        const timer = window.setTimeout(() => {
          if (this.isConnected) this.setAttribute("data-pincon-settled", "");
          settleTimers.delete(this);
        }, 760);
        settleTimers.set(this, timer);
      }
    },
  });

  globalThis.PINCON_LAB_STABILITY = Object.freeze({
    version: "2026.08.18-1",
    purpose: "Prevent identical Lab rail rerenders from restarting entrance motion.",
  });
})();
