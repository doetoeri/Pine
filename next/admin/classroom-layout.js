import { readClassProfile } from "../core/data-gateway.js";
import { accountRequest } from "../core/student-auth.js";

const root = document.querySelector("#adminApp");
let view = null;
let state = null;
let loading = false;
let saving = false;
let selectedDesk = 0;
let mountQueued = false;

const MODE_LABELS = Object.freeze({ general: "일반", groups: "모둠", assessment: "수행평가" });
const ROTATIONS = [0, 90, 180, 270];
const ROTATION_ARROW = Object.freeze({ 0: "↑", 90: "→", 180: "↓", 270: "←" });

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const classKey = () => readClassProfile()?.classKey || "";
const roster = () => Array.isArray(view?.roster) ? view.roster : [];
const studentName = (uid) => roster().find((item) => item.uid === uid)?.name || "이름 없음";
const studentLabel = (uid) => {
  const student = roster().find((item) => item.uid === uid);
  if (!student) return "학생 없음";
  return `${Number(student.number) || "-"}번 ${student.name || "이름 없음"}`;
};

function freshState() {
  const count = roster().length;
  const groupCount = Math.max(1, Math.min(12, Math.ceil(count / 4) || 1));
  return {
    schemaVersion: 1,
    mode: "general",
    general: {
      rows: 6,
      cols: 6,
      seats: [],
      blocked: count <= 34 ? [34, 35] : [],
      focusStudentIds: [],
      separationPairs: [],
    },
    groups: {
      groupCount,
      sizes: evenSizes(count, groupCount),
      members: [],
      deskRows: 6,
      deskCols: 6,
      desks: makeDesks(count, groupCount, evenSizes(count, groupCount)),
    },
    assessment: {
      lines: 6,
      seats: [],
    },
  };
}

function evenSizes(total, groups) {
  const safeGroups = Math.max(1, Math.min(12, Number(groups) || 1));
  const base = Math.floor(total / safeGroups);
  const rest = total % safeGroups;
  return Array.from({ length: safeGroups }, (_, index) => base + (index < rest ? 1 : 0));
}

function makeDesks(total, groupCount, sizes) {
  const output = [];
  let desk = 0;
  for (let group = 0; group < groupCount && desk < total; group += 1) {
    const size = Math.max(0, Number(sizes[group]) || 0);
    for (let i = 0; i < size && desk < total; i += 1) {
      output.push({ index: desk, group: group + 1, rotation: i % 2 === 0 ? 90 : 270 });
      desk += 1;
    }
  }
  while (desk < total) {
    output.push({ index: desk, group: Math.min(groupCount, 1 + (desk % Math.max(groupCount, 1))), rotation: 0 });
    desk += 1;
  }
  return output;
}

function normalizeClientState(value) {
  const base = freshState();
  if (!value || typeof value !== "object") return base;
  const general = value.general || {};
  const groups = value.groups || {};
  const assessment = value.assessment || {};
  const groupCount = Math.max(1, Math.min(12, Number(groups.groupCount) || base.groups.groupCount));
  const sizes = Array.from({ length: groupCount }, (_, index) => Math.max(0, Math.min(12, Number(groups.sizes?.[index]) || 0)));
  return {
    schemaVersion: 1,
    mode: ["general", "groups", "assessment"].includes(value.mode) ? value.mode : "general",
    general: {
      rows: Math.max(3, Math.min(10, Number(general.rows) || 6)),
      cols: Math.max(3, Math.min(10, Number(general.cols) || 6)),
      seats: Array.isArray(general.seats) ? general.seats.filter(Boolean).slice(0, 60) : [],
      blocked: Array.isArray(general.blocked) ? [...new Set(general.blocked.map(Number).filter(Number.isInteger))].slice(0, 30) : [],
      focusStudentIds: Array.isArray(general.focusStudentIds) ? [...new Set(general.focusStudentIds)].slice(0, 60) : [],
      separationPairs: Array.isArray(general.separationPairs)
        ? general.separationPairs.filter((pair) => Array.isArray(pair) && pair.length === 2 && pair[0] !== pair[1]).slice(0, 100)
        : [],
    },
    groups: {
      groupCount,
      sizes,
      members: Array.isArray(groups.members)
        ? groups.members.slice(0, groupCount).map((items) => Array.isArray(items) ? items.filter(Boolean).slice(0, 12) : [])
        : [],
      deskRows: Math.max(3, Math.min(10, Number(groups.deskRows) || 6)),
      deskCols: Math.max(3, Math.min(10, Number(groups.deskCols) || 6)),
      desks: Array.isArray(groups.desks)
        ? groups.desks.slice(0, 60).map((desk, index) => ({
            index: Math.max(0, Math.min(99, Number(desk?.index) || index)),
            group: Math.max(1, Math.min(groupCount, Number(desk?.group) || 1)),
            rotation: ROTATIONS.includes(Number(desk?.rotation)) ? Number(desk.rotation) : 0,
          }))
        : [],
    },
    assessment: {
      lines: Number(assessment.lines) === 5 ? 5 : 6,
      seats: Array.isArray(assessment.seats) ? assessment.seats.filter(Boolean).slice(0, 60) : [],
    },
  };
}

