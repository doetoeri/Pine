import { readClassProfile } from "../core/data-gateway.js";
import { accountRequest } from "../core/student-auth.js";

const root = document.querySelector("#adminApp");
let view = null;
let state = null;
let loading = false;
let saving = false;
let selectedDesk = 0;
let queued = false;

const MODES = Object.freeze({ general: "일반", groups: "모둠", assessment: "수행평가" });
const ROTATIONS = [0, 90, 180, 270];
const ARROW = Object.freeze({ 0: "↑", 90: "→", 180: "↓", 270: "←" });
const DIRECTION = Object.freeze({ 0: "교탁 방향", 90: "오른쪽", 180: "뒤쪽", 270: "왼쪽" });

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const classKey = () => readClassProfile()?.classKey || "";
const roster = () => Array.isArray(view?.roster) ? view.roster : [];
const student = (uid) => roster().find((item) => item.uid === uid) || null;
const studentLabel = (uid) => { const item = student(uid); return item ? `${Number(item.number) || "-"}번 ${item.name || "이름 없음"}` : "학생 없음"; };

function shuffle(values) {
  const out = values.slice();
  for (let index = out.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [out[index], out[target]] = [out[target], out[index]];
  }
  return out;
}

function evenSizes(total, count) {
  const groups = Math.max(1, Math.min(12, Number(count) || 1));
  const base = Math.floor(total / groups);
  const rest = total % groups;
  return Array.from({ length: groups }, (_, index) => base + (index < rest ? 1 : 0));
}

function defaultDesks(total, groupCount, sizes) {
  const desks = [];
  let index = 0;
  for (let group = 1; group <= groupCount && index < total; group += 1) {
    const size = Number(sizes[group - 1]) || 0;
    for (let member = 0; member < size && index < total; member += 1) {
      desks.push({ index, group, rotation: member % 2 === 0 ? 90 : 270 });
      index += 1;
    }
  }
  while (index < total) {
    desks.push({ index, group: 1 + (index % Math.max(groupCount, 1)), rotation: 0 });
    index += 1;
  }
  return desks;
}

function freshState() {
  const total = roster().length;
  const groupCount = Math.max(1, Math.min(12, Math.ceil(total / 4) || 1));
  const sizes = evenSizes(total, groupCount);
  return {
    schemaVersion: 1,
    mode: "general",
    general: { rows: 6, cols: 6, seats: [], blocked: total <= 34 ? [34, 35] : [], focusStudentIds: [], separationPairs: [], nominations: [] },
    groups: { groupCount, sizes, members: [], deskRows: 6, deskCols: 6, desks: defaultDesks(total, groupCount, sizes) },
    assessment: { lines: 6, seats: [] },
  };
}

function normalize(value) {
  const base = freshState();
  const input = value && typeof value === "object" ? value : {};
  const general = input.general || {};
  const groups = input.groups || {};
  const assessment = input.assessment || {};
  const groupCount = Math.max(1, Math.min(12, Number(groups.groupCount) || base.groups.groupCount));
  return {
    schemaVersion: 1,
    mode: Object.hasOwn(MODES, input.mode) ? input.mode : "general",
    general: {
      rows: Math.max(3, Math.min(10, Number(general.rows) || 6)), cols: Math.max(3, Math.min(10, Number(general.cols) || 6)),
      seats: Array.isArray(general.seats) ? general.seats.slice(0, 100).map((uid) => String(uid || "")) : [],
      blocked: Array.isArray(general.blocked) ? [...new Set(general.blocked.map(Number).filter(Number.isInteger))].slice(0, 30) : [],
      focusStudentIds: Array.isArray(general.focusStudentIds) ? [...new Set(general.focusStudentIds)].slice(0, 60) : [],
      separationPairs: Array.isArray(general.separationPairs) ? general.separationPairs.filter((pair) => Array.isArray(pair) && pair.length === 2 && pair[0] !== pair[1]).slice(0, 100) : [],
      nominations: Array.isArray(general.nominations) ? general.nominations.slice(0, 200) : [],
    },
    groups: {
      groupCount,
      sizes: Array.from({ length: groupCount }, (_, index) => Math.max(0, Math.min(12, Number(groups.sizes?.[index]) || 0))),
      members: Array.isArray(groups.members) ? groups.members.slice(0, groupCount).map((items) => Array.isArray(items) ? items.filter(Boolean).slice(0, 12) : []) : [],
      deskRows: Math.max(3, Math.min(10, Number(groups.deskRows) || 6)), deskCols: Math.max(3, Math.min(10, Number(groups.deskCols) || 6)),
      desks: Array.isArray(groups.desks) ? groups.desks.slice(0, 60).map((desk, index) => ({ index: Math.max(0, Math.min(99, Number(desk?.index) || index)), group: Math.max(1, Math.min(groupCount, Number(desk?.group) || 1)), rotation: ROTATIONS.includes(Number(desk?.rotation)) ? Number(desk.rotation) : 0 })) : [],
    },
    assessment: { lines: Number(assessment.lines) === 5 ? 5 : 6, seats: Array.isArray(assessment.seats) ? assessment.seats.slice(0, 100).map((uid) => String(uid || "")) : [] },
  };
}

