import { accountRequest } from "../core/student-auth.js?v=20260903-pinless1";

const root = document.querySelector("#adminApp");
let accounts = [];
let loaded = false;
let loading = false;
let allowed = true;
const filters = { query: "", status: "ALL", role: "ALL", attention: false, privileged: false };

const ROLE_OPTIONS = Object.freeze([
  ["STUDENT", "학생", "기본 사용자"],
  ["DEPARTMENT_HEAD", "학급자치회 부장", "부서 청소 운영"],
  ["SUBJECT_MANAGER", "과목 관리자", "과목 공지·검토"],
  ["CLASS_PRESIDENT", "학급 회장", "학급 운영 권한"],
  ["TEACHER", "교사", "학급 계정 관리"],
  ["ADMIN", "관리자", "학교 전체 관리"],
]);
const ROLE_LABELS = new Map(ROLE_OPTIONS.map(([role, label]) => [role, label]));

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function classLabel(account) {
  return `${Number(account.grade) || "-"}학년 ${Number(account.classNumber) || "-"}반 ${Number(account.number) || "-"}번`;
}

function accountRoles(account) {
  return Array.isArray(account.roles) && account.roles.length ? account.roles : ["STUDENT"];
}

function roleLabel(role) {
  return ROLE_LABELS.get(role) || role;
}

function isAttention(account) {
  return account.status !== "ACTIVE" || account.mustChangePin === true;
}

function filteredAccounts() {
  const query = filters.query.trim().toLowerCase();
  return accounts.filter((item) => {
    const haystack = `${item.name || ""} ${item.studentNumber || ""} ${item.classKey || ""} ${item.grade || ""} ${item.classNumber || ""} ${item.number || ""}`.toLowerCase();
    if (query && !haystack.includes(query)) return false;
    if (filters.status !== "ALL" && item.status !== filters.status) return false;
    if (filters.role !== "ALL" && !accountRoles(item).includes(filters.role)) return false;
    if (filters.attention && !isAttention(item)) return false;
    if (filters.privileged && !accountRoles(item).some((role) => role !== "STUDENT")) return false;
    return true;
  });
}

function stats() {
  const total = accounts.length;
  const active = accounts.filter((item) => item.status === "ACTIVE").length;
  const firstLogin = accounts.filter((item) => item.mustChangePin === true && item.status === "ACTIVE").length;
  const disabled = accounts.filter((item) => item.status !== "ACTIVE").length;
  const privileged = accounts.filter((item) => accountRoles(item).some((role) => role !== "STUDENT")).length;
  return { total, active, firstLogin, disabled, privileged, attention: firstLogin + disabled };
}

