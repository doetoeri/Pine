import { readClassProfile } from "../core/data-gateway.js";
import { accountRequest } from "../core/student-auth.js";

const root = document.querySelector("#adminApp");
const API_PATH = "/api/class-ops/duties";
const TIMING_LABELS = Object.freeze({
  MORNING: "아침",
  LUNCH: "점심",
  CLEANING_TIME: "청소 시간",
  BEFORE_LEAVING: "종례 전후",
  WEEKLY: "주 1회",
});
const CLEANING_STATUS_LABELS = Object.freeze({
  ASSIGNED: "배정됨",
  ACCEPTED: "수락됨",
  EXCHANGE_PENDING: "교환 요청 중",
  EXEMPTION_PENDING: "면제 검토 중",
  COMPLETED: "완료",
  EXEMPTED: "면제",
});

let view = null;
let selectedDepartmentId = "";
let selectedDate = "";
let recommendation = null;
let loading = false;
let denied = false;
let mountQueued = false;

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

function todayKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

const classKey = () => readClassProfile()?.classKey || "";
const activeMembers = () => (view?.members || [])
  .filter((item) => item.status === "ACTIVE")
  .sort((a, b) => Number(a.number || 0) - Number(b.number || 0));
const activeDepartments = () => (view?.departments || []).filter((item) => item.active !== false);
const activeRoles = () => (view?.onePersonRoles || []).filter((item) => item.active !== false);
const memberLabel = (member) => `${Number(member?.number) || "-"}번 ${member?.name || "이름 없음"}`;
const departmentName = (id) => (view?.departments || []).find((item) => item.id === id)?.name || "미배정";

async function request(action, payload = {}) {
  return accountRequest(API_PATH, {
    method: "POST",
    body: { action, classKey: view?.classKey || classKey(), ...payload },
  });
}

function roleMarkup() {
  const roles = activeRoles();
  if (!roles.length) return `<div class="admin-empty"><md-icon>assignment_ind</md-icon><strong>등록된 1인1역이 없습니다</strong><span>아래 학급 운영 설정에서 역할을 먼저 추가하세요.</span></div>`;
  return `<div class="pincon-duty-role-grid">${roles.map((role) => {
    const holder = activeMembers().find((member) => member.onePersonRoleId === role.id);
    return `<article class="pincon-duty-role" data-assigned="${holder ? "true" : "false"}">
      <div class="pincon-duty-role__icon"><md-icon>${holder ? "person_check" : "person_add"}</md-icon></div>
      <div class="pincon-duty-role__copy"><span>${escapeHtml(TIMING_LABELS[role.timing] || role.timing || "상시")}</span><strong>${escapeHtml(role.name)}</strong><small>${escapeHtml(role.description || "설명 없음")}</small></div>
      <div class="pincon-duty-role__assignee"><span>담당</span><strong>${holder ? escapeHtml(memberLabel(holder)) : "미배정"}</strong></div>
      <md-filled-tonal-button data-duty-role="${escapeHtml(role.id)}">${holder ? "변경" : "배정"}</md-filled-tonal-button>
    </article>`;
  }).join("")}</div>`;
}

function departmentMarkup() {
  const departments = activeDepartments();
  if (!departments.length) return `<div class="admin-empty"><md-icon>groups</md-icon><strong>등록된 학급자치회 부서가 없습니다</strong><span>학급 운영 설정에서 부서를 먼저 추가하세요.</span></div>`;
  return `<div class="pincon-duty-department-grid">${departments.map((department) => {
    const members = activeMembers().filter((member) => member.departmentId === department.id);
    const labels = members.slice(0, 8).map((member) => `<span>${escapeHtml(memberLabel(member))}</span>`).join("");
    return `<article class="pincon-duty-department">
      <div class="pincon-duty-department__head"><div><span>청소 팀</span><strong>${escapeHtml(department.name)}</strong></div><em>${members.length}명</em></div>
      <div class="pincon-duty-department__members">${labels || `<span class="is-empty">배정된 학생이 없습니다</span>`}${members.length > 8 ? `<span>+${members.length - 8}명</span>` : ""}</div>
      <md-outlined-button data-duty-department="${escapeHtml(department.id)}"><md-icon slot="icon">group</md-icon>구성원 관리</md-outlined-button>
    </article>`;
  }).join("")}</div>`;
}