function pairKey(a, b) { return [a, b].sort().join("|"); }
function pairSet() { return new Set((state.general.separationPairs || []).map(([a, b]) => pairKey(a, b))); }

function groupPenalty(groups) {
  const separated = pairSet();
  const focus = new Set(state.general.focusStudentIds || []);
  let penalty = 0;
  for (const group of groups) {
    for (let a = 0; a < group.length; a += 1) for (let b = a + 1; b < group.length; b += 1) if (separated.has(pairKey(group[a], group[b]))) penalty += 1000;
  }
  const focusCounts = groups.map((group) => group.filter((uid) => focus.has(uid)).length);
  if (focusCounts.length) penalty += (Math.max(...focusCounts) - Math.min(...focusCounts)) * 30;
  return penalty;
}

function generateGroups() {
  const ids = roster().map((item) => item.uid);
  const sizes = state.groups.sizes.map(Number);
  if (sizes.reduce((sum, size) => sum + size, 0) !== ids.length) return false;
  let best = []; let bestPenalty = Infinity;
  for (let attempt = 0; attempt < 3500; attempt += 1) {
    const pool = shuffle(ids); const groups = []; let cursor = 0;
    for (const size of sizes) { groups.push(pool.slice(cursor, cursor + size)); cursor += size; }
    const penalty = groupPenalty(groups);
    if (penalty < bestPenalty) { best = groups; bestPenalty = penalty; if (!penalty) break; }
  }
  state.groups.members = best;
  return true;
}

function seatPenalty(seats, cols) {
  const positions = new Map(); seats.forEach((uid, index) => { if (uid) positions.set(uid, index); });
  const distance = (a, b) => Math.max(Math.abs(Math.floor(a / cols) - Math.floor(b / cols)), Math.abs((a % cols) - (b % cols)));
  let penalty = 0;
  for (const [a, b] of state.general.separationPairs || []) if (positions.has(a) && positions.has(b) && distance(positions.get(a), positions.get(b)) <= 1) penalty += 1000;
  const focused = (state.general.focusStudentIds || []).filter((uid) => positions.has(uid));
  for (let a = 0; a < focused.length; a += 1) for (let b = a + 1; b < focused.length; b += 1) if (distance(positions.get(focused[a]), positions.get(focused[b])) <= 1) penalty += 500;
  return penalty;
}

function generateGeneral() {
  const { rows, cols } = state.general;
  const blocked = new Set(state.general.blocked);
  const slots = Array.from({ length: rows * cols }, (_, index) => index).filter((index) => !blocked.has(index));
  const ids = roster().map((item) => item.uid);
  if (slots.length < ids.length) return false;
  let best = []; let bestPenalty = Infinity;
  for (let attempt = 0; attempt < 3000; attempt += 1) {
    const pool = shuffle(ids); const seats = Array(rows * cols).fill("");
    slots.forEach((slot, index) => { seats[slot] = pool[index] || ""; });
    const penalty = seatPenalty(seats, cols);
    if (penalty < bestPenalty) { best = seats; bestPenalty = penalty; if (!penalty) break; }
  }
  state.general.seats = best;
  return true;
}

