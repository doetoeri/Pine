import { f as firebaseApi } from "./assets/firebase-IW9tbrMW.js";
await globalThis.PINCON_MATERIAL_READY;

const FIREBASE = globalThis.PINCON_FIREBASE_CONFIG || {};
const SCHOOL = globalThis.PINCON_SCHOOL_CONFIG || { id: "gochon-high", name: "학교" };
const PROJECT_ID = FIREBASE.projectId || "";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const MODE_KEY = "pincon-design-system-v1";
const LAB_MODE = "material-expressive-lab";
const PROFILE_KEY = "pincon-profile-v2";
const SNAPSHOT_KEY = "pincon-expressive-lab-snapshot-v1";
const DIGEST_SEEN_KEY = "pincon-expressive-lab-digest-seen-v1";
const LAB_PREF_KEY = "pincon-expressive-lab-prefs-v1";

let currentUser = null;
let currentClassKey = "";
let cache = { at: 0, timetable: null, meal: null, content: [], assignments: [], history: [] };
let dialog = null;
let activeTab = "now";
let mountTimer = 0;
let searchTimer = 0;
let loadingPromise = null;

function labOn() {
  return document.documentElement.dataset.pinconDesign === LAB_MODE || localStorage.getItem(MODE_KEY) === LAB_MODE;
}

function profileClassKey() {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
    const grade = Number(p?.grade);
    const classNumber = Number(p?.classNumber);
    return Number.isInteger(grade) && grade >= 1 && grade <= 3 && Number.isInteger(classNumber) && classNumber >= 1 && classNumber <= 10
      ? `${grade}-${classNumber}`
      : "";
  } catch { return ""; }
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function decodeValue(value) {
  if (!value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return Date.parse(value.timestampValue);
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeValue);
  if ("mapValue" in value) return decodeFields(value.mapValue.fields || {});
  if ("nullValue" in value) return null;
  return null;
}

function decodeFields(fields = {}) {
  const out = {};
  for (const [key, value] of Object.entries(fields)) out[key] = decodeValue(value);
  return out;
}

function decodeDoc(doc) {
  return { id: String(doc?.name || "").split("/").pop(), ...decodeFields(doc?.fields || {}) };
}

function kstDate(offsetDays = 0) {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  now.setUTCDate(now.getUTCDate() + offsetDays);
  return now.toISOString().slice(0, 10);
}

function compactDate(date) { return String(date || "").replaceAll("-", ""); }

function formatDateTime(ms) {
  if (!Number(ms)) return "";
  try {
    return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(Number(ms)));
  } catch { return ""; }
}

function relativeTime(ms) {
  const value = Number(ms);
  if (!value) return "";
  const diff = value - Date.now();
  const abs = Math.abs(diff);
  if (abs < 60_000) return diff >= 0 ? "곧" : "방금";
  const minutes = Math.round(abs / 60_000);
  if (minutes < 60) return diff >= 0 ? `${minutes}분 후` : `${minutes}분 전`;
  const hours = Math.round(abs / 3_600_000);
  if (hours < 24) return diff >= 0 ? `${hours}시간 후` : `${hours}시간 전`;
  const days = Math.round(abs / 86_400_000);
  return diff >= 0 ? `${days}일 후` : `${days}일 전`;
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<br\s*\/?\s*>/gi, " · ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function authHeaders() {
  if (!currentUser) return {};
  try { return { Authorization: `Bearer ${await currentUser.getIdToken()}` }; }
  catch { return {}; }
}

async function fetchDoc(path, { auth = false } = {}) {
  const response = await fetch(`${FIRESTORE_BASE}/${path}`, { headers: auth ? await authHeaders() : {} });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return decodeDoc(await response.json());
}

