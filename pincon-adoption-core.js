import { f as firebaseApi } from "./assets/firebase-IW9tbrMW.js";
await globalThis.PINCON_MATERIAL_READY;

const FIREBASE = globalThis.PINCON_FIREBASE_CONFIG || {};
const SCHOOL = globalThis.PINCON_SCHOOL_CONFIG || { id: "gochon-high", name: "학교" };
const PROJECT_ID = FIREBASE.projectId || "";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const PROFILE_KEY = "pincon-profile-v2";
const BAG_KEY = "pincon-tomorrow-bag-v1";
const CACHE_MS = 90_000;

let currentUser = null;
let currentClassKey = "";
let cache = { at: 0, content: [], todayTable: null, tomorrowTable: null, assignments: [] };
let loading = null;
let mountTimer = 0;
let detailDialog = null;
let lastSignature = "";

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

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
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

function kstDate(offset = 0) {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  now.setUTCDate(now.getUTCDate() + offset);
  return now.toISOString().slice(0, 10);
}
function compactDate(date) { return String(date).replaceAll("-", ""); }
function timestampOf(item) { return Number(item?.updatedAtMs || item?.updatedAt || item?.createdAtMs || item?.createdAt || 0); }
function stripHtml(value) { return String(value || "").replace(/<br\s*\/?\s*>/gi, " · ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }

async function authHeaders() {
  if (!currentUser) return {};
  try { return { Authorization: `Bearer ${await currentUser.getIdToken()}` }; } catch { return {}; }
}
async function fetchDoc(path, auth = false) {
  const r = await fetch(`${FIRESTORE_BASE}/${path}`, { headers: auth ? await authHeaders() : {} });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return decodeDoc(await r.json());
}
async function listCollection(path, auth = false, limit = 600) {
  const rows = [];
  let pageToken = "";
  do {
    const q = new URLSearchParams({ pageSize: "200" });
    if (pageToken) q.set("pageToken", pageToken);
    const r = await fetch(`${FIRESTORE_BASE}/${path}?${q}`, { headers: auth ? await authHeaders() : {} });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const j = await r.json();
    rows.push(...(j.documents || []).map(decodeDoc));
    pageToken = j.nextPageToken || "";
  } while (pageToken && rows.length < limit);
  return rows;
}
async function safe(task, fallback) { try { return await task(); } catch { return fallback; } }

function relevantContent(rows) {
  return rows.filter((item) => {
    const targets = Array.isArray(item.targets) ? item.targets : [];
    return !item.deleted && (targets.includes(currentClassKey) || item.classKey === currentClassKey);
  }).sort((a, b) => timestampOf(b) - timestampOf(a));
}

async function loadData(force = false) {
  currentClassKey = profileClassKey();
  if (!PROJECT_ID || !currentClassKey) return cache;
  if (!force && cache.at && Date.now() - cache.at < CACHE_MS) return cache;
  if (loading) return loading;

  loading = (async () => {
    const today = kstDate(0), tomorrow = kstDate(1);
    const [contentRows, todayTable, tomorrowTable, assignments] = await Promise.all([
      safe(() => listCollection(`schools/${SCHOOL.id}/content`, false), []),
      safe(() => fetchDoc(`schools/${SCHOOL.id}/neisTimetables/${currentClassKey}-${compactDate(today)}`), null),
      safe(() => fetchDoc(`schools/${SCHOOL.id}/neisTimetables/${currentClassKey}-${compactDate(tomorrow)}`), null),
      currentUser ? safe(() => listCollection(`schools/${SCHOOL.id}/assignments`, true), []) : Promise.resolve([]),
    ]);
    cache = {
      at: Date.now(),
      content: relevantContent(contentRows),
      todayTable,
      tomorrowTable,
      assignments: assignments.filter((x) => x.classKey === currentClassKey && !x.deleted),
    };
    return cache;
  })().finally(() => { loading = null; });
  return loading;
}

function recentChanges(data) {
  const today = kstDate(0);
  const cutoff = Date.now() - 36 * 60 * 60 * 1000;
  return data.content.filter((item) => {
    const text = `${item.category || ""} ${item.title || ""} ${item.body || ""}`;
    const isChange = item.kind === "schedule" || /시간표 변경|수업 변경|교실 변경|변경됨/.test(text);
    const sameDate = item.date === today;
    return isChange && (sameDate || timestampOf(item) >= cutoff);
  }).slice(0, 4);
}

function displayChange(item) {
  const title = String(item.title || item.subject || "변경사항").trim();
  const body = stripHtml(item.body || "");
  if (/→/.test(body)) return { title, detail: body };
  if (item.kind === "schedule") {
    const bits = [item.period ? `${item.period}교시` : "", item.subject || title, item.room || ""].filter(Boolean);
    return { title: bits.join(" · "), detail: item.status && item.status !== "정상" ? item.status : body };
  }
  return { title, detail: body || item.category || "변경됨" };
}

function tomorrowBag(data) {
  const tomorrow = kstDate(1);
  const start = Date.parse(`${tomorrow}T00:00:00+09:00`), end = start + 86_400_000;
  const rows = [];

  for (const item of data.content) {
    if (item.kind === "supply" && (!item.date || item.date === tomorrow)) {
      rows.push({ id: `s:${item.id}`, label: item.title || "준비물", meta: item.body || "준비물" });
    }
    if (item.kind === "event" && item.date === tomorrow) {
      rows.push({ id: `e:${item.id}`, label: item.title || "내일 일정", meta: [item.subject, item.category].filter(Boolean).join(" · ") });
    }
  }
  for (const item of data.assignments) {
    const due = Number(item.dueAtMs || 0);
    if (due >= start && due < end) rows.push({ id: `a:${item.id}`, label: item.title || "수행평가", meta: item.subject || "내일 마감" });
  }
  return rows.slice(0, 12);
}

function tomorrowSubjects(data) {
  const periods = Array.isArray(data.tomorrowTable?.periods) ? [...data.tomorrowTable.periods].sort((a, b) => Number(a.period) - Number(b.period)) : [];
  return periods.map((x) => x.subject).filter(Boolean);
}

function bagState(date = kstDate(1)) {
  try { return JSON.parse(localStorage.getItem(`${BAG_KEY}:${currentClassKey}:${date}`) || "{}"); } catch { return {}; }
}
function setBagChecked(id, checked) {
  const key = `${BAG_KEY}:${currentClassKey}:${kstDate(1)}`;
  const state = bagState();
  state[id] = Boolean(checked);
  try { localStorage.setItem(key, JSON.stringify(state)); } catch {}
}

function changeMarkup(changes) {
  if (!changes.length) return `<div class="pincon-adoption-empty"><md-icon>check_circle</md-icon><div><strong>오늘 변경 없음</strong><p>현재 확인된 시간표·교실 변경이 없습니다.</p></div></div>`;
  return changes.map((item) => {
    const row = displayChange(item);
    return `<div class="pincon-change-row"><md-icon>swap_horiz</md-icon><div><strong>${esc(row.title)}</strong>${row.detail ? `<p>${esc(row.detail)}</p>` : ""}</div></div>`;
  }).join("");
}

function bagPreviewMarkup(rows) {
  const state = bagState();
  if (!rows.length) return `<div class="pincon-adoption-empty compact"><md-icon>checklist</md-icon><div><strong>등록된 준비 없음</strong><p>내일 준비물이 추가되면 여기에 모입니다.</p></div></div>`;
  return rows.slice(0, 4).map((item) => `<label class="pincon-bag-row"><md-checkbox data-bag-check="${esc(item.id)}" ${state[item.id] ? "checked" : ""}></md-checkbox><span><strong>${esc(item.label)}</strong>${item.meta ? `<small>${esc(stripHtml(item.meta))}</small>` : ""}</span></label>`).join("");
}

function shareText(changes, rows, subjects) {
  const lines = [`📌 ${classLabel(currentClassKey)} · 오늘 변경 ${changes.length}건`];
  if (changes.length) {
    for (const item of changes.slice(0, 4)) {
      const row = displayChange(item);
      lines.push(`• ${row.title}${row.detail ? ` · ${row.detail}` : ""}`);
    }
  } else lines.push("• 오늘 확인된 변경 없음");
  if (rows.length) lines.push(`🎒 내일 준비: ${rows.slice(0, 4).map((x) => x.label).join(" · ")}${rows.length > 4 ? ` 외 ${rows.length - 4}개` : ""}`);
  if (subjects.length) lines.push(`📚 내일 시간표: ${subjects.join(" · ")}`);
  lines.push("PinCon에서 최신 정보 확인");
  return lines.join("\n");
}

function ensureMessageDialog() {
  let d = document.getElementById("pincon-adoption-message");
  if (!d) {
    d = document.createElement("md-dialog");
    d.id = "pincon-adoption-message";
    d.innerHTML = '<div slot="headline">PinCon</div><div slot="content" data-adoption-message></div><div slot="actions"><md-filled-button type="button" data-adoption-message-close>확인</md-filled-button></div>';
    document.body.appendChild(d);
    d.querySelector("[data-adoption-message-close]")?.addEventListener("click", () => { d.open = false; });
  }
  return d;
}
function message(text) { const d = ensureMessageDialog(); d.querySelector("[data-adoption-message]").textContent = text; d.open = true; }

async function shareToday(data) {
  const text = shareText(recentChanges(data), tomorrowBag(data), tomorrowSubjects(data));
  const payload = { title: "PinCon · 오늘 변경", text, url: `${location.origin}${location.pathname}` };
  try {
    if (navigator.share) { await navigator.share(payload); return; }
    await navigator.clipboard.writeText(`${text}\n${payload.url}`);
    message("공유 내용을 클립보드에 복사했습니다.");
  } catch (error) {
    if (error?.name !== "AbortError") message("공유를 열지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

function openQuickAdd() {
  const compose = document.querySelector(".compose-fab,[aria-label='콘텐츠 등록 메뉴']");
  if (compose) { compose.click(); return; }
  const add = [...document.querySelectorAll("md-filled-button,md-filled-tonal-button,button")].find((x) => /추가|등록/.test(x.textContent || ""));
  if (add) { add.click(); return; }
  message("빠른 등록 화면을 찾지 못했습니다. 더보기의 공동 편집에서 항목을 추가할 수 있습니다.");
}

function ensureDetailDialog() {
  if (detailDialog?.isConnected) return detailDialog;
  detailDialog = document.createElement("md-dialog");
  detailDialog.id = "pincon-tomorrow-bag-dialog";
  detailDialog.innerHTML = '<div slot="headline">내일 가방</div><div slot="content" data-bag-detail></div><div slot="actions"><md-text-button type="button" data-bag-close>닫기</md-text-button></div>';
  document.body.appendChild(detailDialog);
  detailDialog.querySelector("[data-bag-close]")?.addEventListener("click", () => { detailDialog.open = false; });
  detailDialog.querySelector("[data-bag-detail]")?.addEventListener("change", (event) => {
    const box = event.target.closest?.("[data-bag-check]");
    if (!box) return;
    setBagChecked(box.dataset.bagCheck, Boolean(box.checked));
    scheduleMount(false);
  });
  return detailDialog;
}
function openBag(data) {
  const d = ensureDetailDialog(), rows = tomorrowBag(data), subjects = tomorrowSubjects(data), state = bagState();
  d.querySelector("[data-bag-detail]").innerHTML = `<div class="pincon-bag-dialog-copy"><p>${esc(kstDate(1))} · ${esc(classLabel(currentClassKey))}</p>${subjects.length ? `<div class="pincon-bag-subjects">${subjects.map((s, i) => `<md-assist-chip label="${i + 1}교시 · ${esc(s)}"></md-assist-chip>`).join("")}</div>` : ""}<div class="pincon-bag-dialog-list">${rows.length ? rows.map((item) => `<label class="pincon-bag-row"><md-checkbox data-bag-check="${esc(item.id)}" ${state[item.id] ? "checked" : ""}></md-checkbox><span><strong>${esc(item.label)}</strong>${item.meta ? `<small>${esc(stripHtml(item.meta))}</small>` : ""}</span></label>`).join("") : '<div class="pincon-adoption-empty"><md-icon>task_alt</md-icon><div><strong>준비물 등록 없음</strong><p>내일 시간표만 확인해도 됩니다.</p></div></div>'}</div></div>`;
  d.open = true;
}

function sectionMarkup(data) {
  const changes = recentChanges(data), bag = tomorrowBag(data), subjects = tomorrowSubjects(data), checked = bagState();
  const done = bag.filter((x) => checked[x.id]).length;
  return `<div class="pincon-adoption-head"><div><p class="md-typescale-label-large">오늘 필요한 것만</p><h2 class="md-typescale-headline-medium">${esc(classLabel(currentClassKey))} 핵심</h2></div><md-assist-chip label="변경 ${changes.length}건"></md-assist-chip></div>
    <div class="pincon-adoption-grid">
      <section class="pincon-adoption-change-card">
        <div class="pincon-adoption-card-title"><div><span>오늘 바뀐 것</span><strong>${changes.length}</strong></div><md-icon>difference</md-icon></div>
        <div class="pincon-change-list">${changeMarkup(changes)}</div>
        <div class="pincon-adoption-actions"><md-filled-tonal-button type="button" data-adoption-share><md-icon slot="icon">share</md-icon>공유</md-filled-tonal-button><md-outlined-button type="button" data-adoption-add><md-icon slot="icon">add</md-icon>빠른 등록</md-outlined-button></div>
      </section>
      <section class="pincon-adoption-bag-card">
        <div class="pincon-adoption-card-title"><div><span>내일 가방</span><strong>${bag.length ? `${done}/${bag.length}` : "✓"}</strong></div><md-icon>backpack</md-icon></div>
        ${subjects.length ? `<p class="pincon-adoption-subject-line">${esc(subjects.slice(0, 6).join(" · "))}${subjects.length > 6 ? "…" : ""}</p>` : '<p class="pincon-adoption-subject-line">내일 시간표를 불러오는 중이거나 등록되지 않았습니다.</p>'}
        <div class="pincon-bag-preview">${bagPreviewMarkup(bag)}</div>
        <div class="pincon-adoption-actions"><md-filled-button type="button" data-adoption-bag><md-icon slot="icon">checklist</md-icon>내일 준비 보기</md-filled-button></div>
      </section>
    </div>`;
}

function ensureSection() {
  const hero = document.querySelector(".hero-area");
  if (!hero?.parentElement || !currentClassKey) { document.querySelector(".pincon-adoption-core")?.remove(); return null; }
  const parent = hero.parentElement;
  let section = parent.querySelector(":scope > .pincon-adoption-core");
  if (!section) {
    section = document.createElement("section");
    section.className = "pincon-adoption-core";
    section.setAttribute("aria-label", "오늘 변경과 내일 준비");
    section.addEventListener("click", async (event) => {
      if (event.target.closest?.("[data-adoption-share]")) return shareToday(await loadData());
      if (event.target.closest?.("[data-adoption-add]")) return openQuickAdd();
      if (event.target.closest?.("[data-adoption-bag]")) return openBag(await loadData());
    });
    section.addEventListener("change", (event) => {
      const box = event.target.closest?.("[data-bag-check]");
      if (!box) return;
      setBagChecked(box.dataset.bagCheck, Boolean(box.checked));
      scheduleMount(false);
    });
  }
  const rail = parent.querySelector(":scope > .pincon-lab-rail");
  const anchor = rail || hero;
  if (section.parentElement !== parent || section.previousElementSibling !== anchor) anchor.insertAdjacentElement("afterend", section);
  return section;
}

async function mount(force = false) {
  currentClassKey = profileClassKey();
  const section = ensureSection();
  if (!section) return;
  const data = await loadData(force);
  if (!section.isConnected) return;
  const changes = recentChanges(data), bag = tomorrowBag(data), subjects = tomorrowSubjects(data), state = bagState();
  const signature = JSON.stringify({
    classKey: currentClassKey,
    changes: changes.map((x) => [x.id, timestampOf(x), x.title, x.body]),
    bag: bag.map((x) => [x.id, x.label, state[x.id] || false]),
    subjects,
  });
  if (signature === lastSignature && section.childElementCount) return;
  lastSignature = signature;
  section.innerHTML = sectionMarkup(data);
}

function scheduleMount(force = false) {
  clearTimeout(mountTimer);
  mountTimer = window.setTimeout(() => mount(force), 80);
}

firebaseApi.observeAuth((user) => {
  currentUser = user || null;
  cache.at = 0;
  lastSignature = "";
  scheduleMount(true);
});

window.addEventListener("pageshow", () => scheduleMount(false), { passive: true });
window.addEventListener("storage", (event) => {
  if (event.key === PROFILE_KEY || event.key?.startsWith(BAG_KEY)) {
    cache.at = 0;
    lastSignature = "";
    scheduleMount(true);
  }
});
window.addEventListener("pincon-design-system-change", () => scheduleMount(false));

const root = document.getElementById("root");
if (root) new MutationObserver(() => scheduleMount(false)).observe(root, { childList: true, subtree: true });

scheduleMount(true);
window.setInterval(() => {
  if (document.visibilityState !== "visible") return;
  cache.at = 0;
  lastSignature = "";
  scheduleMount(true);
}, 120_000);

globalThis.PINCON_ADOPTION_CORE = Object.freeze({ refresh: () => mount(true), openBag: () => loadData().then(openBag) });
