import { readClassProfile } from "../core/data-gateway.js";
import { accountRequest } from "../core/student-auth.js";

const root = document.querySelector("#adminApp");
const LINES = 5;
let assessmentView = null;
let classroomView = null;
let draftOwners = [];
let draftDummies = [];
let tvLabelMode = "both";
let loading = false;
let saving = false;
let queued = false;
let renderSignature = "";
let selectedOwnerUid = "";

const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const classKey = () => readClassProfile()?.classKey || "";
const serverRoster = () => Array.isArray(assessmentView?.roster) ? assessmentView.roster : [];
const realRoster = () => serverRoster().filter((item) => !item.dummy);
const plan = () => assessmentView?.assessmentPlan || {};

function dummyRoster() {
  return draftDummies.map((item) => ({
    uid: item.id,
    id: item.id,
    name: item.name,
    number: 0,
    studentNumber: "",
    dummy: true,
    slotIndex: item.slotIndex,
  }));
}

function roster() {
  return [...realRoster(), ...dummyRoster()];
}

function student(uid) {
  return roster().find((item) => item.uid === uid) || null;
}

function label(uid) {
  const item = student(uid);
  if (!item) return "빈자리";
  if (item.dummy) return `가상 · ${item.name || "자리"}`;
  return `${Number(item.number) || "-"}번 ${item.name || "이름 없음"}`;
}

function verticalIndexes(slotCount) {
  const rows = Math.max(1, Math.ceil(slotCount / LINES));
  const indexes = [];
  for (let column = 0; column < LINES; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const index = row * LINES + column;
      if (index < slotCount) indexes.push(index);
    }
  }
  return indexes;
}

function slotCountFor() {
  const occupants = Math.max(1, realRoster().length + draftDummies.length);
  const requested = draftDummies.reduce((max, item) => Math.max(max, Number(item.slotIndex || 0) + 1), 0);
  return Math.ceil(Math.max(LINES, occupants, requested) / LINES) * LINES;
}

function localSeatOrder() {
  const slotCount = slotCountFor();
  const result = Array(slotCount).fill("");
  const occupied = new Set();
  const order = verticalIndexes(slotCount);

  draftDummies.forEach((dummy) => {
    let target = Math.max(0, Math.min(slotCount - 1, Number(dummy.slotIndex || 0)));
    if (occupied.has(target)) target = order.find((index) => !occupied.has(index)) ?? target;
    dummy.slotIndex = target;
    result[target] = dummy.id;
    occupied.add(target);
  });

  let cursor = 0;
  for (const index of order) {
    if (occupied.has(index)) continue;
    const next = realRoster()[cursor];
    if (!next) break;
    result[index] = next.uid;
    cursor += 1;
  }
  return result;
}

function normalizeDraftOwners() {
  const seatOrder = localSeatOrder();
  const valid = new Set(seatOrder.filter(Boolean));
  const next = Array(seatOrder.length).fill("");
  const used = new Set();
  draftOwners.slice(0, next.length).forEach((uid, index) => {
    if (!uid || !valid.has(uid) || used.has(uid)) return;
    next[index] = uid;
    used.add(uid);
  });
  const missing = seatOrder.filter((uid) => uid && !used.has(uid));
  let cursor = 0;
  for (let index = 0; index < next.length && cursor < missing.length; index += 1) {
    if (next[index]) continue;
    next[index] = missing[cursor++];
  }
  draftOwners = next;
}

function cellCoordinate(index, slotCount = slotCountFor()) {
  const row = Math.floor(index / LINES);
  const column = index % LINES;
  const rows = Math.max(1, Math.ceil(slotCount / LINES));
  return { row, column, rows, text: `${column + 1}열 ${row + 1}행` };
}

