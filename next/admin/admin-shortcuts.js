const root = document.querySelector("#adminApp");

function textEntryActive() {
  const active = document.activeElement;
  if (!active) return false;
  const tag = active.tagName?.toLowerCase();
  return ["input", "textarea", "select"].includes(tag) || active.isContentEditable === true || Boolean(active.closest?.("md-outlined-text-field, md-filled-text-field"));
}

document.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === "k") {
    event.preventDefault();
    root?.querySelector("#openAdminSearch")?.click();
    return;
  }
  if (event.key === "/" && !textEntryActive()) {
    event.preventDefault();
    root?.querySelector("#openAdminSearch")?.click();
  }
});