function departmentOptions() {
  return activeDepartments().map((department) => `<md-select-option value="${escapeHtml(department.id)}" ${department.id === selectedDepartmentId ? "selected" : ""}><div slot="headline">${escapeHtml(department.name)}</div></md-select-option>`).join("");
}

function currentCleaningMarkup() {
  const cleaning = view?.cleaning;
  if (!cleaning) return `<div class="pincon-cleaning-empty"><md-icon>cleaning_services</md-icon><div><strong>청소 부서를 선택하세요</strong><span>부서 구성원을 등록하면 공정 배정을 사용할 수 있습니다.</span></div></div>`;
  const assignment = cleaning.todayAssignment;
  if (!assignment) return `<div class="pincon-cleaning-current is-empty"><div><span>${escapeHtml(selectedDate)} 대걸레 당번</span><strong>아직 배정되지 않음</strong><small>${escapeHtml(cleaning.department?.name || "")}</small></div><md-icon>person_add</md-icon></div>`;
  return `<div class="pincon-cleaning-current" data-status="${escapeHtml(assignment.status || "ASSIGNED")}">
    <div><span>${escapeHtml(selectedDate)} 대걸레 당번</span><strong>${escapeHtml(`${Number(assignment.assigneeNumber) || "-"}번 ${assignment.assigneeName || "학생"}`)}</strong><small>${escapeHtml(assignment.selectionReason || "배정 사유 없음")}</small></div>
    <em>${escapeHtml(CLEANING_STATUS_LABELS[assignment.status] || assignment.status || "배정")}</em>
  </div>`;
}

function cleaningStatsMarkup() {
  const stats = view?.cleaning?.memberStats || [];
  if (!stats.length) return `<span class="pincon-duty-muted">이 부서에 배정된 학생이 없습니다.</span>`;
  return `<div class="pincon-cleaning-stats">${stats.map((item) => `<span><strong>${escapeHtml(`${item.number}번 ${item.name}`)}</strong><em>${Number(item.count || 0)}회</em></span>`).join("")}</div>`;
}

function recommendationMarkup() {
  if (!recommendation || recommendation.departmentId !== selectedDepartmentId || recommendation.date !== selectedDate) return "";
  return `<div class="pincon-cleaning-recommendation">
    <md-icon>balance</md-icon>
    <div><span>공정 추천</span><strong>${escapeHtml(memberLabel(recommendation.candidate))}</strong><small>${escapeHtml(recommendation.reason || "")}</small></div>
    <div class="pincon-cleaning-recommendation__facts"><span>이번 달 ${Number(recommendation.fairness?.monthlyCount || 0)}회</span><span>${recommendation.fairness?.lastAssignedDate ? `마지막 ${escapeHtml(recommendation.fairness.lastAssignedDate)}` : "이번 달 첫 배정"}</span></div>
    <md-filled-button data-duty-confirm-recommendation>이 학생으로 배정</md-filled-button>
  </div>`;
}

function cleaningMarkup() {
  const cleaning = view?.cleaning;
  const assignment = cleaning?.todayAssignment;
  const members = cleaning?.members || [];
  const pending = cleaning?.pendingRequests?.length || 0;
  return `<div class="pincon-cleaning-manager">
    <div class="pincon-cleaning-toolbar">
      <md-outlined-select id="pinconCleaningDepartment" label="청소 부서" value="${escapeHtml(selectedDepartmentId)}">${departmentOptions()}</md-outlined-select>
      <md-outlined-text-field id="pinconCleaningDate" label="날짜" type="date" value="${escapeHtml(selectedDate)}"></md-outlined-text-field>
      <md-outlined-button id="pinconCleaningRefresh"><md-icon slot="icon">refresh</md-icon>새로고침</md-outlined-button>
    </div>
    ${currentCleaningMarkup()}
    <div class="pincon-cleaning-actions">
      <md-filled-tonal-button id="pinconCleaningRecommend" ${members.length ? "" : "disabled"}><md-icon slot="icon">balance</md-icon>공정 추천</md-filled-tonal-button>
      <md-filled-button id="pinconCleaningAuto" ${members.length ? "" : "disabled"}><md-icon slot="icon">auto_mode</md-icon>자동 배정</md-filled-button>
      <md-outlined-button id="pinconCleaningManual" ${members.length ? "" : "disabled"}><md-icon slot="icon">person_edit</md-icon>직접 배정</md-outlined-button>
      ${assignment && assignment.status !== "COMPLETED" ? `<md-outlined-button id="pinconCleaningComplete"><md-icon slot="icon">task_alt</md-icon>완료 처리</md-outlined-button>` : ""}
      ${assignment ? `<md-text-button id="pinconCleaningClear">배정 취소</md-text-button>` : ""}
    </div>
    ${recommendationMarkup()}
    <div class="pincon-cleaning-fairness"><div><strong>이번 달 배정 횟수</strong><span>횟수·최근 수행일·연속 배정·다른 역할 부담을 함께 반영합니다.</span></div>${cleaningStatsMarkup()}</div>
    ${pending ? `<div class="pincon-cleaning-pending"><md-icon>pending_actions</md-icon><span>이 부서에 처리 대기 중인 교환·면제 요청이 ${pending}건 있습니다.</span></div>` : ""}
  </div>`;
}