function installStyles() {
  if (document.querySelector("#pinconAssessmentV4Styles")) return;
  const style = document.createElement("style");
  style.id = "pinconAssessmentV4Styles";
  style.textContent = `
    .pincon-assessment-v4{margin-top:8px;display:grid;gap:15px}
    .pincon-assessment-v4-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;padding:17px;border:1px solid var(--md-sys-color-outline-variant,#d9ddd7);border-radius:22px;background:var(--md-sys-color-surface-container-low,#f7f8f5)}
    .pincon-assessment-v4-head h3{margin:0 0 5px;font-size:19px}.pincon-assessment-v4-head p{margin:0;color:var(--md-sys-color-on-surface-variant,#636863);font-size:13px;line-height:1.6}
    .pincon-assessment-badge{white-space:nowrap;padding:7px 10px;border-radius:999px;background:var(--md-sys-color-primary-container,#dcebd8);font-size:12px;font-weight:800}
    .pincon-assessment-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:end}.pincon-assessment-toolbar label{display:grid;gap:5px;font-size:12px;font-weight:700}.pincon-assessment-toolbar select,.pincon-assessment-toolbar input{min-height:40px;border:1px solid var(--md-sys-color-outline-variant,#d9ddd7);border-radius:12px;padding:0 11px;background:var(--md-sys-color-surface,#fff);font:inherit}.pincon-assessment-status{margin-left:auto;font-size:12px;color:var(--md-sys-color-on-surface-variant,#666)}
    .pincon-assessment-front{width:min(320px,70%);margin:0 auto;padding:8px 12px;text-align:center;border-radius:999px;background:var(--md-sys-color-primary-container,#dcebd8);font-size:12px;font-weight:800}
    .pincon-assessment-grid{display:grid;grid-template-columns:repeat(5,minmax(132px,1fr));gap:9px;overflow-x:auto;padding-bottom:4px}.pincon-assessment-cell{min-width:0;border:1px solid var(--md-sys-color-outline-variant,#d9ddd7);border-radius:16px;padding:10px;background:var(--md-sys-color-surface,#fff);display:grid;gap:7px}.pincon-assessment-cell[data-dummy='true']{border-style:dashed}.pincon-assessment-cell>small{color:var(--md-sys-color-on-surface-variant,#666);font-size:11px}.pincon-assessment-cell>strong{font-size:13px}.pincon-assessment-cell label{display:grid;gap:4px;font-size:10px;color:var(--md-sys-color-on-surface-variant,#666)}.pincon-assessment-cell select{width:100%;min-height:34px;border:0;border-radius:10px;padding:0 7px;background:var(--md-sys-color-surface-container-low,#f4f6f2);font:inherit;font-size:12px}
    .pincon-dummy-box{display:grid;gap:9px;padding:14px;border:1px solid var(--md-sys-color-outline-variant,#d9ddd7);border-radius:18px}.pincon-dummy-add{display:flex;gap:8px;flex-wrap:wrap;align-items:end}.pincon-dummy-add label{display:grid;gap:5px;min-width:180px;font-size:12px;font-weight:700}.pincon-dummy-add input{min-height:40px;border:1px solid var(--md-sys-color-outline-variant,#d9ddd7);border-radius:12px;padding:0 11px;background:var(--md-sys-color-surface,#fff);font:inherit}.pincon-dummy-list{display:grid;gap:7px}.pincon-dummy-row{display:grid;grid-template-columns:minmax(130px,1fr) minmax(150px,220px) auto;gap:8px;align-items:center;padding:8px 10px;border-radius:12px;background:var(--md-sys-color-surface-container-low,#f6f7f4);font-size:12px}.pincon-dummy-row select{min-height:36px;border:1px solid var(--md-sys-color-outline-variant,#d9ddd7);border-radius:10px;background:var(--md-sys-color-surface,#fff);padding:0 8px}
    .pincon-move-visual{display:grid;gap:10px;padding:14px;border:1px solid var(--md-sys-color-outline-variant,#d9ddd7);border-radius:20px}.pincon-move-visual-head{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}.pincon-move-visual-head h4{margin:0}.pincon-move-selector{min-height:38px;border:1px solid var(--md-sys-color-outline-variant,#d9ddd7);border-radius:11px;padding:0 10px;background:var(--md-sys-color-surface,#fff)}.pincon-move-stage{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:14px;align-items:center}.pincon-move-side{display:grid;gap:7px}.pincon-move-side>strong{text-align:center;font-size:12px}.pincon-mini-grid{display:grid;grid-template-columns:repeat(5,minmax(44px,1fr));gap:5px}.pincon-mini-seat{min-height:48px;border:1px solid var(--md-sys-color-outline-variant,#d9ddd7);border-radius:9px;display:grid;place-items:center;padding:4px;text-align:center;font-size:9px;background:var(--md-sys-color-surface,#fff)}.pincon-mini-seat.is-active{outline:3px solid color-mix(in srgb,var(--md-sys-color-primary,#2f6b3b) 35%,transparent);font-weight:850;background:var(--md-sys-color-primary-container,#dcebd8)}.pincon-move-arrow{font-size:34px;font-weight:300;color:var(--md-sys-color-primary,#2f6b3b)}.pincon-move-caption{text-align:center;font-size:12px;font-weight:760}.pincon-assessment-legacy-hidden{display:none!important}
    @media(max-width:760px){.pincon-assessment-v4-head{flex-direction:column}.pincon-assessment-grid{grid-template-columns:repeat(5,minmax(108px,1fr))}.pincon-assessment-status{width:100%;margin-left:0}.pincon-dummy-row{grid-template-columns:1fr}.pincon-move-stage{grid-template-columns:1fr}.pincon-move-arrow{transform:rotate(90deg);text-align:center}.pincon-mini-grid{grid-template-columns:repeat(5,minmax(38px,1fr))}}
  `;
  document.head.appendChild(style);
}