function shuffle(values) {
  const out = values.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function pairKey(a, b) {
  return [a, b].sort().join("|");
}

function pairSet() {
  return new Set((state.general.separationPairs || []).map(([a, b]) => pairKey(a, b)));
}

function groupPenalty(groups) {
  const separated = pairSet();
  let penalty = 0;
  for (const group of groups) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        if (separated.has(pairKey(group[i], group[j]))) penalty += 1000;
      }
    }
  }
  const focus = new Set(state.general.focusStudentIds || []);
  const counts = groups.map((group) => group.filter((uid) => focus.has(uid)).length);
  if (counts.length) penalty += (Math.max(...counts) - Math.min(...counts)) * 30;
  return penalty;
}

function generateGroups() {
  const students = roster().map((item) => item.uid);
  const sizes = state.groups.sizes.map((size) => Math.max(0, Number(size) || 0));
  if (sizes.reduce((sum, size) => sum + size, 0) !== students.length) return false;
  let best = [];
  let bestPenalty = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 3500; attempt += 1) {
    const candidates = shuffle(students);
    const groups = [];
    let cursor = 0;
    for (const size of sizes) {
      groups.push(candidates.slice(cursor, cursor + size));
      cursor += size;
    }
    const penalty = groupPenalty(groups);
    if (penalty < bestPenalty) {
      best = groups;
      bestPenalty = penalty;
      if (penalty === 0) break;
    }
  }
  state.groups.members = best;
  return true;
}

function seatPenalty(seats, cols) {
  const pos = new Map();
  seats.forEach((uid, index) => { if (uid) pos.set(uid, index); });
  const focus = new Set(state.general.focusStudentIds || []);
  let penalty = 0;
  const distance = (a, b) => {
    const ar = Math.floor(a / cols); const ac = a % cols;
    const br = Math.floor(b / cols); const bc = b % cols;
    return Math.max(Math.abs(ar - br), Math.abs(ac - bc));
  };
  for (const [a, b] of state.general.separationPairs || []) {
    if (pos.has(a) && pos.has(b) && distance(pos.get(a), pos.get(b)) <= 1) penalty += 1000;
  }
  const focusIds = [...focus].filter((uid) => pos.has(uid));
  for (let i = 0; i < focusIds.length; i += 1) {
    for (let j = i + 1; j < focusIds.length; j += 1) {
      if (distance(pos.get(focusIds[i]), pos.get(focusIds[j])) <= 1) penalty += 500;
    }
  }
  return penalty;
}

function generateGeneralSeats() {
  const rows = state.general.rows;
  const cols = state.general.cols;
  const blocked = new Set(state.general.blocked || []);
  const slots = Array.from({ length: rows * cols }, (_, index) => index).filter((index) => !blocked.has(index));
  const students = roster().map((item) => item.uid);
  if (slots.length < students.length) return false;
  let best = [];
  let bestPenalty = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 3000; attempt += 1) {
    const ids = shuffle(students);
    const seats = Array(rows * cols).fill("");
    slots.forEach((slot, index) => { seats[slot] = ids[index] || ""; });
    const penalty = seatPenalty(seats, cols);
    if (penalty < bestPenalty) {
      best = seats;
      bestPenalty = penalty;
      if (penalty === 0) break;
    }
  }
  state.general.seats = best;
  return true;
}

