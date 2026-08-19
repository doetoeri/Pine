await Promise.resolve(globalThis.PINCON_MATERIAL_READY).catch(() => null);

const FIREBASE = globalThis.PINCON_FIREBASE_CONFIG || {};
const SCHOOL = globalThis.PINCON_SCHOOL_CONFIG || { id: "gochon-high", name: "학교" };
const PROJECT_ID = FIREBASE.projectId || "";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const PROFILE_KEY = "pincon-profile-v2";
const LIVE_PERSONAL_KEY = "pincon-live-personal-v1";
const PREP_KEY = "pincon-night-prep-v1";
const PREP_PERSONAL_KEY = "pincon-night-personal-v1";
const PREP_SNAPSHOT_KEY = "pincon-prep-snapshot-v1";
const PENDING_LIVE_KEY = "pincon-live-pending-v1";
const SDK = "12.16.0";

let authBundlePromise = null;
let currentUser = null;
let contentCache = { at: 0, rows: [] };
let liveSection = null;
let prepSection = null;
let lastLiveSignature = "";
let lastPrepSignature = "";
let eventEditor = null;
let personalDialog = null;
let qrDialog = null;
let prepAddDialog = null;
let messageDialog = null;
let tickTimer = 0;
let refreshTimer = 0;

function profileClassKey() {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
    const grade = Number(p?.grade), classNumber = Number(p?.classNumber);
    return Number.isInteger(grade) && grade >= 1 && grade <= 3 && Number.isInteger(classNumber) && classNumber >= 1 && classNumber <= 10
      ? `${grade}-${classNumber}` : "";
  } catch { return ""; }
}

function classLabel(key) {
  const [g, c] = String(key || "").split("-");
  return g && c ? `${g}학년 ${c}반` : "학급";
}

function kstNow() { return new Date(Date.now() + 9 * 60 * 60 * 1000); }
function kstDate(offset = 0) {
  const d = kstNow();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
function compactDate(date) { return String(date || "").replaceAll("-", ""); }
function kstHour() { return kstNow().getUTCHours(); }
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])); }
function stripHtml(value) { return String(value || "").replace(/<br\s*\/?\s*>/gi, " · ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
function timestampOf(item) { return Number(item?.updatedAtMs || item?.createdAtMs || item?.updatedAt || item?.createdAt || 0); }
function randomId(prefix = "id") { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
function safeJson(key, fallback = {}) { try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; } }
function saveJson(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }

function track(name, params = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") safe[key] = value.slice(0, 60);
    else if (typeof value === "number" && Number.isFinite(value)) safe[key] = value;
    else if (typeof value === "boolean") safe[key] = value;
  }
  window.dispatchEvent(new CustomEvent("pincon-adoption-analytics", { detail: { name, params: safe } }));
}

function decodeValue(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return Date.parse(v.timestampValue);
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeValue);
  if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
  return null;
}
function decodeFields(fields = {}) { const out = {}; for (const [k, v] of Object.entries(fields)) out[k] = decodeValue(v); return out; }
function decodeDoc(doc) { return { id: String(doc?.name || "").split("/").pop(), ...decodeFields(doc?.fields || {}) }; }
function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === "object") return { mapValue: { fields: encodeFields(value) } };
  return { stringValue: String(value) };
}
function encodeFields(obj = {}) { const fields = {}; for (const [k, v] of Object.entries(obj)) if (v !== undefined) fields[k] = encodeValue(v); return fields; }

