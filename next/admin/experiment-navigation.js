const root = document.querySelector("#adminApp");
const NAV_KEY = "experiments";

function ensureStyle() {
  if (document.querySelector("#pinconExperimentNavStyle")) return;
  const style = document.createElement("style");
  style.id = "pinconExperimentNavStyle";
  style.textContent = `
    #adminMain.experiment-focus .admin-workspace > :not(.admin-topbar):not(#pinconExperimentAdmin) { display:none !important; }
    #adminMain.experiment-focus #pinconExperimentAdmin { margin-top:0; min-height:calc(100dvh - 110px); }
    .admin-nav__item[data-admin-target="experiments"] md-icon { color:var(--md-sys-color-primary,#49662e); }
    @media(max-width:820px){#adminMain.experiment-focus #pinconExperimentAdmin{min-height:auto}}
  `;
  document.head.appendChild(style);
}

function setCurrent(button) {
  root?.querySelectorAll(".admin-nav [data-admin-target][aria-current]").forEach((node) => node.removeAttribute("aria-current"));
  button?.setAttribute("aria-current", "page");
}

function openExperiments(button) {
  const main = root?.querySelector("#adminMain");
  const panel = root?.querySelector("#pinconExperimentAdmin");
  if (!main || !panel) return;
  main.classList.add("experiment-focus");
  setCurrent(button);
  panel.scrollIntoView({ behavior:"auto", block:"start" });
  history.replaceState(null, "", "#experiments");
}

function leaveExperiments(button) {
  const main = root?.querySelector("#adminMain");
  if (!main?.classList.contains("experiment-focus")) return;
  main.classList.remove("experiment-focus");
  if (button) setCurrent(button);
  if (location.hash === "#experiments") history.replaceState(null, "", location.pathname + location.search);
}

function install() {
  const panel = root?.querySelector("#pinconExperimentAdmin");
  const nav = root?.querySelector(".admin-nav");
  if (!panel || !nav) return false;
  ensureStyle();

  let button = nav.querySelector(`[data-admin-target="${NAV_KEY}"]`);
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "admin-nav__item";
    button.dataset.adminTarget = NAV_KEY;
    button.innerHTML = "<md-icon>experiment</md-icon><span>실험 · 통계</span>";
    nav.appendChild(button);
  }

  if (!button.dataset.experimentBound) {
    button.dataset.experimentBound = "true";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      openExperiments(button);
    }, true);
  }

  nav.querySelectorAll('[data-admin-target]:not([data-admin-target="experiments"])').forEach((item) => {
    if (item.dataset.experimentExitBound) return;
    item.dataset.experimentExitBound = "true";
    item.addEventListener("click", () => leaveExperiments(item), true);
  });

  if (location.hash === "#experiments") requestAnimationFrame(() => openExperiments(button));
  return true;
}

let scheduled = false;
function scheduleInstall() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => { scheduled = false; install(); });
}

const observer = new MutationObserver(scheduleInstall);
if (root) observer.observe(root, { childList:true, subtree:true });
scheduleInstall();
