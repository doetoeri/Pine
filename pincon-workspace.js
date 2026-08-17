import { f as firebaseApi } from "./assets/firebase-IW9tbrMW.js";

const FIREBASE = globalThis.PINCON_FIREBASE_CONFIG || {};
const SCHOOL = globalThis.PINCON_SCHOOL_CONFIG || { id: "gochon-high", name: "학교" };
const PROJECT_ID = FIREBASE.projectId;
const STORAGE_BUCKET = FIREBASE.storageBucket;
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const STORAGE_BASE = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(STORAGE_BUCKET || "")}/o`;
const REFRESH_MS = 20_000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

let currentUser = null;
let currentClassKey = "";
let classContent = [];
let unsubscribeContent = null;
let refreshTimer = null;
let activePanel = "polls";
let selectedGroupId = "";
let state = {
  polls: [],
  assignments: [],
  driveItems: [],
  votes: new Map(),
  loading: false,
  error: "",
};

const style = document.createElement("style");
style.textContent = `
  .pincon-workspace { grid-column: 1 / -1; margin-top: 18px; }
  .pincon-workspace-head { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; margin-bottom:14px; }
  .pincon-workspace-head p,.pincon-workspace-head h2 { margin:0; }
  .pincon-workspace-head p { color:var(--md-sys-color-primary); margin-bottom:2px; }
  .pincon-workspace-copy { margin:0 0 14px; color:var(--md-sys-color-on-surface-variant); }
  .pincon-workspace-tabs { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px; }
  .pincon-workspace-tabs button { border:0; border-radius:999px; padding:10px 14px; font:inherit; cursor:pointer; color:var(--md-sys-color-on-surface-variant); background:var(--md-sys-color-surface-container); }
  .pincon-workspace-tabs button[aria-selected="true"] { color:var(--md-sys-color-on-primary-container); background:var(--md-sys-color-primary-container); font-weight:650; }
  .pincon-feature-panel { display:grid; gap:14px; }
  .pincon-feature-toolbar { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  .pincon-feature-toolbar .spacer { flex:1 1 auto; }
  .pincon-feature-card { padding:18px; border-radius:22px; background:var(--md-sys-color-surface-container-low); border:1px solid color-mix(in srgb,var(--md-sys-color-outline-variant) 75%, transparent); }
  .pincon-feature-card h3 { margin:0; font-size:1rem; line-height:1.4; }
  .pincon-feature-meta { margin-top:5px; color:var(--md-sys-color-on-surface-variant); font-size:.82rem; }
  .pincon-feature-actions { margin-top:12px; display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  .pincon-empty-feature { padding:22px; border-radius:22px; text-align:center; color:var(--md-sys-color-on-surface-variant); background:var(--md-sys-color-surface-container-low); }
  .pincon-poll-options { display:grid; gap:8px; margin-top:14px; }
  .pincon-poll-option { position:relative; overflow:hidden; display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:9px; padding:10px 12px; border-radius:14px; background:var(--md-sys-color-surface-container-high); }
  .pincon-poll-option::before { content:""; position:absolute; inset:0 auto 0 0; width:var(--poll-percent,0%); background:color-mix(in srgb,var(--md-sys-color-primary-container) 68%, transparent); pointer-events:none; }
  .pincon-poll-option > * { position:relative; z-index:1; }
  .pincon-poll-option input { accent-color:var(--md-sys-color-primary); }
  .pincon-poll-count { font-size:.8rem; color:var(--md-sys-color-on-surface-variant); white-space:nowrap; }
  .pincon-status-pill { display:inline-flex; align-items:center; padding:4px 9px; border-radius:999px; font-size:.75rem; font-weight:650; background:var(--md-sys-color-secondary-container); color:var(--md-sys-color-on-secondary-container); }
  .pincon-status-pill.done { background:var(--md-sys-color-primary-container); color:var(--md-sys-color-on-primary-container); }
  .pincon-status-pill.overdue { background:var(--md-sys-color-error-container); color:var(--md-sys-color-on-error-container); }
  .pincon-drive-grid { display:grid; gap:10px; grid-template-columns:repeat(2,minmax(0,1fr)); }
  .pincon-drive-item { padding:14px; border-radius:18px; background:var(--md-sys-color-surface-container-low); border:1px solid color-mix(in srgb,var(--md-sys-color-outline-variant) 75%,transparent); }
  .pincon-drive-item-head { display:flex; gap:10px; align-items:flex-start; }
  .pincon-drive-icon { width:38px; height:38px; border-radius:12px; display:grid; place-items:center; flex:0 0 auto; background:var(--md-sys-color-primary-container); color:var(--md-sys-color-on-primary-container); }
  .pincon-drive-item h3 { margin:0; font-size:.95rem; overflow-wrap:anywhere; }
  .pincon-drive-body { margin:10px 0 0; white-space:pre-wrap; overflow-wrap:anywhere; color:var(--md-sys-color-on-surface-variant); }
  .pincon-drive-link { color:var(--md-sys-color-primary); overflow-wrap:anywhere; }
  .pincon-assignment-row { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:12px; align-items:start; }
  .pincon-assignment-due { font-size:.82rem; color:var(--md-sys-color-on-surface-variant); white-space:nowrap; }
  .pincon-progress-buttons { display:flex; gap:6px; flex-wrap:wrap; margin-top:12px; }
  .pincon-progress-buttons button { border:0; border-radius:999px; padding:7px 11px; font:inherit; font-size:.8rem; cursor:pointer; background:var(--md-sys-color-surface-container-highest); color:var(--md-sys-color-on-surface); }
  .pincon-progress-buttons button.active { background:var(--md-sys-color-primary-container); color:var(--md-sys-color-on-primary-container); font-weight:650; }
  .pincon-trash { margin-top:8px; padding-top:12px; border-top:1px solid var(--md-sys-color-outline-variant); }
  .pincon-trash summary { cursor:pointer; color:var(--md-sys-color-on-surface-variant); }
  .pincon-trash-list { display:grid; gap:8px; margin-top:10px; }
  .pincon-trash-row { display:flex; align-items:center; gap:8px; justify-content:space-between; padding:10px 12px; border-radius:14px; background:var(--md-sys-color-surface-container); }
  .pincon-feature-error { margin:0; padding:10px 12px; border-radius:14px; color:var(--md-sys-color-on-error-container); background:var(--md-sys-color-error-container); }
  .pincon-feature-loading { color:var(--md-sys-color-on-surface-variant); }
  .pincon-feature-dialog { border:0; border-radius:28px; width:min(92vw,580px); max-height:88vh; padding:0; background:var(--md-sys-color-surface-container-high); color:var(--md-sys-color-on-surface); box-shadow:0 24px 64px rgba(0,0,0,.24); }
  .pincon-feature-dialog::backdrop { background:rgba(15,23,42,.38); backdrop-filter:blur(4px); }
  .pincon-feature-dialog form { padding:24px; display:grid; gap:14px; }
  .pincon-feature-dialog h2 { margin:0; font-size:1.35rem; }
  .pincon-feature-dialog label { display:grid; gap:6px; font-size:.86rem; color:var(--md-sys-color-on-surface-variant); }
  .pincon-feature-dialog input,.pincon-feature-dialog textarea,.pincon-feature-dialog select { width:100%; box-sizing:border-box; border:1px solid rgba(100,116,139,.45); border-radius:14px; padding:11px 12px; font:inherit; background:var(--md-sys-color-surface); color:var(--md-sys-color-on-surface); }
  .pincon-feature-dialog textarea { resize:vertical; min-height:92px; }
  .pincon-feature-dialog .inline-check { display:flex; align-items:center; gap:9px; }
  .pincon-feature-dialog .inline-check input { width:auto; }
  .pincon-dialog-actions { display:flex; justify-content:flex-end; gap:8px; }
  .pincon-native-button { border:0; border-radius:999px; padding:10px 16px; font:inherit; cursor:pointer; }
  .pincon-native-button.primary { background:var(--md-sys-color-primary); color:var(--md-sys-color-on-primary); }
  .pincon-native-button.tonal { background:var(--md-sys-color-secondary-container); color:var(--md-sys-color-on-secondary-container); }
  @media (max-width:700px){ .pincon-drive-grid{grid-template-columns:1fr}.pincon-assignment-row{grid-template-columns:1fr}.pincon-assignment-due{white-space:normal} }
`;
document.head.appendChild(style);

function profileClassKey() {
  try {
    const profile = JSON.parse(localStorage.getItem("pincon-profile-v2") || "null");
    const grade = Number(profile?.grade);
    const classNumber = Number(profile?.classNumber);
    if (!Number.isInteger(grade) || grade < 1 || grade > 3) return "";
    if (!Number.isInteger(classNumber) || classNumber < 1 || classNumber > 10) return "";
    return `${grade}-${classNumber}`;
  } catch {
    return "";
  }
}

function authorName() {
  return currentUser?.displayName || currentUser?.email || "학생";
}

function uid() {
  return currentUser?.uid || "";
}

function id(prefix = "d") {
  const random = crypto.randomUUID ? crypto.randomUUID().replaceAll("-", "") : `${Date.now()}${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random.slice(0, 28)}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function formatDateTime(ms) {
  if (!Number(ms)) return "";
  try {
    return new Intl.DateTimeFormat("ko-KR", { month:"numeric", day:"numeric", hour:"numeric", minute:"2-digit" }).format(new Date(Number(ms)));
  } catch {
    return "";
  }
}

function formatBytes(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 ** 2).toFixed(1)} MB`;
}

function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (typeof value === "object") {
    const fields = {};
    for (const [key, child] of Object.entries(value)) fields[key] = encodeValue(child);
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function decodeValue(value) {
  if (!value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return Date.parse(value.timestampValue);
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeValue);
  if ("mapValue" in value) return decodeFields(value.mapValue.fields || {});
  return null;
}

function decodeFields(fields = {}) {
  const result = {};
  for (const [key, value] of Object.entries(fields)) result[key] = decodeValue(value);
  return result;
}

function decodeDocument(doc) {
  const path = String(doc.name || "");
  return { id: path.slice(path.lastIndexOf("/") + 1), ...decodeFields(doc.fields || {}) };
}

async function idToken(force = false) {
  if (!currentUser) throw new Error("Google 로그인이 필요합니다.");
  return currentUser.getIdToken(force);
}

async function apiFetch(url, init = {}, storage = false) {
  const token = await idToken();
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", storage ? `Firebase ${token}` : `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json();
      message = payload?.error?.message || payload?.error || message;
    } catch {}
    if (response.status === 401) {
      try {
        const retry = await currentUser.getIdToken(true);
        headers.set("Authorization", storage ? `Firebase ${retry}` : `Bearer ${retry}`);
        const second = await fetch(url, { ...init, headers });
        if (second.ok) return second;
      } catch {}
    }
    throw new Error(message);
  }
  return response;
}