function generateAssessment() {
  const lines = state.assessment.lines === 5 ? 5 : 6;
  const students = shuffle(roster().map((item) => item.uid));
  const rows = Math.ceil(students.length / lines);
  const seats = Array(rows * lines).fill("");
  students.forEach((uid, index) => { seats[index] = uid; });
  state.assessment.seats = seats;
}

function modeTabs() {
  return `<div class="pincon-layout-tabs" role="tablist" aria-label="교실 배치 모드">
    ${Object.entries(MODE_LABELS).map(([key, label]) => `<button type="button" class="pincon-layout-tab" data-layout-mode="${key}" aria-selected="${state.mode === key}"><md-icon>${key === "general" ? "event_seat" : key === "groups" ? "groups" : "fact_check"}</md-icon>${label}</button>`).join("")}
  </div>`;
}

function studentOptions(selected = "") {
  return `<option value="">학생 선택</option>${roster().map((item) => `<option value="${escapeHtml(item.uid)}" ${selected === item.uid ? "selected" : ""}>${escapeHtml(`${Number(item.number) || "-"}번 ${item.name || "이름 없음"}`)}</option>`).join("")}`;
}

function rosterChips(values, attr) {
  const selected = new Set(values || []);
  return `<div class="pincon-layout-student-grid">${roster().map((student) => `<button type="button" class="pincon-layout-student-chip" data-${attr}="${escapeHtml(student.uid)}" data-selected="${selected.has(student.uid)}"><span>${escapeHtml(Number(student.number) || "-")}</span><strong>${escapeHtml(student.name || "이름 없음")}</strong><md-icon>${selected.has(student.uid) ? "check_circle" : "radio_button_unchecked"}</md-icon></button>`).join("")}</div>`;
}

function generalMarkup() {
  const general = state.general;
  const seatCount = general.rows * general.cols - general.blocked.length;
  return `<div class="pincon-layout-mode" data-mode-panel="general">
    <div class="pincon-layout-toolbar">
      <div><h3>일반 자리배치</h3><p>기본 무작위 배치에 비공개 조정 조건을 함께 반영합니다.</p></div>
      <div class="pincon-layout-inline-fields">
        <label>행<input type="number" min="3" max="10" value="${general.rows}" data-general-rows></label>
        <label>열<input type="number" min="3" max="10" value="${general.cols}" data-general-cols></label>
      </div>
    </div>
    <div class="pincon-layout-actions">
      <md-filled-button data-generate-general><md-icon slot="icon">casino</md-icon>자리 생성</md-filled-button>
      <md-outlined-button data-clear-general><md-icon slot="icon">restart_alt</md-icon>배치 비우기</md-outlined-button>
      <span class="pincon-layout-meta">사용 가능 ${seatCount}석 · 학생 ${roster().length}명</span>
    </div>
    ${classroomMarkup(general.seats, general.rows, general.cols, new Set(general.blocked), true)}
    <details class="pincon-layout-constraints">
      <summary><span><md-icon>lock</md-icon><strong>비공개 좌석 조정 조건</strong></span><small>일반 학생 화면에는 표시되지 않습니다.</small></summary>
      <div class="pincon-layout-constraint-grid">
        <section><h4>집중 조정 대상</h4><p>선택된 학생끼리 인접하지 않도록 최대한 분산합니다.</p>${rosterChips(general.focusStudentIds, "focus-student")}</section>
        <section><h4>분리 조합</h4><p>승인된 두 학생이 상하좌우·대각선으로 붙지 않도록 시도합니다.</p>
          <div class="pincon-layout-pair-form"><select data-pair-a>${studentOptions()}</select><select data-pair-b>${studentOptions()}</select><button type="button" data-add-pair>추가</button></div>
          <div class="pincon-layout-pair-list">${general.separationPairs.length ? general.separationPairs.map(([a, b], index) => `<div><span>${escapeHtml(studentLabel(a))} ↔ ${escapeHtml(studentLabel(b))}</span><button type="button" data-remove-pair="${index}" aria-label="분리 조합 삭제"><md-icon>close</md-icon></button></div>`).join("") : `<p class="pincon-layout-empty">등록된 분리 조합이 없습니다.</p>`}</div>
        </section>
      </div>
    </details>
  </div>`;
}