function panel() {
  return root?.querySelector("#pinconClassroomLayout [data-mode-panel='assessment']") || null;
}

function sourceSeats() {
  return classroomView?.classroomLayout?.general?.seats || [];
}

function sourceSeat(uid) {
  const index = sourceSeats().findIndex((value) => value === uid);
  return index >= 0 ? index : -1;
}

function seatTarget(uid) {
  return localSeatOrder().findIndex((value) => value === uid);
}

function deskTarget(uid) {
  return draftOwners.findIndex((value) => value === uid);
}

function ownerOptions(selectedUid = "") {
  const options = [`<option value="">책상 없음</option>`];
  for (const item of roster()) {
    options.push(`<option value="${esc(item.uid)}" ${item.uid === selectedUid ? "selected" : ""}>${esc(label(item.uid))} 책상</option>`);
  }
  return options.join("");
}

function dummyMarkup() {
  const slots = slotCountFor();
  const optionsFor = (dummy) => Array.from({ length: slots }, (_, index) => `<option value="${index}" ${Number(dummy.slotIndex) === index ? "selected" : ""}>${index + 1}번 자리 · ${cellCoordinate(index, slots).text}</option>`).join("");
  const rows = draftDummies.map((dummy) => `<div class="pincon-dummy-row"><strong>${esc(dummy.name)}</strong><select data-dummy-position="${esc(dummy.id)}">${optionsFor(dummy)}</select><md-text-button data-dummy-remove="${esc(dummy.id)}">삭제</md-text-button></div>`).join("");
  return `<section class="pincon-dummy-box"><div><strong>가상 자리</strong><p class="admin-meta" style="margin:4px 0 0">실제 로그인 계정은 만들지 않습니다. 자리와 책상 배치만 차지합니다.</p></div><div class="pincon-dummy-add"><label>표시 이름<input data-dummy-name maxlength="40" placeholder="예: 빈 책상, 예비 자리"></label><md-outlined-button data-dummy-add><md-icon slot="icon">add</md-icon>가상 자리 추가</md-outlined-button></div><div class="pincon-dummy-list">${rows || '<span class="admin-meta">추가된 가상 자리가 없습니다.</span>'}</div></section>`;
}

function miniGrid(seats, activeUid, type = "source") {
  const slotCount = type === "target" ? slotCountFor() : Math.max(LINES, Math.ceil(Math.max(1, seats.length) / LINES) * LINES);
  return Array.from({ length: slotCount }, (_, index) => {
    const uid = seats[index] || "";
    const active = uid && uid === activeUid;
    const text = uid ? label(uid) : "·";
    return `<div class="pincon-mini-seat ${active ? "is-active" : ""}">${esc(text)}</div>`;
  }).join("");
}