function markup() {
  if (!view || denied) return "";
  return `<section class="admin-card admin-card--wide pincon-duty-manager" id="pinconDutyManager" aria-labelledby="pincon-duty-title">
    <header class="pincon-duty-manager__header"><div><span>CLASS DUTIES</span><h2 id="pincon-duty-title">1인1역 · 청소당번</h2><p>역할과 청소를 학생에게 배정하고, 반복 업무는 공정하게 자동화합니다.</p></div><div class="pincon-duty-manager__class"><span>관리 학급</span><strong>${escapeHtml(view.classKey)}</strong></div></header>
    <div id="pinconDutyStatus" class="pincon-duty-status" role="status" aria-live="polite"></div>
    <section class="pincon-duty-section"><div class="pincon-duty-section__head"><div><span>01</span><div><h3>1인1역 배정</h3><p>등록한 역할과 담당 학생을 한 화면에서 연결합니다.</p></div></div></div>${roleMarkup()}</section>
    <section class="pincon-duty-section"><div class="pincon-duty-section__head"><div><span>02</span><div><h3>청소 부서 구성</h3><p>학급자치회 부서별 학생을 지정해 청소 후보군을 구성합니다.</p></div></div></div>${departmentMarkup()}</section>
    <section class="pincon-duty-section"><div class="pincon-duty-section__head"><div><span>03</span><div><h3>청소당번 관리</h3><p>대걸레 당번을 추천·자동·직접 배정하고 완료까지 기록합니다.</p></div></div></div>${cleaningMarkup()}</section>
  </section>`;
}

function makeDialog(title, body, saveLabel = "저장") {
  const dialog = document.createElement("md-dialog");
  dialog.className = "pincon-duty-dialog";
  dialog.innerHTML = `<div slot="headline">${escapeHtml(title)}</div><div slot="content" class="pincon-duty-dialog__body">${body}<div data-dialog-status class="pincon-duty-dialog__status" role="status"></div></div><div slot="actions"><md-text-button data-dialog-close>닫기</md-text-button><md-filled-button data-dialog-save>${escapeHtml(saveLabel)}</md-filled-button></div>`;
  document.body.appendChild(dialog);
  dialog.querySelector("[data-dialog-close]")?.addEventListener("click", () => dialog.close?.());
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.show?.();
  return dialog;
}

async function refresh({ force = false } = {}) {
  if (loading || (view && !force)) return;
  const targetClass = classKey();
  if (!targetClass) return;
  loading = true;
  if (!selectedDate) selectedDate = todayKey();
  try {
    const params = new URLSearchParams({ classKey: targetClass, date: selectedDate });
    if (selectedDepartmentId) params.set("departmentId", selectedDepartmentId);
    view = await accountRequest(`${API_PATH}?${params.toString()}`);
    selectedDepartmentId = view.departmentId || selectedDepartmentId || "";
    selectedDate = view.date || selectedDate;
    denied = false;
  } catch (error) {
    denied = error?.status === 403;
  } finally {
    loading = false;
    mount({ force: true });
  }
}