function classroomMarkup(seats, rows, cols, blocked = new Set(), editable = false) {
  const cells = Array.from({ length: rows * cols }, (_, index) => {
    if (blocked.has(index)) return `<button type="button" class="pincon-layout-seat is-blocked" ${editable ? `data-toggle-blocked="${index}"` : "disabled"}><small>${index + 1}</small><strong>사용 안 함</strong></button>`;
    const uid = seats?.[index] || "";
    return `<button type="button" class="pincon-layout-seat" ${editable ? `data-toggle-blocked="${index}"` : "disabled"}><small>${index + 1}</small><strong>${escapeHtml(uid ? studentName(uid) : "빈자리")}</strong><span>${escapeHtml(uid ? `${roster().find((item) => item.uid === uid)?.number || "-"}번` : "")}</span></button>`;
  }).join("");
  return `<div class="pincon-layout-front">교탁</div><div class="pincon-layout-classroom" style="--layout-cols:${cols}">${cells}</div>`;
}

function sizeRows() {
  return state.groups.sizes.map((size, index) => `<label class="pincon-layout-size-row"><span>${index + 1}모둠</span><input type="number" min="0" max="12" value="${size}" data-group-size="${index}"><small>명</small></label>`).join("");
}

function groupMembersMarkup() {
  if (!state.groups.members.length) return `<div class="pincon-layout-empty">모둠 정원을 맞춘 뒤 ‘학생 자동 배정’을 누르세요.</div>`;
  return `<div class="pincon-layout-group-cards">${state.groups.members.map((group, index) => `<article><header><strong>${index + 1}모둠</strong><span>${group.length}/${state.groups.sizes[index] || 0}명</span></header><div>${group.map((uid) => `<span>${escapeHtml(studentLabel(uid))}</span>`).join("")}</div></article>`).join("")}</div>`;
}

function deskGridMarkup() {
  const { deskRows, deskCols } = state.groups;
  const desks = new Map(state.groups.desks.map((desk) => [desk.index, desk]));
  const cells = Array.from({ length: deskRows * deskCols }, (_, index) => {
    const desk = desks.get(index);
    if (!desk) return `<button type="button" class="pincon-layout-desk is-empty" data-desk-slot="${index}"><small>${index + 1}</small><span>빈 칸</span></button>`;
    return `<button type="button" class="pincon-layout-desk ${selectedDesk === index ? "is-selected" : ""}" data-desk-slot="${index}" data-group="${desk.group}"><small>책상 ${index + 1}</small><strong>${desk.group}모둠</strong><b>${ROTATION_ARROW[desk.rotation] || "↑"}</b></button>`;
  }).join("");
  const selected = state.groups.desks.find((desk) => desk.index === selectedDesk) || null;
  return `<div class="pincon-layout-desk-editor">
    <div><div class="pincon-layout-front">교탁</div><div class="pincon-layout-desk-grid" style="--layout-cols:${deskCols}">${cells}</div></div>
    <aside>${selected ? `<h4>책상 ${selected.index + 1}</h4><label>소속 모둠<select data-selected-desk-group>${Array.from({ length: state.groups.groupCount }, (_, index) => `<option value="${index + 1}" ${selected.group === index + 1 ? "selected" : ""}>${index + 1}모둠</option>`).join("")}</select></label><div class="pincon-layout-rotation"><span>책상 방향</span>${ROTATIONS.map((rotation) => `<button type="button" data-desk-rotation="${rotation}" data-selected="${selected.rotation === rotation}">${ROTATION_ARROW[rotation]}</button>`).join("")}</div><md-text-button data-remove-desk><md-icon slot="icon">remove</md-icon>이 책상 비우기</md-text-button>` : `<h4>빈 칸 ${selectedDesk + 1}</h4><p>여기에 책상을 추가할 수 있습니다.</p><md-filled-tonal-button data-add-desk><md-icon slot="icon">add</md-icon>책상 추가</md-filled-tonal-button>`}</aside>
  </div>`;
}

