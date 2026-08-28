import { accountRequest } from "../core/student-auth.js";

const root = document.querySelector("#adminApp");
let accounts = [];
let loaded = false;
let loading = false;
let allowed = true;
const filters = { query: "", status: "ALL", role: "ALL" };

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

function filteredAccounts() {
  const query = filters.query.trim().toLowerCase();
  return accounts.filter((item) => {
    if (query && !`${item.name || ""} ${item.studentNumber || ""} ${item.classKey || ""} ${item.number || ""}`.toLowerCase().includes(query)) return false;
    if (filters.status !== "ALL" && item.status !== filters.status) return false;
    if (filters.role !== "ALL" && !(item.roles || []).includes(filters.role)) return false;
    return true;
  });
}

function accountStats() {
  return {
    total: accounts.length,
    active: accounts.filter((item) => item.status === "ACTIVE").length,
    disabled: accounts.filter((item) => item.status !== "ACTIVE").length,
    firstLogin: accounts.filter((item) => item.mustChangePin === true).length,
    managers: accounts.filter((item) => (item.roles || []).some((role) => ["DEPARTMENT_HEAD", "SUBJECT_MANAGER", "CLASS_PRESIDENT", "TEACHER", "ADMIN"].includes(role))).length,
  };
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
    renderSection(true);
  }
}

function statsMarkup() {
  const stats = accountStats();
  return `<div class="pincon-user-stats">
    <div><span>전체</span><strong>${stats.total}</strong></div>
    <div><span>활성</span><strong>${stats.active}</strong></div>
    <div><span>첫 로그인 대기</span><strong>${stats.firstLogin}</strong></div>
    <div><span>운영 역할 보유</span><strong>${stats.managers}</strong></div>
    <div><span>비활성</span><strong>${stats.disabled}</strong></div>
  </div>`;
}

function roleFilterOptions() {
  return `<md-select-option value="ALL"><div slot="headline">모든 역할</div></md-select-option>${ROLE_OPTIONS.slice(1).map(([role, label]) => `<md-select-option value="${role}"><div slot="headline">${label}</div></md-select-option>`).join("")}`;
}

function sectionMarkup() {
  if (!allowed) return "";
  const visible = filteredAccounts();
  return `<section class="admin-card admin-card--wide pincon-user-manager" id="pinconUserManager" aria-labelledby="pincon-users-title">
    <div class="admin-card__header"><div><span class="pincon-user-manager__eyebrow">IDENTITY & RBAC</span><h2 id="pincon-users-title">사용자 · 권한 관리</h2></div><span class="admin-meta">Firebase Auth · 서버 RBAC</span></div>
    <p class="pincon-user-manager__intro">학생 계정, 운영 역할, 최초 로그인 상태를 한 화면에서 관리합니다. PIN 원문은 저장하거나 다시 조회하지 않습니다.</p>
    ${statsMarkup()}
    <div class="pincon-user-manager__toolbar">
      <md-outlined-text-field id="pinconUserSearch" label="검색" placeholder="이름, 학번, 반, 번호" type="search" value="${escapeHtml(filters.query)}"></md-outlined-text-field>
      <md-outlined-select id="pinconUserStatusFilter" label="계정 상태" value="${escapeHtml(filters.status)}">
        <md-select-option value="ALL"><div slot="headline">모든 상태</div></md-select-option>
        <md-select-option value="ACTIVE"><div slot="headline">활성</div></md-select-option>
        <md-select-option value="DISABLED"><div slot="headline">비활성</div></md-select-option>
      </md-outlined-select>
      <md-outlined-select id="pinconUserRoleFilter" label="역할" value="${escapeHtml(filters.role)}">${roleFilterOptions()}</md-outlined-select>
      <div class="pincon-user-manager__actions">
        <md-outlined-button id="pinconExportUsers"><md-icon slot="icon">download</md-icon>명단 CSV</md-outlined-button>
        <md-filled-tonal-button id="pinconBulkUsers"><md-icon slot="icon">group_add</md-icon>일괄 등록</md-filled-tonal-button>
        <md-filled-button id="pinconAddUser"><md-icon slot="icon">person_add</md-icon>학생 추가</md-filled-button>
      </div>
    </div>
    <div class="pincon-user-manager__result-meta"><span>표시 ${visible.length}명</span><span>${filters.status !== "ALL" || filters.role !== "ALL" || filters.query ? "필터 적용 중" : "전체 계정"}</span></div>
    <div id="pinconUserList" class="pincon-user-manager__list">
      ${loading && !loaded ? `<md-linear-progress indeterminate></md-linear-progress>` : visible.length ? userRows(visible) : `<div class="admin-empty"><md-icon>person_search</md-icon><strong>조건에 맞는 계정이 없습니다</strong><span>검색어나 필터를 바꾸거나 새 계정을 추가하세요.</span></div>`}
    </div>
  </section>`;
}

