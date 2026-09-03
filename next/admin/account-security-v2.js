import { accountRequest } from "../core/student-auth.js?v=20260903-identity2";

let reloadAfterDialog = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function activationMarkup(code, name = "학생") {
  return `<div class="pincon-account-temp" role="status">
    <div><span>1회용 활성화 코드</span><strong>${escapeHtml(name)}</strong></div>
    <code>${escapeHtml(code)}</code>
    <p>학생은 첫 로그인 화면에서 학번과 이 코드를 입력한 뒤 새 PIN을 직접 만듭니다. 코드는 사용 즉시 폐기됩니다.</p>
    <md-filled-tonal-button data-copy-activation="${escapeHtml(code)}"><md-icon slot="icon">content_copy</md-icon>코드 복사</md-filled-tonal-button>
  </div>`;
}

function setDialogBusy(dialog, busy) {
  dialog?.querySelectorAll("md-filled-button, md-filled-tonal-button, md-outlined-button, md-outlined-text-field, md-checkbox")
    .forEach((element) => { element.disabled = busy; });
}

function rewriteLegacyLabels(root = document) {
  root.querySelectorAll?.("#accountResetPin").forEach((button) => {
    if (button.dataset.identityV2 === "true") return;
    button.dataset.identityV2 = "true";
    button.innerHTML = `<md-icon slot="icon">key</md-icon>활성화 코드 재발급`;
    const section = button.closest(".pincon-account-editor__section");
    const support = section?.querySelector(".pincon-account-editor__section-head small");
    if (support) support.textContent = "활성화 코드 재발급·계정 상태";
  });

  root.querySelectorAll?.("#pinconDeleteNonAdmins").forEach((button) => {
    if (button.dataset.identityV2 === "true") return;
    button.dataset.identityV2 = "true";
    button.innerHTML = `<md-icon slot="icon">restart_alt</md-icon>학생 로그인 초기화`;
  });
}

async function resetOne(trigger) {
  const dialog = trigger.closest("md-dialog");
  const result = dialog?.querySelector("#accountEditorResult");
  const status = dialog?.querySelector("#accountEditorStatus");
  const studentNumber = String(dialog?.querySelector("#accountStudentNumber")?.value || "").trim();
  if (!dialog || !result || !status || !/^\d{5}$/.test(studentNumber)) return;

  setDialogBusy(dialog, true);
  status.dataset.error = "false";
  status.textContent = "기존 로그인 세션을 종료하고 새 활성화 코드를 만드는 중…";
  try {
    const response = await accountRequest("/api/accounts/reset", {
      method: "POST",
      networkRetries: 0,
      body: { mode: "single", studentNumber },
    });
    result.innerHTML = activationMarkup(response.activationCode, response.account?.name);
    status.textContent = "기존 PIN과 로그인 세션을 무효화했습니다. 이 화면을 닫기 전에 활성화 코드를 전달하세요.";
    reloadAfterDialog = true;
    dialog.addEventListener("close", () => {
      if (!reloadAfterDialog) return;
      reloadAfterDialog = false;
      location.reload();
    }, { once: true });
  } catch (error) {
    status.dataset.error = "true";
    status.textContent = error?.message === "cannot-reset-self"
      ? "현재 로그인한 관리자 계정은 여기서 초기화할 수 없습니다."
      : "로그인을 초기화하지 못했습니다. 다시 시도해주세요.";
  } finally {
    setDialogBusy(dialog, false);
  }
}