function openRoleDialog(role) {
  const current = activeMembers().find((member) => member.onePersonRoleId === role.id) || null;
  const options = activeMembers().map((member) => `<md-select-option value="${escapeHtml(member.uid)}" ${member.uid === current?.uid ? "selected" : ""}><div slot="headline">${escapeHtml(memberLabel(member))}</div><div slot="supporting-text">${escapeHtml(departmentName(member.departmentId))}</div></md-select-option>`).join("");
  const dialog = makeDialog(`${role.name} 담당 배정`, `<div class="pincon-duty-dialog__intro"><md-icon>assignment_ind</md-icon><div><strong>${escapeHtml(role.name)}</strong><span>${escapeHtml(role.description || "담당 학생을 선택하세요.")}</span></div></div><md-outlined-select id="dutyRoleStudent" label="담당 학생" value="${escapeHtml(current?.uid || "")}"><md-select-option value=""><div slot="headline">미배정</div></md-select-option>${options}</md-outlined-select>`, "배정 저장");
  dialog.querySelector("[data-dialog-save]")?.addEventListener("click", async () => {
    const status = dialog.querySelector("[data-dialog-status]");
    const uid = String(dialog.querySelector("#dutyRoleStudent")?.value || "");
    if (!uid && !current) return dialog.close?.();
    status.textContent = "배정 저장 중…";
    try {
      await request("ASSIGN_ONE_PERSON_ROLE", { userUid: uid || current.uid, roleId: uid ? role.id : "" });
      recommendation = null;
      await refresh({ force: true });
      dialog.close?.();
    } catch {
      status.textContent = "배정을 저장하지 못했습니다.";
    }
  });
}

function openDepartmentDialog(department) {
  const current = new Set(activeMembers().filter((member) => member.departmentId === department.id).map((member) => member.uid));
  const rows = activeMembers().map((member) => `<label class="pincon-duty-member-check"><md-checkbox data-duty-member="${escapeHtml(member.uid)}" ${current.has(member.uid) ? "checked" : ""}></md-checkbox><span><strong>${escapeHtml(memberLabel(member))}</strong><small>${escapeHtml(member.departmentId === department.id ? "현재 이 부서" : member.departmentId ? `현재 ${departmentName(member.departmentId)}` : "부서 미배정")}</small></span></label>`).join("");
  const dialog = makeDialog(`${department.name} 구성원`, `<div class="pincon-duty-dialog__intro"><md-icon>groups</md-icon><div><strong>${escapeHtml(department.name)}</strong><span>체크한 학생이 이 부서의 청소 후보가 됩니다. 다른 부서 학생을 선택하면 이 부서로 이동합니다.</span></div></div><div class="pincon-duty-member-list">${rows}</div>`, "구성 저장");
  dialog.querySelector("[data-dialog-save]")?.addEventListener("click", async () => {
    const status = dialog.querySelector("[data-dialog-status]");
    const userUids = [...dialog.querySelectorAll("[data-duty-member]")].filter((box) => box.checked).map((box) => box.dataset.dutyMember);
    status.textContent = "구성원 저장 중…";
    try {
      await request("SET_DEPARTMENT_MEMBERS", { departmentId: department.id, userUids });
      selectedDepartmentId = department.id;
      recommendation = null;
      await refresh({ force: true });
      dialog.close?.();
    } catch {
      status.textContent = "부서 구성을 저장하지 못했습니다.";
    }
  });
}

function openManualCleaningDialog() {
  const members = view?.cleaning?.members || [];
  const options = members.map((member) => `<md-select-option value="${escapeHtml(member.uid)}"><div slot="headline">${escapeHtml(memberLabel(member))}</div></md-select-option>`).join("");
  const dialog = makeDialog("청소당번 직접 배정", `<div class="pincon-duty-dialog__intro"><md-icon>cleaning_services</md-icon><div><strong>${escapeHtml(view?.cleaning?.department?.name || "청소 부서")}</strong><span>${escapeHtml(selectedDate)} 대걸레 당번을 직접 지정합니다.</span></div></div><md-outlined-select id="manualCleaningStudent" label="학생 선택">${options}</md-outlined-select>`, "배정");
  dialog.querySelector("[data-dialog-save]")?.addEventListener("click", async () => {
    const status = dialog.querySelector("[data-dialog-status]");
    const assigneeUid = String(dialog.querySelector("#manualCleaningStudent")?.value || "");
    if (!assigneeUid) { status.textContent = "학생을 선택해주세요."; return; }
    status.textContent = "당번 배정 중…";
    try {
      await request("CLEANING_ASSIGN", { departmentId: selectedDepartmentId, date: selectedDate, assigneeUid });
      recommendation = null;
      await refresh({ force: true });
      dialog.close?.();
    } catch {
      status.textContent = "당번을 배정하지 못했습니다.";
    }
  });
}

