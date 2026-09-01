import { accountRequest } from "../core/student-auth.js";

const MAX_BULK_ACCOUNTS = 60;
let reloadAfterBulkClose = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function validateAccount(value) {
  if (!/^\d{5}$/.test(value.studentNumber)) return "학번은 5자리 숫자여야 합니다.";
  if (!value.name) return "이름을 입력해주세요.";
  if (!Number.isInteger(value.grade) || value.grade < 1 || value.grade > 3) return "학년을 확인해주세요.";
  if (!Number.isInteger(value.classNumber) || value.classNumber < 1 || value.classNumber > 10) return "반을 확인해주세요.";
  if (!Number.isInteger(value.number) || value.number < 1 || value.number > 60) return "번호를 확인해주세요.";
  return "";
}

function parseBulkRows(value) {
  const rawLines = String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const lines = rawLines.filter((line, index) => !(index === 0 && /^학번[\t,]/.test(line)));
  const rows = [];
  const errors = [];

  lines.slice(0, MAX_BULK_ACCOUNTS).forEach((line, index) => {
    const columns = line.split(/[\t,]/).map((item) => item.trim());
    if (columns.length < 5) {
      errors.push(`${index + 1}행: 학번, 이름, 학년, 반, 번호 5개 항목이 필요합니다.`);
      return;
    }
    const [studentNumber, name, gradeText, classText, numberText] = columns;
    const row = {
      studentNumber,
      name,
      grade: Number(gradeText),
      classNumber: Number(classText),
      number: Number(numberText),
      roles: ["STUDENT"],
      subjectRoles: [],
      departmentId: "",
      onePersonRoleId: "",
      status: "ACTIVE",
    };
    const validation = validateAccount(row);
    if (validation) errors.push(`${index + 1}행: ${validation}`);
    else rows.push(row);
  });

  if (lines.length > MAX_BULK_ACCOUNTS) errors.push(`한 번에 최대 ${MAX_BULK_ACCOUNTS}명까지 등록할 수 있습니다.`);
  const seen = new Set();
  const duplicates = new Set();
  for (const row of rows) {
    if (seen.has(row.studentNumber)) duplicates.add(row.studentNumber);
    seen.add(row.studentNumber);
  }
  if (duplicates.size) errors.push(`입력 안에 중복 학번이 있습니다: ${[...duplicates].join(", ")}`);
  return { rows, errors };
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

function errorLabel(value) {
  const labels = {
    "student-number-exists": "이미 생성된 학번",
    "duplicate-student-number-in-request": "명단 안 중복 학번",
    "invalid-student-number": "학번 형식 오류",
    "invalid-seat-number": "번호 오류",
    "invalid-class": "학급 정보 오류",
    "class-scope-denied": "관리 범위를 벗어난 학급",
    "account-create-failed": "계정 생성 실패",
  };
  return labels[value] || value || "계정 생성 실패";
}

function renderValidation(dialog) {
  const input = dialog.querySelector("#pinconBulkInput");
  const preview = dialog.querySelector("#pinconBulkPreview");
  if (!input || !preview) return { rows: [], errors: ["입력창을 찾지 못했습니다."] };
  const parsed = parseBulkRows(input.value);
  preview.dataset.error = parsed.errors.length ? "true" : "false";
  preview.textContent = parsed.errors.length
    ? parsed.errors.slice(0, 5).join(" · ")
    : parsed.rows.length
      ? `${parsed.rows.length}명 검사 완료 · 서버에 한 번에 안전하게 등록합니다.`
      : "명단을 붙여넣으면 먼저 검사합니다.";
  return parsed;
}

async function submitBulk(dialog, button) {
  const parsed = renderValidation(dialog);
  if (!parsed.rows.length || parsed.errors.length) return;

  const status = dialog.querySelector("#pinconBulkStatus");
  const resultBox = dialog.querySelector("#pinconBulkResult");
  button.disabled = true;
  if (status) status.textContent = `${parsed.rows.length}명 계정을 한 번의 요청으로 생성하는 중…`;
  if (resultBox) resultBox.innerHTML = `<md-linear-progress indeterminate aria-label="계정 일괄 생성 중"></md-linear-progress>`;

  try {
    const response = await accountRequest("/api/accounts/manage", {
      method: "POST",
      body: { action: "BULK_CREATE", accounts: parsed.rows },
    });
    const created = Array.isArray(response.created) ? response.created : [];
    const failed = Array.isArray(response.failed) ? response.failed : [];
    reloadAfterBulkClose = created.length > 0;

    if (resultBox) {
      resultBox.innerHTML = `<div class="pincon-account-bulk__result">
        <md-icon>${created.length ? "check_circle" : "error"}</md-icon>
        <div><strong>${created.length}명 생성 완료</strong><span>${failed.length ? `${failed.length}명은 생성하지 못했습니다.` : "명단 전체를 생성했습니다."}</span></div>
        ${created.length ? `<md-filled-tonal-button id="pinconBulkDownload"><md-icon slot="icon">download</md-icon>임시 PIN CSV 저장</md-filled-tonal-button>` : ""}
      </div>
      ${failed.length ? `<div class="pincon-account-bulk__errors">${failed.map((item) => `<span>${escapeHtml(item.studentNumber)} ${escapeHtml(item.name)}: ${escapeHtml(errorLabel(item.error))}</span>`).join("")}</div>` : ""}`;
      resultBox.querySelector("#pinconBulkDownload")?.addEventListener("click", () => downloadCsv(
        `pincon-temporary-pins-${new Date().toISOString().slice(0, 10)}.csv`,
        [["학번", "이름", "임시 PIN"], ...created.map((item) => [item.account?.studentNumber, item.account?.name, item.temporaryPin])],
      ));
    }
    if (status) status.textContent = created.length
      ? "임시 PIN은 이 창을 닫기 전에 저장하세요. 창을 닫으면 계정 목록을 새로고침합니다."
      : "생성된 계정이 없습니다. 실패 사유를 확인해주세요.";
  } catch (error) {
    if (resultBox) resultBox.innerHTML = `<div class="pincon-account-bulk__errors"><span>${escapeHtml(errorLabel(error?.message))}</span></div>`;
    if (status) status.textContent = error?.status === 401
      ? "관리자 인증이 만료되었습니다. 자동 갱신 후에도 실패해 다시 로그인해야 합니다."
      : "일괄 계정 생성 요청을 처리하지 못했습니다.";
  } finally {
    button.disabled = false;
  }
}

document.addEventListener("input", (event) => {
  const input = event.composedPath?.().find((node) => node instanceof HTMLElement && node.id === "pinconBulkInput");
  if (!input) return;
  const dialog = input.closest("md-dialog") || document.querySelector("#pinconBulkUserDialog");
  if (dialog) renderValidation(dialog);
}, true);

document.addEventListener("click", (event) => {
  const button = event.composedPath?.().find((node) => node instanceof HTMLElement && node.id === "pinconBulkCreate");
  if (!button) return;
  const dialog = button.closest("md-dialog") || document.querySelector("#pinconBulkUserDialog");
  if (!dialog) return;

  // user-manager.js still owns the dialog shell. Stop its old N-request submitter
  // and replace only the submission path with the server-side BULK_CREATE contract.
  event.preventDefault();
  event.stopImmediatePropagation();
  void submitBulk(dialog, button);
}, true);

document.addEventListener("close", (event) => {
  if (event.target?.id !== "pinconBulkUserDialog" || !reloadAfterBulkClose) return;
  reloadAfterBulkClose = false;
  window.setTimeout(() => location.reload(), 30);
}, true);
