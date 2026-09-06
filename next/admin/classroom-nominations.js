import { readClassProfile } from "../core/data-gateway.js";
import { accountRequest } from "../core/student-auth.js";

const root = document.querySelector("#adminApp");
let view = null;
let layout = null;
let loading = false;
let saving = false;
let queued = false;

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const classKey = () => readClassProfile()?.classKey || "";
const roster = () => Array.isArray(view?.roster) ? view.roster : [];
const studentLabel = (uid) => {
  const student = roster().find((item) => item.uid === uid);
  return student ? `${Number(student.number) || "-"}번 ${student.name || "이름 없음"}` : "학생 없음";
};

function todayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function options(blank = "학생 선택") {
  return `<option value="">${blank}</option>${roster().map((student) => `<option value="${escapeHtml(student.uid)}">${escapeHtml(studentLabel(student.uid))}</option>`).join("")}`;
}

function nominations() {
  if (!layout?.general) layout.general = {};
  if (!Array.isArray(layout.general.nominations)) layout.general.nominations = [];
  if (!Array.isArray(layout.general.focusStudentIds)) layout.general.focusStudentIds = [];
  if (!Array.isArray(layout.general.separationPairs)) layout.general.separationPairs = [];
  return layout.general.nominations;
}

function studentSummary() {
  const map = new Map();
  for (const item of nominations()) {
    const current = map.get(item.studentUid) || { uid: item.studentUid, count: 0, reasons: new Map(), latest: "" };
    current.count += 1;
    current.reasons.set(item.reason || "기타", (current.reasons.get(item.reason || "기타") || 0) + 1);
    if (String(item.date || "") > current.latest) current.latest = String(item.date || "");
    map.set(item.studentUid, current);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || studentLabel(a.uid).localeCompare(studentLabel(b.uid), "ko"));
}

