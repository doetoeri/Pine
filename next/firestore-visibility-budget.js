import { NextDataGateway } from "./core/data-gateway.js";

const gateway = new NextDataGateway();
let suspended = false;

function repository() {
  return gateway.repository || null;
}

function stopAll(items) {
  if (!Array.isArray(items)) return;
  items.splice(0).forEach((stop) => {
    try { stop?.(); } catch {}
  });
}

function suspend() {
  const repo = repository();
  if (!repo || suspended) return;
  stopAll(repo.unsubscribers);
  stopAll(repo.privateUnsubscribers);
  suspended = true;
}

function resume() {
  const repo = repository();
  if (!repo?.api || !suspended || document.hidden) return;
  suspended = false;
  try { repo.listenPublic?.(); } catch {}
  if (repo.state?.isPresident) {
    try { repo.listenPrivate?.(); } catch {}
  }
}

function applyVisibilityBudget() {
  if (document.hidden) suspend();
  else resume();
}

document.addEventListener("visibilitychange", applyVisibilityBudget);
window.addEventListener("pagehide", suspend);
window.addEventListener("pageshow", applyVisibilityBudget);

gateway.addEventListener("change", () => {
  if (document.hidden) suspend();
  else if (suspended) resume();
});

await gateway.start().catch(() => null);
applyVisibilityBudget();

globalThis.PinConFirestoreBudget = Object.freeze({
  suspended: () => suspended,
  apply: applyVisibilityBudget,
});
