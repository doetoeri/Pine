const DIALOG_TRIGGERS = Object.freeze({
  searchDialog: "openSearch",
  notificationDialog: "openNotifications",
});

let restoreSequence = 0;

function actualFocusable(control) {
  if (!control) return null;
  return control.shadowRoot?.querySelector("button, a, input, textarea, select, [tabindex]") || control;
}

function dialogIsOpen(dialog) {
  return Boolean(
    dialog?.open
    || dialog?.hasAttribute?.("open")
    || dialog?.getAttribute?.("data-pincon-opening") === "true"
  );
}

function openTrackedDialog() {
  for (const dialogId of Object.keys(DIALOG_TRIGGERS)) {
    const dialog = document.getElementById(dialogId);
    if (dialogIsOpen(dialog)) return dialog;
  }
  return null;
}

function restoreAfterClose(dialog, triggerId) {
  const sequence = ++restoreSequence;
  let attempts = 0;

  const check = () => {
    if (sequence !== restoreSequence) return;
    if (dialogIsOpen(dialog)) {
      attempts += 1;
      if (attempts < 90) requestAnimationFrame(check);
      return;
    }

    requestAnimationFrame(() => {
      if (sequence !== restoreSequence) return;
      const trigger = document.getElementById(triggerId);
      actualFocusable(trigger)?.focus?.({ preventScroll: true });
    });
  };

  requestAnimationFrame(check);
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const dialog = openTrackedDialog();
  if (!dialog) return;
  const triggerId = DIALOG_TRIGGERS[dialog.id];
  if (triggerId) restoreAfterClose(dialog, triggerId);
}, true);