function userRows(rows) {
  return rows.map((account) => `<div class="pincon-user-row" data-disabled="${account.status !== "ACTIVE"}">
    <div class="pincon-user-row__identity"><span class="pincon-user-avatar" aria-hidden="true">${escapeHtml(String(account.name || "?").slice(0, 1))}</span><div><strong>${String(account.number || "-").padStart(2, "0")}번 ${escapeHtml(account.name || "이름 없음")}</strong><span>${escapeHtml(account.studentNumber)} · ${account.grade}학년 ${account.classNumber}반</span></div></div>
    <div class="pincon-user-row__roles"><span>${escapeHtml(roleLabels(account))}</span>${account.mustChangePin ? `<b>첫 로그인 대기</b>` : ""}${account.status !== "ACTIVE" ? `<b class="pincon-user-badge--disabled">비활성</b>` : ""}</div>
    <md-outlined-button data-edit-user="${escapeHtml(account.uid)}">관리</md-outlined-button>
  </div>`).join("");
}

function bindEditButtons(section) {
  section.querySelectorAll("[data-edit-user]").forEach((button) => button.addEventListener("click", () => openUserDialog(accounts.find((item) => item.uid === button.dataset.editUser))));
}

function rerenderList(section) {
  const rows = filteredAccounts();
  const list = section.querySelector("#pinconUserList");
  if (list) list.innerHTML = rows.length ? userRows(rows) : `<div class="admin-empty"><md-icon>person_search</md-icon><strong>조건에 맞는 계정이 없습니다</strong></div>`;
  const meta = section.querySelector(".pincon-user-manager__result-meta span:first-child");
  if (meta) meta.textContent = `표시 ${rows.length}명`;
  bindEditButtons(section);
}

function bindSection() {
  const section = root.querySelector("#pinconUserManager");
  if (!section) return;
  section.querySelector("#pinconAddUser")?.addEventListener("click", () => openUserDialog(null));
  section.querySelector("#pinconBulkUsers")?.addEventListener("click", openBulkDialog);
  section.querySelector("#pinconExportUsers")?.addEventListener("click", exportUsers);
  section.querySelector("#pinconUserSearch")?.addEventListener("input", (event) => { filters.query = String(event.target.value || ""); rerenderList(section); });
  section.querySelector("#pinconUserStatusFilter")?.addEventListener("change", (event) => { filters.status = event.target.value || "ALL"; rerenderList(section); });
  section.querySelector("#pinconUserRoleFilter")?.addEventListener("change", (event) => { filters.role = event.target.value || "ALL"; rerenderList(section); });
  bindEditButtons(section);
}

function renderSection(force = false) {
  const grid = root.querySelector("#adminMain .admin-grid");
  if (!grid) return;
  const existing = grid.querySelector("#pinconUserManager");
  if (!allowed) { existing?.remove(); return; }
  if (existing && !force) return;
  existing?.remove();
  grid.insertAdjacentHTML("afterbegin", sectionMarkup());
  bindSection();
}

function checkedRoles(dialog) {
  const roles = [...dialog.querySelectorAll("[data-role-check]")].filter((input) => input.checked).map((input) => input.dataset.roleCheck);
  if (!roles.includes("STUDENT")) roles.unshift("STUDENT");
  return roles;
}

function subjectRoles(value) {
  return [...new Set(String(value || "").split(/[,，]/).map((item) => item.trim()).filter(Boolean))].map((subject) => ({ subject, role: "SUBJECT_MANAGER" }));
}

