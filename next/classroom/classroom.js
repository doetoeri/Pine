import { accountRequest } from "../core/student-auth.js";

const root = document.querySelector("#classroomApp");
let view = null;
let mode = "general";

const SCENE_LABELS = Object.freeze({
  morning: "아침시간",
  assessment: "수행평가 전",
  "seat-change": "자리 바꾸는 시간",
  "history-group": "한국사 모둠 시작 전",
  special: "특별 상황",
});
const TARGET_LABELS = Object.freeze({
  message: "문구만",
  general: "일반 자리",
  groups: "모둠 배치",
  assessment: "수행평가 배치",
});

const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const label = (uid) => {
  const s = view?.roster?.find((x) => x.uid === uid);
  return s ? `${Number(s.number) || "-"}번 ${s.name || "이름 없음"}` : "빈자리";
};
const arrow = (r) => ({ 0: "↑", 90: "→", 180: "↓", 270: "←" })[Number(r)] || "↑";

function generalRoom() {
  const g = view.classroomLayout.general;
  const cells = [];
  for (let i = 0; i < g.rows * g.cols; i += 1) {
    if ((g.blocked || []).includes(i)) {
      cells.push(`<div class="seat empty"><small>${i + 1}</small><strong>사용 안 함</strong></div>`);
      continue;
    }
    const uid = g.seats?.[i] || "";
    cells.push(`<div class="seat ${uid ? "" : "empty"}"><small>${i + 1}번 자리</small><strong>${esc(label(uid))}</strong></div>`);
  }
  return `<div class="teacher">교탁</div><div class="room-wrap"><div class="room" style="grid-template-columns:repeat(${g.cols},minmax(72px,1fr))">${cells.join("")}</div></div>`;
}
function groupAssignments() {
  const g = view.classroomLayout.groups;
  const map = new Map();
  for (let group = 1; group <= g.groupCount; group += 1) {
    const members = g.members?.[group - 1] || [];
    const desks = (g.desks || []).filter((d) => d.group === group).sort((a, b) => a.index - b.index);
    members.forEach((uid, i) => {
      if (desks[i]) map.set(desks[i].index, uid);
    });
  }
  return map;
}
function groupRoom() {
  const g = view.classroomLayout.groups;
  const assigned = groupAssignments();
  const total = g.deskRows * g.deskCols;
  const desksByIndex = new Map((g.desks || []).map((d) => [d.index, d]));
  const cells = [];
  for (let i = 0; i < total; i += 1) {
    const d = desksByIndex.get(i);
    if (!d) {
      cells.push(`<div class="seat empty"><small>${i + 1}</small><strong>빈 공간</strong></div>`);
      continue;
    }
    const uid = assigned.get(i) || "";
    cells.push(`<div class="seat ${uid ? "" : "empty"}"><span class="group-chip">${d.group}모둠</span><span class="arrow">${arrow(d.rotation)}</span><small>${i + 1}번 책상</small><strong>${esc(label(uid))}</strong></div>`);
  }
  return `<div class="teacher">교탁</div><div class="room-wrap"><div class="room" style="grid-template-columns:repeat(${g.deskCols},minmax(72px,1fr))">${cells.join("")}</div></div><div class="classroom-meta">${g.sizes.map((n, i) => `<span>${i + 1}모둠 ${n}명</span>`).join("")}</div>`;
}
function assessmentRoom() {
  const a = view.classroomLayout.assessment;
  const cols = a.lines;
  const rows = Math.ceil(Math.max(view.roster.length, a.seats?.length || 0) / cols);
  const cells = [];
  for (let i = 0; i < rows * cols; i += 1) {
    const uid = a.seats?.[i] || "";
    cells.push(`<div class="seat ${uid ? "" : "empty"}"><small>${i + 1}번 평가 자리</small><strong>${esc(label(uid))}</strong></div>`);
  }
  return `<div class="teacher">교탁</div><div class="room-wrap"><div class="room" style="grid-template-columns:repeat(${cols},minmax(72px,1fr))">${cells.join("")}</div></div><div class="classroom-meta"><span>${cols}줄 수행평가</span></div>`;
}
function reportSummary() {
  const noms = view.classroomLayout.general.nominations || [];
  const byStudent = new Map();
  for (const n of noms) {
    const r = byStudent.get(n.studentUid) || { count: 0, reasons: new Map() };
    r.count += 1;
    r.reasons.set(n.reason, (r.reasons.get(n.reason) || 0) + 1);
    byStudent.set(n.studentUid, r);
  }
  const rows = [...byStudent].sort((a, b) => b[1].count - a[1].count);
  const recent = noms.slice().reverse().slice(0, 10);
  return `<div class="report-grid"><div class="report-list"><h3>제보 취합</h3>${rows.length ? rows.map(([uid, r]) => `<div class="report-row"><strong>${esc(label(uid))}</strong><small>${r.count}건 · ${esc([...r.reasons].map(([k, v]) => `${k} ${v}`).join(" · "))}</small></div>`).join("") : "<p>아직 제보가 없습니다.</p>"}</div><div class="report-list"><h3>최근 제보</h3>${recent.length ? recent.map((n) => `<div class="report-row"><strong>${esc(label(n.studentUid))}</strong><small>${esc(n.date || "")} · ${esc(n.reason || "")}${n.note ? ` · ${esc(n.note)}` : ""}${view.permissions.canSeeReporter ? `<br>제보자: ${esc(n.proposerName || "기록 없음")} · ${esc(n.proposerRole || "")}` : ""}</small></div>`).join("") : "<p>최근 제보가 없습니다.</p>"}</div></div>`;
}
function reportForm() {
  if (!view.permissions.canReport) return "";
  return `<form class="classroom-report no-print" id="reportForm"><label>대상 학생<select id="reportStudent" required><option value="">선택</option>${view.roster.map((s) => `<option value="${esc(s.uid)}">${esc(label(s.uid))}</option>`).join("")}</select></label><label>함께 대화한 학생<select id="reportPartner"><option value="">없음 / 특정 불가</option>${view.roster.map((s) => `<option value="${esc(s.uid)}">${esc(label(s.uid))}</option>`).join("")}</select></label><label>상황<select id="reportReason"><option>설명 중 반복 대화</option><option>수업 시작 방해</option><option>불필요한 자리 이동</option><option>주변 학생 집중 반복 방해</option><option>교사 반복 정숙 요구 원인</option><option>기타</option></select></label><label class="wide">간단 근거<input id="reportNote" maxlength="180" placeholder="관찰 가능한 사실 위주"></label><button type="submit">비공개 제보 제출</button></form>`;
}
function activeScene() {
  const d = view.classroomLayout.display;
  return d.scenes?.[d.activeScene] || {};
}
function captureDisplayEditor() {
  if (!view?.permissions?.canControlDisplay) return;
  const d = view.classroomLayout.display;
  const scene = d.scenes?.[d.activeScene];
  if (!scene || !root.querySelector("#displayMessage")) return;
  scene.message = root.querySelector("#displayMessage")?.value || "";
  scene.targetMode = root.querySelector("#displayTarget")?.value || scene.targetMode;
  scene.startAt = root.querySelector("#displayStartAt")?.value || "";
  scene.leadMinutes = Number(root.querySelector("#displayLeadMinutes")?.value || 0);
  scene.showMovement = root.querySelector("#displayShowMovement")?.checked === true;
  d.idleSeconds = Number(root.querySelector("#idleSeconds")?.value || d.idleSeconds);
  d.stepSeconds = Number(root.querySelector("#stepSeconds")?.value || d.stepSeconds);
  d.finalSeconds = Number(root.querySelector("#finalSeconds")?.value || d.finalSeconds);
}
function displayEditor() {
  const d = view.classroomLayout.display;
  const scene = activeScene();
  const quick = Object.entries(SCENE_LABELS).map(([key, text]) => `<button type="button" class="${d.activeScene === key ? "primary" : ""}" data-scene="${key}">${text}</button>`).join("");
  if (!view.permissions.canControlDisplay) return `<div class="classroom-meta"><span>${esc(SCENE_LABELS[d.activeScene] || d.activeScene)}</span><span>${esc(scene.message || "")}</span></div>`;
  return `<div class="display-settings no-print"><div class="wide classroom-meta">${quick}</div><label>상황 문구<input id="displayMessage" value="${esc(scene.message || "")}" maxlength="180"></label><label>표시할 화면<select id="displayTarget">${Object.entries(TARGET_LABELS).map(([value, text]) => `<option value="${value}" ${scene.targetMode === value ? "selected" : ""}>${text}</option>`).join("")}</select></label><label>시작 시각 (선택)<input id="displayStartAt" type="datetime-local" value="${esc(scene.startAt || "")}"></label><label>몇 분 전부터 이동 안내<input id="displayLeadMinutes" type="number" min="0" max="180" value="${Number(scene.leadMinutes || 0)}"></label><label>문구 유지(초)<input id="idleSeconds" type="number" min="3" max="120" value="${d.idleSeconds}"></label><label>학생별 이동 안내(초)<input id="stepSeconds" type="number" min="2" max="20" value="${d.stepSeconds}"></label><label>최종 배치 유지(초)<input id="finalSeconds" type="number" min="3" max="60" value="${d.finalSeconds}"></label><label><input id="displayShowMovement" type="checkbox" ${scene.showMovement ? "checked" : ""}> 학생별 이동 애니메이션 사용</label><button id="saveDisplay" type="button">이 상황을 TV에 적용</button></div>`;
}
function render() {
  const d = view.classroomLayout.display;
  const scene = activeScene();
  root.innerHTML = `<header class="classroom-top"><div><span class="classroom-eyebrow">PINCON · CLASSROOM</span><h1>교실 배치</h1><p>${esc(view.classKey)} · ${view.roster.length}명 · ${view.updatedAtMs ? new Date(view.updatedAtMs).toLocaleString("ko-KR") : "저장 기록 없음"}</p></div><div class="classroom-actions no-print"><a href="../#more">PinCon으로</a><button id="printBtn">프린트</button><button class="primary" id="tvBtn">TV에 띄우기</button></div></header><nav class="classroom-tabs no-print">${[["general", "일반"], ["groups", "모둠"], ["assessment", "수행평가"]].map(([k, n]) => `<button data-mode="${k}" aria-selected="${mode === k}">${n}</button>`).join("")}</nav><section class="classroom-card only-mode ${mode === "general" ? "active" : ""}" data-panel="general"><h2>일반 자리</h2><p>회장·부회장·부장은 결과를 열람할 수 있습니다.</p>${generalRoom()}${reportForm()}${reportSummary()}<div class="privacy-note">제보자 식별 정보는 관리자 역할에게만 서버에서 반환됩니다.</div></section><section class="classroom-card only-mode ${mode === "groups" ? "active" : ""}" data-panel="groups"><h2>모둠 배치</h2><p>책상 방향 화살표와 모둠별 학생 위치를 함께 표시합니다.</p>${groupRoom()}</section><section class="classroom-card only-mode ${mode === "assessment" ? "active" : ""}" data-panel="assessment"><h2>수행평가 배치</h2><p>5줄/6줄 설정에 맞춘 평가용 자리입니다.</p>${assessmentRoom()}</section><section class="classroom-card no-print"><h3>TV 상황 설정</h3><p><b>${esc(SCENE_LABELS[d.activeScene] || d.activeScene)}</b> · ${esc(scene.message || "")}</p>${displayEditor()}</section><div id="status" class="no-print"></div>`;
  bind();
}
function bind() {
  root.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => { mode = b.dataset.mode; render(); }));
  root.querySelector("#printBtn")?.addEventListener("click", () => window.print());
  root.querySelector("#tvBtn")?.addEventListener("click", () => window.open("./tv.html", "pinconClassroomTV", "noopener"));
  root.querySelectorAll("[data-scene]").forEach((button) => button.addEventListener("click", () => {
    captureDisplayEditor();
    view.classroomLayout.display.activeScene = button.dataset.scene;
    render();
  }));
  root.querySelector("#reportForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const studentUid = root.querySelector("#reportStudent")?.value || "";
    const partnerUid = root.querySelector("#reportPartner")?.value || "";
    if (!studentUid || studentUid === partnerUid) return;
    await accountRequest("/api/class-ops/classroom-layout", { method: "POST", body: { action: "ADD_NOMINATION", classKey: view.classKey, studentUid, partnerUid, reason: root.querySelector("#reportReason")?.value, note: root.querySelector("#reportNote")?.value } });
    await load();
  });
  root.querySelector("#saveDisplay")?.addEventListener("click", async () => {
    captureDisplayEditor();
    const status = root.querySelector("#status");
    if (status) status.textContent = "TV 상황 설정 저장 중…";
    await accountRequest("/api/class-ops/classroom-layout", { method: "POST", body: { action: "SET_DISPLAY", classKey: view.classKey, display: view.classroomLayout.display } });
    await load();
    const next = root.querySelector("#status");
    if (next) next.textContent = "TV 상황을 적용했습니다.";
  });
}
async function load() {
  try {
    view = await accountRequest("/api/class-ops/classroom-layout");
    render();
  } catch (error) {
    root.innerHTML = `<section class="classroom-error"><strong>교실 배치를 열 수 없습니다</strong><span>회장·부회장·부장·교사·관리자 계정인지 확인해주세요.</span><a href="../#more">PinCon으로 돌아가기</a></section>`;
  }
}
load();
