import { readClassProfile } from "../core/data-gateway.js";
import { accountRequest } from "../core/student-auth.js";

const root = document.querySelector("#adminApp");
let assessmentView = null;
let classroomView = null;
let draftOwners = [];
let tvLabelMode = "both";
let loading = false;
let saving = false;
let queued = false;
let renderSignature = "";

const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const classKey = () => readClassProfile()?.classKey || "";
const roster = () => Array.isArray(assessmentView?.roster) ? assessmentView.roster : [];
const plan = () => assessmentView?.assessmentPlan || {};
const student = (uid) => roster().find((item) => item.uid === uid) || null;
const label = (uid) => {
  const item = student(uid);
  return item ? `${Number(item.number) || "-"}번 ${item.name || "이름 없음"}` : "빈자리";
};

function installStyles() {
  if (document.querySelector("#pinconAssessmentV3Styles")) return;
  const style = document.createElement("style");
  style.id = "pinconAssessmentV3Styles";
  style.textContent = `
    .pincon-assessment-v3{margin-top:8px;display:grid;gap:14px}
    .pincon-assessment-v3-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;padding:16px;border:1px solid var(--md-sys-color-outline-variant,#d9ddd7);border-radius:20px;background:var(--md-sys-color-surface-container-low,#f7f8f5)}
    .pincon-assessment-v3-head h3{margin:0 0 5px;font-size:18px}.pincon-assessment-v3-head p{margin:0;color:var(--md-sys-color-on-surface-variant,#636863);font-size:13px;line-height:1.55}
    .pincon-assessment-badge{white-space:nowrap;padding:7px 10px;border-radius:999px;background:var(--md-sys-color-primary-container,#dcebd8);font-size:12px;font-weight:800}
    .pincon-assessment-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:end}
    .pincon-assessment-toolbar label{display:grid;gap:5px;font-size:12px;font-weight:700}.pincon-assessment-toolbar select{min-height:40px;border:1px solid var(--md-sys-color-outline-variant,#d9ddd7);border-radius:12px;padding:0 11px;background:var(--md-sys-color-surface,#fff);font:inherit}
    .pincon-assessment-status{margin-left:auto;font-size:12px;color:var(--md-sys-color-on-surface-variant,#666)}
    .pincon-assessment-front{width:min(320px,70%);margin:0 auto;padding:8px 12px;text-align:center;border-radius:999px;background:var(--md-sys-color-primary-container,#dcebd8);font-size:12px;font-weight:800}
    .pincon-assessment-grid{display:grid;grid-template-columns:repeat(5,minmax(128px,1fr));gap:9px;overflow-x:auto;padding-bottom:4px}
    .pincon-assessment-cell{min-width:0;border:1px solid var(--md-sys-color-outline-variant,#d9ddd7);border-radius:16px;padding:10px;background:var(--md-sys-color-surface,#fff);display:grid;gap:7px}
    .pincon-assessment-cell>small{color:var(--md-sys-color-on-surface-variant,#666);font-size:11px}.pincon-assessment-cell>strong{font-size:13px}.pincon-assessment-cell label{display:grid;gap:4px;font-size:10px;color:var(--md-sys-color-on-surface-variant,#666)}
    .pincon-assessment-cell select{width:100%;min-height:34px;border:0;border-radius:10px;padding:0 7px;background:var(--md-sys-color-surface-container-low,#f4f6f2);font:inherit;font-size:12px}
    .pincon-assessment-guide{border:1px solid var(--md-sys-color-outline-variant,#d9ddd7);border-radius:18px;padding:0 14px}.pincon-assessment-guide summary{cursor:pointer;padding:13px 0;font-weight:800}.pincon-assessment-guide-list{display:grid;gap:7px;padding:0 0 14px}.pincon-assessment-guide-row{display:grid;grid-template-columns:minmax(150px,.8fr) 1fr 1fr;gap:10px;padding:9px 10px;border-radius:12px;background:var(--md-sys-color-surface-container-low,#f6f7f4);font-size:12px}.pincon-assessment-guide-row span:last-child{font-weight:700}
    .pincon-assessment-legacy-hidden{display:none!important}
    @media(max-width:760px){.pincon-assessment-v3-head{flex-direction:column}.pincon-assessment-grid{grid-template-columns:repeat(5,minmax(105px,1fr))}.pincon-assessment-guide-row{grid-template-columns:1fr}.pincon-assessment-status{width:100%;margin-left:0}}
  `;
  document.head.appendChild(style);
}

