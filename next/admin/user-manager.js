import { accountRequest } from "../core/student-auth.js";

const root = document.querySelector("#adminApp");
let accounts = [];
let loaded = false;
let loading = false;
let allowed = true;

const ROLE_OPTIONS = Object.freeze([
  ["STUDENT", "학생"],
  ["DEPARTMENT_HEAD", "학급자치회 부장"],
  ["SUBJECT_MANAGER", "과목 관리자"],
  ["CLASS_PRESIDENT", "학급 회장"],
  ["TEACHER", "교사"],
  ["ADMIN", "관리자"],
]);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function roleLabels(account) {
  const labels = new Map(ROLE_OPTIONS);
  return (account.roles || []).map((role) => labels.get(role) || role).join(" · ");
}

async function loadAccounts(force = false) {
  if (loading || (!force && loaded)) return;
  loading = true;
  try {
    const result = await accountRequest("/api/accounts/manage");
    accounts = Array.isArray(result.accounts) ? result.accounts : [];
    allowed = true;
    loaded = true;
  } catch (error) {
    if (error?.status === 403) allowed = false;
  } finally {
    loading = false;
    renderSection();
  }
}

function sectionMarkup() {
  if (!allowed) return "";
  return `<section class="admin-card admin-card--wide" id="pinconUserManager" aria-labelledby="pincon-users-title">
    <div class="admin-card__header"><h2 id="pincon-users-title">사용자 관리</h2><span class="admin-meta">Firebase Auth · RBAC</span></div>
    <div class="pincon-user-manager__toolbar">
      <md-outlined-text-field id="pinconUserSearch" label="학생 검색" placeholder="이름 또는 학번" type="search"></md-outlined-text-field>
      <md-filled-button id="pinconAddUser"><md-icon slot="icon">person_add</md-icon>학생 추가</md-filled-button>
    </div>
    <div id="pinconUserList" class="pincon-user-manager__list">
      ${loading && !loaded ? `<md-linear-progress indeterminate></md-linear-progress>` : accounts.length ? userRows(accounts) : `<div class="admin-empty"><md-icon>group</md-icon><strong>새 계정이 아직 없습니다</strong><span>기존 데이터는 삭제하지 않고 학생 계정을 추가할 수 있습니다.</span></div>`}
    </div>
  </section>`;
}

function userRows(rows) {
  return rows.map((account) => `<div class="pincon-user-row" data-disabled="${account.status !== "ACTIVE"}">
    <div><strong>${account.number || "-"}번 ${escapeHtml(account.name || "이름 없음")}</strong><span>${escapeHtml(account.studentNumber)} · ${account.grade}학년 ${account.classNumber}반 · ${escapeHtml(roleLabels(account))}</span></div>
    <md-outlined-button data-edit-user="${escapeHtml(account.uid)}">관리</md-outlined-button>
  </div>`).join("");
}

function bindSection() {
  const section = root.querySelector("#pinconUserManager");
  if (!section) return;
  section.querySelector("#pinconAddUser")?.addEventListener("click", () => openUserDialog(null));
  section.querySelector("#pinconUserSearch")?.addEventListener("input", (event) => {
    const query = String(event.target.value || "").trim().toLowerCase();
    const filtered = !query ? accounts : accounts.filter((item) => `${item.name} ${item.studentNumber}`.toLowerCase().includes(query));
    section.querySelector("#pinconUserList").innerHTML = filtered.length ? userRows(filtered) : `<div class="admin-empty"><strong>검색 결과가 없습니다</strong></div>`;
    section.querySelectorAll("[data-edit-user]").forEach((button) => button.addEventListener("click", () => openUserDialog(accounts.find((item) => item.uid === button.dataset.editUser))));
  });
  section.querySelectorAll("[data-edit-user]").forEach((button) => button.addEventListener("click", () => openUserDialog(accounts.find((item) => item.uid === button.dataset.editUser))));
}

function renderSection() {
  const grid = root.querySelector("#adminMain .admin-grid");
  if (!grid || !allowed) return;
  grid.querySelector("#pinconUserManager")?.remove();
  grid.insertAdjacentHTML("afterbegin", sectionMarkup());
  bindSection();
}

function checkedRoles(dialog) {
  const roles = [...dialog.querySelectorAll("[data-role-check]")]
    .filter((input) => input.checked)
    .map((input) => input.dataset.roleCheck);
  if (!roles.includes("STUDENT")) roles.unshift("STUDENT");
  return roles;
}

function subjectRoles(value) {
  return [...new Set(String(value || "").split(/[,，]/).map((item) => item.trim()).filter(Boolean))]
    .map((subject) => ({ subject, role: "SUBJECT_MANAGER" }));
}

function tempPinMarkup(pin) {
  return `<div class="pincon-temp-pin" role="status"><strong>임시 PIN</strong><code>${escapeHtml(pin)}</code><span>이 화면을 닫으면 다시 조회할 수 없습니다. 학생은 첫 로그인 후 새 PIN으로 변경해야 합니다.</span></div>`;
}