function generateAssessment() {
  const lines = state.assessment.lines === 5 ? 5 : 6;
  const ids = shuffle(roster().map((item) => item.uid));
  const rows = Math.max(1, Math.ceil(ids.length / lines));
  state.assessment.seats = Array(rows * lines).fill("");
  ids.forEach((uid, index) => { state.assessment.seats[index] = uid; });
}

function classroom(seats, rows, cols, blocked = new Set(), editable = false) {
  const cells = Array.from({ length: rows * cols }, (_, index) => {
    if (blocked.has(index)) return `<button type="button" class="pincon-layout-seat is-blocked" ${editable ? `data-block="${index}"` : "disabled"}><small>${index + 1}</small><strong>사용 안 함</strong><span></span></button>`;
    const uid = seats?.[index] || ""; const item = student(uid);
    return `<button type="button" class="pincon-layout-seat" ${editable ? `data-block="${index}"` : "disabled"}><small>${index + 1}</small><strong>${escapeHtml(item?.name || "빈자리")}</strong><span>${item ? `${Number(item.number) || "-"}번` : ""}</span></button>`;
  }).join("");
  return `<div class="pincon-layout-front">교탁</div><div class="pincon-layout-classroom" style="--layout-cols:${cols}">${cells}</div>`;
}

function options() { return `<option value="">학생 선택</option>${roster().map((item) => `<option value="${escapeHtml(item.uid)}">${escapeHtml(studentLabel(item.uid))}</option>`).join("")}`; }
function focusChips() {
  const selected = new Set(state.general.focusStudentIds);
  return `<div class="pincon-layout-student-grid">${roster().map((item) => `<button type="button" class="pincon-layout-student-chip" data-focus="${escapeHtml(item.uid)}" data-selected="${selected.has(item.uid)}"><span>${Number(item.number) || "-"}</span><strong>${escapeHtml(item.name || "이름 없음")}</strong><md-icon>${selected.has(item.uid) ? "check_circle" : "radio_button_unchecked"}</md-icon></button>`).join("")}</div>`;
}

function generalPanel() {
  const g = state.general; const available = g.rows * g.cols - g.blocked.filter((index) => index < g.rows * g.cols).length;
  return `<div class="pincon-layout-mode" data-mode-panel="general"><div class="pincon-layout-toolbar"><div><h3>일반 자리배치</h3><p>무작위 배치에 최종 지정 학생 분산과 승인된 분리 조합을 반영합니다.</p></div><div class="pincon-layout-inline-fields"><label>행<input type="number" min="3" max="10" value="${g.rows}" data-rows></label><label>열<input type="number" min="3" max="10" value="${g.cols}" data-cols></label></div></div><div class="pincon-layout-actions"><md-filled-button data-generate-general><md-icon slot="icon">casino</md-icon>자리 생성</md-filled-button><md-outlined-button data-clear-general>배치 비우기</md-outlined-button><span class="pincon-layout-meta">사용 가능 ${available}석 · 학생 ${roster().length}명</span></div>${classroom(g.seats,g.rows,g.cols,new Set(g.blocked),true)}<details class="pincon-layout-constraints"><summary><span><md-icon>lock</md-icon><strong>비공개 좌석 조정 조건</strong></span><small>학생용 화면에는 표시하지 않음</small></summary><div class="pincon-layout-constraint-grid"><section><h4>최종 지정 학생</h4><p>서로 최대한 인접하지 않도록 분산합니다.</p>${focusChips()}</section><section><h4>분리 조합</h4><p>승인된 두 학생이 붙지 않도록 배치합니다.</p><div class="pincon-layout-pair-form"><select data-pair-a>${options()}</select><select data-pair-b>${options()}</select><button type="button" data-add-pair>추가</button></div><div class="pincon-layout-pair-list">${g.separationPairs.length ? g.separationPairs.map(([a,b],index)=>`<div><span>${escapeHtml(studentLabel(a))} ↔ ${escapeHtml(studentLabel(b))}</span><button type="button" data-remove-pair="${index}"><md-icon>close</md-icon></button></div>`).join("") : `<p class="pincon-layout-empty">분리 조합이 없습니다.</p>`}</div></section></div></details></div>`;
}

