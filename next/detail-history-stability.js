function detailKeyInLocation() {
  const query = location.hash.split("?")[1] || "";
  return new URLSearchParams(query).get("detail") || "";
}

function forceClosedWhenHistoryHasNoDetail() {
  if (detailKeyInLocation()) return;
  const layer = document.querySelector("#detailLayer");
  if (!layer) return;
  layer.classList.remove("is-open");
  layer.setAttribute("aria-hidden", "true");
  layer.hidden = true;
}

function settleDetailHistory() {
  forceClosedWhenHistoryHasNoDetail();
  requestAnimationFrame(() => {
    forceClosedWhenHistoryHasNoDetail();
    requestAnimationFrame(forceClosedWhenHistoryHasNoDetail);
  });
  window.setTimeout(forceClosedWhenHistoryHasNoDetail, 80);
}

window.addEventListener("popstate", settleDetailHistory);
window.addEventListener("hashchange", settleDetailHistory);

export { forceClosedWhenHistoryHasNoDetail, settleDetailHistory };