function openUserDialog(account) {
  document.querySelector("#pinconUserDialog")?.remove();
  const dialog = document.createElement("md-dialog");
  dialog.id = "pinconUserDialog";
  dialog.className = "pincon-user-dialog";
  const roles = new Set(account?.roles || ["STUDENT"]);
  const subjects = (account?.subjectRoles || []).map((item) => item.subject).join(", ");
  dialog.innerHTML = `<div slot="headline">${account ? "학생 계정 관리" : "학생 추가"}</div>
    <div slot="content" class="pincon-user-dialog__body">
      <form class="pincon-user-form" id="pinconUserForm">
        <md-outlined-text-field id="userStudentNumber" label="학번" inputmode="numeric" maxlength="5" value="${escapeHtml(account?.studentNumber || "")}" required></md-outlined-text-field>
        <md-outlined-text-field id="userName" label="이름" maxlength="30" value="${escapeHtml(account?.name || "")}" required></md-outlined-text-field>
        <md-outlined-text-field id="userGrade" label="학년" type="number" min="1" max="3" value="${account?.grade || 1}" required></md-outlined-text-field>
        <md-outlined-text-field id="userClass" label="반" type="number" min="1" max="10" value="${account?.classNumber || 8}" required></md-outlined-text-field>
        <md-outlined-text-field id="userNumber" label="번호" type="number" min="1" max="60" value="${account?.number || ""}" required></md-outlined-text-field>
        <md-outlined-text-field id="userDepartment" label="부서 ID" value="${escapeHtml(account?.departmentId || "")}"></md-outlined-text-field>
        <div class="pincon-role-checks"><strong class="pincon-user-form--wide">역할</strong>${ROLE_OPTIONS.map(([role, label]) => `<label><md-checkbox data-role-check="${role}" ${roles.has(role) ? "checked" : ""} ${role === "STUDENT" ? "disabled" : ""}></md-checkbox><span>${label}</span></label>`).join("")}</div>
        <md-outlined-text-field class="pincon-user-form--wide" id="userSubjects" label="과목 관리자" supporting-text="여러 과목은 쉼표로 구분" value="${escapeHtml(subjects)}"></md-outlined-text-field>
        <md-outlined-text-field class="pincon-user-form--wide" id="userOnePersonRole" label="1인1역 ID" value="${escapeHtml(account?.onePersonRoleId || "")}"></md-outlined-text-field>
      </form>
      <div id="pinconUserDialogResult"></div>
      <div class="pincon-user-dialog__status" id="pinconUserDialogStatus"></div>
    </div>
    <div slot="actions">
      ${account ? `<md-text-button id="pinconResetPin">초기 PIN 재발급</md-text-button>${account.status === "ACTIVE" ? `<md-text-button id="pinconDisableUser">계정 비활성화</md-text-button>` : ""}` : ""}
      <md-text-button id="pinconUserCancel">닫기</md-text-button>
      <md-filled-button id="pinconUserSave">저장</md-filled-button>
    </div>`;
  document.body.appendChild(dialog);
  const status = dialog.querySelector("#pinconUserDialogStatus");
  const resultBox = dialog.querySelector("#pinconUserDialogResult");
  dialog.querySelector("#pinconUserCancel")?.addEventListener("click", () => dialog.close?.());
  dialog.querySelector("#pinconUserSave")?.addEventListener("click", async () => {
    const rolesValue = checkedRoles(dialog);
    const subjectRolesValue = subjectRoles(dialog.querySelector("#userSubjects")?.value);
    if (subjectRolesValue.length && !rolesValue.includes("SUBJECT_MANAGER")) rolesValue.push("SUBJECT_MANAGER");
    const payload = {
      studentNumber: String(dialog.querySelector("#userStudentNumber")?.value || "").trim(),
      name: String(dialog.querySelector("#userName")?.value || "").trim(),
      grade: Number(dialog.querySelector("#userGrade")?.value),
      classNumber: Number(dialog.querySelector("#userClass")?.value),
      number: Number(dialog.querySelector("#userNumber")?.value),
      roles: rolesValue,
      subjectRoles: subjectRolesValue,
      departmentId: String(dialog.querySelector("#userDepartment")?.value || "").trim(),
      onePersonRoleId: String(dialog.querySelector("#userOnePersonRole")?.value || "").trim(),
      status: account?.status || "ACTIVE",
    };
    status.textContent = "저장 중…";
    status.dataset.error = "false";
    try {
      const result = await accountRequest("/api/accounts/manage", { method: "POST", body: account ? { action: "UPDATE", uid: account.uid, patch: payload } : { action: "CREATE", account: payload } });
      resultBox.innerHTML = result.temporaryPin ? tempPinMarkup(result.temporaryPin) : "";
      status.textContent = "저장했습니다.";
      await loadAccounts(true);
    } catch {
      status.textContent = "저장하지 못했습니다. 학번 중복, 입력값 또는 권한을 확인해주세요.";
      status.dataset.error = "true";
    }
  });
  dialog.querySelector("#pinconResetPin")?.addEventListener("click", async () => {
    status.textContent = "새 임시 PIN을 발급하는 중…";
    try {
      const result = await accountRequest("/api/accounts/manage", { method: "POST", body: { action: "RESET_PIN", uid: account.uid } });
      resultBox.innerHTML = tempPinMarkup(result.temporaryPin);
      status.textContent = "새 임시 PIN을 발급했습니다.";
      await loadAccounts(true);
    } catch {
      status.textContent = "PIN을 재발급하지 못했습니다.";
      status.dataset.error = "true";
    }
  });
  dialog.querySelector("#pinconDisableUser")?.addEventListener("click", async () => {
    status.textContent = "계정을 비활성화하는 중…";
    try {
      await accountRequest("/api/accounts/manage", { method: "POST", body: { action: "DISABLE", uid: account.uid } });
      status.textContent = "계정을 비활성화했습니다.";
      await loadAccounts(true);
    } catch {
      status.textContent = "계정을 비활성화하지 못했습니다.";
      status.dataset.error = "true";
    }
  });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.show?.();
}

new MutationObserver(() => {
  if (!root.querySelector("#adminMain")) return;
  renderSection();
  loadAccounts();
}).observe(root, { childList: true, subtree: true });

renderSection();
loadAccounts();