function memberCards() {
  return state.groups.members.length ? `<div class="pincon-layout-group-cards">${state.groups.members.map((group,index)=>`<article><header><strong>${index+1}모둠</strong><span>${group.length}/${state.groups.sizes[index]||0}명</span></header><div>${group.map((uid)=>`<span>${escapeHtml(studentLabel(uid))}</span>`).join("")}</div></article>`).join("")}</div>` : `<div class="pincon-layout-empty">정원 합계를 맞춘 뒤 학생 자동 배정을 실행하세요.</div>`;
}

function deskEditor() {
  const g = state.groups; const byIndex = new Map(g.desks.map((desk)=>[desk.index,desk]));
  const cells = Array.from({length:g.deskRows*g.deskCols},(_,index)=>{ const desk=byIndex.get(index); return desk ? `<button type="button" class="pincon-layout-desk ${selectedDesk===index?"is-selected":""}" data-desk="${index}"><small>책상 ${index+1}</small><strong>${desk.group}모둠</strong><b>${ARROW[desk.rotation]||"↑"}</b></button>` : `<button type="button" class="pincon-layout-desk is-empty ${selectedDesk===index?"is-selected":""}" data-desk="${index}"><small>${index+1}</small><span>빈 칸</span></button>`; }).join("");
  const selected = g.desks.find((desk)=>desk.index===selectedDesk);
  const aside = selected ? `<h4>책상 ${selected.index+1}</h4><label>소속 모둠<select data-desk-group>${Array.from({length:g.groupCount},(_,index)=>`<option value="${index+1}" ${selected.group===index+1?"selected":""}>${index+1}모둠</option>`).join("")}</select></label><div class="pincon-layout-rotation"><span>방향</span>${ROTATIONS.map((rotation)=>`<button type="button" data-rotate="${rotation}" data-selected="${selected.rotation===rotation}">${ARROW[rotation]}</button>`).join("")}</div><md-text-button data-remove-desk>책상 비우기</md-text-button>` : `<h4>빈 칸 ${selectedDesk+1}</h4><p>이 위치에 책상을 추가합니다.</p><md-filled-tonal-button data-add-desk>책상 추가</md-filled-tonal-button>`;
  return `<div class="pincon-layout-desk-editor"><div><div class="pincon-layout-front">교탁</div><div class="pincon-layout-desk-grid" style="--layout-cols:${g.deskCols}">${cells}</div></div><aside>${aside}</aside></div>`;
}

function deskGuide() {
  const desks = state.groups.desks.slice().sort((a,b)=>a.group-b.group||a.index-b.index);
  return `<details class="pincon-layout-constraints"><summary><span><md-icon>moving</md-icon><strong>책상 이동 가이드</strong></span><small>${desks.length}개 책상</small></summary><div class="pincon-layout-pair-list">${desks.map((desk)=>`<div><span>책상 ${desk.index+1} → ${desk.group}모둠</span><strong>${ARROW[desk.rotation]} ${DIRECTION[desk.rotation]}</strong></div>`).join("")}</div></details>`;
}