function groupsMarkup() {
  const total = state.groups.sizes.reduce((sum, size) => sum + (Number(size) || 0), 0);
  const balanced = total === roster().length;
  return `<div class="pincon-layout-mode" data-mode-panel="groups">
    <div class="pincon-layout-toolbar"><div><h3>모둠 배치</h3><p>모둠 수와 모둠별 인원, 책상 소속과 방향을 직접 정합니다.</p></div><label class="pincon-layout-main-field">모둠 개수<input type="number" min="1" max="12" value="${state.groups.groupCount}" data-group-count></label></div>
    <div class="pincon-layout-group-config"><section><header><h4>모둠별 정원</h4><span data-size-status data-valid="${balanced}">${total}/${roster().length}명</span></header><div class="pincon-layout-size-list">${sizeRows()}</div><div class="pincon-layout-actions"><md-filled-tonal-button data-even-sizes>균등하게 나누기</md-filled-tonal-button><md-filled-button data-generate-groups ${balanced ? "" : "disabled"}>학생 자동 배정</md-filled-button></div></section><section><header><h4>학생 배정 결과</h4><span>${state.groups.members.length ? `${state.groups.members.length}개 모둠` : "미생성"}</span></header>${groupMembersMarkup()}</section></div>
    <div class="pincon-layout-desk-head"><div><h4>책상 배치 편집기</h4><p>책상을 선택한 뒤 소속 모둠과 방향을 바꿀 수 있습니다.</p></div><div class="pincon-layout-inline-fields"><label>행<input type="number" min="3" max="10" value="${state.groups.deskRows}" data-desk-rows></label><label>열<input type="number" min="3" max="10" value="${state.groups.deskCols}" data-desk-cols></label><md-outlined-button data-auto-desks>정원대로 자동 배치</md-outlined-button></div></div>
    ${deskGridMarkup()}
  </div>`;
}

function assessmentMarkup() {
  const lines = state.assessment.lines === 5 ? 5 : 6;
  const rows = Math.max(1, Math.ceil(roster().length / lines));
  const seats = state.assessment.seats.length ? state.assessment.seats : Array(rows * lines).fill("");
  return `<div class="pincon-layout-mode" data-mode-panel="assessment">
    <div class="pincon-layout-toolbar"><div><h3>수행평가 배치</h3><p>교실에서 실제로 쓰는 세로 5줄 / 6줄 버전을 따로 생성합니다.</p></div><div class="pincon-layout-assessment-switch"><button type="button" data-assessment-lines="5" data-selected="${lines === 5}">5줄</button><button type="button" data-assessment-lines="6" data-selected="${lines === 6}">6줄</button></div></div>
    <div class="pincon-layout-actions"><md-filled-button data-generate-assessment><md-icon slot="icon">shuffle</md-icon>${lines}줄 무작위 배치</md-filled-button><md-outlined-button data-clear-assessment>배치 비우기</md-outlined-button><span class="pincon-layout-meta">${lines}줄 × ${rows}행 · 학생 ${roster().length}명</span></div>
    ${classroomMarkup(seats, rows, lines)}
  </div>`;
}

function markup() {
  if (!view || !state) return "";
  return `<section class="admin-card admin-card--wide pincon-classroom-layout" id="pinconClassroomLayout" aria-labelledby="pincon-classroom-layout-title">
    <header class="pincon-layout-header"><div><span class="pincon-layout-eyebrow">CLASSROOM LAYOUT</span><h2 id="pincon-classroom-layout-title">교실 배치</h2><p>${escapeHtml(view.classKey || classKey())} · PinCon 계정 명단 ${roster().length}명 연동</p></div><div class="pincon-layout-save"><span data-layout-status role="status"></span><md-filled-button data-save-layout ${saving ? "disabled" : ""}><md-icon slot="icon">save</md-icon>저장</md-filled-button></div></header>
    ${modeTabs()}
    ${state.mode === "general" ? generalMarkup() : state.mode === "groups" ? groupsMarkup() : assessmentMarkup()}
  </section>`;
}