function movementVisualMarkup() {
  const real = realRoster();
  const selected = real.find((item) => item.uid === selectedOwnerUid) || real[0] || null;
  if (selected && !selectedOwnerUid) selectedOwnerUid = selected.uid;
  if (!selected) return "";
  const sourceIndex = sourceSeat(selected.uid);
  const targetIndex = deskTarget(selected.uid);
  const sourceText = sourceIndex >= 0 ? `기본 ${cellCoordinate(sourceIndex, Math.max(LINES, Math.ceil(Math.max(1, sourceSeats().length) / LINES) * LINES)).text}` : "기본 위치 미정";
  const targetText = targetIndex >= 0 ? `수행평가 ${cellCoordinate(targetIndex).text}` : "이동 위치 미정";
  return `<section class="pincon-move-visual"><div class="pincon-move-visual-head"><div><h4>책상 이동 시각화</h4><p class="admin-meta" style="margin:3px 0 0">학생을 선택하면 기본 자리에서 수행평가 책상 위치까지 한눈에 비교합니다.</p></div><select class="pincon-move-selector" data-move-student>${real.map((item) => `<option value="${esc(item.uid)}" ${item.uid === selected.uid ? "selected" : ""}>${esc(label(item.uid))}</option>`).join("")}</select></div><div class="pincon-move-stage"><div class="pincon-move-side"><strong>기본 배치</strong><div class="pincon-mini-grid">${miniGrid(sourceSeats(), selected.uid, "source")}</div></div><div class="pincon-move-arrow">→</div><div class="pincon-move-side"><strong>수행평가 책상 배치</strong><div class="pincon-mini-grid">${miniGrid(draftOwners, selected.uid, "target")}</div></div></div><div class="pincon-move-caption">${esc(label(selected.uid))} 책상 · ${esc(sourceText)} → ${esc(targetText)}</div></section>`;
}

function guideMarkup() {
  const rows = realRoster().map((item) => {
    const seatIndex = seatTarget(item.uid);
    const deskIndex = deskTarget(item.uid);
    const sittingDeskOwner = seatIndex >= 0 ? draftOwners[seatIndex] || "" : "";
    const seatCoord = seatIndex >= 0 ? cellCoordinate(seatIndex).text : "미정";
    const deskCoord = deskIndex >= 0 ? cellCoordinate(deskIndex).text : "미정";
    return `<div class="pincon-dummy-row"><strong>${esc(label(item.uid))}</strong><span>책상 → ${esc(deskCoord)}</span><span>착석 → ${esc(seatCoord)}${sittingDeskOwner ? ` · ${esc(label(sittingDeskOwner))} 책상` : ""}</span></div>`;
  }).join("");
  return `<details class="pincon-dummy-box"><summary style="cursor:pointer;font-weight:800">학생별 책상 이동 + 착석 가이드</summary><div class="pincon-dummy-list" style="margin-top:10px">${rows}</div></details>`;
}

function currentRenderSignature() {
  return JSON.stringify([
    assessmentView?.classKey || "",
    plan().updatedAtMs || 0,
    tvLabelMode,
    draftOwners,
    draftDummies,
    selectedOwnerUid,
    sourceSeats(),
  ]);
}

