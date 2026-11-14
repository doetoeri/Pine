(() => {
  const storageKey = "pincon-accessibility-v1";
  const defaults = Object.freeze({ contrast: "system", largeText: false, reduceMotion: false, list: false });
  const root = document.documentElement;
  const theme = document.querySelector('meta[name="theme-color"]');
  const themeColor = theme?.content;
  const motionMedia = matchMedia("(prefers-reduced-motion: reduce)");
  const contrastMedia = matchMedia("(prefers-contrast: more)");
  const forcedColors = matchMedia("(forced-colors: active)");
  const motion = new EventTarget();
  let choices = defaults;
  let reduced = false;
  let readingList = false;
  Object.defineProperty(motion, "matches", { get: () => reduced });

  function read() {
    try { return JSON.parse(localStorage.getItem(storageKey)) || defaults; }
    catch { return defaults; }
  }

  function apply(values) {
    choices = {
      contrast: ["system", "normal", "high"].includes(values.contrast) ? values.contrast : defaults.contrast,
      largeText: values.largeText === true,
      reduceMotion: values.reduceMotion === true,
      list: values.list === true,
    };
    const highContrast = forcedColors.matches || choices.contrast === "high"
      || choices.contrast === "system" && contrastMedia.matches;
    const nextList = choices.list || choices.largeText;
    const layoutChanged = nextList !== readingList;
    readingList = nextList;
    root.dataset.pcContrast = highContrast ? "high" : "normal";
    root.dataset.pcText = choices.largeText ? "large" : "normal";
    root.dataset.pcLayout = readingList ? "list" : "covers";
    if (theme) theme.content = highContrast ? "#090e17" : themeColor;
    const nextMotion = choices.reduceMotion || motionMedia.matches;
    if (nextMotion !== reduced) {
      reduced = nextMotion;
      root.toggleAttribute("data-pc-reduced-motion", reduced);
      motion.dispatchEvent(new Event("change"));
    }
    if (layoutChanged) document.dispatchEvent(new Event("pincon-layout-change"));
    document.dispatchEvent(new Event("pincon-accessibility-change"));
  }

  function save(next) {
    apply(next);
    try { localStorage.setItem(storageKey, JSON.stringify(choices)); }
    catch { /* Preferences still work for the current page. */ }
  }

  apply(read());
  for (const setting of [motionMedia, contrastMedia, forcedColors]) {
    const refresh = () => apply(choices);
    if (setting.addEventListener) setting.addEventListener("change", refresh);
    else setting.addListener?.(refresh);
  }
  window.addEventListener("storage", event => {
    if (event.key === storageKey || event.key === null) apply(read());
  });
  globalThis.PINCON_ACCESSIBILITY = Object.freeze({
    get: () => ({ ...choices }),
    update: change => save({ ...choices, ...change }),
    reset: () => save(defaults),
    motion,
  });
})();