function downloadCsv(rows) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `pincon-reactivation-codes-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function openBulkResetDialog() {
  document.querySelector("#pinconIdentityResetDialog")?.remove();
  const dialog = document.createElement("md-dialog");
  dialog.id = "pinconIdentityResetDialog";
  dialog.setAttribute("aria-label", "학생 로그인 초기화");
  dialog.innerHTML = `<div slot="headline">학생 로그인을 초기화할까요?</div>
    <div slot="content" class="pincon-account-editor__body">
      <p>관리자·교사·학급회장 계정은 유지하고 나머지 학생 계정의 <strong>기존 PIN과 로그인 세션만 무효화</strong>합니다. 공지·일정·역할 등 학급 데이터와 학생 프로필은 삭제하지 않습니다.</p>
      <p>초기화가 끝나면 학생별 1회용 활성화 코드 CSV를 저장할 수 있습니다.</p>
      <md-outlined-text-field id="pinconIdentityResetConfirmation" label="확인을 위해 ‘학생 로그인 초기화’ 입력" autocomplete="off"></md-outlined-text-field>
      <div id="pinconIdentityResetResult"></div>
      <div id="pinconIdentityResetStatus" class="pincon-account-editor__status" role="status" aria-live="polite"></div>
    </div>
    <div slot="actions"><md-text-button id="pinconIdentityResetCancel">취소</md-text-button><md-filled-button id="pinconIdentityResetConfirm" disabled><md-icon slot="icon">restart_alt</md-icon>로그인 초기화</md-filled-button></div>`;
  document.body.appendChild(dialog);

  const input = dialog.querySelector("#pinconIdentityResetConfirmation");
  const confirm = dialog.querySelector("#pinconIdentityResetConfirm");
  const status = dialog.querySelector("#pinconIdentityResetStatus");
  const result = dialog.querySelector("#pinconIdentityResetResult");
  input?.addEventListener("input", () => {
    confirm.disabled = String(input.value || "").trim() !== "학생 로그인 초기화";
  });
  confirm?.addEventListener("click", async () => {
    if (String(input?.value || "").trim() !== "학생 로그인 초기화") return;
    setDialogBusy(dialog, true);
    status.dataset.error = "false";
    status.textContent = "학생 계정과 활성화 코드를 안전하게 초기화하는 중…";
    try {
      const response = await accountRequest("/api/accounts/reset", {
        method: "POST",
        networkRetries: 0,
        body: { mode: "non-admins", confirmation: "RESET_NON_ADMIN_ACCOUNTS" },
      });
      const reset = Array.isArray(response.reset) ? response.reset : [];
      const failed = Array.isArray(response.failed) ? response.failed : [];
      result.innerHTML = `<div class="pincon-account-create__bulk-result"><div class="pincon-account-create__bulk-result-summary"><span><md-icon>${failed.length ? "rule" : "check_circle"}</md-icon></span><div><small>로그인 초기화 완료</small><strong>${reset.length}명 초기화 · ${failed.length}명 실패</strong><p>학생 데이터는 유지됐고 기존 로그인 정보만 무효화되었습니다.</p></div></div>${reset.length ? `<md-filled-tonal-button id="pinconIdentityCodesDownload"><md-icon slot="icon">download</md-icon>활성화 코드 CSV 저장</md-filled-tonal-button>` : ""}</div>`;
      result.querySelector("#pinconIdentityCodesDownload")?.addEventListener("click", () => downloadCsv([
        ["학번", "이름", "활성화 코드"],
        ...reset.map((item) => [item.account?.studentNumber, item.account?.name, item.activationCode]),
      ]));
      status.textContent = failed.length
        ? "일부 계정은 초기화하지 못했습니다. 실패한 계정은 개별적으로 다시 시도해주세요."
        : "모든 대상 계정의 기존 로그인을 무효화했습니다.";
      reloadAfterDialog = true;
    } catch (error) {
      status.dataset.error = "true";
      status.textContent = `초기화하지 못했습니다: ${error?.message || "요청 실패"}`;
      setDialogBusy(dialog, false);
    }
  });
  dialog.querySelector("#pinconIdentityResetCancel")?.addEventListener("click", () => dialog.close?.());
  dialog.addEventListener("close", () => {
    dialog.remove();
    if (reloadAfterDialog) {
      reloadAfterDialog = false;
      location.reload();
    }
  }, { once: true });
  dialog.show?.();
}

document.addEventListener("click", (event) => {
  const path = event.composedPath?.() || [];
  const resetOneButton = path.find((node) => node instanceof HTMLElement && node.id === "accountResetPin");
  if (resetOneButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    void resetOne(resetOneButton);
    return;
  }

  const resetAllButton = path.find((node) => node instanceof HTMLElement && node.id === "pinconDeleteNonAdmins");
  if (resetAllButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    openBulkResetDialog();
    return;
  }

  const copyButton = path.find((node) => node instanceof HTMLElement && node.hasAttribute("data-copy-activation"));
  if (copyButton) {
    const code = copyButton.getAttribute("data-copy-activation") || "";
    navigator.clipboard?.writeText?.(code).catch(() => {});
    copyButton.textContent = "복사됨";
  }
}, true);

const observer = new MutationObserver((records) => {
  for (const record of records) {
    record.addedNodes.forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      rewriteLegacyLabels(node);
    });
  }
});
observer.observe(document.body, { childList: true, subtree: true });
rewriteLegacyLabels();