async function listCollection(path, { auth = false, pageSize = 300, limit = 700 } = {}) {
  const rows = [];
  let pageToken = "";
  do {
    const query = new URLSearchParams({ pageSize: String(pageSize) });
    if (pageToken) query.set("pageToken", pageToken);
    const response = await fetch(`${FIRESTORE_BASE}/${path}?${query}`, { headers: auth ? await authHeaders() : {} });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const payload = await response.json();
    rows.push(...(payload.documents || []).map(decodeDoc));
    pageToken = payload.nextPageToken || "";
  } while (pageToken && rows.length < limit);
  return rows;
}

async function safe(task, fallback) {
  try { return await task(); } catch { return fallback; }
}

function snapshotKey() { return `${SNAPSHOT_KEY}:${currentClassKey || "none"}`; }

function readSnapshot() {
  try { return JSON.parse(localStorage.getItem(snapshotKey()) || "null"); }
  catch { return null; }
}

function saveSnapshot(value) {
  try { localStorage.setItem(snapshotKey(), JSON.stringify(value)); } catch {}
}

function relevantContent(rows) {
  return rows.filter((item) => {
    const targets = Array.isArray(item.targets) ? item.targets : [];
    return !item.deleted && (targets.includes(currentClassKey) || item.classKey === currentClassKey);
  }).sort((a, b) => Number(b.updatedAtMs || b.updatedAt || b.createdAtMs || b.createdAt || 0) - Number(a.updatedAtMs || a.updatedAt || a.createdAtMs || a.createdAt || 0));
}

function relevantAssignments(rows) {
  return rows.filter((item) => item.classKey === currentClassKey && !item.deleted)
    .sort((a, b) => Number(a.dueAtMs || Number.MAX_SAFE_INTEGER) - Number(b.dueAtMs || Number.MAX_SAFE_INTEGER));
}

function relevantHistory(rows) {
  return rows.filter((item) => Array.isArray(item.targets) && item.targets.includes(currentClassKey))
    .sort((a, b) => Number(b.createdAtMs || b.updatedAtMs || b.createdAt || 0) - Number(a.createdAtMs || a.updatedAtMs || a.createdAt || 0));
}

async function loadData(force = false) {
  currentClassKey = profileClassKey();
  if (!currentClassKey || !PROJECT_ID) return cache;
  if (!force && cache.at && Date.now() - cache.at < 60_000) return cache;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const today = kstDate();
    const timetableId = `${currentClassKey}-${compactDate(today)}`;
    const [timetable, meal, contentRows, assignments, history] = await Promise.all([
      safe(() => fetchDoc(`schools/${SCHOOL.id}/neisTimetables/${timetableId}`), null),
      safe(() => fetchDoc(`schools/${SCHOOL.id}/meals/${compactDate(today)}`), null),
      safe(() => listCollection(`schools/${SCHOOL.id}/content`, { auth: false }), []),
      currentUser ? safe(() => listCollection(`schools/${SCHOOL.id}/assignments`, { auth: true }), []) : Promise.resolve([]),
      currentUser ? safe(() => listCollection(`schools/${SCHOOL.id}/history`, { auth: true }), []) : Promise.resolve([]),
    ]);

    const next = {
      at: Date.now(),
      timetable,
      meal,
      content: relevantContent(contentRows),
      assignments: relevantAssignments(assignments),
      history: relevantHistory(history),
    };

    const hasUsefulData = Boolean(timetable || meal || next.content.length || next.assignments.length || next.history.length);
    if (hasUsefulData) {
      cache = next;
      saveSnapshot(next);
    } else {
      const old = readSnapshot();
      cache = old ? { ...old, at: Number(old.at) || Date.now() } : next;
    }
    return cache;
  })().finally(() => { loadingPromise = null; });

  return loadingPromise;
}

function timestampOf(item) {
  return Number(item.updatedAtMs || item.updatedAt || item.createdAtMs || item.createdAt || 0);
}

function nearestAssignment(data) {
  const now = Date.now();
  return data.assignments.find((item) => Number(item.dueAtMs) >= now) || null;
}

