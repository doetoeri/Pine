import { NextDataGateway, readClassProfile } from "./core/data-gateway.js";
import { buildTodayChanges, buildTodayChangesShareText } from "./core/today-changes.js";

const gateway = new NextDataGateway();
const COLLECTIONS = ["announcements", "content", "classAssignments", "evaluationPlans", "events"];
let renderQueued = false;
let lastSignature = "";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function compact(value, max = 150) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function routeIsToday() {
  const route = location.hash.replace(/^#\/?/, "").split("?")[0];
  return !route || route === "today";
}

function relevantStatus(snapshot) {
  const statuses = COLLECTIONS.map((name) => snapshot.collectionStatus?.[name] || "idle");
  const loading = statuses.some((status) => ["idle", "loading"].includes(status));
  const failed = statuses.every((status) => ["error", "cached-error"].includes(status));
  return { loading, failed };
}

function relativeTime(time) {
  const diff = Math.max(0, Date.now() - Number(time || 0));
  if (diff < 60_000) return "방금";
  if (diff < 60 * 60_000) return `${Math.max(1, Math.floor(diff / 60_000))}분 전`;
  if (diff < 24 * 60 * 60_000) return `${Math.max(1, Math.floor(diff / (60 * 60_000)))}시간 전`;
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(time));
}

function cardMarkup(snapshot, rows) {
  const { loading, failed } = relevantStatus(snapshot);
  const cacheLabel = snapshot.usingCache || !snapshot.online ? "저장된 정보 기준" : "최근 36시간";
  let body = "";

  if (!rows.length && loading) {
    body = `<div class="pincon-today-changes__state" role="status">
      <md-circular-progress indeterminate></md-circular-progress>
      <div><strong>변경사항 확인 중</strong><span>공지와 수행평가, 시간표 변경을 확인하고 있습니다.</span></div>
    </div>`;
  } else if (!rows.length && failed) {
    body = `<div class="pincon-today-changes__state" role="alert">
      <md-icon>cloud_off</md-icon>
      <div><strong>변경사항을 확인하지 못했습니다</strong><span>연결이 복구되면 자동으로 다시 확인합니다.</span></div>
    </div>`;
  } else if (!rows.length) {
    body = `<div class="pincon-today-changes__state">
      <md-icon>check_circle</md-icon>
      <div><strong>새로 바뀐 정보 없음</strong><span>최근 36시간 동안 확인된 새 공지나 변경사항이 없습니다.</span></div>
    </div>`;
  } else {
    body = `<div class="pincon-today-changes__list">
      ${rows.map((row) => `<button type="button" class="pincon-today-change" data-route="${escapeHtml(row.route)}" aria-label="${escapeHtml(row.title)} 관련 화면 열기">
        <span class="pincon-today-change__icon"><md-icon>${escapeHtml(row.icon)}</md-icon></span>
        <span class="pincon-today-change__copy">
          <span class="pincon-today-change__meta"><b data-change-type="${escapeHtml(row.changeType)}">${row.changeType === "changed" ? "변경" : "새로 등록"}</b><span>${escapeHtml(row.kind)} · ${escapeHtml(relativeTime(row.occurredAtMs))}</span></span>
          <strong>${escapeHtml(row.title)}</strong>
          ${row.summary ? `<small>${escapeHtml(compact(row.summary))}</small>` : ""}
        </span>
        <md-icon class="pincon-today-change__chevron">chevron_right</md-icon>
      </button>`).join("")}
    </div>`;
  }

  return `<article class="surface pincon-today-changes" id="pinconTodayChanges" aria-labelledby="pinconTodayChangesTitle">
    <div class="surface__header pincon-today-changes__header">
      <div>
        <p class="page-eyebrow">${escapeHtml(cacheLabel)}</p>
        <h2 class="surface__title" id="pinconTodayChangesTitle">오늘 바뀐 것</h2>
      </div>
      <div class="pincon-today-changes__actions">
        ${rows.length ? `<span class="pincon-today-changes__count">${rows.length}건</span>` : ""}
        <md-text-button data-today-changes-share ${loading && !rows.length ? "disabled" : ""}><md-icon slot="icon">share</md-icon>반톡 공유</md-text-button>
      </div>
    </div>
    ${body}
  </article>`;
}

function signature(snapshot, rows) {
  const statuses = COLLECTIONS.map((name) => snapshot.collectionStatus?.[name] || "idle").join(",");
  return [
    routeIsToday() ? "today" : "other",
    snapshot.online ? "online" : "offline",
    snapshot.usingCache ? "cache" : "live",
    statuses,
    ...rows.map((row) => `${row.id}:${row.occurredAtMs}:${row.changeType}`),
  ].join("|");
}

function render() {
  renderQueued = false;
  const existing = document.querySelector("#pinconTodayChanges");
  if (!routeIsToday()) {
    existing?.remove();
    lastSignature = "";
    return;
  }

  const main = document.querySelector("#mainContent");
  const dashboard = main?.querySelector(".dashboard-grid");
  if (!main || !dashboard) return;

  const snapshot = gateway.snapshot();
  const rows = buildTodayChanges(snapshot.data || {});
  const nextSignature = signature(snapshot, rows);
  if (existing && nextSignature === lastSignature) return;

  existing?.remove();
  dashboard.insertAdjacentHTML("beforebegin", cardMarkup(snapshot, rows));
  lastSignature = nextSignature;
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(render);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

async function shareCurrent(button) {
  const snapshot = gateway.snapshot();
  const rows = buildTodayChanges(snapshot.data || {});
  const text = buildTodayChangesShareText(rows, snapshot.profile || readClassProfile());
  const payload = { title: "PinCon · 오늘 바뀐 것", text };

  try {
    if (navigator.share) {
      await navigator.share(payload);
      return;
    }
    await copyText(text);
    const original = button.innerHTML;
    button.innerHTML = '<md-icon slot="icon">check</md-icon>복사됨';
    window.setTimeout(() => { if (button.isConnected) button.innerHTML = original; }, 1800);
  } catch (error) {
    if (error?.name === "AbortError") return;
    const original = button.innerHTML;
    button.textContent = "공유 실패";
    window.setTimeout(() => { if (button.isConnected) button.innerHTML = original; }, 1800);
  }
}

document.addEventListener("click", (event) => {
  const share = event.target.closest?.("[data-today-changes-share]");
  if (share) shareCurrent(share);
});

gateway.addEventListener("change", queueRender);
window.addEventListener("hashchange", queueRender);
const app = document.querySelector("#app");
if (app) new MutationObserver(queueRender).observe(app, { childList: true, subtree: true });
queueRender();