function panel() {
  return root?.querySelector("#pinconClassroomLayout [data-mode-panel='assessment']") || null;
}

function sourceSeat(uid) {
  const seats = classroomView?.classroomLayout?.general?.seats || [];
  const index = seats.findIndex((value) => value === uid);
  return index >= 0 ? `일반 자리 ${index + 1}` : "현재 책상 위치 미정";
}

function seatTarget(uid) {
  return (plan().seatOrder || []).findIndex((value) => value === uid);
}

function ownerOptions(selectedUid = "") {
  const options = [`<option value="">책상 없음</option>`];
  for (const item of roster()) {
    options.push(`<option value="${esc(item.uid)}" ${item.uid === selectedUid ? "selected" : ""}>${esc(label(item.uid))} 책상</option>`);
  }
  return options.join("");
}

function guideMarkup() {
  const rows = roster().map((item) => {
    const seatIndex = seatTarget(item.uid);
    const deskIndex = draftOwners.findIndex((uid) => uid === item.uid);
    const sittingDeskOwner = seatIndex >= 0 ? draftOwners[seatIndex] || "" : "";
    return `<div class="pincon-assessment-guide-row"><strong>${esc(label(item.uid))}</strong><span>책상: ${esc(sourceSeat(item.uid))} → ${deskIndex >= 0 ? `수행평가 자리 ${deskIndex + 1}` : "미정"}</span><span>착석: 수행평가 자리 ${seatIndex + 1}${sittingDeskOwner ? ` · ${esc(label(sittingDeskOwner))} 책상` : ""}</span></div>`;
  }).join("");
  return `<details class="pincon-assessment-guide"><summary>학생별 책상 이동 + 착석 가이드</summary><div class="pincon-assessment-guide-list">${rows}</div></details>`;
}

function currentRenderSignature() {
  return JSON.stringify([
    assessmentView?.classKey || "",
    plan().updatedAtMs || 0,
    tvLabelMode,
    draftOwners,
    classroomView?.classroomLayout?.general?.seats || [],
  ]);
}

