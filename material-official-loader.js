const VERSION = "2.4.1";
const BASE = `https://esm.run/@material/web@${VERSION}`;

const modules = [
  ["md-icon", "icon/icon.js"],
  ["md-filled-button", "button/filled-button.js"],
  ["md-filled-tonal-button", "button/filled-tonal-button.js"],
  ["md-outlined-button", "button/outlined-button.js"],
  ["md-text-button", "button/text-button.js"],
  ["md-icon-button", "iconbutton/icon-button.js"],
  ["md-fab", "fab/fab.js"],
  ["md-dialog", "dialog/dialog.js"],
  ["md-tabs", "tabs/tabs.js"],
  ["md-primary-tab", "tabs/primary-tab.js"],
  ["md-list", "list/list.js"],
  ["md-list-item", "list/list-item.js"],
  ["md-outlined-text-field", "textfield/outlined-text-field.js"],
  ["md-outlined-select", "select/outlined-select.js"],
  ["md-select-option", "select/select-option.js"],
  ["md-checkbox", "checkbox/checkbox.js"],
  ["md-radio", "radio/radio.js"],
  ["md-switch", "switch/switch.js"],
  ["md-assist-chip", "chips/assist-chip.js"],
  ["md-filter-chip", "chips/filter-chip.js"],
  ["md-linear-progress", "progress/linear-progress.js"],
  ["md-divider", "divider/divider.js"],
];

async function loadOfficialMaterial() {
  const missing = modules.filter(([tag]) => !customElements.get(tag));
  await Promise.all(missing.map(async ([tag, path]) => {
    await import(`${BASE}/${path}`);
    await customElements.whenDefined(tag);
  }));
  return VERSION;
}

globalThis.PINCON_MATERIAL_READY = loadOfficialMaterial();
globalThis.PINCON_MATERIAL_VERSION = VERSION;
await globalThis.PINCON_MATERIAL_READY;