function recentScheduleChange(data, withinHours = 48) {
  const cutoff = Date.now() - withinHours * 3_600_000;
  return data.content.find((item) => {
    const text = `${item.category || ""} ${item.title || ""} ${item.body || ""}`;
    return timestampOf(item) >= cutoff && (item.kind === "schedule" || /시간표 변경|수업 변경/.test(text));
  }) || null;
}

function todayPeriods(data) {
  return Array.isArray(data.timetable?.periods) ? [...data.timetable.periods].sort((a, b) => Number(a.period) - Number(b.period)) : [];
}

function contextChoice(data) {
  const assignment = nearestAssignment(data);
  const schedule = recentScheduleChange(data, 24);
  const periods = todayPeriods(data);
  const hours = assignment ? (Number(assignment.dueAtMs) - Date.now()) / 3_600_000 : Infinity;

  if (assignment && hours >= 0 && hours <= 24) {
    return {
      tone: "urgent",
      kicker: "24시간 안 마감",
      title: `${assignment.subject ? `${assignment.subject} · ` : ""}${assignment.title || "수행평가"}`,
      meta: `${relativeTime(assignment.dueAtMs)} · ${formatDateTime(assignment.dueAtMs)}`,
      tab: "load",
    };
  }
  if (schedule) {
    return {
      tone: "urgent",
      kicker: "최근 변경",
      title: schedule.title || "시간표가 변경됐어요",
      meta: stripHtml(schedule.body || "변경 내용을 확인하세요."),
      tab: "changes",
    };
  }
  if (periods.length) {
    return {
      tone: "primary",
      kicker: `오늘 ${periods.length}교시`,
      title: periods.slice(0, 3).map((x) => x.subject).join(" · "),
      meta: data.timetable?.source ? `${data.timetable.source} 동기화 시간표` : "오늘 시간표",
      tab: "now",
    };
  }
  return {
    tone: "primary",
    kicker: "지금",
    title: "오늘 필요한 정보를 한곳에서 정리합니다",
    meta: currentClassKey ? `${currentClassKey.replace("-", "학년 ")}반` : "학급을 선택하면 시작합니다.",
    tab: "now",
  };
}

function mealSummary(data) {
  const text = stripHtml(data.meal?.dishesHtml || "");
  return text ? text.split(" · ").slice(0, 3).join(" · ") : "오늘 급식 정보가 아직 없습니다.";
}

function railMarkup(data) {
  const context = contextChoice(data);
  const assignment = nearestAssignment(data);
  const change = recentScheduleChange(data, 72) || data.content[0] || null;
  const assignmentTitle = assignment ? `${assignment.subject ? `${assignment.subject} · ` : ""}${assignment.title}` : "가까운 마감 없음";
  const assignmentMeta = assignment ? `${relativeTime(assignment.dueAtMs)} · ${formatDateTime(assignment.dueAtMs)}` : "등록된 수행평가를 여유 있게 볼 수 있어요.";
  const changeTitle = change?.title || "새 변경 없음";
  const changeMeta = change ? `${relativeTime(timestampOf(change))} · ${stripHtml(change.body || change.kind || "")}` : mealSummary(data);

  return `<div class="pincon-lab-rail-card" data-tone="${context.tone}">
      <div><p class="pincon-lab-rail-label">${esc(context.kicker)}</p><p class="pincon-lab-rail-value">${esc(context.title)}</p><p class="pincon-lab-rail-meta">${esc(context.meta)}</p></div>
      <md-text-button type="button" data-lab-open="${esc(context.tab)}">자세히</md-text-button>
    </div>
    <div class="pincon-lab-rail-card">
      <div><p class="pincon-lab-rail-label">다음 마감</p><p class="pincon-lab-rail-value">${esc(assignmentTitle)}</p><p class="pincon-lab-rail-meta">${esc(assignmentMeta)}</p></div>
      <md-text-button type="button" data-lab-open="load">7일 부하</md-text-button>
    </div>
    <div class="pincon-lab-rail-card">
      <div><p class="pincon-lab-rail-label">변경과 브리핑</p><p class="pincon-lab-rail-value">${esc(changeTitle)}</p><p class="pincon-lab-rail-meta">${esc(changeMeta)}</p></div>
      <md-text-button type="button" data-lab-open="digest">묶어보기</md-text-button>
    </div>`;
}