async function loadAccounts(force = false) {
  if (loading || (!force && loaded)) return;
  loading = true;
  renderSection(true);
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

function roleFilterOptions() {
  return `<md-select-option value="ALL"><div slot="headline">모든 역할</div></md-select-option>${ROLE_OPTIONS.slice(1).map(([role, label]) => `<md-select-option value="${role}"><div slot="headline">${label}</div></md-select-option>`).join("")}`;
}

function statsMarkup() {
  const value = stats();
  return `<div class="pincon-account-metrics" aria-label="계정 현황">
    <button type="button" data-account-metric="all"><span>전체 계정</span><strong>${value.total}</strong><small>등록됨</small></button>
    <button type="button" data-account-metric="active"><span>활성</span><strong>${value.active}</strong><small>로그인 가능</small></button>
    <button type="button" data-account-metric="attention" data-attention="${value.attention > 0}"><span>확인 필요</span><strong>${value.attention}</strong><small>첫 로그인·비활성</small></button>
    <button type="button" data-account-metric="privileged"><span>운영 권한</span><strong>${value.privileged}</strong><small>추가 역할 보유</small></button>
  </div>`;
}

function accountBadges(account) {
  const badges = [];
  if (account.status !== "ACTIVE") badges.push(`<span class="pincon-account-badge is-disabled"><md-icon>block</md-icon>비활성</span>`);
  else badges.push(`<span class="pincon-account-badge is-active"><md-icon>check_circle</md-icon>활성</span>`);
  if (account.mustChangePin) badges.push(`<span class="pincon-account-badge is-pending"><md-icon>key</md-icon>첫 로그인 대기</span>`);
  return badges.join("");
}

function accountRows(rows) {
  return rows.map((account) => {
    const roles = accountRoles(account).filter((role) => role !== "STUDENT");
    return `<button class="pincon-account-row" type="button" data-open-account="${escapeHtml(account.uid)}" data-disabled="${account.status !== "ACTIVE"}">
      <span class="pincon-account-row__avatar">${escapeHtml(String(account.name || "?").slice(0, 1))}</span>
      <span class="pincon-account-row__main"><strong>${escapeHtml(account.name || "이름 없음")}</strong><small>${escapeHtml(account.studentNumber || "학번 없음")} · ${escapeHtml(classLabel(account))}</small></span>
      <span class="pincon-account-row__roles">${roles.length ? roles.slice(0, 2).map((role) => `<em>${escapeHtml(roleLabel(role))}</em>`).join("") : `<em class="is-student">학생</em>`}${roles.length > 2 ? `<em>+${roles.length - 2}</em>` : ""}</span>
      <span class="pincon-account-row__badges">${accountBadges(account)}</span>
      <md-icon>chevron_right</md-icon>
    </button>`;
  }).join("");
}

function sectionMarkup() {
  if (!allowed) return "";
  const visible = filteredAccounts();
  return `<section class="admin-card admin-card--wide pincon-account-directory" id="pinconUserManager" aria-labelledby="pincon-users-title">
    <header class="pincon-account-directory__hero">
      <div><span class="pincon-account-directory__eyebrow">ACCOUNT DIRECTORY</span><h2 id="pincon-users-title">계정</h2><p>학생 신원, 로그인 상태, 역할을 한곳에서 관리합니다. PIN 원문은 생성 직후 외에는 표시하지 않습니다.</p></div>
      <div class="pincon-account-directory__hero-actions">
        <md-outlined-button id="pinconExportUsers"><md-icon slot="icon">download</md-icon>CSV</md-outlined-button>
        <md-outlined-button id="pinconDeleteNonAdmins"><md-icon slot="icon">delete_sweep</md-icon>학생 계정 초기화</md-outlined-button>
        <md-filled-tonal-button id="pinconBulkUsers"><md-icon slot="icon">group_add</md-icon>일괄 등록</md-filled-tonal-button>
        <md-filled-button id="pinconAddUser"><md-icon slot="icon">person_add</md-icon>새 계정</md-filled-button>
      </div>
    </header>
    ${statsMarkup()}
    <div class="pincon-account-directory__controls">
      <md-outlined-text-field id="pinconUserSearch" label="계정 검색" placeholder="이름, 학번, 반, 번호" type="search" value="${escapeHtml(filters.query)}"><md-icon slot="leading-icon">search</md-icon></md-outlined-text-field>
      <md-outlined-select id="pinconUserStatusFilter" label="상태" value="${escapeHtml(filters.status)}">
        <md-select-option value="ALL"><div slot="headline">모든 상태</div></md-select-option>
        <md-select-option value="ACTIVE"><div slot="headline">활성</div></md-select-option>
        <md-select-option value="DISABLED"><div slot="headline">비활성</div></md-select-option>
      </md-outlined-select>
      <md-outlined-select id="pinconUserRoleFilter" label="역할" value="${escapeHtml(filters.role)}">${roleFilterOptions()}</md-outlined-select>
      <md-filter-chip id="pinconAttentionFilter" ${filters.attention ? "selected" : ""} label="확인 필요"></md-filter-chip>
    </div>
    <div class="pincon-account-directory__meta"><span>${visible.length}명 표시</span><span>${loading ? "계정 동기화 중…" : loaded ? "최신 목록" : "불러오는 중"}</span></div>
    <div id="pinconUserList" class="pincon-account-directory__list">
      ${loading && !loaded ? `<md-linear-progress indeterminate></md-linear-progress>` : visible.length ? accountRows(visible) : `<div class="admin-empty"><md-icon>person_search</md-icon><strong>조건에 맞는 계정이 없습니다</strong><span>검색어나 필터를 바꾸거나 새 계정을 만드세요.</span></div>`}
    </div>
  </section>`;
}

function bindRows(section) {
  section.querySelectorAll("[data-open-account]").forEach((button) => button.addEventListener("click", () => openAccountDialog(accounts.find((item) => item.uid === button.dataset.openAccount))));
}

function rerenderList(section) {
  const rows = filteredAccounts();
  const list = section.querySelector("#pinconUserList");
  if (list) list.innerHTML = rows.length ? accountRows(rows) : `<div class="admin-empty"><md-icon>person_search</md-icon><strong>조건에 맞는 계정이 없습니다</strong></div>`;
  const count = section.querySelector(".pincon-account-directory__meta span:first-child");
  if (count) count.textContent = `${rows.length}명 표시`;
  bindRows(section);
}

function bindSection() {
  const section = root.querySelector("#pinconUserManager");
  if (!section) return;
  section.querySelector("#pinconAddUser")?.addEventListener("click", () => openAccountDialog(null));
  section.querySelector("#pinconBulkUsers")?.addEventListener("click", openBulkDialog);
  section.querySelector("#pinconExportUsers")?.addEventListener("click", exportUsers);
  section.querySelector("#pinconDeleteNonAdmins")?.addEventListener("click", openDeleteAccountsDialog);
  section.querySelector("#pinconUserSearch")?.addEventListener("input", (event) => { filters.query = String(event.target.value || ""); rerenderList(section); });
  section.querySelector("#pinconUserStatusFilter")?.addEventListener("change", (event) => { filters.status = event.target.value || "ALL"; rerenderList(section); });
  section.querySelector("#pinconUserRoleFilter")?.addEventListener("change", (event) => { filters.role = event.target.value || "ALL"; filters.privileged = false; rerenderList(section); });
  section.querySelector("#pinconAttentionFilter")?.addEventListener("click", (event) => { filters.attention = !filters.attention; filters.privileged = false; event.currentTarget.selected = filters.attention; rerenderList(section); });
  section.querySelectorAll("[data-account-metric]").forEach((button) => button.addEventListener("click", () => {
    const metric = button.dataset.accountMetric;
    filters.status = "ALL";
    filters.role = "ALL";
    filters.attention = false;
    filters.privileged = false;
    if (metric === "active") filters.status = "ACTIVE";
    else if (metric === "attention") filters.attention = true;
    else if (metric === "privileged") filters.privileged = true;
    renderSection(true);
  }));
  bindRows(section);
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

function roleChecks(account) {
  const current = new Set(accountRoles(account || {}));
  return ROLE_OPTIONS.slice(1).map(([role, label, support]) => `<label class="pincon-account-role-card" data-role="${role}" data-selected="${current.has(role)}"><md-checkbox data-role-check="${role}" ${current.has(role) ? "checked" : ""}></md-checkbox><span><strong>${label}</strong><small>${support}</small></span></label>`).join("");
}

function formAccount(dialog, existing) {
  const checked = [...dialog.querySelectorAll("[data-role-check]")].filter((item) => item.checked).map((item) => item.dataset.roleCheck);
  const subjects = String(dialog.querySelector("#accountSubjects")?.value || "").split(/[,，]/).map((item) => item.trim()).filter(Boolean);
  return {
    studentNumber: String(dialog.querySelector("#accountStudentNumber")?.value || "").trim(),
    name: String(dialog.querySelector("#accountName")?.value || "").trim(),
    grade: Number(dialog.querySelector("#accountGrade")?.value || 0),
    classNumber: Number(dialog.querySelector("#accountClass")?.value || 0),
    number: Number(dialog.querySelector("#accountNumber")?.value || 0),
    departmentId: String(dialog.querySelector("#accountDepartment")?.value || "").trim(),
    onePersonRoleId: String(dialog.querySelector("#accountOneRole")?.value || "").trim(),
    roles: ["STUDENT", ...checked],
    subjectRoles: subjects.map((subject) => ({ subject, role: "SUBJECT_MANAGER" })),
    status: existing?.status || "ACTIVE",
  };
}

function validateAccount(value) {
  if (!/^\d{5}$/.test(value.studentNumber)) return "학번은 5자리 숫자여야 합니다.";
  if (!value.name) return "이름을 입력해주세요.";
  if (!Number.isInteger(value.grade) || value.grade < 1 || value.grade > 3) return "학년을 확인해주세요.";
  if (!Number.isInteger(value.classNumber) || value.classNumber < 1 || value.classNumber > 10) return "반을 확인해주세요.";
  if (!Number.isInteger(value.number) || value.number < 1 || value.number > 60) return "번호를 확인해주세요.";
  return "";
}

function tempPinMarkup(pin, name = "학생") {
  return `<div class="pincon-account-temp" role="status"><div><span>임시 PIN</span><strong>${escapeHtml(name)}</strong></div><code>${escapeHtml(pin)}</code><p>이 PIN은 지금 한 번만 확인할 수 있습니다. 학생은 첫 로그인 후 새 PIN으로 바꿉니다.</p></div>`;
}

function updateAccountInMemory(next) {
  if (!next?.uid) return;
  const index = accounts.findIndex((item) => item.uid === next.uid);
  if (index >= 0) accounts[index] = next;
  else accounts.push(next);
}

function openAccountDialog(account) {
  const existing = account || null;
  document.querySelector("#pinconAccountEditor")?.remove();
  const dialog = document.createElement("md-dialog");
  dialog.id = "pinconAccountEditor";
  dialog.className = "pincon-account-editor";
  dialog.innerHTML = `<div slot="headline" class="pincon-account-editor__headline"><span>${existing ? "ACCOUNT" : "NEW ACCOUNT"}</span><strong>${escapeHtml(existing?.name || "새 계정")}</strong></div>
    <div slot="content" class="pincon-account-editor__body">
      ${existing ? `<section class="pincon-account-editor__summary"><span class="pincon-account-row__avatar">${escapeHtml(String(existing.name || "?").slice(0, 1))}</span><div><strong>${escapeHtml(existing.name)}</strong><span>${escapeHtml(existing.studentNumber)} · ${escapeHtml(classLabel(existing))}</span></div><div>${accountBadges(existing)}</div></section>` : ""}
      <section class="pincon-account-editor__section"><div class="pincon-account-editor__section-head"><span>01</span><div><strong>신원과 소속</strong><small>로그인 식별자와 학급 정보</small></div></div>
        <div class="pincon-account-editor__fields">
          <md-outlined-text-field id="accountStudentNumber" label="학번" inputmode="numeric" maxlength="5" value="${escapeHtml(existing?.studentNumber || "")}" required></md-outlined-text-field>
          <md-outlined-text-field id="accountName" label="이름" maxlength="30" value="${escapeHtml(existing?.name || "")}" required></md-outlined-text-field>
          <md-outlined-text-field id="accountGrade" label="학년" type="number" min="1" max="3" value="${escapeHtml(existing?.grade || "1")}" required></md-outlined-text-field>
          <md-outlined-text-field id="accountClass" label="반" type="number" min="1" max="10" value="${escapeHtml(existing?.classNumber || "8")}" required></md-outlined-text-field>
          <md-outlined-text-field id="accountNumber" label="번호" type="number" min="1" max="60" value="${escapeHtml(existing?.number || "")}" required></md-outlined-text-field>
          <md-outlined-text-field id="accountDepartment" label="부서 ID" value="${escapeHtml(existing?.departmentId || "")}" supporting-text="부장 역할이 있을 때 사용"></md-outlined-text-field>
          <md-outlined-text-field id="accountOneRole" class="is-wide" label="1인1역 ID" value="${escapeHtml(existing?.onePersonRoleId || "")}"></md-outlined-text-field>
        </div>
      </section>
      <section class="pincon-account-editor__section"><div class="pincon-account-editor__section-head"><span>02</span><div><strong>권한</strong><small>학생 역할은 모든 계정에 기본 포함</small></div></div>
        <div class="pincon-account-editor__roles">${roleChecks(existing)}</div>
        <md-outlined-text-field id="accountSubjects" label="담당 과목" value="${escapeHtml((existing?.subjectRoles || []).map((item) => item.subject).join(", "))}" supporting-text="과목 관리자인 경우 쉼표로 구분"></md-outlined-text-field>
      </section>
      ${existing ? `<section class="pincon-account-editor__section pincon-account-editor__security"><div class="pincon-account-editor__section-head"><span>03</span><div><strong>로그인과 보안</strong><small>PIN 재발급·계정 상태</small></div></div><div class="pincon-account-editor__security-actions"><md-filled-tonal-button id="accountResetPin"><md-icon slot="icon">password</md-icon>임시 PIN 재발급</md-filled-tonal-button>${existing.status === "ACTIVE" ? `<md-outlined-button id="accountToggleStatus"><md-icon slot="icon">person_off</md-icon>계정 비활성화</md-outlined-button>` : `<md-filled-button id="accountToggleStatus"><md-icon slot="icon">person_check</md-icon>계정 다시 활성화</md-filled-button>`}</div></section>` : ""}
      <div id="accountEditorResult"></div>
      <div id="accountEditorStatus" class="pincon-account-editor__status" role="status" aria-live="polite"></div>
    </div>
    <div slot="actions"><md-text-button id="accountEditorClose">닫기</md-text-button><md-filled-button id="accountEditorSave"><md-icon slot="icon">save</md-icon>${existing ? "변경 저장" : "계정 만들기"}</md-filled-button></div>`;
  document.body.appendChild(dialog);

  const status = dialog.querySelector("#accountEditorStatus");
  const result = dialog.querySelector("#accountEditorResult");
  const saveButton = dialog.querySelector("#accountEditorSave");
  const setBusy = (busy) => dialog.querySelectorAll("md-filled-button, md-filled-tonal-button, md-outlined-button, md-outlined-text-field, md-checkbox").forEach((element) => { element.disabled = busy; });
  const setStatus = (message, error = false) => { status.textContent = message; status.dataset.error = error ? "true" : "false"; };

  dialog.querySelectorAll("[data-role-check]").forEach((checkbox) => checkbox.addEventListener("change", () => { checkbox.closest(".pincon-account-role-card").dataset.selected = checkbox.checked ? "true" : "false"; }));
  saveButton?.addEventListener("click", async () => {
    if (dialog.dataset.createdUid) return;
    const value = formAccount(dialog, existing);
    const validation = validateAccount(value);
    if (validation) { setStatus(validation, true); return; }
    setBusy(true);
    setStatus(existing ? "변경사항을 저장하는 중…" : "계정을 만드는 중…");
    try {
      const response = existing
        ? await accountRequest("/api/accounts/manage", { method: "POST", body: { action: "UPDATE", uid: existing.uid, patch: value } })
        : await accountRequest("/api/accounts/manage", { method: "POST", body: { action: "CREATE", account: value } });
      updateAccountInMemory(response.account);
      if (response.temporaryPin) {
        result.innerHTML = tempPinMarkup(response.temporaryPin, response.account?.name);
        dialog.dataset.createdUid = response.account?.uid || "created";
      }
      setStatus(existing ? "계정 정보를 저장했습니다." : "계정을 만들었습니다.");
      renderSection(true);
    } catch (error) {
      const message = error?.message === "student-number-exists" ? "이미 사용 중인 학번입니다." : "계정을 저장하지 못했습니다. 입력값과 권한을 확인해주세요.";
      setStatus(message, true);
    } finally {
      setBusy(false);
      if (dialog.dataset.createdUid && saveButton) saveButton.disabled = true;
    }
  });

  dialog.querySelector("#accountResetPin")?.addEventListener("click", async () => {
    setBusy(true); setStatus("임시 PIN을 만드는 중…");
    try {
      const response = await accountRequest("/api/accounts/manage", { method: "POST", body: { action: "RESET_PIN", uid: existing.uid } });
      updateAccountInMemory(response.account);
      result.innerHTML = tempPinMarkup(response.temporaryPin, response.account?.name);
      setStatus("임시 PIN을 발급했습니다. 이 화면을 닫기 전에 전달하세요.");
      renderSection(true);
    } catch { setStatus("PIN을 재발급하지 못했습니다.", true); }
    finally { setBusy(false); }
  });

  dialog.querySelector("#accountToggleStatus")?.addEventListener("click", async () => {
    setBusy(true);
    const disabling = existing.status === "ACTIVE";
    setStatus(disabling ? "계정을 비활성화하는 중…" : "계정을 활성화하는 중…");
    try {
      const response = disabling
        ? await accountRequest("/api/accounts/manage", { method: "POST", body: { action: "DISABLE", uid: existing.uid } })
        : await accountRequest("/api/accounts/manage", { method: "POST", body: { action: "UPDATE", uid: existing.uid, patch: { status: "ACTIVE" } } });
      updateAccountInMemory(response.account);
      setStatus(disabling ? "계정을 비활성화했습니다." : "계정을 다시 활성화했습니다.");
      renderSection(true);
      setTimeout(() => { dialog.close?.(); }, 350);
    } catch { setStatus("계정 상태를 바꾸지 못했습니다.", true); setBusy(false); }
  });

  dialog.querySelector("#accountEditorClose")?.addEventListener("click", () => dialog.close?.());
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.show?.();
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
  downloadCsv(`pincon-accounts-${new Date().toISOString().slice(0, 10)}.csv`, [
    ["학번", "이름", "학년", "반", "번호", "상태", "첫 로그인 대기", "역할", "부서", "과목 관리자", "1인1역"],
    ...accounts.map((item) => [item.studentNumber, item.name, item.grade, item.classNumber, item.number, item.status, item.mustChangePin ? "Y" : "N", accountRoles(item).join("|"), item.departmentId || "", (item.subjectRoles || []).map((role) => role.subject).join("|"), item.onePersonRoleId || ""]),
  ]);
}

function deletableAccounts() {
  const preservedRoles = new Set(["ADMIN", "TEACHER", "CLASS_PRESIDENT"]);
  return accounts.filter((item) => !accountRoles(item).some((role) => preservedRoles.has(role)));
}

function openDeleteAccountsDialog() {
  document.querySelector("#pinconDeleteAccountsDialog")?.remove();
  const targets = deletableAccounts();
  const dialog = document.createElement("md-dialog");
  dialog.id = "pinconDeleteAccountsDialog";
  dialog.innerHTML = `<div slot="headline">학생 계정을 초기화할까요?</div>
    <div slot="content" class="pincon-account-editor__body">
      <p><strong>${targets.length}개 학생 계정</strong>을 서버 백업과 재등록 대기 명단으로 옮긴 뒤 삭제합니다. 관리자·교사·학급회장 계정과 공지·일정 등 학급 콘텐츠는 유지됩니다.</p>
      <p>삭제된 학생은 첫 로그인에서 임시 PIN 없이 학번과 이름을 확인하고 새 PIN을 직접 정합니다.</p>
      <md-outlined-text-field id="pinconDeleteConfirmation" label="확인을 위해 ‘학생 계정 삭제’ 입력" autocomplete="off"></md-outlined-text-field>
      <div id="pinconDeleteAccountStatus" class="pincon-account-editor__status" role="status" aria-live="polite"></div>
    </div>
    <div slot="actions"><md-text-button id="pinconDeleteCancel">취소</md-text-button><md-filled-button id="pinconDeleteConfirm" disabled><md-icon slot="icon">delete_sweep</md-icon>백업 후 삭제</md-filled-button></div>`;
  document.body.appendChild(dialog);
  const input = dialog.querySelector("#pinconDeleteConfirmation");
  const confirm = dialog.querySelector("#pinconDeleteConfirm");
  const status = dialog.querySelector("#pinconDeleteAccountStatus");
  input?.addEventListener("input", () => { confirm.disabled = String(input.value || "").trim() !== "학생 계정 삭제"; });
  confirm?.addEventListener("click", async () => {
    if (String(input?.value || "").trim() !== "학생 계정 삭제") return;
    confirm.disabled = true;
    input.disabled = true;
    status.textContent = "계정 목록을 백업한 뒤 삭제하는 중…";
    if (targets.length) {
      downloadCsv(`pincon-account-backup-${new Date().toISOString().slice(0, 10)}.csv`, [
        ["학번", "이름", "학년", "반", "번호", "상태", "역할", "부서", "과목 관리자", "1인1역"],
        ...targets.map((item) => [item.studentNumber, item.name, item.grade, item.classNumber, item.number, item.status, accountRoles(item).join("|"), item.departmentId || "", (item.subjectRoles || []).map((role) => role.subject).join("|"), item.onePersonRoleId || ""]),
      ]);
    }
    try {
      const response = await accountRequest("/api/accounts/manage", {
        method: "POST",
        networkRetries: 0,
        body: { action: "DELETE_NON_ADMINS", confirmation: "DELETE_NON_ADMIN_ACCOUNTS" },
      });
      status.textContent = `${response.deleted}개 삭제 완료 · 서버 백업 ${response.backupId}${response.failed?.length ? ` · ${response.failed.length}개 실패` : ""}`;
      await loadAccounts(true);
      setTimeout(() => dialog.close?.(), 1400);
    } catch (error) {
      status.textContent = `삭제하지 못했습니다: ${error?.message || "요청 실패"}`;
      status.dataset.error = "true";
      confirm.disabled = false;
      input.disabled = false;
    }
  });
  dialog.querySelector("#pinconDeleteCancel")?.addEventListener("click", () => dialog.close?.());
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.show?.();
}

function parseBulkRows(value) {
  const lines = String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const rows = [];
  const errors = [];
  lines.slice(0, 60).forEach((line, index) => {
    const [studentNumber, name, gradeText, classText, numberText] = line.split(/[\t,]/).map((item) => item.trim());
    const row = { studentNumber, name, grade: Number(gradeText), classNumber: Number(classText), number: Number(numberText), roles: ["STUDENT"], subjectRoles: [], departmentId: "", onePersonRoleId: "", status: "ACTIVE" };
    const validation = validateAccount(row);
    if (validation) errors.push(`${index + 1}행: ${validation}`);
    else rows.push(row);
  });
  if (lines.length > 60) errors.push("한 번에 최대 60명까지 등록할 수 있습니다.");
  if (new Set(rows.map((row) => row.studentNumber)).size !== rows.length) errors.push("입력 안에 중복 학번이 있습니다.");
  return { rows, errors };
}

function openBulkDialog() {
  document.querySelector("#pinconBulkUserDialog")?.remove();
  const dialog = document.createElement("md-dialog");
  dialog.id = "pinconBulkUserDialog";
  dialog.className = "pincon-account-bulk";
  dialog.innerHTML = `<div slot="headline">계정 일괄 등록</div><div slot="content" class="pincon-account-bulk__body"><div class="pincon-account-bulk__guide"><md-icon>table_view</md-icon><div><strong>학번, 이름, 학년, 반, 번호</strong><span>쉼표 또는 탭으로 구분하고 한 줄에 한 명씩 입력하세요.</span><code>10804,김도영,1,8,4</code></div></div><md-outlined-text-field id="pinconBulkInput" label="학생 명단" type="textarea" rows="10"></md-outlined-text-field><div id="pinconBulkPreview" class="pincon-account-bulk__preview">명단을 붙여넣으면 먼저 검사합니다.</div><div id="pinconBulkResult"></div><div id="pinconBulkStatus" class="pincon-account-editor__status" role="status"></div></div><div slot="actions"><md-text-button id="pinconBulkClose">닫기</md-text-button><md-filled-button id="pinconBulkCreate">계정 생성</md-filled-button></div>`;
  document.body.appendChild(dialog);
  const input = dialog.querySelector("#pinconBulkInput");
  const preview = dialog.querySelector("#pinconBulkPreview");
  const status = dialog.querySelector("#pinconBulkStatus");
  let created = [];
  const refreshPreview = () => {
    const parsed = parseBulkRows(input?.value);
    preview.dataset.error = parsed.errors.length ? "true" : "false";
    preview.textContent = parsed.errors.length ? parsed.errors.slice(0, 4).join(" · ") : parsed.rows.length ? `${parsed.rows.length}명 등록 준비 완료` : "명단을 붙여넣으면 먼저 검사합니다.";
  };
  input?.addEventListener("input", refreshPreview);
  dialog.querySelector("#pinconBulkCreate")?.addEventListener("click", async () => {
    const parsed = parseBulkRows(input?.value);
    if (!parsed.rows.length || parsed.errors.length) { refreshPreview(); return; }
    dialog.querySelector("#pinconBulkCreate").disabled = true;
    created = [];
    const failed = [];
    for (let index = 0; index < parsed.rows.length; index += 1) {
      status.textContent = `${index + 1}/${parsed.rows.length} 계정 생성 중…`;
      try {
        const response = await accountRequest("/api/accounts/manage", { method: "POST", body: { action: "CREATE", account: parsed.rows[index] } });
        updateAccountInMemory(response.account);
        created.push({ ...response.account, temporaryPin: response.temporaryPin });
      } catch (error) { failed.push(`${parsed.rows[index].studentNumber} ${parsed.rows[index].name}: ${error?.message || "실패"}`); }
    }
    const box = dialog.querySelector("#pinconBulkResult");
    box.innerHTML = `<div class="pincon-account-bulk__result"><md-icon>check_circle</md-icon><div><strong>${created.length}명 생성 완료</strong><span>${failed.length ? `${failed.length}명 실패` : "모든 계정을 만들었습니다."}</span></div>${created.length ? `<md-filled-tonal-button id="pinconBulkDownload">임시 PIN CSV 저장</md-filled-tonal-button>` : ""}</div>${failed.length ? `<div class="pincon-account-bulk__errors">${failed.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}`;
    box.querySelector("#pinconBulkDownload")?.addEventListener("click", () => downloadCsv(`pincon-temporary-pins-${new Date().toISOString().slice(0, 10)}.csv`, [["학번", "이름", "임시 PIN"], ...created.map((item) => [item.studentNumber, item.name, item.temporaryPin])]));
    status.textContent = created.length ? "임시 PIN은 이 화면을 닫기 전에 저장하세요." : "생성된 계정이 없습니다.";
    renderSection(true);
    dialog.querySelector("#pinconBulkCreate").disabled = false;
  });
  dialog.querySelector("#pinconBulkClose")?.addEventListener("click", () => dialog.close?.());
  dialog.addEventListener("close", () => { created = []; dialog.remove(); }, { once: true });
  dialog.show?.();
}

function mount() {
  renderSection();
  if (!loaded && !loading) loadAccounts();
}

mount();
new MutationObserver(() => {
  if (!root.querySelector("#pinconUserManager") && root.querySelector("#adminMain .admin-grid")) mount();
}).observe(root, { childList: true });