function pairSummary() {
  const map = new Map();
  for (const item of nominations()) {
    if (!item.partnerUid || item.partnerUid === item.studentUid) continue;
    const ids = [item.studentUid, item.partnerUid].sort();
    const key = ids.join("|");
    const current = map.get(key) || { a: ids[0], b: ids[1], count: 0 };
    current.count += 1;
    map.set(key, current);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

function markup() {
  const students = studentSummary();
  const pairs = pairSummary();
  const recent = nominations().slice().reverse().slice(0, 12);
  const focused = new Set(layout?.general?.focusStudentIds || []);
  const separated = new Set((layout?.general?.separationPairs || []).map((pair) => [...pair].sort().join("|")));
  return `<section class="pincon-layout-nominations" id="pinconClassroomNominations" aria-labelledby="pincon-nomination-title">
    <div class="pincon-layout-subhead"><div><h4 id="pincon-nomination-title">비공개 제안 · 취합</h4><p>제안은 관리자에게만 보이고, 자동으로 학생을 확정하지 않습니다. 최종 지정·분리 반영은 별도 버튼으로 수행합니다.</p></div><span>${nominations().length}건</span></div>
    <div class="pincon-layout-nomination-form">
      <label>제안자<select data-nom-role><option>부장</option><option>반장</option><option>교과교사 전달</option><option>담임 직접 확인</option></select></label>
      <label>대상<select data-nom-student>${options()}</select></label>
      <label>상황<select data-nom-reason><option>설명 중 반복 대화</option><option>수업 시작 방해</option><option>불필요한 자리 이동</option><option>주변 학생 집중 반복 방해</option><option>교사 반복 정숙 요구 원인</option><option>기타</option></select></label>
      <label>함께 대화<select data-nom-partner>${options("없음 / 특정 불가")}</select></label>
      <label class="is-wide">간단 근거<input type="text" maxlength="180" placeholder="관찰 가능한 사실 위주" data-nom-note></label>
      <button type="button" data-add-nomination>제안 추가</button>
    </div>
    <div class="pincon-layout-nomination-grid">
      <div><h5>학생별 취합</h5>${students.length ? students.map((row) => `<div class="pincon-layout-nomination-row"><div><strong>${escapeHtml(studentLabel(row.uid))}</strong><small>${row.count}건 · ${escapeHtml([...row.reasons.entries()].map(([reason, count]) => `${reason} ${count}`).join(" · "))}</small></div>${focused.has(row.uid) ? `<span class="is-done">지정됨</span>` : `<button type="button" data-confirm-focus="${escapeHtml(row.uid)}">최종 지정</button>`}</div>`).join("") : `<p class="pincon-layout-empty">아직 제안이 없습니다.</p>`}</div>
      <div><h5>반복 조합</h5>${pairs.length ? pairs.map((pair) => { const key = [pair.a, pair.b].sort().join("|"); return `<div class="pincon-layout-nomination-row"><div><strong>${escapeHtml(studentLabel(pair.a))} ↔ ${escapeHtml(studentLabel(pair.b))}</strong><small>${pair.count}건 함께 등장</small></div>${separated.has(key) ? `<span class="is-done">분리됨</span>` : `<button type="button" data-confirm-pair="${escapeHtml(pair.a)}|${escapeHtml(pair.b)}">분리 반영</button>`}</div>`; }).join("") : `<p class="pincon-layout-empty">반복 조합이 없습니다.</p>`}</div>
    </div>
    <details class="pincon-layout-nomination-history"><summary>최근 제안 ${recent.length}건 보기</summary><div>${recent.length ? recent.map((item) => `<div class="pincon-layout-nomination-row"><div><strong>${escapeHtml(studentLabel(item.studentUid))}</strong><small>${escapeHtml(item.date || "날짜 없음")} · ${escapeHtml(item.proposerRole)} · ${escapeHtml(item.reason)}${item.note ? ` · ${escapeHtml(item.note)}` : ""}</small></div><button type="button" data-remove-nomination="${escapeHtml(item.id)}" aria-label="제안 삭제"><md-icon>close</md-icon></button></div>`).join("") : `<p class="pincon-layout-empty">최근 제안이 없습니다.</p>`}</div></details>
    <div class="pincon-layout-nomination-status" data-nomination-status role="status"></div>
  </section>`;
}

async function savePrivateLayout() {
  if (saving || !view?.classKey) return;
  saving = true;
  try {
    const result = await accountRequest("/api/class-ops/classroom-layout", {
      method: "POST",
      body: { classKey: view.classKey, action: "SAVE", classroomLayout: layout },
    });
    layout = result.classroomLayout || layout;
  } finally {
    saving = false;
  }
}

async function applyToSeating(change) {
  const settingsView = await accountRequest(`/api/class-ops/settings?classKey=${encodeURIComponent(view.classKey)}`);
  const current = settingsView?.settings?.classroomLayout && typeof settingsView.settings.classroomLayout === "object"
    ? structuredClone(settingsView.settings.classroomLayout)
    : { schemaVersion: 1, mode: "general", general: { rows: 6, cols: 6, seats: [], blocked: [], focusStudentIds: [], separationPairs: [] }, groups: {}, assessment: { lines: 6, seats: [] } };
  current.general ||= {};
  current.general.focusStudentIds = Array.isArray(current.general.focusStudentIds) ? current.general.focusStudentIds : [];
  current.general.separationPairs = Array.isArray(current.general.separationPairs) ? current.general.separationPairs : [];
  if (change.focusUid && !current.general.focusStudentIds.includes(change.focusUid)) current.general.focusStudentIds.push(change.focusUid);
  if (change.pair) {
    const key = [...change.pair].sort().join("|");
    if (!current.general.separationPairs.some((pair) => Array.isArray(pair) && [...pair].sort().join("|") === key)) current.general.separationPairs.push(change.pair);
  }
  await accountRequest("/api/class-ops/settings", {
    method: "POST",
    body: { classKey: view.classKey, action: "UPDATE_CLASSROOM_LAYOUT", classroomLayout: current },
  });
}

function bind(section) {
  section.querySelector("[data-add-nomination]")?.addEventListener("click", async () => {
    const studentUid = section.querySelector("[data-nom-student]")?.value || "";
    const partnerUid = section.querySelector("[data-nom-partner]")?.value || "";
    if (!studentUid || studentUid === partnerUid) return;
    nominations().push({
      id: `nom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      studentUid,
      proposerRole: section.querySelector("[data-nom-role]")?.value || "부장",
      reason: section.querySelector("[data-nom-reason]")?.value || "기타",
      partnerUid,
      note: String(section.querySelector("[data-nom-note]")?.value || "").trim(),
      date: todayKey(),
    });
    await savePrivateLayout();
    mount({ force: true });
  });
  section.querySelectorAll("[data-remove-nomination]").forEach((button) => button.addEventListener("click", async () => {
    layout.general.nominations = nominations().filter((item) => item.id !== button.dataset.removeNomination);
    await savePrivateLayout();
    mount({ force: true });
  }));
  section.querySelectorAll("[data-confirm-focus]").forEach((button) => button.addEventListener("click", async () => {
    const status = section.querySelector("[data-nomination-status]");
    status.textContent = "자리배치 조건에 반영 중…";
    const uid = button.dataset.confirmFocus;
    if (!layout.general.focusStudentIds.includes(uid)) layout.general.focusStudentIds.push(uid);
    await Promise.all([savePrivateLayout(), applyToSeating({ focusUid: uid })]);
    location.reload();
  }));
  section.querySelectorAll("[data-confirm-pair]").forEach((button) => button.addEventListener("click", async () => {
    const [a, b] = String(button.dataset.confirmPair || "").split("|");
    if (!a || !b || a === b) return;
    const key = [a, b].sort().join("|");
    if (!layout.general.separationPairs.some((pair) => [...pair].sort().join("|") === key)) layout.general.separationPairs.push([a, b]);
    await Promise.all([savePrivateLayout(), applyToSeating({ pair: [a, b] })]);
    location.reload();
  }));
}

function mount({ force = false } = {}) {
  const host = root?.querySelector("#pinconClassroomLayout [data-mode-panel='general']");
  if (!host || !view || !layout) return;
  const existing = host.querySelector("#pinconClassroomNominations");
  if (existing && !force) return;
  existing?.remove();
  const constraints = host.querySelector(".pincon-layout-constraints");
  if (constraints) constraints.insertAdjacentHTML("beforebegin", markup());
  else host.insertAdjacentHTML("beforeend", markup());
  bind(host.querySelector("#pinconClassroomNominations"));
}

async function load(force = false) {
  if (loading || (view && !force)) return;
  const target = classKey();
  if (!target) return;
  loading = true;
  try {
    view = await accountRequest(`/api/class-ops/classroom-layout?classKey=${encodeURIComponent(target)}`);
    layout = view.classroomLayout || { schemaVersion: 1, mode: "general", general: { nominations: [], focusStudentIds: [], separationPairs: [] }, groups: {}, assessment: { lines: 6, seats: [] } };
    layout.general ||= {};
    nominations();
  } catch (error) {
    if (error?.status !== 403) console.warn("[PinCon] classroom nominations load failed", error);
  } finally {
    loading = false;
    mount({ force: true });
  }
}

function queueMount() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    if (!root?.querySelector("#adminMain")) return;
    mount();
    load();
  });
}

new MutationObserver(queueMount).observe(root, { childList: true, subtree: true });
queueMount();
