const root = document.querySelector("#adminApp");

function textEntryActive() {
  const active = document.activeElement;
  if (!active) return false;
  const tag = active.tagName?.toLowerCase();
  return ["input", "textarea", "select"].includes(tag) || active.isContentEditable === true || Boolean(active.closest?.("md-outlined-text-field, md-filled-text-field"));
}

function openSearch() {
  const dialog = root?.querySelector("#adminSearchDialog");
  if (dialog?.open || dialog?.hasAttribute?.("open")) return;
  root?.querySelector("#openAdminSearch")?.click();
}

document.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === "k") {
    event.preventDefault();
    openSearch();
    return;
  }
  if (event.key === "/" && !textEntryActive()) {
    event.preventDefault();
    openSearch();
  }
});
