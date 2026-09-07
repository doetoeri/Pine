const DIALOG_TRIGGER_MAP = new Map([
  ["openNotifications", "notificationDialog"],
  ["openSearch", "searchDialog"],
]);

function dialogIsOpen(dialog) {
  return Boolean(dialog?.open || dialog?.hasAttribute?.("open"));
}

function guardDialogOpening(dialog) {
  if (!(dialog instanceof HTMLElement)) return;
  const started = performance.now();
  const maxGuardMs = 1200;

  const keepGuarded = () => {
    if (!dialog.isConnected) return;
    if (dialogIsOpen(dialog)) {
      dialog.removeAttribute("data-pincon-opening");
      return;
    }
    if (performance.now() - started >= maxGuardMs) {
      dialog.removeAttribute("data-pincon-opening");
      return;
    }
    // app.js may clear this marker as soon as md-dialog.show() returns even
    // though WebKit has not reflected the open state yet. Re-assert it until
    // the component is observably open so background data renders cannot
    // replace the dialog mid-transition.
    dialog.setAttribute("data-pincon-opening", "true");
    requestAnimationFrame(keepGuarded);
  };

  dialog.setAttribute("data-pincon-opening", "true");
  requestAnimationFrame(keepGuarded);
}

document.addEventListener("click", (event) => {
  const trigger = event.composedPath?.().find((node) => (
    node instanceof HTMLElement && DIALOG_TRIGGER_MAP.has(node.id)
  ));
  if (!trigger) return;
  const dialogId = DIALOG_TRIGGER_MAP.get(trigger.id);
  const dialog = document.getElementById(dialogId);
  guardDialogOpening(dialog);
}, true);
