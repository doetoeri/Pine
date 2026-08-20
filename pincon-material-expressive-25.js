const VERSION = "2.5.0";
const CDN_BASE = `https://esm.run/@material/web@${VERSION}/`;

const EXPRESSIVE_MODULES = [
  "labs/gb/components/button/md-gb-button.js",
  "labs/gb/components/iconbutton/md-gb-icon-button.js",
  "labs/gb/components/card/md-gb-card.js",
  "labs/gb/components/fab/md-gb-fab.js",
];

const EXPECTED_TAGS = [
  "md-gb-button",
  "md-gb-icon-button",
  "md-gb-card",
  "md-gb-fab",
];

async function loadExpressiveComponents() {
  const results = await Promise.allSettled(
    EXPRESSIVE_MODULES.map((path) => import(`${CDN_BASE}${path}`)),
  );

  const failed = results
    .map((result, index) => ({ result, path: EXPRESSIVE_MODULES[index] }))
    .filter(({ result }) => result.status === "rejected")
    .map(({ path, result }) => ({ path, reason: String(result.reason || "unknown error") }));

  const missing = EXPECTED_TAGS.filter((tag) => !customElements.get(tag));
  const detail = {
    version: VERSION,
    source: "@material/web labs/gb",
    status: missing.length ? (failed.length ? "partial" : "missing") : "ready",
    missing,
    failed,
  };

  globalThis.PINCON_EXPRESSIVE_MATERIAL_STATUS = detail;
  window.dispatchEvent(new CustomEvent("pincon-expressive-material-ready", { detail }));
  return detail;
}

globalThis.PINCON_EXPRESSIVE_MATERIAL_VERSION = VERSION;
globalThis.PINCON_EXPRESSIVE_MATERIAL_READY = loadExpressiveComponents().catch((error) => {
  const detail = {
    version: VERSION,
    source: "@material/web labs/gb",
    status: "error",
    missing: EXPECTED_TAGS.filter((tag) => !customElements.get(tag)),
    failed: [{ path: "loader", reason: String(error || "unknown error") }],
  };
  globalThis.PINCON_EXPRESSIVE_MATERIAL_STATUS = detail;
  console.warn("[PinCon Expressive] Material 2.5 labs loader recovered", error);
  window.dispatchEvent(new CustomEvent("pincon-expressive-material-ready", { detail }));
  return detail;
});

await globalThis.PINCON_EXPRESSIVE_MATERIAL_READY;