function tempPinMarkup(pin) {
  return `<div class="pincon-temp-pin" role="status"><strong>임시 PIN</strong><code>${escapeHtml(pin)}</code><span>이 화면을 닫으면 다시 조회할 수 없습니다. 학생은 첫 로그인 후 새 PIN으로 변경해야 합니다.</span></div>`;
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportUsers() {
  downloadCsv(`pincon-users-${new Date().toISOString().slice(0, 10)}.csv`, [
    ["학번", "이름", "학년", "반", "번호", "상태", "첫 로그인 대기", "역할", "부서", "과목 관리자", "1인1역"],
    ...accounts.map((item) => [item.studentNumber, item.name, item.grade, item.classNumber, item.number, item.status, item.mustChangePin ? "Y" : "N", (item.roles || []).join("|"), item.departmentId || "", (item.subjectRoles || []).map((role) => role.subject).join("|"), item.onePersonRoleId || ""]),
  ]);
}

function parseBulkRows(value) {
  const lines = String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const rows = [];
  const errors = [];
  lines.slice(0, 60).forEach((line, index) => {
    const parts = line.split(/[\t,]/).map((item) => item.trim());
    const [studentNumber, name, gradeText, classText, numberText] = parts;
    const grade = Number(gradeText);
    const classNumber = Number(classText);
    const number = Number(numberText);
    if (!/^\d{5}$/.test(studentNumber || "") || !name || !Number.isInteger(grade) || grade < 1 || grade > 3 || !Number.isInteger(classNumber) || classNumber < 1 || classNumber > 10 || !Number.isInteger(number) || number < 1 || number > 60) {
      errors.push(`${index + 1}행 형식 오류`);
      return;
    }
    rows.push({ studentNumber, name, grade, classNumber, number, roles: ["STUDENT"], subjectRoles: [], departmentId: "", onePersonRoleId: "", status: "ACTIVE" });
  });
  if (lines.length > 60) errors.push("한 번에 최대 60명까지 등록할 수 있습니다.");
  const duplicates = rows.filter((row, index) => rows.findIndex((item) => item.studentNumber === row.studentNumber) !== index);
  if (duplicates.length) errors.push("입력 안에 중복 학번이 있습니다.");
  return { rows, errors };
}

function openBulkDialog() {
  document.querySelector("#pinconBulkUserDialog")?.remove();
  const dialog = document.createElement("md-dialog");
  dialog.id = "pinconBulkUserDialog";
  dialog.className = "pincon-user-dialog pincon-bulk-user-dialog";
  dialog.innerHTML = `<div slot="headline">학생 계정 일괄 등록</div>
    <div slot="content" class="pincon-user-dialog__body">
      <div class="pincon-bulk-guide"><md-icon>info</md-icon><div><strong>한 줄에 한 명</strong><span>학번, 이름, 학년, 반, 번호 순서로 붙여넣으세요. 쉼표 또는 탭을 지원합니다.</span><code>10801,홍길동,1,8,1</code></div></div>
      <md-outlined-text-field id="pinconBulkInput" label="학생 명단" type="textarea" rows="10" placeholder="10801,홍길동,1,8,1"></md-outlined-text-field>
      <div id="pinconBulkPreview" class="pincon-bulk-preview">명단을 붙여넣으면 형식을 확인합니다.</div>
      <div id="pinconBulkResult"></div>
      <div class="pincon-user-dialog__status" id="pinconBulkStatus" role="status"></div>
    </div>
    <div slot="actions"><md-text-button id="pinconBulkClose">닫기</md-text-button><md-filled-button id="pinconBulkCreate">계정 생성</md-filled-button></div>`;
  document.body.appendChild(dialog);
  const input = dialog.querySelector("#pinconBulkInput");
  const preview = dialog.querySelector("#pinconBulkPreview");
  const status = dialog.querySelector("#pinconBulkStatus");
  const resultBox = dialog.querySelector("#pinconBulkResult");
  let created = [];
  const updatePreview = () => {
    const parsed = parseBulkRows(input?.value);
    preview.dataset.error = parsed.errors.length ? "true" : "false";
    preview.textContent = parsed.errors.length ? parsed.errors.join(" · ") : parsed.rows.length ? `${parsed.rows.length}명 등록 준비 완료` : "명단을 붙여넣으면 형식을 확인합니다.";
  };
  input?.addEventListener("input", updatePreview);
  dialog.querySelector("#pinconBulkClose")?.addEventListener("click", () => dialog.close?.());
  dialog.querySelector("#pinconBulkCreate")?.addEventListener("click", async (event) => {
    const parsed = parseBulkRows(input?.value);
    if (parsed.errors.length || !parsed.rows.length) { updatePreview(); return; }
    const button = event.currentTarget;
    button.disabled = true;
    created = [];
    const failures = [];
    for (let index = 0; index < parsed.rows.length; index += 1) {
      const account = parsed.rows[index];
      status.textContent = `${index + 1}/${parsed.rows.length} · ${account.name} 계정 생성 중…`;
      try {
        const result = await accountRequest("/api/accounts/manage", { method: "POST", body: { action: "CREATE", account } });
        created.push({ ...account, temporaryPin: result.temporaryPin });
      } catch (error) {
        failures.push(`${account.studentNumber} ${account.name}: ${error?.status === 409 ? "이미 존재" : "생성 실패"}`);
      }
    }
    status.textContent = `완료: ${created.length}명 생성${failures.length ? ` · ${failures.length}명 실패` : ""}`;
    resultBox.innerHTML = `${created.length ? `<div class="pincon-bulk-result"><md-icon>verified</md-icon><div><strong>임시 PIN은 지금 한 번만 내려받을 수 있습니다.</strong><span>파일 전달 후 안전하게 삭제하고, 학생에게 첫 로그인 후 PIN 변경을 안내하세요.</span></div><md-filled-tonal-button id="pinconDownloadPins">임시 PIN CSV</md-filled-tonal-button></div>` : ""}${failures.length ? `<div class="pincon-bulk-errors">${failures.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}`;
    resultBox.querySelector("#pinconDownloadPins")?.addEventListener("click", () => downloadCsv(`pincon-temporary-pins-${new Date().toISOString().slice(0, 10)}.csv`, [["학번", "이름", "임시 PIN"], ...created.map((item) => [item.studentNumber, item.name, item.temporaryPin])]));
    await loadAccounts(true);
    button.disabled = false;
  });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.show?.();
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
      ${account ? `<div class="pincon-account-state"><span class="${account.status === "ACTIVE" ? "is-active" : "is-disabled"}">${account.status === "ACTIVE" ? "활성 계정" : "비활성 계정"}</span>${account.mustChangePin ? `<span>첫 로그인 PIN 변경 대기</span>` : `<span>PIN 설정 완료</span>`}</div>` : ""}
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
      <div id="pinconUserDialogResult"></div><div class="pincon-user-dialog__status" id="pinconUserDialogStatus"></div>
    </div>
    <div slot="actions">
      ${account ? `<md-text-button id="pinconResetPin">임시 PIN 재발급</md-text-button>${account.status === "ACTIVE" ? `<md-text-button id="pinconDisableUser">비활성화</md-text-button>` : `<md-text-button id="pinconEnableUser">다시 활성화</md-text-button>`}` : ""}
      <md-text-button id="pinconUserCancel">닫기</md-text-button><md-filled-button id="pinconUserSave">저장</md-filled-button>
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
      grade: Number(dialog.querySelector("#userGrade")?.value), classNumber: Number(dialog.querySelector("#userClass")?.value), number: Number(dialog.querySelector("#userNumber")?.value),
      roles: rolesValue, subjectRoles: subjectRolesValue,
      departmentId: String(dialog.querySelector("#userDepartment")?.value || "").trim(), onePersonRoleId: String(dialog.querySelector("#userOnePersonRole")?.value || "").trim(), status: account?.status || "ACTIVE",
    };
    status.textContent = "저장 중…"; status.dataset.error = "false";
    try {
      const result = await accountRequest("/api/accounts/manage", { method: "POST", body: account ? { action: "UPDATE", uid: account.uid, patch: payload } : { action: "CREATE", account: payload } });
      resultBox.innerHTML = result.temporaryPin ? tempPinMarkup(result.temporaryPin) : "";
      status.textContent = "저장했습니다.";
      await loadAccounts(true);
    } catch { status.textContent = "저장하지 못했습니다. 학번 중복, 입력값 또는 권한을 확인해주세요."; status.dataset.error = "true"; }
  });
  dialog.querySelector("#pinconResetPin")?.addEventListener("click", async () => {
    status.textContent = "새 임시 PIN을 발급하는 중…";
    try { const result = await accountRequest("/api/accounts/manage", { method: "POST", body: { action: "RESET_PIN", uid: account.uid } }); resultBox.innerHTML = tempPinMarkup(result.temporaryPin); status.textContent = "새 임시 PIN을 발급했습니다."; await loadAccounts(true); }
    catch { status.textContent = "PIN을 재발급하지 못했습니다."; status.dataset.error = "true"; }
  });
  dialog.querySelector("#pinconDisableUser")?.addEventListener("click", async () => {
    status.textContent = "계정을 비활성화하는 중…";
    try { await accountRequest("/api/accounts/manage", { method: "POST", body: { action: "DISABLE", uid: account.uid } }); status.textContent = "계정을 비활성화했습니다."; await loadAccounts(true); dialog.close?.(); }
    catch { status.textContent = "계정을 비활성화하지 못했습니다."; status.dataset.error = "true"; }
  });
  dialog.querySelector("#pinconEnableUser")?.addEventListener("click", async () => {
    status.textContent = "계정을 다시 활성화하는 중…";
    try { await accountRequest("/api/accounts/manage", { method: "POST", body: { action: "UPDATE", uid: account.uid, patch: { status: "ACTIVE" } } }); status.textContent = "계정을 활성화했습니다."; await loadAccounts(true); dialog.close?.(); }
    catch { status.textContent = "계정을 활성화하지 못했습니다."; status.dataset.error = "true"; }
  });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.show?.();
}

new MutationObserver(() => {
  if (!root.querySelector("#adminMain")) return;
  renderSection(false);
  loadAccounts();
}).observe(root, { childList: true, subtree: true });

renderSection(false);
loadAccounts();