function groupsPanel() {
  const g=state.groups; const total=g.sizes.reduce((sum,size)=>sum+Number(size||0),0); const valid=total===roster().length;
  return `<div class="pincon-layout-mode" data-mode-panel="groups"><div class="pincon-layout-toolbar"><div><h3>모둠 배치</h3><p>모둠 수, 모둠별 인원, 책상 위치와 방향을 모두 직접 정합니다.</p></div><label class="pincon-layout-main-field">모둠 개수<input type="number" min="1" max="12" value="${g.groupCount}" data-group-count></label></div><div class="pincon-layout-group-config"><section><header><h4>모둠별 정원</h4><span data-size-status data-valid="${valid}">${total}/${roster().length}명</span></header><div class="pincon-layout-size-list">${g.sizes.map((size,index)=>`<label class="pincon-layout-size-row"><span>${index+1}모둠</span><input type="number" min="0" max="12" value="${size}" data-group-size="${index}"><small>명</small></label>`).join("")}</div><div class="pincon-layout-actions"><md-filled-tonal-button data-even>균등하게 나누기</md-filled-tonal-button><md-filled-button data-generate-groups ${valid?"":"disabled"}>학생 자동 배정</md-filled-button></div></section><section><header><h4>학생 배정 결과</h4><span>${g.members.length?`${g.members.length}개 모둠`:"미생성"}</span></header>${memberCards()}</section></div><div class="pincon-layout-desk-head"><div><h4>책상 배치 편집기</h4><p>책상을 눌러 소속 모둠과 회전 방향을 직접 바꿉니다.</p></div><div class="pincon-layout-inline-fields"><label>행<input type="number" min="3" max="10" value="${g.deskRows}" data-desk-rows></label><label>열<input type="number" min="3" max="10" value="${g.deskCols}" data-desk-cols></label><md-outlined-button data-auto-desks>정원대로 자동 배치</md-outlined-button></div></div>${deskEditor()}${deskGuide()}</div>`;
}

function assessmentPanel() {
  const lines=state.assessment.lines===5?5:6; const rows=Math.max(1,Math.ceil(roster().length/lines)); const seats=state.assessment.seats.length?state.assessment.seats:Array(rows*lines).fill("");
  return `<div class="pincon-layout-mode" data-mode-panel="assessment"><div class="pincon-layout-toolbar"><div><h3>수행평가 배치</h3><p>실제 교실 배치에 맞춰 5줄 버전과 6줄 버전을 따로 생성합니다.</p></div><div class="pincon-layout-assessment-switch"><button type="button" data-assessment-lines="5" data-selected="${lines===5}">5줄</button><button type="button" data-assessment-lines="6" data-selected="${lines===6}">6줄</button></div></div><div class="pincon-layout-actions"><md-filled-button data-generate-assessment><md-icon slot="icon">shuffle</md-icon>${lines}줄 무작위 배치</md-filled-button><md-outlined-button data-clear-assessment>배치 비우기</md-outlined-button><span class="pincon-layout-meta">${lines}줄 × ${rows}행 · 학생 ${roster().length}명</span></div>${classroom(seats,rows,lines)}</div>`;
}

function markup() {
  if (!state || !view) return "";
  return `<section class="admin-card admin-card--wide pincon-classroom-layout" id="pinconClassroomLayout" aria-labelledby="pincon-classroom-layout-title"><header class="pincon-layout-header"><div><span class="pincon-layout-eyebrow">CLASSROOM LAYOUT</span><h2 id="pincon-classroom-layout-title">교실 배치</h2><p>${escapeHtml(view.classKey)} · PinCon 계정 명단 ${roster().length}명 연동</p></div><div class="pincon-layout-save"><span data-layout-status role="status"></span><md-filled-button data-save-layout ${saving?"disabled":""}><md-icon slot="icon">save</md-icon>저장</md-filled-button></div></header><div class="pincon-layout-tabs" role="tablist">${Object.entries(MODES).map(([key,label])=>`<button type="button" class="pincon-layout-tab" data-layout-mode="${key}" aria-selected="${state.mode===key}"><md-icon>${key==="general"?"event_seat":key==="groups"?"groups":"fact_check"}</md-icon>${label}</button>`).join("")}</div>${state.mode==="general"?generalPanel():state.mode==="groups"?groupsPanel():assessmentPanel()}</section>`;
}

function rerender() { const section=root?.querySelector("#pinconClassroomLayout"); if(!section)return mount({force:true}); section.outerHTML=markup(); bind(root.querySelector("#pinconClassroomLayout")); }
function resetGroupCount(value) { const count=Math.max(1,Math.min(12,Number(value)||1)); state.groups.groupCount=count; state.groups.sizes=evenSizes(roster().length,count); state.groups.members=[]; state.groups.desks=defaultDesks(roster().length,count,state.groups.sizes); selectedDesk=0; }

