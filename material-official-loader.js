const VERSION = "2.4.1";
const TAGS = [
  "md-icon",
  "md-filled-button",
  "md-filled-tonal-button",
  "md-outlined-button",
  "md-text-button",
  "md-icon-button",
  "md-fab",
  "md-dialog",
  "md-tabs",
  "md-primary-tab",
  "md-list",
  "md-list-item",
  "md-outlined-text-field",
  "md-outlined-select",
  "md-select-option",
  "md-checkbox",
  "md-radio",
  "md-switch",
  "md-assist-chip",
  "md-filter-chip",
  "md-linear-progress",
  "md-divider",
];

const TIMEOUT_MS = 2500;

function timeoutResult() {
  return new Promise((resolve) => {
    window.setTimeout(() => resolve({ version: VERSION, status: "degraded", missing: TAGS.filter((tag) => !customElements.get(tag)) }), TIMEOUT_MS);
  });
}

async function loadOfficialMaterial() {
  // PinCon's main bundle already renders Google's Material elements. This loader adds
  // the separately built official @material/web bundle for enhancement modules.
  // A missing/slow optional element must never freeze every later module.
  const loadTask = (async () => {
    try {
      await import("./material-web.bundle.js?v=20260817-material-official-2");
    } catch (error) {
      console.warn("[PinCon Material] official bundle load failed; continuing with already-defined elements", error);
      return { version: VERSION, status: "bundle-error", missing: TAGS.filter((tag) => !customElements.get(tag)) };
    }

    const pending = TAGS.filter((tag) => !customElements.get(tag));
    if (!pending.length) return { version: VERSION, status: "ready", missing: [] };

    // Wait briefly for definitions, but never deadlock the rest of PinCon.
    await Promise.race([
      Promise.all(pending.map((tag) => customElements.whenDefined(tag))),
      new Promise((resolve) => window.setTimeout(resolve, TIMEOUT_MS)),
    ]);

    const missing = TAGS.filter((tag) => !customElements.get(tag));
    return { version: VERSION, status: missing.length ? "partial" : "ready", missing };
  })();

  return Promise.race([loadTask, timeoutResult()]);
}

globalThis.PINCON_MATERIAL_VERSION = VERSION;
globalThis.PINCON_MATERIAL_READY = loadOfficialMaterial()
  .catch((error) => {
    console.warn("[PinCon Material] loader recovered from error", error);
    return { version: VERSION, status: "recovered", missing: TAGS.filter((tag) => !customElements.get(tag)) };
  })
  .then((result) => {
    globalThis.PINCON_MATERIAL_STATUS = result;
    window.dispatchEvent(new CustomEvent("pincon-material-ready", { detail: result }));
    return result;
  });

await globalThis.PINCON_MATERIAL_READY;
