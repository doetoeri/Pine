import { readClassProfile } from "../core/data-gateway.js";
import {
  buildStudentAccount,
  createOneAccount,
  createRosterAccounts,
  parseRoster,
  studentNumberFromParts,
  validateStudentAccount,
} from "./account-create-service.js?v=20260902-account5";

let changed = false;
let activeDialog = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initialClass() {
  const profile = readClassProfile?.() || {};
  const classKey = String(profile.classKey || "");
  const [keyGrade, keyClass] = classKey.split("-").map(Number);
  return {
    grade: Number(profile.grade || keyGrade || 1),
    classNumber: Number(profile.classNumber || keyClass || 1),
  };
}

function gradeOptions(selected) {
  return [1, 2, 3].map((value) => `<md-select-option value="${value}" ${Number(selected) === value ? "selected" : ""}><div slot="headline">${value}학년</div></md-select-option>`).join("");
}

function classOptions(selected) {
  return Array.from({ length: 10 }, (_, index) => index + 1)
    .map((value) => `<md-select-option value="${value}" ${Number(selected) === value ? "selected" : ""}><div slot="headline">${value}반</div></md-select-option>`).join("");
}

function dialogMarkup(mode) {
  const current = initialClass();
  return `<div slot="headline" class="pincon-account-create__headline">
      <span class="pincon-account-create__headline-icon"><md-icon>person_add</md-icon></span>
      <span><strong>계정 추가</strong><small>학생 신원에서 학번을 자동 구성합니다.</small></span>
    </div>
    <div slot="content" class="pincon-account-create" data-mode="${mode}">
      <div class="pincon-account-create__mode" role="tablist" aria-label="계정 추가 방식">
        <button type="button" role="tab" data-create-mode="single" aria-selected="${mode === "single"}"><md-icon>person_add</md-icon><span><strong>한 명 추가</strong><small>이름과 번호만 입력</small></span></button>
        <button type="button" role="tab" data-create-mode="bulk" aria-selected="${mode === "bulk"}"><md-icon>group_add</md-icon><span><strong>명단 추가</strong><small>번호+이름 붙여넣기</small></span></button>
      </div>

      <section class="pincon-account-create__panel" data-create-panel="single" ${mode === "single" ? "" : "hidden"}>
        <div class="pincon-account-create__class-row">
          <md-outlined-select id="accountCreateGrade" label="학년" value="${current.grade}">${gradeOptions(current.grade)}</md-outlined-select>
          <md-outlined-select id="accountCreateClass" label="반" value="${current.classNumber}">${classOptions(current.classNumber)}</md-outlined-select>
          <md-outlined-text-field id="accountCreateNumber" label="번호" type="number" min="1" max="60" inputmode="numeric"></md-outlined-text-field>
        </div>
        <md-outlined-text-field id="accountCreateName" label="이름" autocomplete="off" placeholder="학생 이름"></md-outlined-text-field>
        <div class="pincon-account-create__identity" id="accountCreateIdentity" data-valid="false">
          <span>생성될 학번</span><strong>번호를 입력하세요</strong><small>학번은 학년 1자리 + 반 2자리 + 번호 2자리로 자동 구성됩니다.</small>
        </div>
        <div class="pincon-account-create__message" id="accountCreateSingleMessage" aria-live="polite"></div>
      </section>

      <section class="pincon-account-create__panel" data-create-panel="bulk" ${mode === "bulk" ? "" : "hidden"}>
        <div class="pincon-account-create__bulk-head">
          <div><strong>대상 학급</strong><span>번호만 붙여넣을 때 이 학급을 사용합니다.</span></div>
          <div class="pincon-account-create__class-row is-compact">
            <md-outlined-select id="accountBulkGrade" label="학년" value="${current.grade}">${gradeOptions(current.grade)}</md-outlined-select>
            <md-outlined-select id="accountBulkClass" label="반" value="${current.classNumber}">${classOptions(current.classNumber)}</md-outlined-select>
          </div>
        </div>
        <label class="pincon-account-create__paste">
          <span><strong>학생 명단</strong><small>한 줄에 한 명. <b>번호 이름</b> 또는 <b>학번 이름</b></small></span>
          <textarea id="accountBulkRoster" rows="9" spellcheck="false" placeholder="1 김학생\n2 이학생\n3 박학생"></textarea>
        </label>
        <div class="pincon-account-create__bulk-tools">
          <span id="accountBulkSummary">명단을 붙여넣으면 바로 검사합니다.</span>
          <md-text-button id="accountBulkExample"><md-icon slot="icon">content_paste</md-icon>예시</md-text-button>
        </div>
        <div class="pincon-account-create__preview" id="accountBulkPreview" aria-live="polite"></div>
      </section>

      <div class="pincon-account-create__result" id="accountCreateResult" hidden></div>
    </div>
    <div slot="actions" class="pincon-account-create__actions">
      <md-text-button id="accountCreateClose">닫기</md-text-button>
      <md-filled-button id="accountCreateSubmit"><md-icon slot="icon">person_add</md-icon>${mode === "bulk" ? "명단 계정 생성" : "계정 생성"}</md-filled-button>
    </div>`;
}

