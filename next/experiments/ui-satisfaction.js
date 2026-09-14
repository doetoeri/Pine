const experiment = globalThis.PinConExperiment;
const context = experiment?.uiContext;
const RUNNING = new Set(["CANARY", "ACTIVE", "ROLLOUT"]);
const storageKey = `pincon-ui-satisfaction-v1:${context?.experimentVersion || 0}`;
let host = null;

function eligible() {
  return context
    && context.experimentId === "pincon-next-ui"
    && RUNNING.has(context.status)
    && location.hash.replace(/^#\/?/, "").split(/[?/]/)[0] === "more"
    && localStorage.getItem(storageKey) !== "1";
}

function mount() {
  if (!eligible()) {
    host?.remove();
    host = null;
    return;
  }
  if (host?.isConnected) return;
  host = document.createElement("div");
  host.style.cssText = "position:fixed;right:16px;bottom:max(96px,calc(env(safe-area-inset-bottom) + 86px));z-index:145";
  host.innerHTML = '<button type="button" style="border:1px solid #c6d2bd;border-radius:999px;background:#f8faf2;color:#365d39;padding:10px 14px;font:650 12px system-ui;box-shadow:0 8px 24px #31452a1a">UI 만족도</button>';
  host.querySelector("button")?.addEventListener("click", openDialog);
  document.body.appendChild(host);
}

function openDialog() {
  const dialog = document.createElement("dialog");
  dialog.style.cssText = "border:0;border-radius:20px;padding:0;max-width:min(440px,92vw);box-shadow:0 20px 70px #0003";
  dialog.innerHTML = `<form method="dialog" style="padding:22px;font:14px system-ui;color:#243326">
    <h2 style="margin:0 0 8px">PinCon UI 만족도</h2>
    <p style="margin:0 0 18px;color:#6d7d69">지금 사용 중인 화면은 얼마나 편한가요?</p>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:7px">
      ${[1,2,3,4,5].map((value)=>`<button type="submit" name="score" value="${value}" style="min-height:44px;border:1px solid #cad6c1;border-radius:12px;background:white">${value}</button>`).join("")}
    </div>
    <button value="cancel" style="margin-top:14px;border:0;background:transparent;color:#697665">나중에</button>
  </form>`;
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.querySelectorAll('[name="score"]').forEach((button) => button.addEventListener("click", () => {
    const value = Number(button.value);
    experiment.log("ui_satisfaction", { value, route: "more" }, { dedupeKey: `ui-satisfaction:${context.experimentVersion}`, dedupeMs: 60_000 });
    localStorage.setItem(storageKey, "1");
    host?.remove();
    host = null;
  }));
  document.body.appendChild(dialog);
  dialog.showModal();
}

window.addEventListener("hashchange", mount, { passive: true });
window.addEventListener("popstate", mount, { passive: true });
mount();