function rerender() {
  const section = root?.querySelector("#pinconClassroomLayout");
  if (!section) return mount({ force: true });
  section.outerHTML = markup();
  bind(root.querySelector("#pinconClassroomLayout"));
}

function updateGroupCount(nextCount) {
  const count = Math.max(1, Math.min(12, Number(nextCount) || 1));
  state.groups.groupCount = count;
  state.groups.sizes = evenSizes(roster().length, count);
  state.groups.members = [];
  state.groups.desks = makeDesks(roster().length, count, state.groups.sizes);
  selectedDesk = 0;
}

function bind(section) {
  if (!section) return;
  section.querySelectorAll("[data-layout-mode]").forEach((button) => button.addEventListener("click", () => {
    state.mode = button.dataset.layoutMode;
    rerender();
  }));
  section.querySelector("[data-save-layout]")?.addEventListener("click", saveLayout);

  section.querySelector("[data-general-rows]")?.addEventListener("change", (event) => { state.general.rows = Math.max(3, Math.min(10, Number(event.target.value) || 6)); state.general.seats = []; rerender(); });
  section.querySelector("[data-general-cols]")?.addEventListener("change", (event) => { state.general.cols = Math.max(3, Math.min(10, Number(event.target.value) || 6)); state.general.seats = []; rerender(); });
  section.querySelector("[data-generate-general]")?.addEventListener("click", () => { if (!generateGeneralSeats()) alert("학생 수보다 사용 가능한 좌석이 적습니다."); rerender(); });
  section.querySelector("[data-clear-general]")?.addEventListener("click", () => { state.general.seats = []; rerender(); });
  section.querySelectorAll("[data-toggle-blocked]").forEach((button) => button.addEventListener("click", () => {
    const index = Number(button.dataset.toggleBlocked);
    const blocked = new Set(state.general.blocked);
    if (blocked.has(index)) blocked.delete(index); else blocked.add(index);
    state.general.blocked = [...blocked].sort((a, b) => a - b);
    state.general.seats = [];
    rerender();
  }));
  section.querySelectorAll("[data-focus-student]").forEach((button) => button.addEventListener("click", () => {
    const uid = button.dataset.focusStudent;
    const selected = new Set(state.general.focusStudentIds);
    if (selected.has(uid)) selected.delete(uid); else selected.add(uid);
    state.general.focusStudentIds = [...selected];
    rerender();
  }));
  section.querySelector("[data-add-pair]")?.addEventListener("click", () => {
    const a = section.querySelector("[data-pair-a]")?.value || "";
    const b = section.querySelector("[data-pair-b]")?.value || "";
    if (!a || !b || a === b) return;
    if (!state.general.separationPairs.some((pair) => pairKey(pair[0], pair[1]) === pairKey(a, b))) state.general.separationPairs.push([a, b]);
    rerender();
  });
  section.querySelectorAll("[data-remove-pair]").forEach((button) => button.addEventListener("click", () => { state.general.separationPairs.splice(Number(button.dataset.removePair), 1); rerender(); }));

  section.querySelector("[data-group-count]")?.addEventListener("change", (event) => { updateGroupCount(event.target.value); rerender(); });
  section.querySelectorAll("[data-group-size]").forEach((input) => input.addEventListener("change", () => {
    const index = Number(input.dataset.groupSize);
    state.groups.sizes[index] = Math.max(0, Math.min(12, Number(input.value) || 0));
    state.groups.members = [];
    rerender();
  }));
  section.querySelector("[data-even-sizes]")?.addEventListener("click", () => { state.groups.sizes = evenSizes(roster().length, state.groups.groupCount); state.groups.members = []; rerender(); });
  section.querySelector("[data-generate-groups]")?.addEventListener("click", () => { if (!generateGroups()) alert("모둠별 정원 합계가 학생 수와 같아야 합니다."); rerender(); });
  section.querySelector("[data-desk-rows]")?.addEventListener("change", (event) => { state.groups.deskRows = Math.max(3, Math.min(10, Number(event.target.value) || 6)); rerender(); });
  section.querySelector("[data-desk-cols]")?.addEventListener("change", (event) => { state.groups.deskCols = Math.max(3, Math.min(10, Number(event.target.value) || 6)); rerender(); });
  section.querySelector("[data-auto-desks]")?.addEventListener("click", () => { state.groups.desks = makeDesks(roster().length, state.groups.groupCount, state.groups.sizes); selectedDesk = 0; rerender(); });
  section.querySelectorAll("[data-desk-slot]").forEach((button) => button.addEventListener("click", () => { selectedDesk = Number(button.dataset.deskSlot); rerender(); }));
  section.querySelector("[data-selected-desk-group]")?.addEventListener("change", (event) => { const desk = state.groups.desks.find((item) => item.index === selectedDesk); if (desk) desk.group = Math.max(1, Math.min(state.groups.groupCount, Number(event.target.value) || 1)); rerender(); });
  section.querySelectorAll("[data-desk-rotation]").forEach((button) => button.addEventListener("click", () => { const desk = state.groups.desks.find((item) => item.index === selectedDesk); if (desk) desk.rotation = Number(button.dataset.deskRotation); rerender(); }));
  section.querySelector("[data-remove-desk]")?.addEventListener("click", () => { state.groups.desks = state.groups.desks.filter((item) => item.index !== selectedDesk); rerender(); });
  section.querySelector("[data-add-desk]")?.addEventListener("click", () => { if (!state.groups.desks.some((item) => item.index === selectedDesk)) state.groups.desks.push({ index: selectedDesk, group: 1, rotation: 0 }); rerender(); });

  section.querySelectorAll("[data-assessment-lines]").forEach((button) => button.addEventListener("click", () => { state.assessment.lines = Number(button.dataset.assessmentLines) === 5 ? 5 : 6; state.assessment.seats = []; rerender(); }));
  section.querySelector("[data-generate-assessment]")?.addEventListener("click", () => { generateAssessment(); rerender(); });
  section.querySelector("[data-clear-assessment]")?.addEventListener("click", () => { state.assessment.seats = []; rerender(); });
}

