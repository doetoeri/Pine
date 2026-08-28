import { readClassProfile } from "../core/data-gateway.js";
import { accountRequest } from "../core/student-auth.js";

const root = document.querySelector("#adminApp");
let view = null;
let loading = false;
let denied = false;

const TIMING_LABELS = Object.freeze({
  MORNING: "아침",
  LUNCH: "점심",
  CLEANING_TIME: "청소 시간",
  BEFORE_LEAVING: "종례 전후",
  WEEKLY: "주 1회",
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function selectedClassKey() {
  return readClassProfile()?.classKey || "";
}

function exemptionRows(policy = {}) {
  const fallback = {
    HEALTH: { enabled: true, label: "건강 사유" },
    ABSENCE: { enabled: true, label: "결석" },
    SCHOOL_SCHEDULE: { enabled: true, label: "학교 일정" },
    OTHER: { enabled: true, label: "기타 정당한 사유" },
  };
  const rows = { ...fallback, ...policy };
  return Object.entries(rows).map(([code, item]) => `<label class="pincon-ops-setting-check">
    <md-checkbox data-exemption-code="${escapeHtml(code)}" ${item?.enabled !== false ? "checked" : ""}></md-checkbox>
    <span><strong>${escapeHtml(item?.label || code)}</strong><small>${escapeHtml(code)}</small></span>
  </label>`).join("");
}

function departmentRows(rows = []) {
  if (!rows.length) return `<div class="admin-empty"><md-icon>account_tree</md-icon><strong>등록된 부서가 없습니다</strong><span>학급자치회 5개 부서를 먼저 등록해 주세요.</span></div>`;
  return `<div class="admin-list">${rows.map((item) => `<div class="admin-row pincon-ops-row">
    <span>${item.active === false ? "사용 안 함" : "사용 중"}</span>
    <div class="admin-row__main"><strong>${escapeHtml(item.name)}</strong><span>ID ${escapeHtml(item.id)}</span></div>
    <md-outlined-button data-edit-department="${escapeHtml(item.id)}">관리</md-outlined-button>
  </div>`).join("")}</div>`;
}

function oneRoleRows(rows = []) {
  if (!rows.length) return `<div class="admin-empty"><md-icon>assignment_ind</md-icon><strong>등록된 1인1역이 없습니다</strong><span>전자칠판 정리, 휴대폰 확인 담당 같은 역할을 정의할 수 있습니다.</span></div>`;
  return `<div class="admin-list">${rows.map((item) => `<div class="admin-row pincon-ops-row">
    <span>${item.active === false ? "사용 안 함" : escapeHtml(TIMING_LABELS[item.timing] || item.timing || "상시")}</span>
    <div class="admin-row__main"><strong>${escapeHtml(item.name)}</strong><span>${item.permissions?.includes("MANAGE_PHONE") ? "휴대폰 관리 권한 · " : ""}ID ${escapeHtml(item.id)}</span></div>
    <md-outlined-button data-edit-one-role="${escapeHtml(item.id)}">관리</md-outlined-button>
  </div>`).join("")}</div>`;
}

function sectionMarkup() {
  if (denied || !view) return "";
  const settings = view.settings || {};
  const classKey = view.classKey || selectedClassKey();
  return `<section class="admin-card admin-card--wide pincon-ops-settings" id="pinconClassOpsSettings" aria-labelledby="pincon-ops-settings-title">
    <div class="admin-card__header">
      <h2 id="pincon-ops-settings-title">학급 운영 설정</h2>
      <span class="admin-meta">${escapeHtml(classKey)}</span>
    </div>
    <p class="pincon-ops-settings__intro">정상 상황은 자동 처리하고 예외만 사람이 확인하도록 설정합니다. 규칙을 코드에 박아두는 대신 여기서 바꿀 수 있습니다.</p>
    <div class="pincon-ops-settings__grid">
      <div class="pincon-ops-settings__panel">
        <h3>이동수업 · 청소</h3>
        <md-outlined-select id="pinconPhoneMovementPolicy" label="이동수업 시 휴대폰" value="${escapeHtml(settings.phoneMovementPolicy || "KEEP_IN_CLASSROOM")}">
          <md-select-option value="KEEP_IN_CLASSROOM"><div slot="headline">교실 보관</div></md-select-option>
          <md-select-option value="TAKE"><div slot="headline">이동수업에 지참</div></md-select-option>
        </md-outlined-select>
        <label class="pincon-ops-setting-check"><md-checkbox id="pinconCleaningAutoAssign" ${settings.cleaningAutoAssignEnabled !== false ? "checked" : ""}></md-checkbox><span><strong>담당자가 정해지지 않으면 공정 자동 배정</strong><small>횟수·최근 수행일·연속 배정·역할 부담을 반영합니다.</small></span></label>
        <div class="pincon-ops-exemptions"><strong>면제 사유</strong>${exemptionRows(settings.cleaningExemptionPolicy)}</div>
        <div class="pincon-ops-settings__actions"><md-filled-button id="pinconSaveOpsSettings"><md-icon slot="icon">save</md-icon>설정 저장</md-filled-button><span id="pinconOpsSettingsStatus" role="status"></span></div>
      </div>
      <div class="pincon-ops-settings__panel">
        <div class="pincon-ops-settings__panel-head"><h3>학급자치회 부서</h3><md-filled-tonal-button id="pinconAddDepartment"><md-icon slot="icon">add</md-icon>부서 추가</md-filled-tonal-button></div>
        ${departmentRows(view.departments)}
      </div>
      <div class="pincon-ops-settings__panel pincon-ops-settings__panel--wide">
        <div class="pincon-ops-settings__panel-head"><h3>1인1역</h3><md-filled-tonal-button id="pinconAddOneRole"><md-icon slot="icon">add</md-icon>역할 추가</md-filled-tonal-button></div>
        ${oneRoleRows(view.onePersonRoles)}
      </div>
    </div>
  </section>`;
}

async function load(force = false) {
  if (loading || (view && !force)) return;
  const classKey = selectedClassKey();
  if (!classKey) return;
  loading = true;
  try {
    view = await accountRequest(`/api/class-ops/settings?classKey=${encodeURIComponent(classKey)}`);
    denied = false;
  } catch (error) {
    if (error?.status === 403) denied = true;
  } finally {
    loading = false;
    renderSection();
  }
}

function renderSection() {
  const grid = root?.querySelector("#adminMain .admin-grid");
  if (!grid) return;
  grid.querySelector("#pinconClassOpsSettings")?.remove();
  const markup = sectionMarkup();
  if (!markup) return;
  grid.insertAdjacentHTML("afterbegin", markup);
  bindSection();
}

function currentPolicy(section) {
  const previous = view?.settings?.cleaningExemptionPolicy || {};
  return Object.fromEntries([...section.querySelectorAll("[data-exemption-code]")].map((box) => {
    const code = box.dataset.exemptionCode;
    return [code, { enabled: box.checked === true, label: previous[code]?.label || code }];
  }));
}

function bindSection() {
  const section = root.querySelector("#pinconClassOpsSettings");
  if (!section) return;
  section.querySelector("#pinconSaveOpsSettings")?.addEventListener("click", async () => {
    const status = section.querySelector("#pinconOpsSettingsStatus");
    status.textContent = "저장 중…";
    try {
      await accountRequest("/api/class-ops/settings", {
        method: "POST",
        body: {
          action: "UPDATE_SETTINGS",
          classKey: view.classKey,
          phoneMovementPolicy: section.querySelector("#pinconPhoneMovementPolicy")?.value,
          cleaningAutoAssignEnabled: section.querySelector("#pinconCleaningAutoAssign")?.checked === true,
          cleaningExemptionPolicy: currentPolicy(section),
        },
      });
      status.textContent = "저장했습니다.";
      await load(true);
    } catch {
      status.textContent = "설정을 저장하지 못했습니다.";
    }
  });
  section.querySelector("#pinconAddDepartment")?.addEventListener("click", () => openDepartmentDialog(null));
  section.querySelectorAll("[data-edit-department]").forEach((button) => button.addEventListener("click", () => openDepartmentDialog(view.departments.find((item) => item.id === button.dataset.editDepartment))));
  section.querySelector("#pinconAddOneRole")?.addEventListener("click", () => openOneRoleDialog(null));
  section.querySelectorAll("[data-edit-one-role]").forEach((button) => button.addEventListener("click", () => openOneRoleDialog(view.onePersonRoles.find((item) => item.id === button.dataset.editOneRole))));
}

function baseDialog(title, body) {
  const dialog = document.createElement("md-dialog");
  dialog.className = "pincon-ops-dialog";
  dialog.innerHTML = `<div slot="headline">${escapeHtml(title)}</div><div slot="content" class="pincon-ops-dialog__body">${body}<div class="pincon-ops-dialog__status" data-dialog-status role="status"></div></div><div slot="actions"><md-text-button data-dialog-close>닫기</md-text-button><md-filled-button data-dialog-save>저장</md-filled-button></div>`;
  document.body.appendChild(dialog);
  dialog.querySelector("[data-dialog-close]")?.addEventListener("click", () => dialog.close?.());
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.show?.();
  return dialog;
}

function openDepartmentDialog(item) {
  const dialog = baseDialog(item ? "부서 관리" : "부서 추가", `<div class="pincon-ops-dialog__form">
    <md-outlined-text-field id="opsDepartmentId" label="부서 ID" value="${escapeHtml(item?.id || "")}" ${item ? "disabled" : ""} supporting-text="학생 계정의 부서 배정에 사용됩니다."></md-outlined-text-field>
    <md-outlined-text-field id="opsDepartmentName" label="부서 이름" value="${escapeHtml(item?.name || "")}" required></md-outlined-text-field>
    <md-outlined-text-field id="opsDepartmentOrder" label="정렬 순서" type="number" min="0" max="100" value="${Number(item?.sortOrder || 0)}"></md-outlined-text-field>
    <label class="pincon-ops-setting-check"><md-checkbox id="opsDepartmentActive" ${item?.active !== false ? "checked" : ""}></md-checkbox><span><strong>사용 중</strong></span></label>
  </div>`);
  dialog.querySelector("[data-dialog-save]")?.addEventListener("click", async () => {
    const status = dialog.querySelector("[data-dialog-status]");
    status.textContent = "저장 중…";
    try {
      await accountRequest("/api/class-ops/settings", { method: "POST", body: {
        action: "UPSERT_DEPARTMENT",
        classKey: view.classKey,
        id: item?.id || dialog.querySelector("#opsDepartmentId")?.value,
        name: dialog.querySelector("#opsDepartmentName")?.value,
        sortOrder: Number(dialog.querySelector("#opsDepartmentOrder")?.value || 0),
        active: dialog.querySelector("#opsDepartmentActive")?.checked === true,
      } });
      status.textContent = "저장했습니다.";
      await load(true);
      dialog.close?.();
    } catch { status.textContent = "부서를 저장하지 못했습니다."; }
  });
}

function timingOptions(selected) {
  return Object.entries(TIMING_LABELS).map(([value, label]) => `<md-select-option value="${value}" ${value === selected ? "selected" : ""}><div slot="headline">${label}</div></md-select-option>`).join("");
}

function openOneRoleDialog(item) {
  const dialog = baseDialog(item ? "1인1역 관리" : "1인1역 추가", `<div class="pincon-ops-dialog__form">
    <md-outlined-text-field id="opsOneRoleId" label="역할 ID" value="${escapeHtml(item?.id || "")}" ${item ? "disabled" : ""}></md-outlined-text-field>
    <md-outlined-text-field id="opsOneRoleName" label="역할 이름" value="${escapeHtml(item?.name || "")}" required></md-outlined-text-field>
    <md-outlined-text-field id="opsOneRoleDescription" label="설명" value="${escapeHtml(item?.description || "")}"></md-outlined-text-field>
    <md-outlined-select id="opsOneRoleTiming" label="강조 시점" value="${escapeHtml(item?.timing || "WEEKLY")}">${timingOptions(item?.timing || "WEEKLY")}</md-outlined-select>
    <label class="pincon-ops-setting-check"><md-checkbox id="opsOneRolePhone" ${item?.permissions?.includes("MANAGE_PHONE") ? "checked" : ""}></md-checkbox><span><strong>휴대폰 제출·반환 관리 권한</strong><small>실제 보관함을 확인하는 담당 역할에만 사용합니다.</small></span></label>
    <label class="pincon-ops-setting-check"><md-checkbox id="opsOneRoleActive" ${item?.active !== false ? "checked" : ""}></md-checkbox><span><strong>사용 중</strong></span></label>
  </div>`);
  dialog.querySelector("[data-dialog-save]")?.addEventListener("click", async () => {
    const status = dialog.querySelector("[data-dialog-status]");
    status.textContent = "저장 중…";
    try {
      await accountRequest("/api/class-ops/settings", { method: "POST", body: {
        action: "UPSERT_ONE_PERSON_ROLE",
        classKey: view.classKey,
        id: item?.id || dialog.querySelector("#opsOneRoleId")?.value,
        name: dialog.querySelector("#opsOneRoleName")?.value,
        description: dialog.querySelector("#opsOneRoleDescription")?.value,
        timing: dialog.querySelector("#opsOneRoleTiming")?.value,
        permissions: dialog.querySelector("#opsOneRolePhone")?.checked === true ? ["MANAGE_PHONE"] : [],
        active: dialog.querySelector("#opsOneRoleActive")?.checked === true,
      } });
      status.textContent = "저장했습니다.";
      await load(true);
      dialog.close?.();
    } catch { status.textContent = "1인1역을 저장하지 못했습니다."; }
  });
}

new MutationObserver(() => {
  if (!root?.querySelector("#adminMain")) return;
  renderSection();
  load();
}).observe(root, { childList: true, subtree: true });

renderSection();
load();
