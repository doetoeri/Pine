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

async function loadOfficialMaterial() {
  // Built locally by GitHub Actions from Google's official @material/web npm package.
  // No hand-made replacements and no third-party runtime CDN are used.
  await import("./material-web.bundle.js?v=20260817-material-official-1");
  await Promise.all(TAGS.map((tag) => customElements.whenDefined(tag)));
  return VERSION;
}

globalThis.PINCON_MATERIAL_READY = loadOfficialMaterial();
globalThis.PINCON_MATERIAL_VERSION = VERSION;
await globalThis.PINCON_MATERIAL_READY;