function render() {
  const hostPanel = panel();
  if (!hostPanel || !assessmentView) return;
  normalizeDraftOwners();
  const nextSignature = currentRenderSignature();
  const existing = hostPanel.querySelector("[data-assessment-v4]");
  if (existing && renderSignature === nextSignature) return;
  renderSignature = nextSignature;

  hostPanel.querySelectorAll(":scope > .pincon-layout-toolbar, :scope > .pincon-layout-actions, :scope > .pincon-layout-front, :scope > .pincon-layout-classroom, :scope > [data-assessment-v3]").forEach((node) => node.classList.add("pincon-assessment-legacy-hidden"));
  existing?.remove();

  const seatOrder = localSeatOrder();
  const slotCount = seatOrder.length;
  const cells = Array.from({ length: slotCount }, (_, index) => {
    const sitterUid = seatOrder[index] || "";
    const ownerUid = draftOwners[index] || "";
    const sitter = student(sitterUid);
    const coord = cellCoordinate(index, slotCount);
    return `<div class="pincon-assessment-cell" data-dummy="${sitter?.dummy === true}"><small>${coord.text} · 자리 ${index + 1}</small><strong>${sitterUid ? `착석 · ${esc(label(sitterUid))}` : "착석 없음"}</strong><label>이 위치로 옮길 책상<select data-assessment-desk-index="${index}">${ownerOptions(ownerUid)}</select></label></div>`;
  }).join("");

  const section = document.createElement("section");
  section.className = "pincon-assessment-v4";
  section.dataset.assessmentV4 = "";
  section.innerHTML = `
    <div class="pincon-assessment-v4-head"><div><h3>5줄 수행평가 이동 설계</h3><p>학생 번호는 각 세로줄에서 위에서 아래로 증가합니다. 책상은 기본 자리와 별개로 원하는 수행평가 위치에 배치할 수 있습니다.</p></div><span class="pincon-assessment-badge">5줄 · 세로 번호순</span></div>
    <div class="pincon-assessment-toolbar"><label>TV에 표시할 이름<select data-assessment-label-mode><option value="student" ${tvLabelMode === "student" ? "selected" : ""}>앉는 학생</option><option value="desk" ${tvLabelMode === "desk" ? "selected" : ""}>책상 주인</option><option value="both" ${tvLabelMode === "both" ? "selected" : ""}>둘 다</option></select></label><md-outlined-button data-assessment-reset>책상도 착석 순서로</md-outlined-button><md-filled-button data-assessment-save><md-icon slot="icon">save</md-icon>수행평가 배치 저장</md-filled-button><span class="pincon-assessment-status" data-assessment-status>학생 ${realRoster().length}명 · 가상 자리 ${draftDummies.length}개</span></div>
    ${dummyMarkup()}
    ${movementVisualMarkup()}
    <div class="pincon-assessment-front">교탁</div>
    <div class="pincon-assessment-grid">${cells}</div>
    ${guideMarkup()}`;
  hostPanel.appendChild(section);
  bind(section);
}

function setStatus(text) {
  const node = panel()?.querySelector("[data-assessment-status]");
  if (node) node.textContent = text;
}

function changeDesk(index, nextUid) {
  if (!Number.isInteger(index) || index < 0 || index >= draftOwners.length) return;
  const previousUid = draftOwners[index] || "";
  if (previousUid === nextUid) return;
  if (!nextUid) draftOwners[index] = "";
  else {
    const other = draftOwners.findIndex((uid, i) => i !== index && uid === nextUid);
    if (other >= 0) draftOwners[other] = previousUid;
    draftOwners[index] = nextUid;
  }
  renderSignature = "";
  render();
  setStatus("변경됨 · 저장 필요");
}

function resetDeskOrder() {
  draftOwners = localSeatOrder().slice();
  renderSignature = "";
  render();
  setStatus("책상을 착석 순서와 같게 맞췄습니다 · 저장 필요");
}

