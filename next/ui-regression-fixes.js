const root = document.querySelector("#app");

if (root) {
  const style = document.createElement("style");
  style.dataset.pinconRegressionFixes = "true";
  style.textContent = `
    .item-leading,
    .item-end,
    .status-chip,
    .origin-chip,
    .meta-pill,
    .topbar__actions,
    .notification-row-end {
      align-items: center;
    }

    .item-leading md-icon,
    .item-end md-icon,
    .status-chip md-icon,
    .origin-chip md-icon,
    .meta-pill md-icon,
    .topbar__actions md-icon,
    .notification-row-end md-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      line-height: 1;
      vertical-align: middle;
    }

    md-icon-button,
    md-text-button,
    md-filled-button,
    md-filled-tonal-button,
    md-outlined-button,
    md-elevated-button,
    md-list-item[type="button"] {
      touch-action: manipulation;
    }
  `;
  document.head.append(style);

  let queued = false;

  function dialogIsOpen(dialog) {
    return Boolean(
      dialog?.open
      || dialog?.hasAttribute?.("open")
      || dialog?.getAttribute?.("data-pincon-opening") === "true"
    );
  }

  function detailIsOpen() {
    const layer = root.querySelector("#detailLayer");
    return Boolean(layer && !layer.hidden && layer.getAttribute("aria-hidden") !== "true");
  }

  function ensureDetailCloseControl() {
    const close = root.querySelector(".detail-header [data-detail-close]");
    if (!close) return;
    if (close.getAttribute("aria-label") !== "상세 화면 닫기") {
      close.setAttribute("aria-label", "상세 화면 닫기");
    }
    const internal = close.shadowRoot?.querySelector("button, [role='button']");
    if (internal && internal.getAttribute("aria-label") !== "상세 화면 닫기") {
      internal.setAttribute("aria-label", "상세 화면 닫기");
    }
  }

  function removeUnknownStatusChips() {
    root.querySelectorAll(".status-chip--checking").forEach((chip) => chip.remove());
    root.querySelectorAll("[aria-label*='확인 중']").forEach((node) => {
      const label = node.getAttribute("aria-label");
      if (!label) return;
      node.setAttribute("aria-label", label
        .replace(/,?\s*확인\s*중,?/g, ",")
        .replace(/,\s*,/g, ",")
        .replace(/^,\s*|,\s*$/g, "")
        .trim());
    });
  }

  function removeSaturdayClosureRows() {
    root.querySelectorAll("md-list-item.interactive-item").forEach((row) => {
      if (/토요\s*휴업일/.test(row.textContent || "")) row.remove();
    });

    root.querySelectorAll(".surface").forEach((surface) => {
      const list = surface.querySelector("md-list.interactive-list");
      const meta = surface.querySelector(".surface__header .surface__meta");
      if (!list || !meta || !/건$/.test((meta.textContent || "").trim())) return;
      const count = list.querySelectorAll("md-list-item.interactive-item").length;
      meta.textContent = count ? `${count}건` : "";
    });
  }

  function repairInteractionState() {
    if (detailIsOpen()) return;
    const nativeDialogOpen = ["#searchDialog", "#notificationDialog"]
      .some((selector) => dialogIsOpen(root.querySelector(selector)));
    if (nativeDialogOpen) return;

    for (const node of [root.querySelector(".rail"), root.querySelector(".app-frame")]) {
      if (!node) continue;
      if (node.inert) node.inert = false;
      node.removeAttribute("inert");
      node.removeAttribute("aria-hidden");
    }
    document.body.classList.remove("detail-modal-open");
  }

  function closeNotificationDialogFrom(event) {
    const close = event.composedPath?.().find((node) => node instanceof HTMLElement && node.id === "closeNotifications");
    if (!close) return false;
    const dialog = root.querySelector("#notificationDialog");
    if (!dialog) return true;
    dialog.removeAttribute("data-pincon-opening");
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
    queueFixes();
    return true;
  }

  function applyFixes() {
    queued = false;
    ensureDetailCloseControl();
    removeUnknownStatusChips();
    removeSaturdayClosureRows();
    repairInteractionState();
  }

  function queueFixes() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(applyFixes);
  }

  const observer = new MutationObserver(queueFixes);
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["hidden", "open", "aria-hidden", "aria-label", "inert", "data-pincon-opening"],
  });

  document.addEventListener("closed", queueFixes, true);
  document.addEventListener("click", (event) => {
    closeNotificationDialogFrom(event);
    requestAnimationFrame(repairInteractionState);
  }, true);
  window.addEventListener("popstate", queueFixes);
  queueFixes();
}