function bind(section) {
  if(!section)return;
  section.querySelectorAll("[data-layout-mode]").forEach((button)=>button.addEventListener("click",()=>{state.mode=button.dataset.layoutMode;rerender();}));
  section.querySelector("[data-save-layout]")?.addEventListener("click",save);
  section.querySelector("[data-rows]")?.addEventListener("change",(event)=>{state.general.rows=Math.max(3,Math.min(10,Number(event.target.value)||6));state.general.blocked=state.general.blocked.filter((i)=>i<state.general.rows*state.general.cols);state.general.seats=[];rerender();});
  section.querySelector("[data-cols]")?.addEventListener("change",(event)=>{state.general.cols=Math.max(3,Math.min(10,Number(event.target.value)||6));state.general.blocked=state.general.blocked.filter((i)=>i<state.general.rows*state.general.cols);state.general.seats=[];rerender();});
  section.querySelector("[data-generate-general]")?.addEventListener("click",()=>{if(!generateGeneral())alert("학생 수보다 사용 가능한 좌석이 적습니다.");rerender();});
  section.querySelector("[data-clear-general]")?.addEventListener("click",()=>{state.general.seats=[];rerender();});
  section.querySelectorAll("[data-block]").forEach((button)=>button.addEventListener("click",()=>{const index=Number(button.dataset.block);const set=new Set(state.general.blocked);if(set.has(index))set.delete(index);else set.add(index);state.general.blocked=[...set].sort((a,b)=>a-b);state.general.seats=[];rerender();}));
  section.querySelectorAll("[data-focus]").forEach((button)=>button.addEventListener("click",()=>{const uid=button.dataset.focus;const set=new Set(state.general.focusStudentIds);if(set.has(uid))set.delete(uid);else set.add(uid);state.general.focusStudentIds=[...set];rerender();}));
  section.querySelector("[data-add-pair]")?.addEventListener("click",()=>{const a=section.querySelector("[data-pair-a]")?.value||"";const b=section.querySelector("[data-pair-b]")?.value||"";if(!a||!b||a===b)return;const key=pairKey(a,b);if(!state.general.separationPairs.some((pair)=>pairKey(pair[0],pair[1])===key))state.general.separationPairs.push([a,b]);rerender();});
  section.querySelectorAll("[data-remove-pair]").forEach((button)=>button.addEventListener("click",()=>{state.general.separationPairs.splice(Number(button.dataset.removePair),1);rerender();}));
  section.querySelector("[data-group-count]")?.addEventListener("change",(event)=>{resetGroupCount(event.target.value);rerender();});
  section.querySelectorAll("[data-group-size]").forEach((input)=>input.addEventListener("change",()=>{state.groups.sizes[Number(input.dataset.groupSize)]=Math.max(0,Math.min(12,Number(input.value)||0));state.groups.members=[];rerender();}));
  section.querySelector("[data-even]")?.addEventListener("click",()=>{state.groups.sizes=evenSizes(roster().length,state.groups.groupCount);state.groups.members=[];rerender();});
  section.querySelector("[data-generate-groups]")?.addEventListener("click",()=>{if(!generateGroups())alert("모둠별 정원 합계가 학생 수와 같아야 합니다.");rerender();});
  section.querySelector("[data-desk-rows]")?.addEventListener("change",(event)=>{state.groups.deskRows=Math.max(3,Math.min(10,Number(event.target.value)||6));state.groups.desks=state.groups.desks.filter((desk)=>desk.index<state.groups.deskRows*state.groups.deskCols);rerender();});
  section.querySelector("[data-desk-cols]")?.addEventListener("change",(event)=>{state.groups.deskCols=Math.max(3,Math.min(10,Number(event.target.value)||6));state.groups.desks=state.groups.desks.filter((desk)=>desk.index<state.groups.deskRows*state.groups.deskCols);rerender();});
  section.querySelector("[data-auto-desks]")?.addEventListener("click",()=>{state.groups.desks=defaultDesks(roster().length,state.groups.groupCount,state.groups.sizes);selectedDesk=0;rerender();});
  section.querySelectorAll("[data-desk]").forEach((button)=>button.addEventListener("click",()=>{selectedDesk=Number(button.dataset.desk);rerender();}));
  section.querySelector("[data-desk-group]")?.addEventListener("change",(event)=>{const desk=state.groups.desks.find((item)=>item.index===selectedDesk);if(desk)desk.group=Math.max(1,Math.min(state.groups.groupCount,Number(event.target.value)||1));rerender();});
  section.querySelectorAll("[data-rotate]").forEach((button)=>button.addEventListener("click",()=>{const desk=state.groups.desks.find((item)=>item.index===selectedDesk);if(desk)desk.rotation=Number(button.dataset.rotate);rerender();}));
  section.querySelector("[data-remove-desk]")?.addEventListener("click",()=>{state.groups.desks=state.groups.desks.filter((desk)=>desk.index!==selectedDesk);rerender();});
  section.querySelector("[data-add-desk]")?.addEventListener("click",()=>{if(!state.groups.desks.some((desk)=>desk.index===selectedDesk))state.groups.desks.push({index:selectedDesk,group:1,rotation:0});rerender();});
  section.querySelectorAll("[data-assessment-lines]").forEach((button)=>button.addEventListener("click",()=>{state.assessment.lines=Number(button.dataset.assessmentLines)===5?5:6;state.assessment.seats=[];rerender();}));
  section.querySelector("[data-generate-assessment]")?.addEventListener("click",()=>{generateAssessment();rerender();});
  section.querySelector("[data-clear-assessment]")?.addEventListener("click",()=>{state.assessment.seats=[];rerender();});
}

