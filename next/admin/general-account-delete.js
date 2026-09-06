import { accountRequest } from "../core/student-auth.js?v=20260903-identity2";

const PRIVILEGED = new Set(["ADMIN", "TEACHER", "CLASS_PRESIDENT"]);
const CONFIRM_TEXT = "일반 계정 삭제";

function rolesOf(account) {
  return Array.isArray(account?.roles) && account.roles.length ? account.roles : ["STUDENT"];
}

function deletable(accounts) {
  return (Array.isArray(accounts) ? accounts : []).filter((account) =>
    account?.uid && account?.studentNumber && !rolesOf(account).some((role) => PRIVILEGED.has(role))
  );
}

function setBusy(dialog, busy) {
  dialog?.querySelectorAll("md-filled-button, md-outlined-button, md-text-button, md-outlined-text-field")
    .forEach((el) => { el.disabled = busy; });
}

async function openDeleteDialog() {
  document.querySelector("#pinconGeneralAccountDeleteDialog")?.remove();

  let accounts = [];
  try {
    const response = await accountRequest("/api/accounts/manage", { networkRetries: 0 });
    accounts = Array.isArray(response?.accounts) ? response.accounts : [];
  } catch (error) {
    alert(`계정 목록을 불러오지 못했습니다: ${error?.message || "요청 실패"}`);
    return;
  }

  const targets = deletable(accounts);
  const dialog = document.createElement("md-dialog");
  dialog.id = "pinconGeneralAccountDeleteDialog";
  dialog.setAttribute("aria-label", "일반 계정 삭제");
  dialog.innerHTML = `<div slot="headline">일반 학생 계정을 삭제할까요?</div>
    <div slot="content" class="pincon-account-editor__body">
      <p><strong>${targets.length}개 일반 학생 계정</strong>이 삭제 대상입니다.</p>
      <p>Firebase 로그인 계정과 PinCon 계정 프로필을 삭제합니다. 삭제 전에 서버 백업을 만들며, <strong>관리자·교사·학급회장 계정과 현재 로그인한 운영 계정은 유지</strong>됩니다.</p>
      <p>공지·일정·학급 콘텐츠는 삭제하지 않습니다. 삭제된 학생은 이후 계정 개통 명단을 통해 다시 가입할 수 있습니다.</p>
      <md-outlined-text-field id="pinconGeneralDeleteConfirmText" label="확인을 위해 ‘${CONFIRM_TEXT}’ 입력" autocomplete="off"></md-outlined-text-field>
      <div id="pinconGeneralDeleteStatus" class="pincon-account-editor__status" role="status" aria-live="polite"></div>
    </div>
    <div slot="actions">
      <md-text-button id="pinconGeneralDeleteCancel">취소</md-text-button>
      <md-filled-button id="pinconGeneralDeleteConfirm" disabled><md-icon slot="icon">delete_forever</md-icon>백업 후 삭제</md-filled-button>
    </div>`;
  document.body.appendChild(dialog);

  const input = dialog.querySelector("#pinconGeneralDeleteConfirmText");
  const confirmButton = dialog.querySelector("#pinconGeneralDeleteConfirm");
  const status = dialog.querySelector("#pinconGeneralDeleteStatus");

  input?.addEventListener("input", () => {
    confirmButton.disabled = !targets.length || String(input.value || "").trim() !== CONFIRM_TEXT;
  });

  dialog.querySelector("#pinconGeneralDeleteCancel")?.addEventListener("click", () => dialog.close?.());
  confirmButton?.addEventListener("click", async () => {
    if (!targets.length || String(input?.value || "").trim() !== CONFIRM_TEXT) return;
    setBusy(dialog, true);
    status.dataset.error = "false";
    status.textContent = `${targets.length}개 계정을 백업한 뒤 삭제하는 중…`;
    try {
      const response = await accountRequest("/api/accounts/manage", {
        method: "POST",
        networkRetries: 0,
        body: { action: "DELETE_NON_ADMINS", confirmation: "DELETE_NON_ADMIN_ACCOUNTS" },
      });
      const failedCount = Array.isArray(response?.failed) ? response.failed.length : Number(response?.failedCount || 0);
      const preservedCount = Array.isArray(response?.preserved) ? response.preserved.length : Number(response?.preservedCount || 0);
      status.textContent = `${Number(response?.deleted || 0)}개 삭제 완료 · 보호 ${preservedCount}개 · 실패 ${failedCount}개 · 백업 ${response?.backupId || "완료"}`;
      setTimeout(() => location.reload(), 1200);
    } catch (error) {
      status.dataset.error = "true";
      status.textContent = `삭제하지 못했습니다: ${error?.message || "요청 실패"}`;
      setBusy(dialog, false);
    }
  });

  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.show?.();
}

function installButton() {
  const actions = document.querySelector("#pinconUserManager .pincon-account-directory__hero-actions");
  if (!actions || actions.querySelector("#pinconDeleteGeneralAccounts")) return;
  const button = document.createElement("md-outlined-button");
  button.id = "pinconDeleteGeneralAccounts";
  button.innerHTML = `<md-icon slot="icon">delete_forever</md-icon>일반 계정 삭제`;
  button.addEventListener("click", openDeleteDialog);
  const resetButton = actions.querySelector("#pinconDeleteNonAdmins");
  if (resetButton?.nextSibling) actions.insertBefore(button, resetButton.nextSibling);
  else actions.appendChild(button);
}

const observer = new MutationObserver(() => requestAnimationFrame(installButton));
observer.observe(document.body, { childList: true, subtree: true });
installButton();
