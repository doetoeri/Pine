import { accountRequest } from "../core/student-auth.js?v=20260903-identity2";
import { readClassProfile } from "../core/data-gateway.js";

const PRIVILEGED = new Set(["ADMIN", "TEACHER", "CLASS_PRESIDENT"]);
const CONFIRM_TEXT = "일반 계정 삭제";

function rolesOf(account) {
  return Array.isArray(account?.roles) && account.roles.length ? account.roles : ["STUDENT"];
}

function currentClassKey() {
  const profile = readClassProfile?.() || {};
  const direct = String(profile.classKey || "").trim();
  if (/^[1-3]-(?:[1-9]|10)$/.test(direct)) return direct;
  const grade = Number(profile.grade);
  const classNumber = Number(profile.classNumber);
  if (Number.isInteger(grade) && grade >= 1 && grade <= 3 && Number.isInteger(classNumber) && classNumber >= 1 && classNumber <= 10) {
    return `${grade}-${classNumber}`;
  }
  return "";
}

function deletable(accounts, classKey) {
  return (Array.isArray(accounts) ? accounts : []).filter((account) =>
    account?.uid
    && account?.studentNumber
    && account?.classKey === classKey
    && !rolesOf(account).some((role) => PRIVILEGED.has(role))
  );
}

function setBusy(dialog, busy) {
  dialog?.querySelectorAll("md-filled-button, md-outlined-button, md-text-button, md-outlined-text-field")
    .forEach((el) => { el.disabled = busy; });
}

async function openDeleteDialog() {
  document.querySelector("#pinconGeneralAccountDeleteDialog")?.remove();

  const classKey = currentClassKey();
  if (!classKey) {
    alert("현재 학급을 확인하지 못했습니다. 학급을 선택한 뒤 다시 시도해주세요.");
    return;
  }

  let accounts = [];
  try {
    const response = await accountRequest("/api/accounts/manage", { networkRetries: 0 });
    accounts = Array.isArray(response?.accounts) ? response.accounts : [];
  } catch (error) {
    alert(`계정 목록을 불러오지 못했습니다: ${error?.message || "요청 실패"}`);
    return;
  }

  const targets = deletable(accounts, classKey);
  const [grade, classNumber] = classKey.split("-");
  const dialog = document.createElement("md-dialog");
  dialog.id = "pinconGeneralAccountDeleteDialog";
  dialog.setAttribute("aria-label", "일반 계정 삭제");
  dialog.innerHTML = `<div slot="headline">${grade}학년 ${classNumber}반 일반 계정을 정리할까요?</div>
    <div slot="content" class="pincon-account-editor__body">
      <p><strong>${targets.length}개 일반 학생 계정</strong>이 현재 삭제 대상입니다.</p>
      <p>Firebase 로그인 계정과 PinCon 계정 프로필을 삭제하고, 새 계정 개통 명단에 남은 <strong>uid·기존 가입 완료 상태도 함께 초기화</strong>합니다.</p>
      <p>${targets.length ? "삭제 전에 서버 백업을 만듭니다." : "현재 계정 목록에는 삭제 대상이 없지만, 이전 삭제에서 남은 ‘이미 가입됨’ 상태가 있으면 정리합니다."} 관리자·교사·학급회장·현재 운영 계정과 공지·일정 등 학급 콘텐츠는 유지됩니다.</p>
      <md-outlined-text-field id="pinconGeneralDeleteConfirmText" label="확인을 위해 ‘${CONFIRM_TEXT}’ 입력" autocomplete="off"></md-outlined-text-field>
      <div id="pinconGeneralDeleteStatus" class="pincon-account-editor__status" role="status" aria-live="polite"></div>
    </div>
    <div slot="actions">
      <md-text-button id="pinconGeneralDeleteCancel">취소</md-text-button>
      <md-filled-button id="pinconGeneralDeleteConfirm" disabled><md-icon slot="icon">delete_forever</md-icon>${targets.length ? "백업 후 삭제·정리" : "잔여 상태 정리"}</md-filled-button>
    </div>`;
  document.body.appendChild(dialog);

  const input = dialog.querySelector("#pinconGeneralDeleteConfirmText");
  const confirmButton = dialog.querySelector("#pinconGeneralDeleteConfirm");
  const status = dialog.querySelector("#pinconGeneralDeleteStatus");

  input?.addEventListener("input", () => {
    confirmButton.disabled = String(input.value || "").trim() !== CONFIRM_TEXT;
  });

  dialog.querySelector("#pinconGeneralDeleteCancel")?.addEventListener("click", () => dialog.close?.());
  confirmButton?.addEventListener("click", async () => {
    if (String(input?.value || "").trim() !== CONFIRM_TEXT) return;
    setBusy(dialog, true);
    status.dataset.error = "false";
    status.textContent = targets.length
      ? `${targets.length}개 계정을 백업·삭제하고 개통 상태를 정리하는 중…`
      : "이전 삭제에서 남은 개통 상태를 정리하는 중…";
    try {
      const response = await accountRequest("/api/general-account-delete", {
        method: "POST",
        networkRetries: 0,
        body: {
          confirmation: "DELETE_GENERAL_ACCOUNTS",
          classKey,
          studentNumbers: targets.map((account) => account.studentNumber),
        },
      });
      const failedCount = Array.isArray(response?.failed) ? response.failed.length : 0;
      status.textContent = `${Number(response?.deleted || 0)}개 계정 삭제 · ${Number(response?.repaired || 0)}개 잔여 개통 상태 정리 · ${Number(response?.relinked || 0)}개 정상 계정 연결 유지 · 보호 ${Number(response?.preserved || 0)}개 · 실패 ${failedCount}개`;
      setTimeout(() => location.reload(), 1500);
    } catch (error) {
      status.dataset.error = "true";
      status.textContent = `삭제/정리를 완료하지 못했습니다: ${error?.message || "요청 실패"}`;
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