async function runAction(button, action, payload, pendingText) {
  const status = root.querySelector("#pinconDutyStatus");
  if (button) button.disabled = true;
  if (status) status.textContent = pendingText;
  try {
    const result = await request(action, payload);
    recommendation = null;
    await refresh({ force: true });
    return result;
  } catch (error) {
    if (status?.isConnected) status.textContent = `처리하지 못했습니다. ${error?.message || "다시 시도해주세요."}`;
    return null;
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}

function bind(section) {
  section.querySelectorAll("[data-duty-role]").forEach((button) => button.addEventListener("click", () => {
    const role = activeRoles().find((item) => item.id === button.dataset.dutyRole);
    if (role) openRoleDialog(role);
  }));
  section.querySelectorAll("[data-duty-department]").forEach((button) => button.addEventListener("click", () => {
    const department = activeDepartments().find((item) => item.id === button.dataset.dutyDepartment);
    if (department) openDepartmentDialog(department);
  }));
  section.querySelector("#pinconCleaningDepartment")?.addEventListener("change", async (event) => {
    selectedDepartmentId = String(event.target.value || "");
    recommendation = null;
    await refresh({ force: true });
  });
  section.querySelector("#pinconCleaningDate")?.addEventListener("change", async (event) => {
    selectedDate = String(event.target.value || todayKey());
    recommendation = null;
    await refresh({ force: true });
  });
  section.querySelector("#pinconCleaningRefresh")?.addEventListener("click", () => refresh({ force: true }));
  section.querySelector("#pinconCleaningManual")?.addEventListener("click", openManualCleaningDialog);
  section.querySelector("#pinconCleaningRecommend")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const status = section.querySelector("#pinconDutyStatus");
    button.disabled = true;
    status.textContent = "공정한 후보를 계산하는 중…";
    try {
      const result = await request("CLEANING_RECOMMEND", { departmentId: selectedDepartmentId, date: selectedDate });
      recommendation = { ...result, departmentId: selectedDepartmentId };
      mount({ force: true });
    } catch (error) {
      status.textContent = error?.message === "no-eligible-cleaning-candidate" ? "배정 가능한 학생이 없습니다." : "추천을 계산하지 못했습니다.";
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  });
  section.querySelector("[data-duty-confirm-recommendation]")?.addEventListener("click", (event) => {
    const uid = recommendation?.candidate?.uid;
    if (uid) void runAction(event.currentTarget, "CLEANING_ASSIGN", { departmentId: selectedDepartmentId, date: selectedDate, assigneeUid: uid }, "추천 학생으로 배정하는 중…");
  });
  section.querySelector("#pinconCleaningAuto")?.addEventListener("click", (event) => void runAction(event.currentTarget, "CLEANING_AUTO_ASSIGN", { departmentId: selectedDepartmentId, date: selectedDate }, "공정 기준으로 자동 배정하는 중…"));
  section.querySelector("#pinconCleaningComplete")?.addEventListener("click", (event) => void runAction(event.currentTarget, "CLEANING_COMPLETE", { departmentId: selectedDepartmentId, date: selectedDate }, "청소 완료로 기록하는 중…"));
  section.querySelector("#pinconCleaningClear")?.addEventListener("click", (event) => void runAction(event.currentTarget, "CLEANING_CLEAR", { departmentId: selectedDepartmentId, date: selectedDate }, "배정을 취소하는 중…"));
}

function mount({ force = false } = {}) {
  const grid = root?.querySelector("#adminMain .admin-grid");
  if (!grid) return;
  const existing = grid.querySelector("#pinconDutyManager");
  if (denied) { existing?.remove(); return; }
  if (!view || (existing && !force)) return;
  existing?.remove();
  const settings = grid.querySelector("#pinconClassOpsSettings");
  if (settings) settings.insertAdjacentHTML("beforebegin", markup());
  else grid.insertAdjacentHTML("afterbegin", markup());
  const section = grid.querySelector("#pinconDutyManager");
  if (section) bind(section);
}

function queueMount() {
  if (mountQueued) return;
  mountQueued = true;
  requestAnimationFrame(() => {
    mountQueued = false;
    if (!root?.querySelector("#adminMain")) return;
    mount();
    void refresh();
  });
}

new MutationObserver(queueMount).observe(root, { childList: true });
queueMount();
