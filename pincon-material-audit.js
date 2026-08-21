const MATERIAL_PREFIX = "md-";
const observedTags = new Set();
let lastSignature = "";
let scheduled = false;

function collectMaterialTags(root = document) {
  const inspect = (node) => {
    if (!(node instanceof Element)) return;
    const tag = node.localName;
    if (tag?.startsWith(MATERIAL_PREFIX)) observedTags.add(tag);
  };

  if (root instanceof Element) inspect(root);
  root.querySelectorAll?.("*").forEach(inspect);
}

function snapshot() {
  const used = [...observedTags].sort();
  const unresolved = used.filter((tag) => !customElements.get(tag));
  const resolved = used.filter((tag) => customElements.get(tag));
  return Object.freeze({
    checkedAt: Date.now(),
    materialVersion: globalThis.PINCON_MATERIAL_VERSION || null,
    loaderStatus: globalThis.PINCON_MATERIAL_STATUS?.status || "unknown",
    used,
    resolved,
    unresolved,
  });
}

function publish() {
  collectMaterialTags(document);
  const result = snapshot();
  globalThis.PINCON_MATERIAL_AUDIT_RESULT = result;

  const signature = JSON.stringify(result.unresolved);
  if (signature !== lastSignature) {
    lastSignature = signature;
    if (result.unresolved.length) {
      console.warn(
        "[PinCon Material Audit] unresolved md-* components detected:",
        result.unresolved,
        "Add their official @material/web imports to material-entry.js."
      );
    } else {
      console.info(`[PinCon Material Audit] ${result.resolved.length} Material component types resolved.`);
    }
  }

  window.dispatchEvent(new CustomEvent("pincon-material-audit", { detail: result }));
  return result;
}

function scheduleAudit() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    publish();
  });
}

const observer = new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node instanceof Element) collectMaterialTags(node);
    }
  }
  scheduleAudit();
});

collectMaterialTags(document);
observer.observe(document.documentElement, { childList: true, subtree: true });

Promise.resolve(globalThis.PINCON_MATERIAL_READY)
  .catch(() => null)
  .finally(() => {
    publish();
    window.setTimeout(publish, 500);
  });

globalThis.PINCON_MATERIAL_AUDIT = Object.freeze({
  run: publish,
  snapshot,
});