async function authBundle() {
  if (!authBundlePromise) {
    authBundlePromise = Promise.all([
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-auth.js`),
    ]).then(async ([appApi, authApi]) => {
      const app = appApi.getApps().length ? appApi.getApp() : appApi.initializeApp(FIREBASE);
      const auth = authApi.getAuth(app);
      await auth.authStateReady?.();
      currentUser = auth.currentUser;
      authApi.onAuthStateChanged(auth, (user) => { currentUser = user; scheduleRefresh(true); });
      return { app, auth, ...authApi };
    });
  }
  return authBundlePromise;
}

async function token() {
  const api = await authBundle();
  const user = api.auth.currentUser;
  currentUser = user;
  if (!user) return "";
  try { return await user.getIdToken(); } catch { return ""; }
}

async function listCollection(path, auth = false) {
  const rows = [];
  let pageToken = "";
  do {
    const q = new URLSearchParams({ pageSize: "200" });
    if (pageToken) q.set("pageToken", pageToken);
    const headers = {};
    if (auth) {
      const t = await token();
      if (t) headers.Authorization = `Bearer ${t}`;
    }
    const response = await fetch(`${FIRESTORE_BASE}/${path}?${q}`, { headers });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const json = await response.json();
    rows.push(...(json.documents || []).map(decodeDoc));
    pageToken = json.nextPageToken || "";
  } while (pageToken && rows.length < 800);
  return rows;
}

async function fetchDoc(path) {
  const response = await fetch(`${FIRESTORE_BASE}/${path}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return decodeDoc(await response.json());
}

async function loadContent(force = false) {
  if (!PROJECT_ID) return [];
  if (!force && contentCache.at && Date.now() - contentCache.at < 60_000) return contentCache.rows;
  try {
    const rows = await listCollection(`schools/${SCHOOL.id}/content`, false);
    contentCache = { at: Date.now(), rows };
    return rows;
  } catch { return contentCache.rows || []; }
}

function relevantRows(rows, classKey) {
  return rows.filter((item) => {
    const targets = Array.isArray(item.targets) ? item.targets : [];
    return !item.deleted && (targets.includes(classKey) || item.classKey === classKey);
  }).sort((a, b) => timestampOf(b) - timestampOf(a));
}

function liveEvents(rows, classKey) {
  return relevantRows(rows, classKey).filter((item) => item.kind === "event" && item.pinconLive === true);
}

async function ensureWriteUser(pendingPayload = null) {
  const api = await authBundle();
  if (api.auth.currentUser) return api.auth.currentUser;
  if (pendingPayload) {
    try { sessionStorage.setItem(PENDING_LIVE_KEY, JSON.stringify(pendingPayload)); } catch {}
  }
  const result = await globalThis.PINCON_GUEST_AUTH?.ensureNamedUserAndSync?.();
  if (!result) throw new Error("편집 이름을 확인해 주세요.");
  return result.user;
}

async function writeLiveEvent(event, existingId = "") {
  const user = await ensureWriteUser({ event, existingId });
  const t = await user.getIdToken();
  const now = Date.now();
  const classKey = event.classKey || profileClassKey();
  const id = existingId || randomId(`live-${compactDate(event.date || kstDate())}`);
  const authorName = existingId ? (event.authorName || "학생") : (user.displayName || globalThis.PINCON_GUEST_AUTH?.displayName?.() || "학생");
  const payload = {
    schoolId: SCHOOL.id,
    kind: "event",
    scope: "class",
    targets: [classKey],
    classKey,
    title: String(event.title || "학급 행사").slice(0, 80),
    body: String(event.body || event.statusText || "PinCon LIVE 행사").slice(0, 1000),
    category: "PinCon LIVE",
    date: event.date || kstDate(),
    pinconLive: true,
    startTime: String(event.startTime || ""),
    endTime: String(event.endTime || ""),
    location: String(event.location || "").slice(0, 80),
    liveStatus: ["scheduled", "live", "paused", "finished", "cancelled"].includes(event.liveStatus) ? event.liveStatus : "scheduled",
    statusText: String(event.statusText || "").slice(0, 180),
    score: String(event.score || "").slice(0, 80),
    timeline: Array.isArray(event.timeline) ? event.timeline.slice(0, 24) : [],
    revealAtMs: Number(event.revealAtMs || 0),
    revealTitle: String(event.revealTitle || "").slice(0, 80),
    revealText: String(event.revealText || "").slice(0, 800),
    authorUid: String(event.authorUid || user.uid),
    authorName,
    lastEditorUid: user.uid,
    createdAtMs: Number(event.createdAtMs || now),
    updatedAtMs: now,
    deleted: false,
    source: "pincon-live-v1",
  };
  const body = JSON.stringify({ fields: encodeFields(payload) });
  let response;
  if (existingId) {
    response = await fetch(`${FIRESTORE_BASE}/schools/${SCHOOL.id}/content/${encodeURIComponent(existingId)}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body,
    });
  } else {
    const q = new URLSearchParams({ documentId: id });
    response = await fetch(`${FIRESTORE_BASE}/schools/${SCHOOL.id}/content?${q}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body,
    });
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`LIVE 저장 실패 (${response.status})${detail ? ` · ${detail.slice(0, 120)}` : ""}`);
  }
  try { sessionStorage.removeItem(PENDING_LIVE_KEY); } catch {}
  contentCache.at = 0;
  track(existingId ? "pincon_live_update" : "pincon_live_create", { status: payload.liveStatus });
  scheduleRefresh(true);
  return id;
}

function parseTimeline(text) {
  return String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 24).map((line, index) => {
    const [left, right = ""] = line.split("|").map((x) => x.trim());
    const m = left.match(/^(\d{1,2}:\d{2})\s+(.+)$/);
    return { time: m?.[1] || "", label: (m?.[2] || left || `일정 ${index + 1}`).slice(0, 100), location: right.slice(0, 80) };
  });
}
function timelineText(items) { return (Array.isArray(items) ? items : []).map((x) => `${x.time ? `${x.time} ` : ""}${x.label || ""}${x.location ? ` | ${x.location}` : ""}`).join("\n"); }
function timeMinutes(value) { const m = String(value || "").match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
function timelineState(items) {
  const now = kstNow();
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const valid = (Array.isArray(items) ? items : []).map((x, i) => ({ ...x, i, minute: timeMinutes(x.time) })).filter((x) => x.minute !== null).sort((a, b) => a.minute - b.minute);
  if (!valid.length) return { current: null, next: null };
  let current = null, next = null;
  for (const item of valid) {
    if (item.minute <= minutes) current = item;
    if (item.minute > minutes && !next) next = item;
  }
  return { current, next };
}
function statusLabel(status) { return ({ scheduled: "예정", live: "LIVE", paused: "잠시 멈춤", finished: "종료", cancelled: "취소" })[status] || "예정"; }
function statusIcon(status) { return status === "live" ? "sensors" : status === "finished" ? "check_circle" : status === "paused" ? "pause_circle" : "event"; }

function personalState(eventId) { return safeJson(`${LIVE_PERSONAL_KEY}:${eventId}`, {}); }
function savePersonal(eventId, state) { saveJson(`${LIVE_PERSONAL_KEY}:${eventId}`, state); scheduleRefresh(false); }

function eventLink(eventId) {
  const url = new URL(location.href);
  url.searchParams.set("live", eventId);
  return url.toString();
}

function selectedLiveEvent(events) {
  const deep = new URL(location.href).searchParams.get("live");
  if (deep) {
    const exact = events.find((e) => e.id === deep);
    if (exact) return exact;
  }
  const today = kstDate(0), tomorrow = kstDate(1);
  const todayRows = events.filter((e) => e.date === today && e.liveStatus !== "cancelled");
  if (todayRows.length) return todayRows.sort((a, b) => ({ live: 0, paused: 1, scheduled: 2, finished: 3 }[a.liveStatus] ?? 9) - ({ live: 0, paused: 1, scheduled: 2, finished: 3 }[b.liveStatus] ?? 9))[0];
  const tomorrowRows = events.filter((e) => e.date === tomorrow && e.liveStatus !== "cancelled");
  if (tomorrowRows.length) return tomorrowRows[0];
  return null;
}

function liveMarkup(event) {
  if (!event) return `<div class="pincon-live-empty"><div><span class="pincon-live-kicker">PinCon LIVE</span><strong>학급 행사를 실시간으로 운영해요</strong><p>현재 진행 중이거나 내일 예정된 LIVE 행사가 없습니다.</p></div><md-outlined-button type="button" data-live-create><md-icon slot="icon">add_circle</md-icon>행사 LIVE 만들기</md-outlined-button></div>`;
  const isToday = event.date === kstDate(0);
  const isTomorrow = event.date === kstDate(1);
  const state = timelineState(event.timeline);
  const personal = personalState(event.id);
  const revealAt = Number(event.revealAtMs || 0);
  const revealOpen = revealAt > 0 && Date.now() >= revealAt;
  const revealWaiting = revealAt > Date.now();
  const currentLabel = state.current?.label || event.statusText || (isToday ? "행사 준비 중" : "내일 열리는 행사");
  const currentPlace = state.current?.location || event.location || "";
  const nextText = state.next ? `${state.next.time} · ${state.next.label}` : (event.endTime ? `${event.endTime} 종료 예정` : "다음 일정 없음");
  const personalLine = [personal.team, personal.role, personal.place].filter(Boolean).join(" · ");
  return `<article class="pincon-live-card" data-live-status="${esc(event.liveStatus || "scheduled")}">
    <div class="pincon-live-topline"><span class="pincon-live-badge"><md-icon>${statusIcon(event.liveStatus)}</md-icon>${event.liveStatus === "live" ? "LIVE" : isTomorrow ? "D-1" : statusLabel(event.liveStatus)}</span><span>${esc(event.date || "")}${event.startTime ? ` · ${esc(event.startTime)}` : ""}</span></div>
    <div class="pincon-live-heading"><div><p>${esc(classLabel(profileClassKey()))} · 행사 모드</p><h2>${esc(event.title)}</h2></div>${event.score ? `<div class="pincon-live-score">${esc(event.score)}</div>` : ""}</div>
    <div class="pincon-live-now-grid">
      <section><span>지금</span><strong>${esc(currentLabel)}</strong>${currentPlace ? `<p><md-icon>location_on</md-icon>${esc(currentPlace)}</p>` : ""}</section>
      <section><span>다음</span><strong>${esc(nextText)}</strong>${event.statusText ? `<p>${esc(event.statusText)}</p>` : ""}</section>
      <section class="pincon-live-me"><span>나</span><strong>${esc(personalLine || "내 상태를 설정해 두세요")}</strong>${personal.note ? `<p>${esc(personal.note)}</p>` : ""}<md-text-button type="button" data-live-personal="${esc(event.id)}">내 상태 설정</md-text-button></section>
    </div>
    ${(Array.isArray(event.timeline) && event.timeline.length) ? `<div class="pincon-live-timeline">${event.timeline.slice(0, 10).map((item) => {
      const minute = timeMinutes(item.time), now = kstNow(), currentMinute = now.getUTCHours() * 60 + now.getUTCMinutes();
      const cls = minute === null ? "" : minute < currentMinute ? "is-past" : state.next?.i === event.timeline.indexOf(item) ? "is-next" : "";
      return `<div class="pincon-live-timeline-row ${cls}"><time>${esc(item.time || "•")}</time><div><strong>${esc(item.label || "일정")}</strong>${item.location ? `<span>${esc(item.location)}</span>` : ""}</div></div>`;
    }).join("")}</div>` : ""}
    ${revealWaiting ? `<button type="button" class="pincon-reveal pincon-reveal-locked" data-reveal-at="${revealAt}"><md-icon>lock_clock</md-icon><div><span>Reveal</span><strong>${esc(event.revealTitle || "결과 공개")}</strong><small data-reveal-countdown></small></div></button>` : ""}
    ${revealOpen && event.revealText ? `<div class="pincon-reveal pincon-reveal-open"><md-icon>celebration</md-icon><div><span>Reveal</span><strong>${esc(event.revealTitle || "공개")}</strong><p>${esc(event.revealText)}</p></div></div>` : ""}
    <div class="pincon-live-actions"><md-filled-tonal-button type="button" data-live-share="${esc(event.id)}"><md-icon slot="icon">qr_code_2</md-icon>QR · 공유</md-filled-tonal-button><md-outlined-button type="button" data-live-edit="${esc(event.id)}"><md-icon slot="icon">tune</md-icon>LIVE 운영</md-outlined-button></div>
  </article>`;
}

function ensureLiveSection() {
  if (liveSection?.isConnected) return liveSection;
  liveSection = document.querySelector(".pincon-live-shell");
  if (!liveSection) {
    liveSection = document.createElement("section");
    liveSection.className = "pincon-live-shell";
    liveSection.setAttribute("aria-label", "PinCon LIVE");
    liveSection.addEventListener("click", onLiveClick);
  }
  return liveSection;
}

function liveAnchor() {
  return document.querySelector(".pincon-adoption-core") || document.querySelector(".hero-area");
}

async function renderLive(force = false) {
  const classKey = profileClassKey();
  if (!classKey) { liveSection?.remove(); return; }
  const rows = await loadContent(force);
  const events = liveEvents(rows, classKey);
  const event = selectedLiveEvent(events);
  const anchor = liveAnchor();
  if (!anchor?.parentElement) return;
  const shell = ensureLiveSection();
  if (shell.parentElement !== anchor.parentElement || shell.previousElementSibling !== anchor) anchor.insertAdjacentElement("afterend", shell);
  const signature = JSON.stringify([event?.id || "", event?.updatedAtMs || 0, event?.liveStatus || "", event?.score || "", personalState(event?.id || ""), kstDate()]);
  if (signature !== lastLiveSignature) {
    shell.innerHTML = liveMarkup(event);
    lastLiveSignature = signature;
    track("pincon_live_surface", { mode: event ? (event.date === kstDate() ? "today" : "upcoming") : "empty" });
  }
  updateRevealCountdowns();
}

function ensureMessageDialog() {
  if (messageDialog?.isConnected) return messageDialog;
  messageDialog = document.createElement("md-dialog");
  messageDialog.id = "pincon-live-message";
  messageDialog.innerHTML = `<div slot="headline">PinCon</div><div slot="content" data-live-message></div><div slot="actions"><md-filled-button type="button" data-live-message-close>확인</md-filled-button></div>`;
  document.body.appendChild(messageDialog);
  messageDialog.querySelector("[data-live-message-close]").addEventListener("click", () => { messageDialog.open = false; });
  return messageDialog;
}
function message(text) { const d = ensureMessageDialog(); d.querySelector("[data-live-message]").textContent = text; d.open = true; }

function ensureEventEditor() {
  if (eventEditor?.isConnected) return eventEditor;
  eventEditor = document.createElement("md-dialog");
  eventEditor.id = "pincon-live-editor";
  eventEditor.innerHTML = `<div slot="headline" data-live-editor-title>PinCon LIVE 만들기</div><div slot="content" class="pincon-live-editor-content">
    <md-outlined-text-field label="행사 이름" maxlength="80" required data-le="title"></md-outlined-text-field>
    <div class="pincon-live-editor-two"><md-outlined-text-field label="날짜" type="date" data-le="date"></md-outlined-text-field><md-outlined-text-field label="장소" maxlength="80" data-le="location"></md-outlined-text-field></div>
    <div class="pincon-live-editor-three"><md-outlined-text-field label="시작" type="time" data-le="startTime"></md-outlined-text-field><md-outlined-text-field label="종료" type="time" data-le="endTime"></md-outlined-text-field><md-outlined-select label="상태" data-le="liveStatus"><md-select-option value="scheduled" selected><div slot="headline">예정</div></md-select-option><md-select-option value="live"><div slot="headline">LIVE</div></md-select-option><md-select-option value="paused"><div slot="headline">잠시 멈춤</div></md-select-option><md-select-option value="finished"><div slot="headline">종료</div></md-select-option><md-select-option value="cancelled"><div slot="headline">취소</div></md-select-option></md-outlined-select></div>
    <md-outlined-text-field label="현재 상태 · 예: 피구 준결승 진행 중" maxlength="180" data-le="statusText"></md-outlined-text-field>
    <md-outlined-text-field label="점수·결과 · 선택" maxlength="80" data-le="score"></md-outlined-text-field>
    <md-outlined-text-field label="LIVE 타임라인" type="textarea" rows="5" data-le="timeline" supporting-text="한 줄에 '10:20 피구 준결승 | 운동장 B코트' 형식"></md-outlined-text-field>
    <div class="pincon-live-editor-reveal"><strong>Reveal · 선택</strong><p>개인 이름·개인 결과 대신 학급 전체에 공개해도 되는 결과나 발표만 넣어 주세요.</p><div class="pincon-live-editor-two"><md-outlined-text-field label="공개 시각" type="datetime-local" data-le="revealAt"></md-outlined-text-field><md-outlined-text-field label="공개 제목" maxlength="80" data-le="revealTitle"></md-outlined-text-field></div><md-outlined-text-field label="공개 내용" type="textarea" rows="3" maxlength="800" data-le="revealText"></md-outlined-text-field></div>
    <div class="pincon-live-editor-error" data-live-editor-error hidden></div>
  </div><div slot="actions"><md-text-button type="button" data-live-editor-close>닫기</md-text-button><md-filled-button type="button" data-live-editor-save>저장</md-filled-button></div>`;
  document.body.appendChild(eventEditor);
  eventEditor.querySelector("[data-live-editor-close]").addEventListener("click", () => { eventEditor.open = false; });
  eventEditor.querySelector("[data-live-editor-save]").addEventListener("click", saveEventEditor);
  return eventEditor;
}

function field(dialog, key) { return dialog.querySelector(`[data-le="${key}"]`); }
function fieldValue(dialog, key) { return String(field(dialog, key)?.value || "").trim(); }
function setEditorError(text = "") { const box = ensureEventEditor().querySelector("[data-live-editor-error]"); box.textContent = text; box.hidden = !text; }

async function openEventEditor(event = null) {
  const d = ensureEventEditor();
  d.dataset.eventId = event?.id || "";
  d.dataset.createdAtMs = String(event?.createdAtMs || 0);
  d.dataset.authorUid = event?.authorUid || "";
  d.dataset.authorName = event?.authorName || "";
  d.querySelector("[data-live-editor-title]").textContent = event ? "PinCon LIVE 운영" : "PinCon LIVE 만들기";
  field(d, "title").value = event?.title || "";
  field(d, "date").value = event?.date || kstDate(0);
  field(d, "location").value = event?.location || "";
  field(d, "startTime").value = event?.startTime || "";
  field(d, "endTime").value = event?.endTime || "";
  field(d, "liveStatus").value = event?.liveStatus || "scheduled";
  field(d, "statusText").value = event?.statusText || "";
  field(d, "score").value = event?.score || "";
  field(d, "timeline").value = timelineText(event?.timeline || []);
  if (event?.revealAtMs) {
    const local = new Date(Number(event.revealAtMs) + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);
    field(d, "revealAt").value = local;
  } else field(d, "revealAt").value = "";
  field(d, "revealTitle").value = event?.revealTitle || "";
  field(d, "revealText").value = event?.revealText || "";
  setEditorError("");
  d.open = true;
}

async function saveEventEditor() {
  const d = ensureEventEditor(), save = d.querySelector("[data-live-editor-save]");
  try {
    const title = fieldValue(d, "title");
    const date = fieldValue(d, "date");
    if (!title || !date) throw new Error("행사 이름과 날짜를 입력해 주세요.");
    let revealAtMs = 0;
    const revealAt = fieldValue(d, "revealAt");
    if (revealAt) revealAtMs = Date.parse(`${revealAt}:00+09:00`);
    const event = {
      classKey: profileClassKey(), title, date, location: fieldValue(d, "location"), startTime: fieldValue(d, "startTime"), endTime: fieldValue(d, "endTime"),
      liveStatus: fieldValue(d, "liveStatus") || "scheduled", statusText: fieldValue(d, "statusText"), score: fieldValue(d, "score"), timeline: parseTimeline(fieldValue(d, "timeline")),
      revealAtMs: Number.isFinite(revealAtMs) ? revealAtMs : 0, revealTitle: fieldValue(d, "revealTitle"), revealText: fieldValue(d, "revealText"),
      createdAtMs: Number(d.dataset.createdAtMs || 0), authorUid: d.dataset.authorUid || "", authorName: d.dataset.authorName || "",
      body: fieldValue(d, "statusText") || `${date} ${fieldValue(d, "startTime")} · ${fieldValue(d, "location")}`.trim(),
    };
    save.disabled = true;
    await writeLiveEvent(event, d.dataset.eventId || "");
    d.open = false;
    message("PinCon LIVE를 저장했습니다.");
  } catch (error) { setEditorError(error?.message || "LIVE를 저장하지 못했습니다."); }
  finally { save.disabled = false; }
}

function ensurePersonalDialog() {
  if (personalDialog?.isConnected) return personalDialog;
  personalDialog = document.createElement("md-dialog");
  personalDialog.id = "pincon-live-personal";
  personalDialog.innerHTML = `<div slot="headline">내 상태</div><div slot="content" class="pincon-live-editor-content"><p class="pincon-live-local-note"><md-icon>lock</md-icon>이 정보는 이 기기에만 저장되고 학급 데이터베이스에는 올라가지 않습니다.</p><md-outlined-text-field label="팀·조 · 선택" maxlength="40" data-lp="team"></md-outlined-text-field><md-outlined-text-field label="역할 · 선택" maxlength="60" data-lp="role"></md-outlined-text-field><md-outlined-text-field label="내가 갈 장소 · 선택" maxlength="60" data-lp="place"></md-outlined-text-field><md-outlined-text-field label="내 메모 · 선택" maxlength="120" data-lp="note"></md-outlined-text-field></div><div slot="actions"><md-text-button data-lp-close>닫기</md-text-button><md-filled-button data-lp-save>저장</md-filled-button></div>`;
  document.body.appendChild(personalDialog);
  personalDialog.querySelector("[data-lp-close]").addEventListener("click", () => { personalDialog.open = false; });
  personalDialog.querySelector("[data-lp-save]").addEventListener("click", () => {
    const id = personalDialog.dataset.eventId || "";
    const get = (k) => String(personalDialog.querySelector(`[data-lp="${k}"]`)?.value || "").trim();
    savePersonal(id, { team: get("team"), role: get("role"), place: get("place"), note: get("note") });
    personalDialog.open = false;
    track("pincon_live_personal_save", {});
  });
  return personalDialog;
}
function openPersonal(id) {
  const d = ensurePersonalDialog(), state = personalState(id);
  d.dataset.eventId = id;
  for (const key of ["team", "role", "place", "note"]) d.querySelector(`[data-lp="${key}"]`).value = state[key] || "";
  d.open = true;
}

function ensureQrDialog() {
  if (qrDialog?.isConnected) return qrDialog;
  qrDialog = document.createElement("md-dialog");
  qrDialog.id = "pincon-live-qr";
  qrDialog.innerHTML = `<div slot="headline">행사로 바로 들어오기</div><div slot="content" class="pincon-live-qr-content"><img data-live-qr-img alt="PinCon LIVE QR 코드"><p>QR에는 행사 링크만 들어갑니다. QR 이미지는 외부 생성 서비스를 사용하므로 개인 정보는 넣지 않습니다.</p><md-outlined-text-field readonly data-live-link label="행사 링크"></md-outlined-text-field></div><div slot="actions"><md-text-button data-live-copy>링크 복사</md-text-button><md-filled-tonal-button data-live-native-share><md-icon slot="icon">share</md-icon>공유</md-filled-tonal-button><md-filled-button data-live-qr-close>닫기</md-filled-button></div>`;
  document.body.appendChild(qrDialog);
  qrDialog.querySelector("[data-live-qr-close]").addEventListener("click", () => { qrDialog.open = false; });
  qrDialog.querySelector("[data-live-copy]").addEventListener("click", async () => { try { await navigator.clipboard.writeText(qrDialog.dataset.link || ""); message("행사 링크를 복사했습니다."); } catch {} });
  qrDialog.querySelector("[data-live-native-share]").addEventListener("click", async () => { try { if (navigator.share) await navigator.share({ title: qrDialog.dataset.title || "PinCon LIVE", url: qrDialog.dataset.link || location.href }); else await navigator.clipboard.writeText(qrDialog.dataset.link || ""); } catch {} });
  return qrDialog;
}
function openQr(event) {
  const d = ensureQrDialog(), link = eventLink(event.id);
  d.dataset.link = link; d.dataset.title = event.title || "PinCon LIVE";
  d.querySelector("[data-live-link]").value = link;
  d.querySelector("[data-live-qr-img]").src = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=12&data=${encodeURIComponent(link)}`;
  d.open = true;
  track("pincon_live_qr_open", {});
}

async function eventById(id) {
  const rows = await loadContent(false);
  return rows.find((r) => r.id === id && r.pinconLive === true) || null;
}
async function onLiveClick(event) {
  const create = event.target.closest?.("[data-live-create]");
  if (create) return openEventEditor(null);
  const edit = event.target.closest?.("[data-live-edit]");
  if (edit) { const row = await eventById(edit.dataset.liveEdit); if (row) return openEventEditor(row); }
  const personal = event.target.closest?.("[data-live-personal]");
  if (personal) return openPersonal(personal.dataset.livePersonal);
  const share = event.target.closest?.("[data-live-share]");
  if (share) { const row = await eventById(share.dataset.liveShare); if (row) return openQr(row); }
}

function updateRevealCountdowns() {
  document.querySelectorAll("[data-reveal-at]").forEach((node) => {
    const at = Number(node.dataset.revealAt || 0), diff = Math.max(0, at - Date.now());
    const target = node.querySelector("[data-reveal-countdown]");
    if (target) {
      const total = Math.ceil(diff / 1000), h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
      target.textContent = diff > 0 ? `공개까지 ${h ? `${h}시간 ` : ""}${m}분 ${s}초` : "공개됨";
    }
    if (diff <= 0) scheduleRefresh(false);
  });
}

async function loadTimetable(classKey, date) {
  try { return await fetchDoc(`schools/${SCHOOL.id}/neisTimetables/${classKey}-${compactDate(date)}`); } catch { return null; }
}
async function loadAssignments() {
  try {
    const api = await authBundle();
    if (!api.auth.currentUser) return [];
    return await listCollection(`schools/${SCHOOL.id}/assignments`, true);
  } catch { return []; }
}

function dayPlan(date, table, content, assignments, events, classKey) {
  const start = Date.parse(`${date}T00:00:00+09:00`), end = start + 86_400_000;
  const items = [];
  for (const item of relevantRows(content, classKey)) {
    if (item.pinconLive === true) continue;
    if (item.kind === "supply" && (item.date === date || (!item.date && timestampOf(item) > Date.now() - 7 * 86_400_000))) items.push({ key: `s:${item.id}`, label: item.title || "준비물", meta: stripHtml(item.body || "준비물"), type: "준비물" });
    if (item.kind === "event" && item.date === date) items.push({ key: `e:${item.id}`, label: item.title || "일정", meta: [item.subject, item.category].filter(Boolean).join(" · "), type: /수행/.test(item.category || "") ? "수행" : "일정" });
    if (item.kind === "schedule" && item.date === date) items.push({ key: `c:${item.id}`, label: `${item.period ? `${item.period}교시 · ` : ""}${item.subject || item.title || "수업 변경"}`, meta: item.room || item.status || "수업 변경", type: "변경" });
  }
  for (const item of assignments.filter((x) => x.classKey === classKey && !x.deleted)) {
    const due = Number(item.dueAtMs || 0);
    if (due >= start && due < end) items.push({ key: `a:${item.id}`, label: item.title || "수행평가", meta: item.subject || "마감", type: "수행" });
  }
  for (const event of events.filter((e) => e.date === date && e.liveStatus !== "cancelled")) items.push({ key: `l:${event.id}`, label: event.title || "학급 행사", meta: [event.startTime, event.location].filter(Boolean).join(" · "), type: "LIVE" });
  const seen = new Set();
  const unique = items.filter((x) => !seen.has(x.key) && seen.add(x.key));
  const periods = Array.isArray(table?.periods) ? [...table.periods].sort((a, b) => Number(a.period) - Number(b.period)) : [];
  const subjects = periods.map((x) => x.subject).filter(Boolean);
  return { date, items: unique, subjects, periods };
}

function prepState(classKey, date) { return safeJson(`${PREP_KEY}:${classKey}:${date}`, {}); }
function savePrepState(classKey, date, state) { saveJson(`${PREP_KEY}:${classKey}:${date}`, state); scheduleRefresh(false); }
function personalPrepItems(classKey) { const rows = safeJson(`${PREP_PERSONAL_KEY}:${classKey}`, []); return Array.isArray(rows) ? rows : []; }
function savePersonalPrepItems(classKey, rows) { saveJson(`${PREP_PERSONAL_KEY}:${classKey}`, rows.slice(0, 20)); scheduleRefresh(false); }
function prepSnapshot(classKey) { return safeJson(`${PREP_SNAPSHOT_KEY}:${classKey}`, null); }

function planSignature(plan) { return { subjects: plan.subjects, itemKeys: plan.items.map((x) => `${x.key}|${x.label}|${x.meta}`), liveKeys: plan.items.filter((x) => x.type === "LIVE").map((x) => `${x.key}|${x.meta}`) }; }
function snapshotDiff(snapshot, plan) {
  if (!snapshot || snapshot.targetDate !== plan.date) return [];
  const before = snapshot.signature || { subjects: [], itemKeys: [] }, now = planSignature(plan), diff = [];
  if (JSON.stringify(before.subjects || []) !== JSON.stringify(now.subjects || [])) diff.push(`시간표가 달라졌어요: ${now.subjects.join(" · ") || "현재 시간표 없음"}`);
  const oldSet = new Set(before.itemKeys || []), newSet = new Set(now.itemKeys || []);
  for (const x of newSet) if (!oldSet.has(x)) diff.push(`새로 추가: ${x.split("|")[1] || x}`);
  for (const x of oldSet) if (!newSet.has(x)) diff.push(`빠짐/변경: ${x.split("|")[1] || x}`);
  return diff.slice(0, 6);
}

function prepMarkup(plan, morningDiff = []) {
  const classKey = profileClassKey(), state = prepState(classKey, plan.date), personals = personalPrepItems(classKey);
  const allRows = [...plan.items, ...personals.map((x) => ({ key: `p:${x.id}`, label: x.label, meta: "개인 준비", type: "개인" }))];
  const done = allRows.filter((x) => state[x.key]).length;
  const hour = kstHour(), evening = hour >= 17 || hour < 5;
  const title = evening ? "내일 준비 모드" : "아침 확인";
  const first = plan.subjects[0] || "시간표 없음";
  return `<article class="pincon-prep-card ${morningDiff.length ? "has-diff" : ""}">
    <div class="pincon-prep-head"><div><span>${evening ? "오늘 밤 10분이면 끝" : "어젯밤 이후 다시 확인"}</span><h2>${title}</h2></div><div class="pincon-prep-progress"><strong>${done}/${allRows.length}</strong><small>준비</small></div></div>
    ${morningDiff.length ? `<div class="pincon-prep-diff"><md-icon>difference</md-icon><div><strong>밤사이 ${morningDiff.length}가지가 달라졌어요</strong>${morningDiff.map((x) => `<p>${esc(x)}</p>`).join("")}</div></div>` : ""}
    <div class="pincon-prep-summary"><section><span>첫 수업</span><strong>${esc(first)}</strong></section><section><span>총 수업</span><strong>${plan.subjects.length ? `${plan.subjects.length}교시` : "확인 필요"}</strong></section><section><span>특이사항</span><strong>${plan.items.length ? `${plan.items.length}개` : "없음"}</strong></section></div>
    ${plan.subjects.length ? `<div class="pincon-prep-subjects">${plan.subjects.map((s, i) => `<span>${i + 1}<strong>${esc(s)}</strong></span>`).join("")}</div>` : ""}
    <div class="pincon-prep-list">${allRows.length ? allRows.map((item) => `<label class="pincon-prep-row"><md-checkbox data-prep-check="${esc(item.key)}" ${state[item.key] ? "checked" : ""}></md-checkbox><div><strong>${esc(item.label)}</strong><span>${esc([item.type, item.meta].filter(Boolean).join(" · "))}</span></div>${item.type === "개인" ? `<md-icon-button type="button" data-prep-remove="${esc(item.key.slice(2))}" aria-label="개인 준비 삭제"><md-icon>close</md-icon></md-icon-button>` : ""}</label>`).join("") : `<div class="pincon-prep-empty"><md-icon>checklist</md-icon><p>학교 데이터에서 별도 준비 항목을 찾지 못했습니다. 개인 준비만 추가해도 됩니다.</p></div>`}</div>
    <div class="pincon-prep-actions"><md-outlined-button type="button" data-prep-add><md-icon slot="icon">add</md-icon>개인 준비 추가</md-outlined-button><md-filled-button type="button" data-prep-complete><md-icon slot="icon">task_alt</md-icon>${state.__completed ? "준비 완료됨" : "내일 준비 완료"}</md-filled-button></div>
    ${state.__completed ? `<p class="pincon-prep-complete-note"><md-icon>verified</md-icon>${new Date(Number(state.__completedAt || Date.now())).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" })}에 준비 완료 · 아침에 변경사항을 다시 비교합니다.</p>` : ""}
  </article>`;
}

function prepAnchor() { return liveSection?.isConnected ? liveSection : (document.querySelector(".pincon-adoption-core") || document.querySelector(".hero-area")); }
function ensurePrepSection() {
  if (prepSection?.isConnected) return prepSection;
  prepSection = document.querySelector(".pincon-prep-shell");
  if (!prepSection) {
    prepSection = document.createElement("section"); prepSection.className = "pincon-prep-shell"; prepSection.setAttribute("aria-label", "내일 준비");
    prepSection.addEventListener("change", onPrepChange); prepSection.addEventListener("click", onPrepClick);
  }
  return prepSection;
}

async function renderPrep(force = false) {
  const classKey = profileClassKey(); if (!classKey) { prepSection?.remove(); return; }
  const hour = kstHour(), isEvening = hour >= 17 || hour < 5, isMorning = hour >= 5 && hour < 11;
  const snap = prepSnapshot(classKey);
  if (!isEvening && !(isMorning && snap?.targetDate === kstDate(0))) { prepSection?.remove(); return; }
  const rows = await loadContent(force), events = liveEvents(rows, classKey), assignments = await loadAssignments();
  const targetDate = isEvening ? kstDate(1) : kstDate(0);
  const table = await loadTimetable(classKey, targetDate);
  const plan = dayPlan(targetDate, table, rows, assignments, events, classKey);
  const diff = isMorning ? snapshotDiff(snap, plan) : [];
  const anchor = prepAnchor(); if (!anchor?.parentElement) return;
  const shell = ensurePrepSection();
  if (shell.parentElement !== anchor.parentElement || shell.previousElementSibling !== anchor) anchor.insertAdjacentElement("afterend", shell);
  const signature = JSON.stringify([targetDate, planSignature(plan), prepState(classKey, targetDate), personalPrepItems(classKey), diff]);
  if (signature !== lastPrepSignature) { shell.innerHTML = prepMarkup(plan, diff); lastPrepSignature = signature; }
}

function ensurePrepAddDialog() {
  if (prepAddDialog?.isConnected) return prepAddDialog;
  prepAddDialog = document.createElement("md-dialog"); prepAddDialog.id = "pincon-prep-add";
  prepAddDialog.innerHTML = `<div slot="headline">개인 준비 추가</div><div slot="content"><md-outlined-text-field label="내가 챙길 것" maxlength="80" data-prep-add-field></md-outlined-text-field><div class="pincon-prep-suggestions"><span>빠른 추가</span><md-assist-chip label="기기 충전" data-prep-suggest="기기 충전"></md-assist-chip><md-assist-chip label="필통 확인" data-prep-suggest="필통 확인"></md-assist-chip><md-assist-chip label="교통카드·학생증" data-prep-suggest="교통카드·학생증"></md-assist-chip></div></div><div slot="actions"><md-text-button data-prep-add-close>닫기</md-text-button><md-filled-button data-prep-add-save>추가</md-filled-button></div>`;
  document.body.appendChild(prepAddDialog);
  prepAddDialog.querySelector("[data-prep-add-close]").addEventListener("click", () => { prepAddDialog.open = false; });
  prepAddDialog.querySelectorAll("[data-prep-suggest]").forEach((chip) => chip.addEventListener("click", () => { prepAddDialog.querySelector("[data-prep-add-field]").value = chip.dataset.prepSuggest || ""; }));
  prepAddDialog.querySelector("[data-prep-add-save]").addEventListener("click", () => {
    const label = String(prepAddDialog.querySelector("[data-prep-add-field]").value || "").trim();
    if (!label) return;
    const classKey = profileClassKey(), rows = personalPrepItems(classKey); rows.push({ id: randomId("prep"), label: label.slice(0, 80) }); savePersonalPrepItems(classKey, rows); prepAddDialog.open = false;
  });
  return prepAddDialog;
}

function onPrepChange(event) {
  const box = event.target.closest?.("[data-prep-check]"); if (!box) return;
  const classKey = profileClassKey(), date = kstHour() >= 17 || kstHour() < 5 ? kstDate(1) : kstDate(0), state = prepState(classKey, date);
  state[box.dataset.prepCheck] = Boolean(box.checked); state.__completed = false; delete state.__completedAt; savePrepState(classKey, date, state); track("pincon_prep_check", { checked: Boolean(box.checked) });
}

async function onPrepClick(event) {
  if (event.target.closest?.("[data-prep-add]")) { const d = ensurePrepAddDialog(); d.querySelector("[data-prep-add-field]").value = ""; d.open = true; return; }
  const remove = event.target.closest?.("[data-prep-remove]");
  if (remove) { const classKey = profileClassKey(); savePersonalPrepItems(classKey, personalPrepItems(classKey).filter((x) => x.id !== remove.dataset.prepRemove)); return; }
  if (event.target.closest?.("[data-prep-complete]")) {
    const classKey = profileClassKey(), targetDate = kstHour() >= 17 || kstHour() < 5 ? kstDate(1) : kstDate(0), rows = await loadContent(false), events = liveEvents(rows, classKey), assignments = await loadAssignments(), table = await loadTimetable(classKey, targetDate), plan = dayPlan(targetDate, table, rows, assignments, events, classKey);
    const state = prepState(classKey, targetDate), personal = personalPrepItems(classKey), allKeys = [...plan.items.map((x) => x.key), ...personal.map((x) => `p:${x.id}`)], remaining = allKeys.filter((k) => !state[k]);
    if (remaining.length) { message(`아직 ${remaining.length}개가 체크되지 않았습니다. 모두 확인한 뒤 완료해 주세요.`); return; }
    state.__completed = true; state.__completedAt = Date.now(); savePrepState(classKey, targetDate, state);
    saveJson(`${PREP_SNAPSHOT_KEY}:${classKey}`, { targetDate, savedAtMs: Date.now(), signature: planSignature(plan) });
    message("내일 준비를 완료했습니다. 아침에 시간표·준비물·행사 변경을 다시 비교해 보여줄게요.");
    track("pincon_prep_complete", { item_count: allKeys.length });
  }
}

async function resumePendingLive() {
  let pending = null; try { pending = JSON.parse(sessionStorage.getItem(PENDING_LIVE_KEY) || "null"); } catch {}
  if (!pending?.event) return;
  try {
    const api = await authBundle(); if (!api.auth.currentUser) return;
    await writeLiveEvent(pending.event, pending.existingId || ""); sessionStorage.removeItem(PENDING_LIVE_KEY); message("PinCon LIVE를 저장했습니다.");
  } catch { try { sessionStorage.removeItem(PENDING_LIVE_KEY); } catch {} }
}

function scheduleRefresh(force = false) {
  clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(async () => { await renderLive(force); await renderPrep(force); }, 120);
}

const root = document.getElementById("root");
if (root) new MutationObserver(() => scheduleRefresh(false)).observe(root, { childList: true, subtree: true });
window.addEventListener("pageshow", () => scheduleRefresh(true), { passive: true });
window.addEventListener("popstate", () => scheduleRefresh(false), { passive: true });
document.addEventListener("visibilitychange", () => { if (!document.hidden) scheduleRefresh(true); }, { passive: true });

authBundle().then(() => resumePendingLive()).catch(() => null);
scheduleRefresh(true);
tickTimer = window.setInterval(() => { updateRevealCountdowns(); if (Date.now() % 30_000 < 1_100) scheduleRefresh(false); }, 1_000);

globalThis.PINCON_LIVE = Object.freeze({
  refresh: () => scheduleRefresh(true),
  create: () => openEventEditor(null),
  open: async (id) => { const row = await eventById(id); if (row) openEventEditor(row); },
});