async function save() {
  if(saving||!view?.classKey)return; saving=true; const status=root.querySelector("#pinconClassroomLayout [data-layout-status]"); if(status)status.textContent="저장 중…";
  try {
    const latest=await accountRequest(`/api/class-ops/classroom-layout?classKey=${encodeURIComponent(view.classKey)}`);
    const latestGeneral=latest?.classroomLayout?.general||{};
    state.general.nominations=Array.isArray(latestGeneral.nominations)?latestGeneral.nominations:state.general.nominations;
    state.general.focusStudentIds=[...new Set([...(state.general.focusStudentIds||[]),...(latestGeneral.focusStudentIds||[])])];
    const pairMap=new Map([...(state.general.separationPairs||[]),...(latestGeneral.separationPairs||[])].filter((pair)=>Array.isArray(pair)&&pair.length===2).map((pair)=>[pairKey(pair[0],pair[1]),pair]));
    state.general.separationPairs=[...pairMap.values()];
    const result=await accountRequest("/api/class-ops/classroom-layout",{method:"POST",body:{classKey:view.classKey,action:"SAVE",classroomLayout:state}});
    state=normalize(result.classroomLayout||state); if(status)status.textContent="저장했습니다.";
  } catch(error) { if(status)status.textContent="저장하지 못했습니다."; }
  finally { saving=false; setTimeout(()=>rerender(),250); }
}

function mount({force=false}={}) { const grid=root?.querySelector("#adminMain .admin-grid"); if(!grid||!view||!state)return; const existing=grid.querySelector("#pinconClassroomLayout"); if(existing&&!force)return; existing?.remove(); const settings=grid.querySelector("#pinconClassOpsSettings"); if(settings)settings.insertAdjacentHTML("beforebegin",markup()); else grid.insertAdjacentHTML("afterbegin",markup()); bind(grid.querySelector("#pinconClassroomLayout")); }
async function load(force=false) { if(loading||(view&&!force))return; const target=classKey(); if(!target)return; loading=true; try { view=await accountRequest(`/api/class-ops/classroom-layout?classKey=${encodeURIComponent(target)}`); state=normalize(view.classroomLayout); } catch(error) { if(error?.status!==403)console.warn("[PinCon] classroom layout load failed",error); } finally { loading=false; mount({force:true}); } }
function queue() { if(queued)return; queued=true; requestAnimationFrame(()=>{queued=false;if(!root?.querySelector("#adminMain"))return;mount();load();}); }
new MutationObserver(queue).observe(root,{childList:true});
queue();
