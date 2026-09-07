import { NextDataGateway, readClassProfile } from "./core/data-gateway.js";
import { cleanText } from "./core/school-life.js";

const SCHOOL = globalThis.PINCON_SCHOOL_CONFIG || { id: "gochon-high" };
const gateway = new NextDataGateway();
let snapshot = gateway.snapshot();
let items = [];
let unsubscribe = null;
let currentKey = "";

function profile() {
  return snapshot.profile || readClassProfile();
}

function route() {
  return location.hash.replace(/^#/, "").split("/")[0] || "today";
}

function disconnect() {
  try { unsubscribe?.(); } catch {}
  unsubscribe = null;
  currentKey = "";
  items = [];
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeLink(value) {
  try {
    const url = new URL(String(value || ""), location.origin);
    if (url.origin !== location.origin) return "#today";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "#today";
  }
}

function formatTime(value) {
  const ms = Number(value || 0);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(ms));
}

function mount() {
  const host = document.querySelector('#schoolLifeAssistant[data-school-life-route="more"] .school-life__surface');
  if (!host) return;
  let node = document.getElementById("schoolLifeInbox");
  if (!node) {
    node = document.createElement("section");
    node.id = "schoolLifeInbox";
    node.className = "school-life__lesson";
    host.appendChild(node);
  }
  const visible = items.slice(0, 12);
  node.innerHTML = `<div class="school-life__header"><div><p class="school-life__eyebrow">앱 내부 알림</p><h3>최근 알림</h3><div class="school-life__meta">푸시를 지원하지 않거나 권한이 꺼져 있어도 여기에 남습니다.</div></div></div>${visible.length ? `<div class="school-life__lessons">${visible.map((item) => `<article class="school-life__lesson" data-inbox-id="${esc(item.id)}"><div class="school-life__lesson-head"><div class="school-life__lesson-title"><strong>${esc(item.title || "PinCon 알림")}</strong><div class="school-life__meta">${esc(formatTime(item.createdAtMs))}${item.read ? "" : " · 새 알림"}</div></div>${item.read ? "" : '<span class="school-life__status">새 알림</span>'}</div><p class="school-life__meta" style="white-space:pre-line;margin:8px 0 0">${esc(cleanText(item.body, 1000))}</p><div class="school-life__actions" style="margin-top:8px"><a class="school-life__button" href="${esc(safeLink(item.link))}" data-inbox-open="${esc(item.id)}">관련 화면 보기</a>${item.read ? "" : `<button type="button" class="school-life__button" data-inbox-read="${esc(item.id)}">읽음</button>`}</div></article>`).join("")}</div>` : '<p class="school-life__empty">아직 받은 학교생활 알림이 없습니다.</p>'}`;
}

async function connect() {
  const user = snapshot.user;
  const p = profile();
  const api = gateway.repository?.api;
  if (route() !== "more" || document.hidden || !user?.uid || !p?.classKey || !api) {
    disconnect();
    requestAnimationFrame(mount);
    return;
  }
  const key = `${p.classKey}:${user.uid}:more`;
  if (key === currentKey) return;
  disconnect();
  currentKey = key;
  const ref = api.query(
    api.collection(api.db, "schools", SCHOOL.id, "schoolLifeUsers", user.uid, "notificationInbox"),
    api.orderBy("createdAtMs", "desc"),
    api.limit(30),
  );
  unsubscribe = api.onSnapshot(ref, (value) => {
    items = value.docs.map((document) => ({ id: document.id, ...document.data() }));
    requestAnimationFrame(mount);
  }, () => {
    items = [];
    requestAnimationFrame(mount);
  });
}

async function markRead(id) {
  const api = gateway.repository?.api;
  const user = snapshot.user;
  if (!api || !user?.uid || !id) return;
  const ref = api.doc(api.db, "schools", SCHOOL.id, "schoolLifeUsers", user.uid, "notificationInbox", id);
  await api.updateDoc(ref, { read: true });
}

document.addEventListener("click", (event) => {
  const read = event.target.closest?.("[data-inbox-read]");
  if (read) markRead(read.dataset.inboxRead).catch(() => {});
  const open = event.target.closest?.("[data-inbox-open]");
  if (open) markRead(open.dataset.inboxOpen).catch(() => {});
});

gateway.addEventListener("change", (event) => {
  snapshot = event.detail;
  connect().catch(() => {});
  requestAnimationFrame(mount);
});
await gateway.start().catch(() => null);
snapshot = gateway.snapshot();
await connect().catch(() => {});
window.addEventListener("hashchange", () => connect().catch(() => {}));
window.addEventListener("popstate", () => connect().catch(() => {}));
document.addEventListener("visibilitychange", () => connect().catch(() => {}));
new MutationObserver(() => requestAnimationFrame(mount)).observe(document.documentElement, { childList: true, subtree: true });
mount();