function render() {
  const hostPanel = panel();
  if (!hostPanel || !assessmentView) return;
  const nextSignature = currentRenderSignature();
  const existing = hostPanel.querySelector("[data-assessment-v3]");
  if (existing && renderSignature === nextSignature) return;
  renderSignature = nextSignature;

  hostPanel.querySelectorAll(":scope > .pincon-layout-toolbar, :scope > .pincon-layout-actions, :scope > .pincon-layout-front, :scope > .pincon-layout-classroom").forEach((node) => node.classList.add("pincon-assessment-legacy-hidden"));
  existing?.remove();

  const slotCount = Number(plan().slotCount || Math.ceil(Math.max(1, roster().length) / 5) * 5);
  const seatOrder = Array.isArray(plan().seatOrder) ? plan().seatOrder : [];
  const cells = Array.from({ length: slotCount }, (_, index) => {
    const sitterUid = seatOrder[index] || "";
    const ownerUid = draftOwners[index] || "";
    return `<div class="pincon-assessment-cell"><small>수행평가 자리 ${index + 1}</small><strong>${sitterUid ? `착석 · ${esc(label(sitterUid))}` : "착석 없음"}</strong><label>이 자리에 놓을 책상<select data-assessment-desk-index="${index}">${ownerOptions(ownerUid)}</select></label></div>`;
  }).join("");

  const section = document.createElement("section");
  section.className = "pincon-assessment-v3";
  section.dataset.assessmentV3 = "";
  section.innerHTML = `
    <div class="pincon-assessment-v3-head"><div><h3>5줄 수행평가 이동 설계</h3><p>학생은 번호순으로 앉습니다. 책상은 원하는 위치로 옮길 수 있으며 책상 주인과 실제 착석 학생은 서로 달라도 됩니다.</p></div><span class="pincon-assessment-badge">5줄 · 번호순 고정</span></div>
    <div class="pincon-assessment-toolbar">
      <label>TV에 표시할 이름<select data-assessment-label-mode><option value="student" ${tvLabelMode === "student" ? "selected" : ""}>앉는 학생</option><option value="desk" ${tvLabelMode === "desk" ? "selected" : ""}>책상 주인</option><option value="both" ${tvLabelMode === "both" ? "selected" : ""}>둘 다</option></select></label>
      <md-outlined-button data-assessment-reset>책상도 번호순</md-outlined-button>
      <md-filled-button data-assessment-save><md-icon slot="icon">save</md-icon>수행평가 배치 저장</md-filled-button>
      <span class="pincon-assessment-status" data-assessment-status>학생 ${roster().length}명 · 책상 ${draftOwners.filter(Boolean).length}개</span>
    </div>
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
  if (!nextUid) {
    draftOwners[index] = "";
  } else {
    const other = draftOwners.findIndex((uid, i) => i !== index && uid === nextUid);
    if (other >= 0) draftOwners[other] = previousUid;
    draftOwners[index] = nextUid;
  }
  renderSignature = "";
  render();
  setStatus("변경됨 · 저장 필요");
}

function resetDeskOrder() {
  const slots = Number(plan().slotCount || 0);
  draftOwners = Array(slots).fill("");
  (plan().seatOrder || []).forEach((uid, index) => { draftOwners[index] = uid; });
  renderSignature = "";
  render();
  setStatus("책상을 번호순으로 맞췄습니다 · 저장 필요");
}

function bind(section) {
  section.querySelectorAll("[data-assessment-desk-index]").forEach((select) => select.addEventListener("change", () => changeDesk(Number(select.dataset.assessmentDeskIndex), select.value)));
  section.querySelector("[data-assessment-label-mode]")?.addEventListener("change", (event) => {
    tvLabelMode = ["student", "desk", "both"].includes(event.target.value) ? event.target.value : "both";
    renderSignature = currentRenderSignature();
    setStatus("TV 표시 방식 변경됨 · 저장 필요");
  });
  section.querySelector("[data-assessment-reset]")?.addEventListener("click", resetDeskOrder);
  section.querySelector("[data-assessment-save]")?.addEventListener("click", save);
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
  draftOwners = Array.isArray(plan().deskOwners) ? plan().deskOwners.slice() : [];
  tvLabelMode = ["student", "desk", "both"].includes(plan().tvLabelMode) ? plan().tvLabelMode : "both";
  renderSignature = "";
  return true;
}

async function save() {
  if (saving || !assessmentView?.permissions?.canEdit) return;
  saving = true;
  setStatus("저장 중…");
  try {
    const result = await accountRequest("/api/class-ops/assessment-layout", {
      method: "POST",
      body: {
        action: "SAVE",
        classKey: assessmentView.classKey || classKey(),
        deskOwners: draftOwners,
        tvLabelMode,
      },
    });
    assessmentView = result;
    draftOwners = result.assessmentPlan.deskOwners.slice();
    tvLabelMode = result.assessmentPlan.tvLabelMode;
    renderSignature = "";
    render();
    setStatus("저장했습니다 · TV와 교실 화면에 즉시 반영됩니다.");
  } catch (error) {
    console.warn("[PinCon] assessment layout save failed", error);
    setStatus("저장하지 못했습니다.");
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