async function listCollection(path) {
  const all = [];
  let token = "";
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (token) params.set("pageToken", token);
    const response = await apiFetch(`${FIRESTORE_BASE}/${path}?${params}`);
    const payload = await response.json();
    all.push(...(payload.documents || []).map(decodeDocument));
    token = payload.nextPageToken || "";
  } while (token);
  return all;
}

async function getDoc(documentPath) {
  const token = await idToken();
  const response = await fetch(`${FIRESTORE_BASE}/${documentPath}`, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 404) return null;
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json();
      message = payload?.error?.message || message;
    } catch {}
    throw new Error(message);
  }
  return decodeDocument(await response.json());
}

async function createDoc(collectionPath, documentId, data) {
  const params = new URLSearchParams({ documentId });
  const fields = {};
  for (const [key, value] of Object.entries(data)) fields[key] = encodeValue(value);
  const response = await apiFetch(`${FIRESTORE_BASE}/${collectionPath}?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  return decodeDocument(await response.json());
}

async function patchDoc(documentPath, data) {
  const params = new URLSearchParams();
  const fields = {};
  for (const [key, value] of Object.entries(data)) {
    fields[key] = encodeValue(value);
    params.append("updateMask.fieldPaths", key);
  }
  const response = await apiFetch(`${FIRESTORE_BASE}/${documentPath}?${params}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  return decodeDocument(await response.json());
}

async function upsertDoc(documentPath, data) {
  return patchDoc(documentPath, data);
}

function schoolPath(collection) {
  return `schools/${SCHOOL.id}/${collection}`;
}

function groupItemsPath(groupId) {
  return `${schoolPath("groupDrive")}/${groupId}/items`;
}

function pollVotesPath(pollId) {
  return `${schoolPath("polls")}/${pollId}/votes`;
}

function groups() {
  return classContent.filter((item) => item.kind === "group" && !item.deleted);
}

function effectivePollOpen(poll) {
  return !poll.deleted && poll.status === "open";
}

async function loadVotesForPoll(poll) {
  try {
    const votes = await listCollection(pollVotesPath(poll.id));
    state.votes.set(poll.id, votes);
  } catch {
    state.votes.set(poll.id, []);
  }
}

async function refreshAll({ silent = false } = {}) {
  if (!currentUser || !currentClassKey || !PROJECT_ID) return;
  if (!silent) state.loading = true;
  state.error = "";
  queueRender();
  try {
    const [polls, assignments] = await Promise.all([
      listCollection(schoolPath("polls")),
      listCollection(schoolPath("assignments")),
    ]);
    state.polls = polls.filter((poll) => poll.classKey === currentClassKey).sort((a,b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
    state.assignments = assignments.filter((assignment) => assignment.classKey === currentClassKey).sort((a,b) => (a.dueAtMs || Number.MAX_SAFE_INTEGER) - (b.dueAtMs || Number.MAX_SAFE_INTEGER));
    state.votes = new Map();
    await Promise.all(state.polls.filter((poll) => !poll.deleted).slice(0, 12).map(loadVotesForPoll));
    if (!selectedGroupId && groups().length) selectedGroupId = groups()[0].id;
    if (selectedGroupId) {
      const items = await listCollection(groupItemsPath(selectedGroupId));
      state.driveItems = items.sort((a,b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
    } else {
      state.driveItems = [];
    }
    if (activePanel === "assignments") await loadAssignmentProgress();
  } catch (error) {
    state.error = error?.message || "데이터를 불러오지 못했습니다.";
  } finally {
    state.loading = false;
    queueRender();
  }
}

function buildPollCounts(poll) {
  const votes = state.votes.get(poll.id) || [];
  const counts = Array.from({ length: (poll.options || []).length }, () => 0);
  for (const vote of votes) {
    for (const index of vote.selected || []) {
      if (Number.isInteger(index) && index >= 0 && index < counts.length) counts[index] += 1;
    }
  }
  return { votes, counts };
}

function renderPolls() {
  const active = state.polls.filter((poll) => !poll.deleted);
  const deleted = state.polls.filter((poll) => poll.deleted);
  const cards = active.map((poll) => {
    const { votes, counts } = buildPollCounts(poll);
    const myVote = votes.find((vote) => vote.voterUid === uid());
    const totalVoters = votes.length;
    const open = effectivePollOpen(poll);
    const type = poll.multiple ? "checkbox" : "radio";
    const name = `poll-${poll.id}`;
    const options = (poll.options || []).map((option, index) => {
      const checked = (myVote?.selected || []).includes(index) ? "checked" : "";
      const percent = totalVoters ? Math.round((counts[index] / totalVoters) * 100) : 0;
      return `<label class="pincon-poll-option" style="--poll-percent:${percent}%">
        <input type="${type}" name="${escapeAttr(name)}" value="${index}" ${checked} ${open ? "" : "disabled"}>
        <span>${escapeHtml(option)}</span>
        <span class="pincon-poll-count">${counts[index]}표 · ${percent}%</span>
      </label>`;
    }).join("");
    return `<article class="pincon-feature-card" data-poll-id="${escapeAttr(poll.id)}">
      <div style="display:flex;gap:10px;align-items:flex-start;justify-content:space-between">
        <div><h3>${escapeHtml(poll.question)}</h3><div class="pincon-feature-meta">${escapeHtml(poll.authorName || "학생")} · ${totalVoters}명 참여${poll.multiple ? " · 복수 선택" : ""}</div></div>
        <span class="pincon-status-pill ${open ? "" : "done"}">${open ? "진행 중" : "종료"}</span>
      </div>
      <div class="pincon-poll-options">${options}</div>
      <div class="pincon-feature-actions">
        ${open ? '<md-filled-button type="button" data-action="vote"><md-icon slot="icon">how_to_vote</md-icon>투표 저장</md-filled-button>' : ""}
        <md-text-button type="button" data-action="toggle">${open ? "투표 종료" : "다시 열기"}</md-text-button>
        <md-text-button type="button" data-action="delete">삭제</md-text-button>
      </div>
    </article>`;
  }).join("");

  return `<div class="pincon-feature-panel">
    <div class="pincon-feature-toolbar">
      <md-filled-button type="button" data-workspace-action="new-poll"><md-icon slot="icon">add</md-icon>빠른 투표 만들기</md-filled-button>
      <div class="spacer"></div>
      <span class="pincon-status-pill">${active.length}개</span>
    </div>
    ${cards || '<div class="pincon-empty-feature"><md-icon>how_to_vote</md-icon><p>아직 투표가 없습니다. 10초짜리 의사결정 도구를 하나 만들어 보세요.</p></div>'}
    ${deleted.length ? `<details class="pincon-trash"><summary>삭제된 투표 ${deleted.length}개</summary><div class="pincon-trash-list">${deleted.map((poll) => `<div class="pincon-trash-row"><span>${escapeHtml(poll.question)}</span><md-text-button data-restore-poll="${escapeAttr(poll.id)}">복원</md-text-button></div>`).join("")}</div></details>` : ""}
  </div>`;
}

function iconForDriveType(type) {
  return type === "file" ? "description" : type === "link" ? "link" : "sticky_note_2";
}

function renderDrive() {
  const allGroups = groups();
  const group = allGroups.find((item) => item.id === selectedGroupId);
  const active = state.driveItems.filter((item) => !item.deleted);
  const deleted = state.driveItems.filter((item) => item.deleted);
  const groupOptions = allGroups.map((item) => `<option value="${escapeAttr(item.id)}" ${item.id === selectedGroupId ? "selected" : ""}>${escapeHtml(item.groupLabel || item.title || item.subject || "모둠")}</option>`).join("");
  const items = active.map((item) => `<article class="pincon-drive-item" data-drive-id="${escapeAttr(item.id)}">
    <div class="pincon-drive-item-head"><div class="pincon-drive-icon"><md-icon>${iconForDriveType(item.type)}</md-icon></div><div style="min-width:0"><h3>${escapeHtml(item.title || "제목 없음")}</h3><div class="pincon-feature-meta">${escapeHtml(item.authorName || "학생")} · ${formatDateTime(item.createdAtMs)}${item.type === "file" ? ` · ${formatBytes(item.size)}` : ""}</div></div></div>
    ${item.type === "note" ? `<p class="pincon-drive-body">${escapeHtml(item.body || "")}</p>` : ""}
    ${item.type === "link" ? `<p class="pincon-drive-body"><a class="pincon-drive-link" href="${escapeAttr(item.url || "#")}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.url || "")}</a></p>` : ""}
    <div class="pincon-feature-actions">
      ${item.type === "file" ? '<md-text-button type="button" data-action="download"><md-icon slot="icon">download</md-icon>열기</md-text-button>' : ""}
      <md-text-button type="button" data-action="delete">삭제</md-text-button>
    </div>
  </article>`).join("");

  return `<div class="pincon-feature-panel">
    <div class="pincon-feature-toolbar">
      <label style="display:flex;align-items:center;gap:8px">모둠 <select id="pincon-drive-group-select" ${allGroups.length ? "" : "disabled"}>${groupOptions || '<option>모둠 없음</option>'}</select></label>
      <div class="spacer"></div>
      ${group ? '<md-filled-button type="button" data-workspace-action="upload-file"><md-icon slot="icon">upload_file</md-icon>파일</md-filled-button><md-filled-tonal-button type="button" data-workspace-action="new-link">링크</md-filled-tonal-button><md-filled-tonal-button type="button" data-workspace-action="new-note">메모</md-filled-tonal-button>' : ""}
    </div>
    ${!allGroups.length ? '<div class="pincon-empty-feature"><md-icon>group</md-icon><p>먼저 모둠을 하나 등록하면 모둠 드라이브가 자동으로 생깁니다.</p></div>' : `<div class="pincon-drive-grid">${items || '<div class="pincon-empty-feature" style="grid-column:1/-1"><md-icon>folder_open</md-icon><p>이 모둠 드라이브는 아직 비어 있습니다.</p></div>'}</div>`}
    ${deleted.length ? `<details class="pincon-trash"><summary>삭제된 드라이브 항목 ${deleted.length}개</summary><div class="pincon-trash-list">${deleted.map((item) => `<div class="pincon-trash-row"><span>${escapeHtml(item.title)}</span><md-text-button data-restore-drive="${escapeAttr(item.id)}">복원</md-text-button></div>`).join("")}</div></details>` : ""}
  </div>`;
}

function assignmentStatus(assignment) {
  const progress = assignment.progress || "todo";
  const overdue = assignment.dueAtMs && assignment.dueAtMs < Date.now() && progress !== "done";
  return overdue ? "overdue" : progress;
}

function renderAssignments() {
  const active = state.assignments.filter((item) => !item.deleted);
  const deleted = state.assignments.filter((item) => item.deleted);
  const cards = active.map((assignment) => {
    const status = assignmentStatus(assignment);
    const group = groups().find((item) => item.id === assignment.groupId);
    return `<article class="pincon-feature-card" data-assignment-id="${escapeAttr(assignment.id)}">
      <div class="pincon-assignment-row"><div><h3>${escapeHtml(assignment.title)}</h3><div class="pincon-feature-meta">${escapeHtml(assignment.subject || "과목 미지정")}${group ? ` · ${escapeHtml(group.groupLabel || group.title || "모둠")}` : ""}</div></div><div class="pincon-assignment-due">${assignment.dueAtMs ? `마감 ${formatDateTime(assignment.dueAtMs)}` : "마감 없음"}</div></div>
      ${assignment.description ? `<p class="pincon-drive-body">${escapeHtml(assignment.description)}</p>` : ""}
      <div class="pincon-progress-buttons" aria-label="과제 진행 상태">
        <button data-progress="todo" class="${assignment.progress === "todo" || !assignment.progress ? "active" : ""}">해야 함</button>
        <button data-progress="doing" class="${assignment.progress === "doing" ? "active" : ""}">진행 중</button>
        <button data-progress="done" class="${assignment.progress === "done" ? "active" : ""}">완료</button>
        ${status === "overdue" ? '<span class="pincon-status-pill overdue">기한 지남</span>' : ""}
      </div>
      <div class="pincon-feature-actions">
        ${group ? '<md-text-button type="button" data-action="open-drive"><md-icon slot="icon">folder</md-icon>모둠 드라이브</md-text-button>' : ""}
        <md-text-button type="button" data-action="edit">수정</md-text-button>
        <md-text-button type="button" data-action="delete">삭제</md-text-button>
      </div>
    </article>`;
  }).join("");

  return `<div class="pincon-feature-panel">
    <div class="pincon-feature-toolbar"><md-filled-button type="button" data-workspace-action="new-assignment"><md-icon slot="icon">add_task</md-icon>과제 추가</md-filled-button><div class="spacer"></div><span class="pincon-status-pill">${active.length}개</span></div>
    ${cards || '<div class="pincon-empty-feature"><md-icon>assignment</md-icon><p>등록된 과제가 없습니다. 마감과 모둠 자료를 한곳에서 연결할 수 있습니다.</p></div>'}
    ${deleted.length ? `<details class="pincon-trash"><summary>삭제된 과제 ${deleted.length}개</summary><div class="pincon-trash-list">${deleted.map((item) => `<div class="pincon-trash-row"><span>${escapeHtml(item.title)}</span><md-text-button data-restore-assignment="${escapeAttr(item.id)}">복원</md-text-button></div>`).join("")}</div></details>` : ""}
  </div>`;
}

function renderWorkspace() {
  const settingsGrid = document.querySelector(".settings-grid");
  let section = document.querySelector(".pincon-workspace");
  if (!settingsGrid || !currentUser || !currentClassKey) {
    section?.remove();
    return;
  }
  if (!section) {
    section = document.createElement("section");
    section.className = "content-section editor-section pincon-workspace";
    section.setAttribute("aria-label", "Pincon 협업 도구");
    settingsGrid.appendChild(section);
  }
  const panel = activePanel === "polls" ? renderPolls() : activePanel === "drive" ? renderDrive() : renderAssignments();
  section.innerHTML = `<div class="pincon-workspace-head"><div><p class="md-typescale-label-large">학급 협업</p><h2 class="md-typescale-headline-small">Pincon Workspace</h2></div><md-assist-chip label="${escapeAttr(currentClassKey)}"></md-assist-chip></div>
    <p class="pincon-workspace-copy md-typescale-body-medium">투표 → 모둠 드라이브 → 과제를 서로 연결해 반 안에서 결정, 자료, 마감을 한 흐름으로 관리합니다.</p>
    <nav class="pincon-workspace-tabs" aria-label="협업 기능">
      <button type="button" data-panel="polls" aria-selected="${activePanel === "polls"}">빠른 투표</button>
      <button type="button" data-panel="drive" aria-selected="${activePanel === "drive"}">모둠 드라이브</button>
      <button type="button" data-panel="assignments" aria-selected="${activePanel === "assignments"}">과제 허브</button>
    </nav>
    ${state.error ? `<p class="pincon-feature-error">${escapeHtml(state.error)}</p>` : ""}
    ${state.loading ? '<p class="pincon-feature-loading">동기화 중…</p>' : ""}
    ${panel}`;
  bindWorkspaceEvents(section);
}

let renderQueued = false;
function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderWorkspace();
  });
}

function ensureDialog(idValue, title) {
  let dialog = document.getElementById(idValue);
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = idValue;
  dialog.className = "pincon-feature-dialog";
  dialog.innerHTML = `<form method="dialog"><h2>${escapeHtml(title)}</h2><div class="pincon-dialog-fields"></div><p class="pincon-feature-error" hidden></p><div class="pincon-dialog-actions"><button type="button" class="pincon-native-button tonal" data-cancel>취소</button><button type="submit" class="pincon-native-button primary">저장</button></div></form>`;
  document.body.appendChild(dialog);
  dialog.querySelector("[data-cancel]").addEventListener("click", () => dialog.close());
  return dialog;
}

function setDialogError(dialog, message = "") {
  const el = dialog.querySelector(".pincon-feature-error");
  el.textContent = message;
  el.hidden = !message;
}

function openPollDialog() {
  const dialog = ensureDialog("pincon-new-poll-dialog", "빠른 투표 만들기");
  const fields = dialog.querySelector(".pincon-dialog-fields");
  fields.innerHTML = `<label>질문<input name="question" maxlength="120" required placeholder="예: 체육대회 반티 색상은?"></label><label>선택지<textarea name="options" required placeholder="한 줄에 하나씩 입력\n초록\n검정\n흰색"></textarea></label><label class="inline-check"><input type="checkbox" name="multiple">복수 선택 허용</label>`;
  dialog.querySelector("form").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const question = String(data.get("question") || "").trim();
    const options = String(data.get("options") || "").split("\n").map((v) => v.trim()).filter(Boolean).slice(0, 8);
    if (!question || options.length < 2) return setDialogError(dialog, "질문과 선택지 2개 이상을 입력해 주세요.");
    try {
      form.querySelector('button[type="submit"]').disabled = true;
      await createDoc(schoolPath("polls"), id("poll"), { classKey: currentClassKey, question, options, multiple: data.get("multiple") === "on", status:"open", deleted:false, authorUid:uid(), authorName:authorName(), createdAtMs:Date.now(), updatedAtMs:Date.now() });
      dialog.close();
      await refreshAll({ silent:true });
    } catch (error) { setDialogError(dialog, error?.message || "투표를 만들지 못했습니다."); }
    finally { form.querySelector('button[type="submit"]').disabled = false; }
  };
  setDialogError(dialog);
  dialog.showModal();
}

function openDriveTextDialog(type) {
  if (!selectedGroupId) return;
  const isLink = type === "link";
  const dialog = ensureDialog(`pincon-drive-${type}-dialog`, isLink ? "드라이브 링크 추가" : "드라이브 메모 추가");
  dialog.querySelector(".pincon-dialog-fields").innerHTML = isLink
    ? `<label>제목<input name="title" maxlength="100" required></label><label>URL<input name="url" type="url" maxlength="1000" required placeholder="https://"></label>`
    : `<label>제목<input name="title" maxlength="100" required></label><label>내용<textarea name="body" maxlength="4000" required></textarea></label>`;
  dialog.querySelector("form").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get("title") || "").trim();
    const body = String(data.get(isLink ? "url" : "body") || "").trim();
    if (!title || !body) return setDialogError(dialog, "필수 항목을 입력해 주세요.");
    try {
      form.querySelector('button[type="submit"]').disabled = true;
      const payload = { classKey:currentClassKey, groupId:selectedGroupId, type, title, deleted:false, authorUid:uid(), authorName:authorName(), createdAtMs:Date.now(), updatedAtMs:Date.now() };
      if (isLink) payload.url = body; else payload.body = body;
      await createDoc(groupItemsPath(selectedGroupId), id("item"), payload);
      dialog.close();
      await loadDriveItems();
    } catch (error) { setDialogError(dialog, error?.message || "추가하지 못했습니다."); }
    finally { form.querySelector('button[type="submit"]').disabled = false; }
  };
  setDialogError(dialog);
  dialog.showModal();
}

function openAssignmentDialog(existing = null) {
  const dialog = ensureDialog("pincon-assignment-dialog", existing ? "과제 수정" : "과제 추가");
  const groupOptions = `<option value="">개인/학급 과제</option>${groups().map((group) => `<option value="${escapeAttr(group.id)}" ${existing?.groupId === group.id ? "selected" : ""}>${escapeHtml(group.groupLabel || group.title || "모둠")}</option>`).join("")}`;
  let dueValue = "";
  if (existing?.dueAtMs) {
    const d = new Date(existing.dueAtMs - new Date().getTimezoneOffset() * 60000);
    dueValue = d.toISOString().slice(0,16);
  }
  dialog.querySelector("h2").textContent = existing ? "과제 수정" : "과제 추가";
  dialog.querySelector(".pincon-dialog-fields").innerHTML = `<label>과목<input name="subject" maxlength="60" value="${escapeAttr(existing?.subject || "")}" placeholder="통합과학"></label><label>과제 제목<input name="title" maxlength="120" required value="${escapeAttr(existing?.title || "")}"></label><label>설명<textarea name="description" maxlength="2000">${escapeHtml(existing?.description || "")}</textarea></label><label>마감<input name="dueAt" type="datetime-local" value="${escapeAttr(dueValue)}"></label><label>연결할 모둠<select name="groupId">${groupOptions}</select></label>`;
  dialog.querySelector("form").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get("title") || "").trim();
    if (!title) return setDialogError(dialog, "과제 제목을 입력해 주세요.");
    const dueAt = String(data.get("dueAt") || "");
    const payload = { classKey:currentClassKey, subject:String(data.get("subject") || "").trim(), title, description:String(data.get("description") || "").trim(), dueAtMs:dueAt ? new Date(dueAt).getTime() : 0, groupId:String(data.get("groupId") || ""), deleted:false, updatedAtMs:Date.now() };
    try {
      form.querySelector('button[type="submit"]').disabled = true;
      if (existing) await patchDoc(`${schoolPath("assignments")}/${existing.id}`, payload);
      else await createDoc(schoolPath("assignments"), id("assignment"), { ...payload, authorUid:uid(), authorName:authorName(), createdAtMs:Date.now() });
      dialog.close();
      await refreshAll({ silent:true });
    } catch (error) { setDialogError(dialog, error?.message || "과제를 저장하지 못했습니다."); }
    finally { form.querySelector('button[type="submit"]').disabled = false; }
  };
  setDialogError(dialog);
  dialog.showModal();
}

async function savePollVote(card, poll) {
  const inputs = [...card.querySelectorAll('input[type="radio"],input[type="checkbox"]')];
  const selected = inputs.filter((input) => input.checked).map((input) => Number(input.value));
  if (!selected.length) throw new Error("선택지를 하나 이상 골라 주세요.");
  if (!poll.multiple && selected.length > 1) throw new Error("이 투표는 하나만 선택할 수 있습니다.");
  await upsertDoc(`${pollVotesPath(poll.id)}/${uid()}`, { voterUid:uid(), selected, updatedAtMs:Date.now() });
}

async function uploadStorageFile(groupId, file) {
  if (!STORAGE_BUCKET) throw new Error("Firebase Storage 설정이 없습니다.");
  if (file.size > MAX_FILE_BYTES) throw new Error("파일은 20MB 이하만 올릴 수 있습니다.");
  const safeName = file.name.replace(/[\\/#?%*:|"<>]/g, "_").slice(0, 140) || "file";
  const storagePath = `schools/${SCHOOL.id}/groupDrive/${groupId}/${Date.now()}-${id("f").slice(-8)}-${safeName}`;
  const boundary = `pincon-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
  const metadata = JSON.stringify({ name:storagePath, contentType:file.type || "application/octet-stream", metadata:{ uploaderUid:uid(), classKey:currentClassKey, groupId } });
  const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${file.type || "application/octet-stream"}\r\n\r\n`, file, `\r\n--${boundary}--`]);
  const params = new URLSearchParams({ name:storagePath });
  const response = await apiFetch(`${STORAGE_BASE}?${params}`, {
    method:"POST",
    headers:{
      "X-Goog-Upload-Protocol":"multipart",
      "X-Firebase-Storage-Version":"webjs/12.17.1",
      "X-Firebase-GMPID":FIREBASE.appId || "",
      "Content-Type":`multipart/related; boundary=${boundary}`,
    },
    body,
  }, true);
  const metadataResponse = await response.json();
  return { storagePath, metadata:metadataResponse };
}

async function chooseAndUploadFile() {
  if (!selectedGroupId) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.hwp,.hwpx,.zip,application/pdf,image/*,text/plain";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) return alert("파일은 20MB 이하만 올릴 수 있습니다.");
    try {
      state.loading = true; queueRender();
      const uploaded = await uploadStorageFile(selectedGroupId, file);
      await createDoc(groupItemsPath(selectedGroupId), id("item"), { classKey:currentClassKey, groupId:selectedGroupId, type:"file", title:file.name, storagePath:uploaded.storagePath, contentType:file.type || "application/octet-stream", size:file.size, deleted:false, authorUid:uid(), authorName:authorName(), createdAtMs:Date.now(), updatedAtMs:Date.now() });
      await loadDriveItems();
    } catch (error) {
      state.error = `파일 업로드 실패: ${error?.message || "알 수 없는 오류"}`;
    } finally { state.loading = false; queueRender(); }
  };
  input.click();
}

async function downloadDriveFile(item) {
  if (!item.storagePath) return;
  const response = await apiFetch(`${STORAGE_BASE}/${encodeURIComponent(item.storagePath)}?alt=media`, { method:"GET" }, true);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = item.title || "download";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function loadDriveItems() {
  if (!selectedGroupId) { state.driveItems = []; queueRender(); return; }
  state.driveItems = (await listCollection(groupItemsPath(selectedGroupId))).sort((a,b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
  queueRender();
}

async function loadAssignmentProgress() {
  await Promise.all(state.assignments.filter((a) => !a.deleted).map(async (assignment) => {
    try {
      const mine = await getDoc(`${schoolPath("assignments")}/${assignment.id}/progress/${uid()}`);
      assignment.progress = mine?.state || "todo";
    } catch { assignment.progress = "todo"; }
  }));
}

async function setAssignmentProgress(assignmentId, progress) {
  await upsertDoc(`${schoolPath("assignments")}/${assignmentId}/progress/${uid()}`, { userUid:uid(), state:progress, updatedAtMs:Date.now() });
  const assignment = state.assignments.find((item) => item.id === assignmentId);
  if (assignment) assignment.progress = progress;
  queueRender();
}

async function refreshAssignmentsWithProgress() {
  await refreshAll({ silent:true });
  await loadAssignmentProgress();
  queueRender();
}

function bindWorkspaceEvents(section) {
  section.querySelectorAll("[data-panel]").forEach((button) => {
    button.addEventListener("click", async () => {
      activePanel = button.dataset.panel;
      if (activePanel === "assignments") await loadAssignmentProgress();
      if (activePanel === "drive" && selectedGroupId) await loadDriveItems();
      queueRender();
    });
  });
  section.querySelector('[data-workspace-action="new-poll"]')?.addEventListener("click", openPollDialog);
  section.querySelector('[data-workspace-action="new-link"]')?.addEventListener("click", () => openDriveTextDialog("link"));
  section.querySelector('[data-workspace-action="new-note"]')?.addEventListener("click", () => openDriveTextDialog("note"));
  section.querySelector('[data-workspace-action="upload-file"]')?.addEventListener("click", chooseAndUploadFile);
  section.querySelector('[data-workspace-action="new-assignment"]')?.addEventListener("click", () => openAssignmentDialog());
  section.querySelector("#pincon-drive-group-select")?.addEventListener("change", async (event) => {
    selectedGroupId = event.target.value;
    await loadDriveItems();
  });

  section.querySelectorAll("[data-poll-id]").forEach((card) => {
    const poll = state.polls.find((item) => item.id === card.dataset.pollId);
    if (!poll) return;
    card.querySelector('[data-action="vote"]')?.addEventListener("click", async () => {
      try { await savePollVote(card, poll); await loadVotesForPoll(poll); queueRender(); }
      catch (error) { alert(error?.message || "투표하지 못했습니다."); }
    });
    card.querySelector('[data-action="toggle"]')?.addEventListener("click", async () => {
      try { await patchDoc(`${schoolPath("polls")}/${poll.id}`, { status:poll.status === "open" ? "closed" : "open", updatedAtMs:Date.now() }); await refreshAll({ silent:true }); }
      catch (error) { alert(error?.message || "투표 상태를 바꾸지 못했습니다."); }
    });
    card.querySelector('[data-action="delete"]')?.addEventListener("click", async () => {
      if (!confirm("이 투표를 삭제할까요? 휴지통에서 복원할 수 있습니다.")) return;
      try { await patchDoc(`${schoolPath("polls")}/${poll.id}`, { deleted:true, updatedAtMs:Date.now() }); await refreshAll({ silent:true }); }
      catch (error) { alert(error?.message || "삭제하지 못했습니다."); }
    });
  });
  section.querySelectorAll("[data-restore-poll]").forEach((button) => button.addEventListener("click", async () => { await patchDoc(`${schoolPath("polls")}/${button.dataset.restorePoll}`, { deleted:false, updatedAtMs:Date.now() }); await refreshAll({ silent:true }); }));

  section.querySelectorAll("[data-drive-id]").forEach((card) => {
    const item = state.driveItems.find((entry) => entry.id === card.dataset.driveId);
    if (!item) return;
    card.querySelector('[data-action="download"]')?.addEventListener("click", async () => {
      try { await downloadDriveFile(item); } catch (error) { alert(error?.message || "파일을 열지 못했습니다."); }
    });
    card.querySelector('[data-action="delete"]')?.addEventListener("click", async () => {
      if (!confirm("이 항목을 드라이브에서 숨길까요? 파일 자체는 보존되어 복원할 수 있습니다.")) return;
      try { await patchDoc(`${groupItemsPath(selectedGroupId)}/${item.id}`, { deleted:true, updatedAtMs:Date.now() }); await loadDriveItems(); }
      catch (error) { alert(error?.message || "삭제하지 못했습니다."); }
    });
  });
  section.querySelectorAll("[data-restore-drive]").forEach((button) => button.addEventListener("click", async () => { await patchDoc(`${groupItemsPath(selectedGroupId)}/${button.dataset.restoreDrive}`, { deleted:false, updatedAtMs:Date.now() }); await loadDriveItems(); }));

  section.querySelectorAll("[data-assignment-id]").forEach((card) => {
    const assignment = state.assignments.find((item) => item.id === card.dataset.assignmentId);
    if (!assignment) return;
    card.querySelectorAll("[data-progress]").forEach((button) => button.addEventListener("click", async () => {
      try { await setAssignmentProgress(assignment.id, button.dataset.progress); }
      catch (error) { alert(error?.message || "진행 상태를 저장하지 못했습니다."); }
    }));
    card.querySelector('[data-action="open-drive"]')?.addEventListener("click", async () => {
      if (!assignment.groupId) return;
      selectedGroupId = assignment.groupId;
      activePanel = "drive";
      await loadDriveItems();
      queueRender();
    });
    card.querySelector('[data-action="edit"]')?.addEventListener("click", () => openAssignmentDialog(assignment));
    card.querySelector('[data-action="delete"]')?.addEventListener("click", async () => {
      if (!confirm("이 과제를 삭제할까요? 휴지통에서 복원할 수 있습니다.")) return;
      try { await patchDoc(`${schoolPath("assignments")}/${assignment.id}`, { deleted:true, updatedAtMs:Date.now() }); await refreshAssignmentsWithProgress(); }
      catch (error) { alert(error?.message || "삭제하지 못했습니다."); }
    });
  });
  section.querySelectorAll("[data-restore-assignment]").forEach((button) => button.addEventListener("click", async () => { await patchDoc(`${schoolPath("assignments")}/${button.dataset.restoreAssignment}`, { deleted:false, updatedAtMs:Date.now() }); await refreshAssignmentsWithProgress(); }));
}

function resetClassSubscription() {
  const nextClassKey = profileClassKey();
  if (nextClassKey === currentClassKey && unsubscribeContent) return;
  currentClassKey = nextClassKey;
  classContent = [];
  selectedGroupId = "";
  state = { polls:[], assignments:[], driveItems:[], votes:new Map(), loading:false, error:"" };
  unsubscribeContent?.();
  unsubscribeContent = null;
  if (currentClassKey) {
    unsubscribeContent = firebaseApi.subscribeClassContent(currentClassKey, (items) => {
      classContent = items;
      if (selectedGroupId && !groups().some((group) => group.id === selectedGroupId)) selectedGroupId = "";
      if (!selectedGroupId && groups().length) selectedGroupId = groups()[0].id;
      queueRender();
    }, () => {}, () => {});
  }
  if (currentUser && currentClassKey) refreshAll();
  queueRender();
}

firebaseApi.observeAuth((user) => {
  currentUser = user;
  resetClassSubscription();
  if (refreshTimer) clearInterval(refreshTimer);
  if (user) refreshTimer = setInterval(() => refreshAll({ silent:true }), REFRESH_MS);
  queueRender();
});

new MutationObserver(() => {
  const nextClass = profileClassKey();
  if (nextClass !== currentClassKey) {
    resetClassSubscription();
    return;
  }
  if (currentUser && currentClassKey && !document.querySelector(".pincon-workspace")) queueRender();
}).observe(document.documentElement, { childList:true, subtree:true });

window.addEventListener("storage", resetClassSubscription);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && currentUser && currentClassKey) refreshAll({ silent:true });
});

resetClassSubscription();