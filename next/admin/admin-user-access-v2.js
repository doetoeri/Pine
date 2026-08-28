const root = document.querySelector("#adminApp");
let queued = false;

function normalizeUserAccessNavigation() {
  queued = false;
  if (!root) return;

  root.querySelectorAll('[data-admin-target="access"]').forEach((button) => button.remove());
  root.querySelector("#adminRoleManager")?.remove();

  const usersButton = root.querySelector('.admin-nav [data-admin-target="users"]');
  if (usersButton) {
    usersButton.dataset.adminTarget = "users";
    const icon = usersButton.querySelector("md-icon");
    const label = usersButton.querySelector("span");
    if (icon) icon.textContent = "manage_accounts";
    if (label) label.textContent = "사용자·권한";
    usersButton.setAttribute("aria-label", "사용자 및 권한 관리");
  }
}

function queueNormalize() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(normalizeUserAccessNavigation);
}

if (root) {
  const observer = new MutationObserver((records) => {
    if (records.some((record) => record.target === root && record.type === "childList")) queueNormalize();
  });
  observer.observe(root, { childList: true });
  normalizeUserAccessNavigation();
}