function removeRail() {
  document.querySelectorAll(".pincon-lab-rail").forEach((node) => node.remove());
  document.querySelectorAll(".pincon-lab-today-layout").forEach((node) => node.classList.remove("pincon-lab-today-layout"));
}

async function ensureRail() {
  if (!labOn()) { removeRail(); return; }
  const hero = document.querySelector(".hero-area");
  if (!hero || !hero.parentElement) { removeRail(); return; }
  const parent = hero.parentElement;
  parent.classList.add("pincon-lab-today-layout");
  let rail = parent.querySelector(":scope > .pincon-lab-rail");
  if (!rail) {
    rail = document.createElement("aside");
    rail.className = "pincon-lab-rail";
    rail.setAttribute("aria-label", "지금 필요한 정보");
    hero.insertAdjacentElement("afterend", rail);
  }
  const data = await loadData();
  if (!rail.isConnected || !labOn()) return;
  rail.innerHTML = railMarkup(data);
}

function ensureFab() {
  let fab = document.querySelector(".pincon-expressive-lab-fab");
  if (!fab) {
    fab = document.createElement("md-fab");
    fab.className = "pincon-expressive-lab-fab";
    fab.setAttribute("label", "Lab");
    fab.setAttribute("aria-label", "Material Expressive Lab 열기");
    fab.innerHTML = '<md-icon slot="icon">science</md-icon>';
    fab.addEventListener("click", () => openLab("now"));
    document.body.appendChild(fab);
  }
  fab.hidden = !labOn();
}

function ensureDialog() {
  if (dialog?.isConnected) return dialog;
  dialog = document.createElement("md-dialog");
  dialog.id = "pincon-expressive-lab-dialog";
  dialog.setAttribute("aria-label", "Material Expressive Lab");
  dialog.innerHTML = `<div slot="headline">Material Expressive Lab <span aria-hidden="true">β</span></div>
    <div slot="content" class="pincon-lab-dialog-content">
      <md-tabs id="pincon-lab-tabs">
        <md-primary-tab>지금</md-primary-tab>
        <md-primary-tab>변경</md-primary-tab>
        <md-primary-tab>7일 부하</md-primary-tab>
        <md-primary-tab>브리핑</md-primary-tab>
        <md-primary-tab>검색</md-primary-tab>
      </md-tabs>
      <div id="pincon-lab-tab-content" class="pincon-lab-tab-content"></div>
    </div>
    <div slot="actions"><md-text-button type="button" data-lab-close>닫기</md-text-button></div>`;
  document.body.appendChild(dialog);
  dialog.querySelector("[data-lab-close]")?.addEventListener("click", () => { dialog.open = false; });
  dialog.querySelector("#pincon-lab-tabs")?.addEventListener("change", (event) => {
    const names = ["now", "changes", "load", "digest", "search"];
    activeTab = names[event.target.activeTabIndex] || "now";
    renderTab(activeTab);
  });
  dialog.querySelector("#pincon-lab-tab-content")?.addEventListener("click", handleClick);
  dialog.querySelector("#pincon-lab-tab-content")?.addEventListener("input", handleInput);
  dialog.querySelector("#pincon-lab-tab-content")?.addEventListener("change", handleChange);
  return dialog;
}

function tabIndex(name) {
  return ({ now: 0, changes: 1, load: 2, digest: 3, search: 4 })[name] ?? 0;
}

async function openLab(tab = "now") {
  if (!labOn()) return;
  const target = ensureDialog();
  activeTab = tab;
  const tabs = target.querySelector("#pincon-lab-tabs");
  if (tabs) tabs.activeTabIndex = tabIndex(tab);
  target.open = true;
  await renderTab(tab);
}