function setMode(dialog, mode) {
  dialog.querySelector(".pincon-account-create")?.setAttribute("data-mode", mode);
  dialog.querySelectorAll("[data-create-mode]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.createMode === mode)));
  dialog.querySelectorAll("[data-create-panel]").forEach((panel) => { panel.hidden = panel.dataset.createPanel !== mode; });
  const submit = dialog.querySelector("#accountCreateSubmit");
  if (submit) submit.innerHTML = `<md-icon slot="icon">${mode === "bulk" ? "group_add" : "person_add"}</md-icon>${mode === "bulk" ? "명단 계정 생성" : "계정 생성"}`;
  renderSingleIdentity(dialog);
  renderBulkPreview(dialog);
}

function singleAccount(dialog) {
  return buildStudentAccount({
    grade: Number(dialog.querySelector("#accountCreateGrade")?.value || 0),
    classNumber: Number(dialog.querySelector("#accountCreateClass")?.value || 0),
    number: Number(dialog.querySelector("#accountCreateNumber")?.value || 0),
    name: dialog.querySelector("#accountCreateName")?.value || "",
  });
}

function renderSingleIdentity(dialog) {
  const identity = dialog.querySelector("#accountCreateIdentity");
  if (!identity) return;
  const account = singleAccount(dialog);
  const number = studentNumberFromParts(account.grade, account.classNumber, account.number);
  const error = validateStudentAccount(account);
  identity.dataset.valid = String(!error);
  identity.querySelector("strong").textContent = number || "번호를 입력하세요";
  identity.querySelector("small").textContent = number
    ? `${account.grade}학년 ${account.classNumber}반 ${account.number}번 · ${account.name || "이름 미입력"}`
    : "학번은 학년 1자리 + 반 2자리 + 번호 2자리로 자동 구성됩니다.";
  const message = dialog.querySelector("#accountCreateSingleMessage");
  if (message) message.textContent = account.name || account.number ? (error || "입력 확인 완료") : "";
}

function rosterState(dialog) {
  return parseRoster(dialog.querySelector("#accountBulkRoster")?.value || "", {
    grade: Number(dialog.querySelector("#accountBulkGrade")?.value || 0),
    classNumber: Number(dialog.querySelector("#accountBulkClass")?.value || 0),
  });
}

function renderBulkPreview(dialog) {
  const preview = dialog.querySelector("#accountBulkPreview");
  const summary = dialog.querySelector("#accountBulkSummary");
  if (!preview || !summary) return;
  const parsed = rosterState(dialog);
  if (!parsed.rows.length) {
    preview.innerHTML = `<div class="pincon-account-create__empty"><md-icon>format_list_numbered</md-icon><span>예: <b>4 김도영</b> 또는 <b>10804 김도영</b></span></div>`;
    summary.textContent = "명단을 붙여넣으면 바로 검사합니다.";
    return;
  }
  summary.textContent = `${parsed.valid.length}명 준비 · ${parsed.errors.length}개 확인 필요`;
  preview.innerHTML = `<div class="pincon-account-create__preview-head"><span>학번</span><span>이름</span><span>상태</span></div>${parsed.rows.map((row) => {
    const account = row.account || {};
    return `<div class="pincon-account-create__preview-row" data-error="${Boolean(row.error)}">
      <span>${escapeHtml(account.studentNumber || `행 ${row.line}`)}</span>
      <strong>${escapeHtml(account.name || row.source || "-")}</strong>
      <em>${row.error ? `<md-icon>error</md-icon>${escapeHtml(row.error)}` : `<md-icon>check_circle</md-icon>${account.grade}학년 ${account.classNumber}반 ${account.number}번`}</em>
    </div>`;
  }).join("")}`;
}

function errorMessage(error) {
  const code = String(error?.message || error?.code || "");
  const table = {
    "student-number-exists": "이미 같은 학번의 계정이 있습니다.",
    "account-api-unreachable": "계정 서버에 연결하지 못했습니다. 이 요청은 자동 재시도하지 않았으므로 중복 생성 걱정 없이 다시 시도할 수 있습니다.",
    "class-scope-denied": "현재 계정으로는 이 학급의 계정을 만들 수 없습니다.",
    "account-admin-required": "계정 생성 권한이 없습니다.",
  };
  if (error?.status === 401) return "관리자 로그인이 만료되었습니다. 다시 로그인한 뒤 시도해주세요.";
  return table[code] || code || "계정을 생성하지 못했습니다.";
}

function downloadCsv(rows) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `pincon-accounts-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function showSingleResult(dialog, response) {
  const result = dialog.querySelector("#accountCreateResult");
  const account = response?.account || {};
  const pin = response?.temporaryPin || "";
  changed = Boolean(account.uid || account.studentNumber);
  result.hidden = false;
  result.innerHTML = `<div class="pincon-account-create__success">
    <span class="pincon-account-create__success-icon"><md-icon>check_circle</md-icon></span>
    <div><small>계정 생성 완료</small><strong>${escapeHtml(account.name || "학생")} · ${escapeHtml(account.studentNumber || "")}</strong><span>학생은 아래 임시 PIN으로 첫 로그인합니다.</span></div>
    <code>${escapeHtml(pin)}</code>
    <md-filled-tonal-button id="accountPinCopy"><md-icon slot="icon">content_copy</md-icon>PIN 복사</md-filled-tonal-button>
  </div>`;
  result.querySelector("#accountPinCopy")?.addEventListener("click", async () => {
    await navigator.clipboard?.writeText?.(pin).catch(() => {});
    result.querySelector("#accountPinCopy").textContent = "복사됨";
  });
}

function showBulkResult(dialog, response) {
  const result = dialog.querySelector("#accountCreateResult");
  const created = Array.isArray(response?.created) ? response.created : [];
  const failed = Array.isArray(response?.failed) ? response.failed : [];
  changed = created.length > 0;
  result.hidden = false;
  result.innerHTML = `<div class="pincon-account-create__bulk-result">
    <div class="pincon-account-create__bulk-result-summary"><span><md-icon>${failed.length ? "rule" : "check_circle"}</md-icon></span><div><small>명단 처리 완료</small><strong>${created.length}명 생성 · ${failed.length}명 실패</strong><p>${failed.length ? "실패한 학생만 확인해서 다시 추가하면 됩니다." : "모든 학생 계정이 생성되었습니다."}</p></div></div>
    ${created.length ? `<md-filled-tonal-button id="accountPinsDownload"><md-icon slot="icon">download</md-icon>임시 PIN CSV 저장</md-filled-tonal-button>` : ""}
    ${failed.length ? `<div class="pincon-account-create__failures">${failed.map((item) => `<span><b>${escapeHtml(item.studentNumber || "-")} ${escapeHtml(item.name || "")}</b><em>${escapeHtml(errorMessage({ message: item.error }))}</em></span>`).join("")}</div>` : ""}
  </div>`;
  result.querySelector("#accountPinsDownload")?.addEventListener("click", () => downloadCsv([
    ["학번", "이름", "임시 PIN"],
    ...created.map((item) => [item.account?.studentNumber, item.account?.name, item.temporaryPin]),
  ]));
}

async function submit(dialog) {
  const mode = dialog.querySelector(".pincon-account-create")?.dataset.mode || "single";
  const button = dialog.querySelector("#accountCreateSubmit");
  const result = dialog.querySelector("#accountCreateResult");
  if (!button) return;
  button.disabled = true;
  result.hidden = false;
  result.innerHTML = `<div class="pincon-account-create__working"><md-circular-progress indeterminate></md-circular-progress><span>${mode === "bulk" ? "명단 계정을 생성하고 있습니다." : "계정을 생성하고 있습니다."}</span></div>`;
  try {
    if (mode === "single") {
      const account = singleAccount(dialog);
      const validation = validateStudentAccount(account);
      if (validation) throw new Error(validation);
      const response = await createOneAccount(account);
      showSingleResult(dialog, response);
    } else {
      const parsed = rosterState(dialog);
      renderBulkPreview(dialog);
      if (parsed.errors.length) throw new Error("오류가 표시된 행을 먼저 수정해주세요.");
      if (!parsed.valid.length) throw new Error("추가할 학생이 없습니다.");
      const response = await createRosterAccounts(parsed.valid);
      showBulkResult(dialog, response);
    }
  } catch (error) {
    result.hidden = false;
    result.innerHTML = `<div class="pincon-account-create__error"><md-icon>error</md-icon><div><strong>계정을 추가하지 못했습니다</strong><span>${escapeHtml(errorMessage(error))}</span></div></div>`;
  } finally {
    button.disabled = false;
  }
}

function bind(dialog) {
  dialog.querySelectorAll("[data-create-mode]").forEach((button) => button.addEventListener("click", () => setMode(dialog, button.dataset.createMode)));
  ["#accountCreateGrade", "#accountCreateClass", "#accountCreateNumber", "#accountCreateName"].forEach((selector) => {
    const field = dialog.querySelector(selector);
    field?.addEventListener("input", () => renderSingleIdentity(dialog));
    field?.addEventListener("change", () => renderSingleIdentity(dialog));
  });
  ["#accountBulkGrade", "#accountBulkClass", "#accountBulkRoster"].forEach((selector) => {
    const field = dialog.querySelector(selector);
    field?.addEventListener("input", () => renderBulkPreview(dialog));
    field?.addEventListener("change", () => renderBulkPreview(dialog));
  });
  dialog.querySelector("#accountBulkExample")?.addEventListener("click", () => {
    const roster = dialog.querySelector("#accountBulkRoster");
    if (roster) roster.value = "1 김학생\n2 이학생\n3 박학생";
    renderBulkPreview(dialog);
  });
  dialog.querySelector("#accountCreateSubmit")?.addEventListener("click", () => void submit(dialog));
  dialog.querySelector("#accountCreateClose")?.addEventListener("click", () => dialog.close?.());
  dialog.addEventListener("close", () => {
    activeDialog = null;
    dialog.remove();
    if (changed) {
      changed = false;
      window.setTimeout(() => location.reload(), 30);
    }
  }, { once: true });
  renderSingleIdentity(dialog);
  renderBulkPreview(dialog);
}

function openAccountCreator(mode = "single") {
  activeDialog?.close?.();
  document.querySelector("#pinconAccountCreateDialog")?.remove();
  const dialog = document.createElement("md-dialog");
  dialog.id = "pinconAccountCreateDialog";
  dialog.className = "pincon-account-create-dialog";
  dialog.setAttribute("aria-label", "계정 추가");
  dialog.innerHTML = dialogMarkup(mode);
  document.body.append(dialog);
  activeDialog = dialog;
  bind(dialog);
  Promise.resolve(dialog.show?.()).catch((error) => console.error(error));
}

// Take ownership before user-manager's legacy target listeners run. The old dialogs remain
// dormant for compatibility with existing account editing, while all account creation uses
// this new renderer and request path.
document.addEventListener("click", (event) => {
  const trigger = event.composedPath?.().find((node) => node instanceof HTMLElement && ["pinconAddUser", "pinconBulkUsers"].includes(node.id));
  if (!trigger) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  openAccountCreator(trigger.id === "pinconBulkUsers" ? "bulk" : "single");
}, true);

export { openAccountCreator };
