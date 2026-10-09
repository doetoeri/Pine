const motions = new WeakMap();
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Keep the native modal/focus lifecycle; only delay close until the exit settles.
export function prepareDialog(dialog, canDismiss = () => true) {
  if (motions.has(dialog)) return;
  const state = { animation: null, extras: [], ghost: null, source: null, sourceId: "", revision: 0 };
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
    clearExtras(state);
    restoreSource(state);
    delete dialog.dataset.dialogMotion;
  });
  matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", event => {
    if (!event.matches) return;
    const closing = dialog.dataset.dialogMotion === "closing";
    state.revision++;
    state.animation?.cancel();
    state.animation = null;
    clearExtras(state);
    delete dialog.dataset.dialogMotion;
    if (closing && dialog.open) dialog.close();
    else restoreSource(state);
  });
}

function clearExtras(state) {
  state.extras.forEach(animation => animation.cancel());
  state.extras = [];
  state.ghost?.remove();
  state.ghost = null;
}

function sourceElement(state) {
  if (state.source?.isConnected) return state.source;
  return state.sourceId ? document.querySelector(`.pc-cover[data-assessment-id="${CSS.escape(state.sourceId)}"]`) : null;
}

function restoreSource(state) {
  state.source?.classList.remove("pc-shared-source");
  sourceElement(state)?.classList.remove("pc-shared-source");
}

function coverTransform(from, to) {
  return `translate(${from.left + from.width / 2 - to.left - to.width / 2}px,${from.top + from.height / 2 - to.top - to.height / 2}px) scale(${from.width / to.width},${from.height / to.height})`;
}

function sharedCover(state, source, target, closing, duration) {
  const face = source.querySelector(":scope > .pc-face");
  if (!face || typeof HTMLElement.prototype.showPopover !== "function") return;
  const rect = source.getBoundingClientRect(), ghost = document.createElement("div");
  ghost.className = "pc-shared-cover";
  ghost.setAttribute("popover", "manual");
  ghost.setAttribute("aria-hidden", "true");
  ghost.dataset.lighting = source.closest(".pc-flow")?.dataset.lighting || "off";
  ghost.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;--card:${rect.width}px;--cover-background:${getComputedStyle(face).backgroundImage}`;
  const clone = face.cloneNode(true);
  clone.querySelectorAll("[id]").forEach(node => node.removeAttribute("id"));
  ghost.append(clone);
  document.body.append(ghost);
  ghost.showPopover();
  state.ghost = ghost;
  source.classList.add("pc-shared-source");
  const expanded = `translate(${target.left - rect.left}px,${target.top - rect.top}px) scale(${target.width / rect.width},${target.height / rect.height})`;
  state.extras.push(ghost.animate(closing ? [
    { transform: expanded, opacity: 0 },
    { transform: "none", opacity: 1 }
  ] : [
    { transform: "none", opacity: 1 },
    { transform: expanded, opacity: 0 }
  ], { duration, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" }));
}

function play(dialog, frames, options, phase, finish) {
  const state = motions.get(dialog), revision = ++state.revision;
  state.animation?.cancel();
  state.animation = null;
  clearExtras(state);
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

export function openDialog(dialog, source = null) {
  prepareDialog(dialog);
  const wasOpen = dialog.open;
  if (wasOpen && dialog.dataset.dialogMotion !== "closing") return;
  const current = wasOpen ? getComputedStyle(dialog) : null;
  const state = motions.get(dialog);
  if (!wasOpen) {
    restoreSource(state);
    state.source = source?.matches(".pc-cover") ? source : null;
    state.sourceId = state.source?.dataset.assessmentId || "";
  }
  const from = current ? { opacity: current.opacity, transform: current.transform } : { opacity: 0, transform: "translateY(8px) scale(.98)" };
  dialog.style.setProperty("--pc-backdrop-from", wasOpen ? getComputedStyle(dialog, "::backdrop").opacity : "0");
  if (!wasOpen) dialog.showModal();
  const anchor = !reduced() && sourceElement(state), target = dialog.getBoundingClientRect();
  const shared = Boolean(anchor && !wasOpen && target.width && target.height);
  if (shared) from.transform = coverTransform(anchor.getBoundingClientRect(), target);
  const duration = shared ? 360 : 280;
  play(dialog, [
    from,
    { opacity: 1, transform: "translateY(0) scale(1)" }
  ], { duration, easing: "cubic-bezier(.2,.8,.2,1)" }, "opening", () => clearExtras(state));
  if (shared) {
    sharedCover(state, anchor, target, false, duration);
    const body = dialog.querySelector(".dialog-body");
    if (body) state.extras.push(body.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: 110, fill: "both", easing: "ease-out" }));
  }
}

export function closeDialog(dialog) {
  if (!dialog.open || dialog.dataset.dialogMotion === "closing") return;
  prepareDialog(dialog);
  const current = getComputedStyle(dialog);
  const from = { opacity: current.opacity, transform: current.transform };
  const state = motions.get(dialog);
  // Read the final layout once, without the in-progress entrance transform.
  state.animation?.cancel();
  const target = dialog.getBoundingClientRect(), anchor = !reduced() && sourceElement(state);
  const shared = Boolean(anchor && target.width && target.height);
  const to = shared ? coverTransform(anchor.getBoundingClientRect(), target) : "translateY(4px) scale(.99)";
  const duration = shared ? 300 : 160;
  dialog.style.setProperty("--pc-backdrop-from", getComputedStyle(dialog, "::backdrop").opacity);
  play(dialog, [
    from,
    { opacity: 0, transform: to }
  ], { duration, easing: shared ? "cubic-bezier(.2,.8,.2,1)" : "cubic-bezier(.4,0,1,1)" }, "closing", () => {
    clearExtras(state); restoreSource(state); dialog.close();
  });
  if (shared) sharedCover(state, anchor, target, true, duration);
}

export function revealDialogContent(dialog) {
  if (!dialog.open || reduced()) return;
  const content = dialog.querySelector(".dialog-body, .pc-file-body");
  content?.animate([
    { opacity: 0 },
    { opacity: 1 }
  ], { duration: 160, easing: "cubic-bezier(.2,.8,.2,1)" });
}
