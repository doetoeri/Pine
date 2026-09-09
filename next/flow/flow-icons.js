const ROUTE_ICONS = {
  today: "today",
  timetable: "view_timeline",
  schedule: "calendar_month",
  assessment: "assignment",
  hub: "apps",
};

const HUB_ICONS = [
  ["[data-action='meal-detail']", "lunch_dining"],
  ["[data-classic-route='classroom']", "groups"],
  ["[data-classic-route='more']", "settings"],
  ["[data-classic-route='schedule']", "edit_calendar"],
  ["[data-action='classic']", "open_in_new"],
  ["[data-action='change-class']", "school"],
];

function symbol(name, className = "") {
  const node = document.createElement("span");
  node.className = `material-symbols-rounded ${className}`.trim();
  node.setAttribute("aria-hidden", "true");
  node.textContent = name;
  return node;
}

function ensureButtonIcon(button, name) {
  if (!button || button.querySelector(":scope > .button-icon")) return;
  button.prepend(symbol(name, "button-icon"));
}

function decorateRoutes(root) {
  root.querySelectorAll?.("[data-route]").forEach((button) => {
    const name = ROUTE_ICONS[button.dataset.route];
    if (!name) return;
    let holder = button.querySelector(":scope > b");
    if (!holder) {
      holder = document.createElement("b");
      button.prepend(holder);
    }
    holder.className = "nav-icon";
    holder.replaceChildren(symbol(name));
  });
}

function decorateActions(root) {
  root.querySelectorAll?.("button[data-action='refresh']").forEach((button) => {
    button.replaceChildren(symbol("refresh"));
  });

  root.querySelectorAll?.("#flowSheet button[value='cancel']").forEach((button) => {
    button.replaceChildren(symbol("close"));
  });

  root.querySelectorAll?.("button[data-action='classic']").forEach((button) => {
    if (button.classList.contains("quick-action")) return;
    ensureButtonIcon(button, "arrow_back");
  });

  root.querySelectorAll?.("button[data-action='meal-detail']").forEach((button) => {
    if (button.classList.contains("quick-action") || button.closest(".meal-card") === button) return;
    if (button.classList.contains("soft-button")) ensureButtonIcon(button, "restaurant");
  });

  root.querySelectorAll?.("button[data-action='retry-flow']").forEach((button) => ensureButtonIcon(button, "refresh"));
  root.querySelectorAll?.(".profile-fields button").forEach((button) => ensureButtonIcon(button, "arrow_forward"));
}

function decorateHub(root) {
  root.querySelectorAll?.(".quick-action").forEach((button) => {
    const iconName = HUB_ICONS.find(([selector]) => button.matches(selector))?.[1] || "apps";
    let em = button.querySelector(":scope > em");
    if (!em) {
      em = document.createElement("em");
      button.prepend(em);
    }
    em.replaceChildren(symbol(iconName));
  });
}

function decorateRows(root) {
  root.querySelectorAll?.(".task-row, .event").forEach((row) => {
    if (!row.querySelector(":scope > .row-chevron")) row.append(symbol("chevron_right", "row-chevron"));
  });

  root.querySelectorAll?.(".next-time").forEach((node) => {
    const raw = node.textContent.trim().replace(/^→\s*/, "");
    if (!raw) return;
    node.replaceChildren(symbol("arrow_forward"), document.createTextNode(raw));
  });
}

function decorateStatus(root) {
  root.querySelectorAll?.(".hero-pill").forEach((pill) => {
    const text = pill.textContent.trim();
    if (!text.includes("동기화됨") || pill.querySelector(".status-icon")) return;
    pill.textContent = "";
    pill.append(symbol("cloud_done", "status-icon"), document.createTextNode("동기화됨"));
  });
}

function decorate(root = document) {
  decorateRoutes(root);
  decorateActions(root);
  decorateHub(root);
  decorateRows(root);
  decorateStatus(root);
}

decorate(document);

const app = document.querySelector("#flowApp");
if (app) {
  new MutationObserver(() => decorate(app)).observe(app, { childList: true, subtree: true });
}

const sheet = document.querySelector("#flowSheet");
if (sheet) {
  new MutationObserver(() => decorate(sheet)).observe(sheet, { childList: true, subtree: true });
}
