import { accountRequest } from "../core/student-auth.js";
import { normalizePlanner, inspectSeating, constraintErrors, publicSeatingView } from "../../integrations/pincon-ai/lib/seating-planner.mjs";
import { demoView, DEMO_KEY } from "./seating-demo.js";

const root = document.getElementById("seatingApp"), params = new URL(location.href).searchParams;
const demo = params.get("demo") === "1", requestedClass = params.get("classKey") || "";
const esc = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const clone = value => structuredClone(value);
let view, general, baseSeats = [], baseline = "", selected = -1, busy = false, saving = false, worker, history = [], message = "", warning = false;
const ids = () => view.roster.map(s => s.uid);
const person = uid => view.roster.find(s => s.uid === uid);
const label = uid => { const s = person(uid); return s ? `${s.number}번 ${s.name}` : "빈자리"; };
const dirty = () => general && JSON.stringify(general) !== baseline;
const readReport = () => inspectSeating({ ...general, seats: baseSeats }, ids(), general.seats);
const tvURL = () => demo ? "./seating-tv.html?demo=1" : `./seating-tv.html?classKey=${encodeURIComponent(view.classKey)}`;

function room() {
  const g = general, locks = new Set(g.planner.lockedSeats.map(l => l.index)), blocked = new Set(g.blocked);
  return `<div class="room-direction"><span>화면 위쪽이 교실 앞</span><span>3분단 · 6 / 6 / 5줄 · 34석</span></div><div class="seat-board">칠판 · 교탁</div><div class="section-labels"><span>1분단 <small>6줄 · 12명</small></span><span>2분단 <small>6줄 · 12명</small></span><span>3분단 <small>5줄 · 10명</small></span></div><div class="planner-room" style="--cols:${g.cols};--rows:${g.rows}">${Array.from({ length: g.rows * g.cols }, (_, i) => {
    if (i === 34 || i === 35) return `<span class="desk-absent" aria-hidden="true"></span>`;
    const s = person(g.seats[i]);
    return `<button type="button" id="seat-${i}" class="desk ${blocked.has(i) ? "is-blocked" : ""} ${i === selected ? "is-selected" : ""} ${i < g.planner.frontRows * g.cols ? "is-front" : ""}" data-seat="${i}" draggable="${!!s && !locks.has(i)}" aria-pressed="${i === selected}" aria-label="${Math.floor(i / g.cols) + 1}행 ${i % g.cols + 1}열, ${blocked.has(i) ? "사용 안 함" : esc(label(g.seats[i]))}${locks.has(i) ? ", 고정석" : ""}"><span class="desk-top"><span>${Math.floor(i / g.cols) + 1}–${i % g.cols + 1}</span>${locks.has(i) ? "<span>고정</span>" : ""}</span><strong>${blocked.has(i) ? "―" : esc(s?.name || "빈자리")}</strong><span class="desk-number">${s ? `${s.number}번` : blocked.has(i) ? "사용 안 함" : ""}</span></button>`;
  }).join("")}</div><div class="room-bottom"><span>교실 뒤</span><span>앞에서 ${g.planner.frontRows}행까지 앞자리</span></div>`;
}
function studentOptions() { return `<option value="">학생 선택</option>${view.roster.map(s => `<option value="${esc(s.uid)}">${esc(label(s.uid))}</option>`).join("")}`; }
function sidePanel() {
  const p = general.planner, front = new Set(p.frontStudentIds), s = person(general.seats[selected]);
  const lock = p.lockedSeats.some(l => l.index === selected), blocked = general.blocked.includes(selected);
  return `<aside class="planner-settings" aria-label="비공개 자리 조건"><div class="settings-heading"><span>자리 조건</span><small>설정 화면 전용</small></div>
    <fieldset><legend>3분단 · 2명씩 짝</legend><p class="helper">1분단 6줄 · 2분단 6줄 · 3분단 5줄<br>${general.rows * general.cols - general.blocked.length}석 사용 가능 · 학생 ${view.roster.length}명</p></fieldset>
    <fieldset><legend>앞자리를 원하는 학생 <span>${front.size}명</span></legend><label class="inline-label">앞에서<select id="frontRows">${Array.from({ length: general.rows }, (_, i) => `<option value="${i + 1}" ${p.frontRows === i + 1 ? "selected" : ""}>${i + 1}행까지</option>`).join("")}</select></label><div class="student-picker">${view.roster.map(s => `<button type="button" id="front-${esc(s.uid)}" data-front="${esc(s.uid)}" aria-pressed="${front.has(s.uid)}">${s.number}<span>${esc(s.name)}</span></button>`).join("")}</div><p class="helper">앞자리를 원하는 학생을 선택해주세요. 선택한 학생의 앞자리 배치를 보장합니다.</p></fieldset>
    <fieldset><legend>선택한 자리</legend>${selected < 0 ? `<p class="helper">자리를 누르면 고정하거나 사용하지 않는 자리로 바꿀 수 있어요. 두 자리를 차례로 누르면 서로 바뀝니다.</p>` : `<div class="selection-label"><strong>${Math.floor(selected / general.cols) + 1}행 ${selected % general.cols + 1}열</strong><span>${esc(label(general.seats[selected]))}</span></div><div class="button-row"><button id="lockSeat" ${!s ? "disabled" : ""}>${lock ? "고정 해제" : "이 자리에 고정"}</button><button id="blockSeat" ${s ? "disabled" : ""}>${blocked ? "자리 사용" : "사용 안 함"}</button><button id="deselect">선택 해제</button></div>${s ? `<p class="helper">다른 자리를 누르거나 드래그해 교환할 수 있어요.</p>` : ""}`}</fieldset>
    <fieldset><legend>등록된 분산 조건</legend><label class="check-label"><input id="spreadFocus" type="checkbox" ${p.spreadFocus ? "checked" : ""}>최종 지정 학생 ${general.focusStudentIds.length}명 분산</label><p class="helper">PinCon에서 최종 지정한 명단을 불러왔습니다.</p><details id="focusDetails"><summary>지정 명단 확인</summary><p class="private-names">${general.focusStudentIds.map(id => esc(label(id))).join(" · ") || "최종 지정 학생이 없습니다."}</p><a href="../admin/">제안 취합·최종 지정 관리</a></details><label>학생 사이 거리<select id="separationDistance"><option value="2" ${p.separationDistance === 2 ? "selected" : ""}>한 자리 이상 띄우기</option><option value="3" ${p.separationDistance === 3 ? "selected" : ""}>두 자리 이상 띄우기</option><option value="4" ${p.separationDistance === 4 ? "selected" : ""}>세 자리 이상 띄우기</option></select></label><p class="helper">앞뒤·좌우·대각선을 함께 고려합니다.</p></fieldset>
    <fieldset><legend>분리할 조합 <span>${general.separationPairs.length}개</span></legend><div class="pair-list">${general.separationPairs.map(([a, b], i) => `<div><span>${esc(label(a))}<br>${esc(label(b))}</span><button data-remove-pair="${i}" aria-label="${esc(label(a))}, ${esc(label(b))} 조합 삭제">×</button></div>`).join("") || `<p class="helper">등록된 분리 조합이 없습니다.</p>`}</div><label>첫 번째 학생<select id="pairA">${studentOptions()}</select></label><label>두 번째 학생<select id="pairB">${studentOptions()}</select></label><button id="addPair">분리 조합 추가</button></fieldset>
    <fieldset><legend>자리 순환</legend><label class="check-label"><input id="avoidPrevious" type="checkbox" ${p.avoidPrevious ? "checked" : ""}>기존과 같은 자리를 가급적 피하기</label><p class="helper">앞자리·고정석·분리 조건을 먼저 반영합니다.</p></fieldset>
  </aside>`;
}
function reportMarkup() {
  const r = readReport();
  return `<section class="seating-report ${r.hard.length || r.conflicts.length ? "needs-review" : ""}" aria-label="배치 검토"><div><strong>${r.hard.length ? "조건을 확인해주세요" : r.conflicts.length ? `거리 조건 ${r.conflicts.length}건 조정 필요` : "지정한 배치 조건을 충족해요"}</strong><span>${r.assigned}/${view.roster.length}명 배치${general.planner.avoidPrevious ? ` · 기존 자리 ${r.repeat}명` : ""}</span></div>${r.hard.length ? `<ul>${r.hard.map(text => `<li>${esc(text)}</li>`).join("")}</ul>` : ""}${r.conflicts.length ? `<details id="conflictDetails"><summary>남은 거리 조건 확인</summary><ul>${r.conflicts.map(c => `<li>${esc(label(c.a))} · ${esc(label(c.b))} — ${c.type === "pair" ? "분리 조합" : "지정 학생 분산"}</li>`).join("")}</ul><p>조건을 조정하거나 다시 탐색해보세요. 모든 조건을 충족하는 배치가 없을 수도 있습니다.</p></details>` : ""}</section>`;
}
function render() {
  const scroll = root.querySelector(".planner-settings")?.scrollTop || 0, focus = document.activeElement?.id;
  const open = new Set([...root.querySelectorAll("details[open]")].map(el => el.id));
  const r = readReport();
  root.innerHTML = `<div class="planner-shell"><header class="planner-header"><div class="brand"><a class="wordmark" href="../">PinCon</a><span class="brand-divider"></span><h1>자리 설계</h1><span class="class-label">${esc(view.classKey)} · ${view.roster.length}명</span></div><nav><a href="./">교실 배치</a><a class="tv-link" href="${tvURL()}" target="_blank" rel="noopener">TV 자리표 ↗</a></nav></header>
    ${demo ? `<div class="demo-banner">예시 34명으로 체험 중 · 실제 학급 데이터가 아닙니다. <a href="./seating.html">내 학급 연결</a></div>` : ""}
    ${!view.capabilities?.seatingPlanner ? `<div class="demo-banner">자리 설계 서버가 아직 업데이트되지 않아 저장할 수 없습니다.</div>` : ""}
    <div class="planner-toolbar"><div><span class="eyebrow">우리 반의 다음 자리</span><p>조건을 정하고, 배치를 만든 뒤 확인하세요.</p></div><div class="toolbar-actions"><button id="undo" ${!history.length || busy || saving ? "disabled" : ""}>되돌리기</button><button id="reload" ${busy || saving ? "disabled" : ""}>다시 불러오기</button><button id="generate" class="primary" ${busy || saving ? "disabled" : ""}>배치 ${general.seats.some(Boolean) ? "다시 " : ""}만들기</button><button id="save" class="save-button" ${busy || saving || r.hard.length || !view.capabilities?.seatingPlanner ? "disabled" : ""}>${saving ? "저장 중…" : demo ? "예시 자리표 저장" : "자리표 저장"}</button></div></div>
    <div class="planner-status" role="status" aria-live="polite"><span>${esc(message || (dirty() ? "저장하지 않은 변경이 있어요." : "저장된 자리표와 조건을 불러왔어요."))}</span>${busy ? `<progress id="searchProgress" max="1" value="0"></progress><button id="cancel">탐색 취소</button>` : ""}</div>
    <div class="planner-workspace" ${busy || saving ? "inert" : ""}><section class="planner-floor" aria-label="교실 자리표">${room()}${reportMarkup()}<p class="search-note">여러 배치를 탐색해 조건 위반이 가장 적은 결과를 제안합니다. 최종 자리표를 확인한 뒤 저장하세요.</p></section>${sidePanel()}</div></div>`;
  root.querySelector(".planner-status").classList.toggle("is-warning", warning);
  for (const id of open) { const element = document.getElementById(id); if (element) element.open = true; }
  root.querySelector(".planner-settings").scrollTop = scroll;
  bind();
  if (focus) document.getElementById(focus)?.focus({ preventScroll: true });
}
function checkpoint() { history.push(clone(general)); if (history.length > 25) history.shift(); }
function change(fn) { if (busy || saving) return; checkpoint(); fn(); message = "저장하지 않은 변경이 있어요."; warning = false; render(); }
function notify(text, isWarning = false) { message = text; warning = isWarning; render(); }
function swap(a, b) {
  if (a === b) { selected = -1; render(); return; }
  if (general.blocked.includes(a) || general.blocked.includes(b)) return notify("사용하지 않는 자리와는 교환할 수 없습니다.", true);
  if (general.planner.lockedSeats.some(l => l.index === a || l.index === b)) return notify("고정을 해제한 뒤 자리를 교환해주세요.", true);
  const front = new Set(general.planner.frontStudentIds), limit = general.planner.frontRows * general.cols;
  if ((front.has(general.seats[a]) && b >= limit) || (front.has(general.seats[b]) && a >= limit)) return notify("앞자리 지정 학생은 앞자리 범위 안에서만 이동할 수 있습니다.", true);
  change(() => { [general.seats[a], general.seats[b]] = [general.seats[b] || "", general.seats[a] || ""]; selected = -1; });
}
function generate() {
  const errors = constraintErrors(general, ids());
  if (errors.length) return notify(errors.join(" "), true);
  busy = true; message = "앞자리와 고정석을 지키며 배치를 탐색하고 있어요…"; warning = false; render();
  try {
    worker = new Worker(new URL("./seating-worker.js", import.meta.url), { type: "module" });
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    worker.onmessage = ({ data }) => {
      if (data.type === "error") { stop(); notify(data.message, true); return; }
      const progress = document.getElementById("searchProgress"); if (progress) progress.value = data.progress;
      if (data.done) {
        checkpoint(); general.seats = data.seats; selected = -1; stop();
        notify(data.report.conflicts.length ? `탐색을 마쳤어요. 남은 거리 조건 ${data.report.conflicts.length}건을 확인해주세요.` : "조건을 충족하는 배치를 찾았어요. 확인 후 저장해주세요.", !!data.report.conflicts.length);
      }
    };
    worker.onerror = () => { stop(); notify("배치 계산을 시작하지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해주세요.", true); };
    worker.postMessage({ general: { ...clone(general), seats: baseSeats }, ids: ids(), seed });
  } catch { stop(); notify("이 브라우저에서 배치 계산을 실행하지 못했습니다.", true); }
}
function stop() { worker?.terminate(); worker = null; busy = false; }
async function save() {
  if (busy || saving) return;
  const report = readReport(); if (report.hard.length) return notify(report.hard.join(" "), true);
  if (report.conflicts.length && !confirm(`거리 조건 ${report.conflicts.length}건이 충족되지 않았습니다. 검토한 이 자리표를 저장할까요?`)) return;
  saving = true; message = "자리표를 저장하고 있어요…"; render();
  try {
    if (demo) {
      const updatedAtMs = Date.now();
      localStorage.setItem(DEMO_KEY, JSON.stringify(publicSeatingView({ classKey: view.classKey, roster: view.roster, general, updatedAtMs })));
      view.updatedAtMs = updatedAtMs; view.classroomLayout.general = clone(general);
    } else {
      const result = await accountRequest("/api/class-ops/classroom-layout", { method: "POST", networkRetries: 0, body: { action: "SAVE_GENERAL", classKey: view.classKey, baseUpdatedAtMs: view.updatedAtMs, general, acceptConflicts: !!report.conflicts.length } });
      view.classroomLayout = result.classroomLayout; view.updatedAtMs = result.updatedAtMs;
      general = clone(result.classroomLayout.general);
    }
    baseline = JSON.stringify(general); baseSeats = general.seats.slice(); history = [];
    message = demo ? "예시 자리표를 저장했어요. TV 자리표에서 확인하세요." : "저장했어요. TV 자리표는 최대 15초 안에 갱신됩니다."; warning = false;
  } catch (error) {
    warning = true;
    message = error.status === 409 ? "다른 곳에서 명단이나 조건을 변경했습니다. 다시 불러온 뒤 배치를 만들어주세요. 현재 작업은 화면에 남아 있습니다." : `저장을 확인하지 못했습니다. ${error.status === 403 ? "회장·교사·관리자 권한을 확인해주세요." : "연결을 확인하고 다시 불러오기로 저장 상태를 확인해주세요."}`;
  } finally { saving = false; render(); }
}
function bind() {
  const on = (id, event, fn) => document.getElementById(id)?.addEventListener(event, fn);
  on("generate", "click", generate); on("save", "click", save);
  on("cancel", "click", () => { stop(); notify("탐색을 취소했어요. 기존 배치는 유지됩니다."); });
  on("undo", "click", () => { if (history.length) { general = history.pop(); selected = -1; notify("이전 상태로 되돌렸어요."); } });
  on("reload", "click", () => { if (!dirty() || confirm("저장하지 않은 변경을 버리고 다시 불러올까요?")) load(); });
  on("frontRows", "change", e => change(() => { general.planner.frontRows = Number(e.target.value); }));
  for (const key of ["spreadFocus", "avoidPrevious"]) on(key, "change", e => change(() => { general.planner[key] = e.target.checked; }));
  on("separationDistance", "change", e => change(() => { general.planner.separationDistance = Number(e.target.value); }));
  root.querySelectorAll("[data-front]").forEach(button => button.addEventListener("click", () => change(() => {
    const id = button.dataset.front; general.planner.frontStudentIds = general.planner.frontStudentIds.includes(id) ? general.planner.frontStudentIds.filter(uid => uid !== id) : [...general.planner.frontStudentIds, id];
  })));
  root.querySelectorAll("[data-seat]").forEach(button => {
    const index = Number(button.dataset.seat);
    button.addEventListener("click", () => { if (selected >= 0 && !general.blocked.includes(selected) && !general.blocked.includes(index)) swap(selected, index); else { selected = index; render(); } });
    button.addEventListener("dragstart", e => { e.dataTransfer.setData("text/plain", String(index)); e.dataTransfer.effectAllowed = "move"; });
    button.addEventListener("dragover", e => e.preventDefault());
    button.addEventListener("drop", e => { e.preventDefault(); const raw = e.dataTransfer.getData("text/plain"); const from = /^\d+$/.test(raw) ? Number(raw) : -1; if (from >= 0 && from < general.rows * general.cols) swap(from, index); });
  });
  on("deselect", "click", () => { selected = -1; render(); });
  on("lockSeat", "click", () => change(() => { const p = general.planner; p.lockedSeats = p.lockedSeats.some(l => l.index === selected) ? p.lockedSeats.filter(l => l.index !== selected) : [...p.lockedSeats, { uid: general.seats[selected], index: selected }]; }));
  on("blockSeat", "click", () => { if (!general.blocked.includes(selected) && general.blocked.length >= 30) return notify("사용하지 않는 자리는 최대 30개까지 지정할 수 있습니다.", true); change(() => { general.blocked = general.blocked.includes(selected) ? general.blocked.filter(i => i !== selected) : [...general.blocked, selected]; }); });
  on("addPair", "click", () => {
    const a = document.getElementById("pairA").value, b = document.getElementById("pairB").value;
    if (!a || !b || a === b) return notify("서로 다른 두 학생을 선택해주세요.", true);
    if (general.separationPairs.some(pair => pair.includes(a) && pair.includes(b))) return notify("이미 등록된 조합입니다.", true);
    if (general.separationPairs.length >= 100) return notify("분리 조합은 최대 100개까지 등록할 수 있습니다.", true);
    change(() => general.separationPairs.push([a, b]));
  });
  root.querySelectorAll("[data-remove-pair]").forEach(button => button.addEventListener("click", () => change(() => { general.separationPairs.splice(Number(button.dataset.removePair), 1); })));
}
async function load() {
  stop();
  try {
    view = demo ? demoView() : await accountRequest(`/api/class-ops/classroom-layout${requestedClass ? `?classKey=${encodeURIComponent(requestedClass)}` : ""}`);
    if (!view.permissions?.canEdit) throw Object.assign(new Error("operator-required"), { status: 403 });
    general = clone(view.classroomLayout.general); general.planner = normalizePlanner(general.planner, ids());
    baseline = JSON.stringify(general);
    general.rows = 6; general.cols = 6; general.sections = [6, 6, 5];
    general.blocked = [...new Set([...(general.blocked || []).filter(i => i >= 0 && i < 34), 34, 35])];
    general.seats = Array.from({ length: general.rows * general.cols }, (_, i) => general.seats?.[i] || "");
    general.focusStudentIds ||= []; general.separationPairs ||= [];
    baseSeats = general.seats.slice(); history = []; selected = -1; message = ""; warning = false; render();
  } catch {
    root.innerHTML = `<section class="seat-loading"><span class="wordmark">PinCon</span><h1>학급에 연결해주세요</h1><p>PinCon에서 회장·교사·관리자 계정으로 로그인한 뒤 다시 열어주세요.<br>이미 로그인했다면 연결 상태와 계정 권한을 확인해주세요.</p><div class="button-row"><a class="primary" href="../">PinCon 열기</a><button id="retry">다시 시도</button><a href="?demo=1">예시 명단으로 둘러보기</a></div></section>`;
    document.getElementById("retry").addEventListener("click", load);
  }
}
window.addEventListener("beforeunload", e => { if (dirty() && !demo) { e.preventDefault(); e.returnValue = ""; } });
load();