async function saveLayout() {
  if (saving || !view?.classKey) return;
  saving = true;
  const status = root.querySelector("#pinconClassroomLayout [data-layout-status]");
  if (status) status.textContent = "저장 중…";
  try {
    const result = await accountRequest("/api/class-ops/settings", {
      method: "POST",
      body: { classKey: view.classKey, action: "UPDATE_CLASSROOM_LAYOUT", classroomLayout: state },
    });
    state = normalizeClientState(result.classroomLayout || state);
    if (status) status.textContent = "저장했습니다.";
  } catch (error) {
    if (status) status.textContent = "저장하지 못했습니다.";
  } finally {
    saving = false;
    setTimeout(() => rerender(), 250);
  }
}

function mount({ force = false } = {}) {
  const grid = root?.querySelector("#adminMain .admin-grid");
  if (!grid || !view || !state) return;
  const existing = grid.querySelector("#pinconClassroomLayout");
  if (existing && !force) return;
  existing?.remove();
  const settings = grid.querySelector("#pinconClassOpsSettings");
  if (settings) settings.insertAdjacentHTML("beforebegin", markup());
  else grid.insertAdjacentHTML("afterbegin", markup());
  bind(grid.querySelector("#pinconClassroomLayout"));
}

async function load(force = false) {
  if (loading || (view && !force)) return;
  const target = classKey();
  if (!target) return;
  loading = true;
  try {
    view = await accountRequest(`/api/class-ops/settings?classKey=${encodeURIComponent(target)}`);
    state = normalizeClientState(view?.settings?.classroomLayout);
  } catch (error) {
    if (error?.status !== 403) console.warn("[PinCon] classroom layout load failed", error);
  } finally {
    loading = false;
    mount({ force: true });
  }
}

function queueMount() {
  if (mountQueued) return;
  mountQueued = true;
  requestAnimationFrame(() => {
    mountQueued = false;
    if (!root?.querySelector("#adminMain")) return;
    mount();
    load();
  });
}

new MutationObserver(queueMount).observe(root, { childList: true });
queueMount();