function contentHost() { return ensureDialog().querySelector("#pincon-lab-tab-content"); }
function setLoading() { contentHost().innerHTML = '<md-linear-progress indeterminate></md-linear-progress>'; }

function periodsMarkup(periods) {
  if (!periods.length) return '<div class="pincon-lab-empty">오늘 시간표가 아직 동기화되지 않았습니다.</div>';
  return `<div class="pincon-lab-periods">${periods.map((item) => `<div class="pincon-lab-period"><strong>${esc(item.subject || "수업")}</strong><span>${esc(item.period)}교시</span></div>`).join("")}</div>`;
}

async function renderNow() {
  const host = contentHost();
  const data = await loadData();
  const context = contextChoice(data);
  const assignment = nearestAssignment(data);
  const periods = todayPeriods(data);
  host.innerHTML = `<div class="pincon-lab-pane">
    <div><p class="pincon-lab-pane-subtitle">같은 크기의 카드 여러 개보다, 지금 중요한 것 하나를 먼저 보여줍니다.</p></div>
    <div class="pincon-lab-now-grid">
      <section class="pincon-lab-now-primary">
        <div><p class="pincon-lab-kicker">${esc(context.kicker)}</p><h3>${esc(context.title)}</h3></div>
        <p>${esc(context.meta)}</p>
      </section>
      <div class="pincon-lab-now-side">
        <section class="pincon-lab-surface"><p class="pincon-lab-kicker">오늘 급식</p><p>${esc(mealSummary(data))}</p></section>
        <section class="pincon-lab-surface"><p class="pincon-lab-kicker">다음 마감</p><p class="pincon-lab-big-number">${assignment ? esc(relativeTime(assignment.dueAtMs)) : "여유"}</p><p>${assignment ? esc(assignment.title || "수행평가") : "가까운 마감이 없습니다."}</p></section>
      </div>
    </div>
    <section class="pincon-lab-surface"><p class="pincon-lab-kicker">오늘 수업 흐름</p>${periodsMarkup(periods)}</section>
  </div>`;
}

