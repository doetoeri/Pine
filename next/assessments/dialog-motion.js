const motions = new WeakMap();
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Keep the native modal/focus lifecycle; only delay close until the exit settles.
export function prepareDialog(dialog, canDismiss = () => true) {
  if (motions.has(dialog)) return;
  const state = { animation: null, revision: 0 };
  motions.set(dialog, state);
  dialog.classList.add("pc-motion-dialog");
  dialog.addEventListener("cancel", event => {
    event.preventDefault();
    if (canDismiss()) closeDialog(dialog);
  });
  dialog.addEventListener("close", () => {
    // A native close event can arrive after an immediate reopen.
    if (dialog.open) return;
    state.revision++;
    state.animation?.cancel();
    state.animation = null;
    delete dialog.dataset.dialogMotion;
  });
  matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", event => {
    if (!event.matches) return;
    const closing = dialog.dataset.dialogMotion === "closing";
    state.revision++;
    state.animation?.cancel();
    state.animation = null;
    delete dialog.dataset.dialogMotion;
    if (closing && dialog.open) dialog.close();
  });
}

function play(dialog, frames, options, phase, finish) {
  const state = motions.get(dialog), revision = ++state.revision;
  state.animation?.cancel();
  state.animation = null;
  delete dialog.dataset.dialogMotion;
  if (reduced() || typeof dialog.animate !== "function") { finish(); return; }
  dialog.dataset.dialogMotion = phase;
  const animation = dialog.animate(frames, options);
  state.animation = animation;
  animation.onfinish = () => {
    if (revision !== state.revision) return;
    state.animation = null;
    delete dialog.dataset.dialogMotion;
    finish();
  };
}

export function openDialog(dialog) {
  prepareDialog(dialog);
  const wasOpen = dialog.open;
  if (wasOpen && dialog.dataset.dialogMotion !== "closing") return;
  const current = wasOpen ? getComputedStyle(dialog) : null;
  const from = current ? { opacity: current.opacity, transform: current.transform } : { opacity: 0, transform: "translateY(8px) scale(.98)" };
  dialog.style.setProperty("--pc-backdrop-from", wasOpen ? getComputedStyle(dialog, "::backdrop").opacity : "0");
  if (!wasOpen) dialog.showModal();
  play(dialog, [
    from,
    { opacity: 1, transform: "translateY(0) scale(1)" }
  ], { duration: 280, easing: "cubic-bezier(.2,.8,.2,1)" }, "opening", () => {});
}

export function closeDialog(dialog) {
  if (!dialog.open || dialog.dataset.dialogMotion === "closing") return;
  prepareDialog(dialog);
  const current = getComputedStyle(dialog);
  dialog.style.setProperty("--pc-backdrop-from", getComputedStyle(dialog, "::backdrop").opacity);
  play(dialog, [
    { opacity: current.opacity, transform: current.transform },
    { opacity: 0, transform: "translateY(4px) scale(.99)" }
  ], { duration: 160, easing: "cubic-bezier(.4,0,1,1)" }, "closing", () => dialog.close());
}

export function revealDialogContent(dialog) {
  if (!dialog.open || reduced()) return;
  const content = dialog.querySelector(".dialog-body, .pc-file-body");
  content?.animate([
    { opacity: 0 },
    { opacity: 1 }
  ], { duration: 160, easing: "cubic-bezier(.2,.8,.2,1)" });
}
