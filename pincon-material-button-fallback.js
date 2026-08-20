const SELECTOR = [
  "md-filled-button",
  "md-filled-tonal-button",
  "md-outlined-button",
  "md-text-button",
  "md-icon-button",
  "md-filled-icon-button",
  "md-filled-tonal-icon-button",
  "md-outlined-icon-button",
  "md-fab",
  "md-branded-fab",
].join(",");

function isUndefinedMaterialButton(node) {
  return node instanceof HTMLElement && node.matches(SELECTOR) && !customElements.get(node.localName);
}

function enhance(node) {
  if (!isUndefinedMaterialButton(node)) return;
  if (!node.hasAttribute("role")) node.setAttribute("role", "button");
  if (!node.hasAttribute("tabindex") && !node.hasAttribute("disabled") && node.getAttribute("aria-disabled") !== "true") {
    node.tabIndex = 0;
  }
  node.dataset.pinconMaterialButtonFallback = "true";
}

function scan(root = document) {
  if (root instanceof HTMLElement) enhance(root);
  root.querySelectorAll?.(SELECTOR).forEach(enhance);
}

function cleanupDefined(tagName) {
  document.querySelectorAll(`${tagName}[data-pincon-material-button-fallback="true"]`).forEach((node) => {
    delete node.dataset.pinconMaterialButtonFallback;
    if (node.getAttribute("role") === "button") node.removeAttribute("role");
    if (node.getAttribute("tabindex") === "0") node.removeAttribute("tabindex");
  });
}

scan();

const observer = new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node instanceof HTMLElement) scan(node);
    }
  }
});
observer.observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener("keydown", (event) => {
  const target = event.target;
  if (!isUndefinedMaterialButton(target)) return;
  if (target.hasAttribute("disabled") || target.getAttribute("aria-disabled") === "true") return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  target.click();
});

for (const tagName of SELECTOR.split(",")) {
  const tag = tagName.trim();
  if (customElements.get(tag)) {
    cleanupDefined(tag);
    continue;
  }
  customElements.whenDefined(tag).then(() => cleanupDefined(tag)).catch(() => {});
}