function timelineRows(data) {
  const currentById = new Map(data.content.map((item) => [item.id, item]));
  const fromHistory = data.history.slice(0, 12).map((item) => {
    const current = currentById.get(item.contentId);
    const actions = { create: "추가", update: "수정", delete: "삭제", restore: "복원" };
    return {
      title: current?.title || item.title || `학급 정보 ${actions[item.action] || item.action || "변경"}`,
      body: `${actions[item.action] || "변경"}${item.actorName ? ` · ${item.actorName}` : ""}`,
      at: Number(item.createdAtMs || item.updatedAtMs || item.createdAt || 0),
    };
  });
  const fromContent = data.content.slice(0, 18).map((item) => ({
    title: item.title || "학급 정보 변경",
    body: stripHtml(item.body || item.category || item.kind || ""),
    at: timestampOf(item),
  }));
  const seen = new Set();
  return [...fromHistory, ...fromContent]
    .sort((a, b) => b.at - a.at)
    .filter((item) => {
      const key = `${item.title}:${item.at}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 22);
}

async function renderChanges() {
  const data = await loadData();
  const rows = timelineRows(data);
  contentHost().innerHTML = `<div class="pincon-lab-pane">
    <div><h3>변경 타임라인</h3><p class="pincon-lab-pane-subtitle">공지와 공동편집 변경을 시간순으로 모읍니다.${currentUser ? "" : " 로그인하면 편집 이력도 함께 볼 수 있습니다."}</p></div>
    ${rows.length ? `<div class="pincon-lab-surface pincon-lab-timeline">${rows.map((item) => `<div class="pincon-lab-timeline-row"><strong>${esc(item.title)}</strong><p>${esc(item.body || "변경됨")}</p><div class="pincon-lab-timeline-time">${esc(relativeTime(item.at))}${item.at ? ` · ${esc(formatDateTime(item.at))}` : ""}</div></div>`).join("")}</div>` : '<div class="pincon-lab-empty">최근 변경이 없습니다.</div>'}
  </div>`;
}

function workloadDays(data) {
  const today = kstDate();
  return Array.from({ length: 7 }, (_, index) => {
    const date = kstDate(index);
    const start = Date.parse(`${date}T00:00:00+09:00`);
    const end = start + 86_400_000;
    const due = data.assignments.filter((item) => Number(item.dueAtMs) >= start && Number(item.dueAtMs) < end);
    const score = Math.min(100, due.reduce((sum, item) => sum + 34 + (String(item.description || "").length > 200 ? 10 : 0), 0));
    const weekday = new Intl.DateTimeFormat("ko-KR", { weekday: "short" }).format(new Date(start));
    return { date, today: date === today, due, score, weekday, level: score >= 85 ? "very-high" : score >= 60 ? "high" : "normal" };
  });
}

async function renderLoad() {
  const data = await loadData();
  const days = workloadDays(data);
  const peak = [...days].sort((a, b) => b.score - a.score)[0];
  contentHost().innerHTML = `<div class="pincon-lab-pane">
    <div><h3>7일 학업 부하</h3><p class="pincon-lab-pane-subtitle">마감 건수와 설명 규모를 이용한 단순 부하 지수입니다. 점수는 성적이나 난이도 평가가 아니라 일정 밀집도를 빠르게 보기 위한 값입니다.</p></div>
    ${currentUser ? `<section class="pincon-lab-surface">
      <div class="pincon-lab-load-grid">${days.map((day) => `<div class="pincon-lab-load-day" data-level="${day.level}"><div class="pincon-lab-load-track"><div class="pincon-lab-load-bar" style="height:${Math.max(6, day.score)}%"></div></div><div class="pincon-lab-load-label">${esc(day.weekday)}${day.today ? " · 오늘" : ""}</div><div class="pincon-lab-load-score">${day.score} · ${day.due.length}건</div></div>`).join("")}</div>
    </section>
    <section class="pincon-lab-surface"><p class="pincon-lab-kicker">가장 밀집된 날</p><p class="pincon-lab-big-number">${peak?.score || 0}</p><p>${peak?.due?.length ? `${esc(peak.weekday)}요일에 ${peak.due.length}건의 마감이 있습니다.` : "이번 7일은 비교적 여유롭습니다."}</p></section>` : '<div class="pincon-lab-empty">로그인하면 수행평가 데이터를 이용해 7일 부하를 계산합니다.</div>'}
  </div>`;
}

function digestSeen() {
  try { return Number(localStorage.getItem(`${DIGEST_SEEN_KEY}:${currentClassKey}`) || 0); }
  catch { return 0; }
}

function prefs() {
  try { return { emphasizeChanges: true, groupRoutine: true, ...JSON.parse(localStorage.getItem(LAB_PREF_KEY) || "{}") }; }
  catch { return { emphasizeChanges: true, groupRoutine: true }; }
}

function savePrefs(value) {
  try { localStorage.setItem(LAB_PREF_KEY, JSON.stringify(value)); } catch {}
}

function digestItems(data) {
  const seen = digestSeen();
  const now = Date.now();
  const immediate = [];
  const routine = [];
  for (const item of data.content) {
    const at = timestampOf(item);
    if (at <= seen) continue;
    const text = `${item.category || ""} ${item.title || ""} ${item.body || ""}`;
    const row = { title: item.title || "학급 정보", meta: relativeTime(at), body: stripHtml(item.body || "") };
    if (/시간표 변경|수업 변경/.test(text) && now - at <= 48 * 3_600_000) immediate.push(row);
    else routine.push(row);
  }
  for (const item of data.assignments) {
    const due = Number(item.dueAtMs);
    if (due >= now && due - now <= 24 * 3_600_000) immediate.push({ title: item.title || "수행평가", meta: relativeTime(due), body: item.subject || "마감 임박" });
  }
  return { immediate: immediate.slice(0, 8), routine: routine.slice(0, 14) };
}

function digestList(rows, empty) {
  if (!rows.length) return `<div class="pincon-lab-empty">${esc(empty)}</div>`;
  return `<md-list>${rows.map((item) => `<md-list-item><div slot="headline">${esc(item.title)}</div><div slot="supporting-text">${esc(item.meta || "")}${item.body ? ` · ${esc(item.body).slice(0, 180)}` : ""}</div></md-list-item>`).join("")}</md-list>`;
}

async function renderDigest() {
  const data = await loadData();
  const items = digestItems(data);
  const p = prefs();
  contentHost().innerHTML = `<div class="pincon-lab-pane">
    <div><h3>스마트 브리핑</h3><p class="pincon-lab-pane-subtitle">수업 변경과 24시간 안 마감은 즉시 강조하고, 나머지 새 소식은 한 묶음으로 정리합니다. 이 설정은 현재 Lab의 인앱 표시 방식이며 FCM 서버 알림 빈도를 바꾸지는 않습니다.</p></div>
    <div class="pincon-lab-digest-grid">
      <section class="pincon-lab-digest-card" data-kind="urgent"><h3>지금 확인</h3><p>${items.immediate.length}개</p>${digestList(items.immediate, "긴급하게 확인할 항목이 없습니다.")}</section>
      <section class="pincon-lab-digest-card"><h3>한 번에 보기</h3><p>${items.routine.length}개</p>${digestList(items.routine, "새로 묶을 소식이 없습니다.")}</section>
    </div>
    <section class="pincon-lab-surface"><md-list>
      <md-list-item><md-icon slot="start">priority_high</md-icon><div slot="headline">중요 변경을 크게 강조</div><div slot="supporting-text">시간표·수업 변경을 Lab의 상황 카드로 올립니다.</div><md-switch slot="end" data-lab-pref="emphasizeChanges" ${p.emphasizeChanges ? "selected" : ""}></md-switch></md-list-item>
      <md-list-item><md-icon slot="start">inbox</md-icon><div slot="headline">일상 소식 묶기</div><div slot="supporting-text">공지·준비물 같은 새 항목을 브리핑으로 모읍니다.</div><md-switch slot="end" data-lab-pref="groupRoutine" ${p.groupRoutine ? "selected" : ""}></md-switch></md-list-item>
    </md-list><div style="padding:8px 12px 2px"><md-filled-tonal-button type="button" data-lab-mark-seen><md-icon slot="icon">done_all</md-icon>여기까지 확인</md-filled-tonal-button></div></section>
  </div>`;
}

function searchRows(data, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  const rows = [];
  for (const item of data.content) {
    if ([item.title, item.body, item.kind, item.category].join(" ").toLowerCase().includes(q)) rows.push({ title: item.title || "학급 정보", meta: item.category || item.kind || "학급 정보", body: stripHtml(item.body || "") });
  }
  for (const item of data.assignments) {
    if ([item.title, item.subject, item.description].join(" ").toLowerCase().includes(q)) rows.push({ title: item.title || "수행평가", meta: `수행평가 · ${item.subject || "과목 미지정"}`, body: item.description || "" });
  }
  const periods = todayPeriods(data);
  for (const item of periods) {
    if (String(item.subject || "").toLowerCase().includes(q)) rows.push({ title: item.subject, meta: `오늘 ${item.period}교시`, body: "시간표" });
  }
  return rows.slice(0, 30);
}

function searchResultMarkup(rows) {
  if (!rows.length) return '<div class="pincon-lab-empty">검색 결과가 없습니다.</div>';
  return `<md-list>${rows.map((item) => `<md-list-item><div slot="headline">${esc(item.title)}</div><div slot="supporting-text">${esc(item.meta)}${item.body ? ` · ${esc(item.body).slice(0, 200)}` : ""}</div></md-list-item>`).join("")}</md-list>`;
}

async function renderSearch(query = "") {
  const data = await loadData();
  contentHost().innerHTML = `<div class="pincon-lab-pane"><div><h3>통합 검색</h3><p class="pincon-lab-pane-subtitle">공지·학급 정보·오늘 시간표${currentUser ? "·수행평가" : ""}를 한 번에 찾습니다.</p></div><md-outlined-text-field class="pincon-lab-search-field" id="pincon-lab-search" label="PinCon에서 검색" value="${esc(query)}"><md-icon slot="leading-icon">search</md-icon></md-outlined-text-field><div data-lab-search-results>${query ? searchResultMarkup(searchRows(data, query)) : '<div class="pincon-lab-empty">검색어를 입력하세요.</div>'}</div></div>`;
}

async function renderTab(name) {
  if (!dialog?.open && !labOn()) return;
  setLoading();
  try {
    if (name === "changes") await renderChanges();
    else if (name === "load") await renderLoad();
    else if (name === "digest") await renderDigest();
    else if (name === "search") await renderSearch();
    else await renderNow();
  } catch (error) {
    contentHost().innerHTML = `<div class="pincon-lab-empty">Lab 데이터를 불러오지 못했습니다. ${esc(error?.message || "잠시 후 다시 시도하세요.")}</div>`;
  }
}

function handleClick(event) {
  const mark = event.target.closest?.("[data-lab-mark-seen]");
  if (mark) {
    try { localStorage.setItem(`${DIGEST_SEEN_KEY}:${currentClassKey}`, String(Date.now())); } catch {}
    renderDigest();
  }
}

function handleChange(event) {
  const target = event.target;
  if (!target?.matches?.("[data-lab-pref]")) return;
  const next = prefs();
  next[target.dataset.labPref] = Boolean(target.selected);
  savePrefs(next);
}

function handleInput(event) {
  if (event.target?.id !== "pincon-lab-search") return;
  clearTimeout(searchTimer);
  const value = event.target.value || "";
  searchTimer = window.setTimeout(async () => {
    const data = await loadData();
    const results = dialog?.querySelector("[data-lab-search-results]");
    if (results) results.innerHTML = value.trim() ? searchResultMarkup(searchRows(data, value)) : '<div class="pincon-lab-empty">검색어를 입력하세요.</div>';
  }, 180);
}

function installGlobalActions() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-lab-open]");
    if (!button) return;
    openLab(button.dataset.labOpen || "now");
  }, { capture: true });
}

function scheduleMount() {
  clearTimeout(mountTimer);
  mountTimer = window.setTimeout(async () => {
    ensureFab();
    if (labOn()) await ensureRail();
    else removeRail();
  }, 90);
}

firebaseApi.observeAuth((user) => {
  currentUser = user || null;
  cache.at = 0;
  scheduleMount();
  if (dialog?.open) renderTab(activeTab);
});

window.addEventListener("pincon-design-system-change", (event) => {
  const on = event.detail?.theme === LAB_MODE;
  document.body?.classList.toggle("pincon-expressive-lab", on);
  if (!on) {
    removeRail();
    if (dialog?.open) dialog.open = false;
  }
  cache.at = 0;
  scheduleMount();
});
window.addEventListener("pageshow", scheduleMount, { passive: true });
window.addEventListener("storage", (event) => {
  if (event.key === PROFILE_KEY || event.key === MODE_KEY) { cache.at = 0; scheduleMount(); }
});

const root = document.getElementById("root");
if (root) new MutationObserver(scheduleMount).observe(root, { childList: true, subtree: true });

installGlobalActions();
currentClassKey = profileClassKey();
ensureFab();
scheduleMount();
window.setInterval(() => {
  if (!labOn() || document.visibilityState !== "visible") return;
  cache.at = 0;
  scheduleMount();
}, 120_000);

globalThis.PINCON_EXPRESSIVE_LAB = Object.freeze({ open: openLab, refresh: () => { cache.at = 0; return loadData(true); } });