function addDummy(section) {
  const input = section.querySelector("[data-dummy-name]");
  const name = String(input?.value || "").trim() || `가상 자리 ${draftDummies.length + 1}`;
  const current = localSeatOrder();
  let target = current.findIndex((uid) => !uid);
  if (target < 0) target = current.length;
  draftDummies.push({ id: `dummy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, name: name.slice(0, 40), slotIndex: target });
  if (input) input.value = "";
  normalizeDraftOwners();
  renderSignature = "";
  render();
  setStatus("가상 자리를 추가했습니다 · 저장 필요");
}

function removeDummy(id) {
  draftDummies = draftDummies.filter((item) => item.id !== id);
  draftOwners = draftOwners.filter((uid) => uid !== id);
  normalizeDraftOwners();
  renderSignature = "";
  render();
  setStatus("가상 자리를 삭제했습니다 · 저장 필요");
}

function moveDummy(id, slotIndex) {
  const dummy = draftDummies.find((item) => item.id === id);
  if (!dummy) return;
  const other = draftDummies.find((item) => item.id !== id && Number(item.slotIndex) === slotIndex);
  if (other) other.slotIndex = dummy.slotIndex;
  dummy.slotIndex = slotIndex;
  normalizeDraftOwners();
  renderSignature = "";
  render();
  setStatus("가상 자리 위치를 바꿨습니다 · 저장 필요");
}

function bind(section) {
  section.querySelectorAll("[data-assessment-desk-index]").forEach((select) => select.addEventListener("change", () => changeDesk(Number(select.dataset.assessmentDeskIndex), select.value)));
  section.querySelector("[data-assessment-label-mode]")?.addEventListener("change", (event) => {
    tvLabelMode = ["student", "desk", "both"].includes(event.target.value) ? event.target.value : "both";
    renderSignature = "";
    render();
    setStatus("TV 표시 방식 변경됨 · 저장 필요");
  });
  section.querySelector("[data-assessment-reset]")?.addEventListener("click", resetDeskOrder);
  section.querySelector("[data-assessment-save]")?.addEventListener("click", save);
  section.querySelector("[data-dummy-add]")?.addEventListener("click", () => addDummy(section));
  section.querySelectorAll("[data-dummy-remove]").forEach((button) => button.addEventListener("click", () => removeDummy(button.dataset.dummyRemove)));
  section.querySelectorAll("[data-dummy-position]").forEach((select) => select.addEventListener("change", () => moveDummy(select.dataset.dummyPosition, Number(select.value))));
  section.querySelector("[data-move-student]")?.addEventListener("change", (event) => {
    selectedOwnerUid = event.target.value;
    renderSignature = "";
    render();
  });
}

async function refresh() {
  const target = classKey();
  if (!target) return false;
  const [nextAssessment, nextClassroom] = await Promise.all([
    accountRequest(`/api/class-ops/assessment-layout?classKey=${encodeURIComponent(target)}`),
    accountRequest(`/api/class-ops/classroom-layout?classKey=${encodeURIComponent(target)}`),
  ]);
  assessmentView = nextAssessment;
  classroomView = nextClassroom;
  draftDummies = Array.isArray(plan().dummies) ? plan().dummies.map((item) => ({ ...item })) : [];
  draftOwners = Array.isArray(plan().deskOwners) ? plan().deskOwners.slice() : [];
  tvLabelMode = ["student", "desk", "both"].includes(plan().tvLabelMode) ? plan().tvLabelMode : "both";
  selectedOwnerUid = realRoster()[0]?.uid || "";
  normalizeDraftOwners();
  renderSignature = "";
  return true;
}

async function save() {
  if (saving || !assessmentView?.permissions?.canEdit) return;
  saving = true;
  setStatus("저장 중…");
  try {
    normalizeDraftOwners();
    const result = await accountRequest("/api/class-ops/assessment-layout", {
      method: "POST",
      body: {
        action: "SAVE",
        classKey: assessmentView.classKey || classKey(),
        dummies: draftDummies,
        deskOwners: draftOwners,
        tvLabelMode,
      },
    });
    assessmentView = result;
    draftDummies = Array.isArray(result.assessmentPlan.dummies) ? result.assessmentPlan.dummies.map((item) => ({ ...item })) : [];
    draftOwners = result.assessmentPlan.deskOwners.slice();
    tvLabelMode = result.assessmentPlan.tvLabelMode;
    renderSignature = "";
    render();
    setStatus("저장했습니다 · TV와 교실 화면에 즉시 반영됩니다.");
  } catch (error) {
    console.warn("[PinCon] assessment layout save failed", error);
    setStatus(error?.message || "저장하지 못했습니다.");
  } finally {
    saving = false;
  }
}

async function mount() {
  installStyles();
  if (!panel()) return;
  if (!assessmentView && !loading) {
    loading = true;
    try { await refresh(); } catch (error) { console.warn("[PinCon] assessment layout load failed", error); }
    finally { loading = false; }
  }
  render();
}

function queue() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; mount(); });
}

new MutationObserver(queue).observe(root, { childList: true, subtree: true });
queue();
