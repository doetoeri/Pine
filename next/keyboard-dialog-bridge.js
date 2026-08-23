// PinCon Next keyboard activation normalizer for Material icon buttons.
// Material Web uses native controls inside Shadow DOM. In browser automation and some
// keyboard paths, Enter reaches the internal button without producing the same host
// click path as a pointer activation. We normalize only the two global dialog triggers
// to the exact host click contract already used by app.js.

const DIALOG_TRIGGER_IDS = new Set(["openSearch", "openNotifications"]);

function triggerHostFromEvent(event) {
  return event.composedPath?.().find((node) => (
    node instanceof HTMLElement && DIALOG_TRIGGER_IDS.has(node.id)
  )) || null;
}

document.addEventListener("keydown", (event) => {
  if (!["Enter", " "].includes(event.key)) return;
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;

  const trigger = triggerHostFromEvent(event);
  if (!trigger || trigger.hasAttribute("disabled")) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  // dispatchEvent is intentional here. HTMLElement.click() on custom elements can be
  // browser-dependent, while an explicit composed click always reaches the app's host
  // click listener and the Day 2 focus/inbox layer through the same public event path.
  trigger.dispatchEvent(new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
  }));
}, true);
