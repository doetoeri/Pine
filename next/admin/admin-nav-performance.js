const root = document.querySelector("#adminApp");

const TARGETS = Object.freeze({
  overview: "#adminOverview",
  users: "#pinconUserManager",
  operations: "#pinconClassOpsSettings",
  content: "[data-managed-editor]",
  access: "#adminRoleManager",
  audit: "#adminAuditExplorer",
  system: "#adminSystemHealth",
});

let activeTarget = "overview";

function eventHost(event, selector) {
  return event.composedPath?.().find((node) => node instanceof Element && node.matches?.(selector)) || null;
}

function isMobileAdmin() {
  return matchMedia("(max-width: 820px)").matches;
}

function setCurrentTarget(key) {
  activeTarget = key || "overview";
  root?.querySelectorAll(".admin-nav [data-admin-target][aria-current]").forEach((node) => node.removeAttribute("aria-current"));
  root?.querySelector(`.admin-nav [data-admin-target="${CSS.escape(activeTarget)}"]`)?.setAttribute("aria-current", "page");
}

function jumpToTarget(key) {
  const selector = TARGETS[key];
  const target = selector ? root?.querySelector(selector) : null;
  if (!target) return false;

  const top = Math.max(0, Math.round(target.getBoundingClientRect().top + window.scrollY - 10));
  window.scrollTo({ top, behavior: "auto" });
  setCurrentTarget(key);
  return true;
}

function handleMobileTargetClick(event) {
  if (!isMobileAdmin()) return;
  const trigger = eventHost(event, "[data-admin-target]");
  if (!trigger || !root?.contains(trigger)) return;

  const key = trigger.dataset.adminTarget;
  if (!TARGETS[key]) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  jumpToTarget(key);
}

root?.addEventListener("click", handleMobileTargetClick, true);

const shellObserver = new MutationObserver(() => {
  if (!root?.querySelector("#adminMain")) return;
  requestAnimationFrame(() => setCurrentTarget(activeTarget));
});

if (root) shellObserver.observe(root, { childList: true });
