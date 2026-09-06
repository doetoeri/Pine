import { currentFirebaseUser } from "../core/student-auth.js?v=20260903-pinreauth1";

const root = document.querySelector("#adminApp");
const configured = String(globalThis.PINCON_ACCOUNT_API_BASE || "").replace(/\/$/, "");
const fallbacks = Array.isArray(globalThis.PINCON_ACCOUNT_API_FALLBACKS)
  ? globalThis.PINCON_ACCOUNT_API_FALLBACKS.map((value) => String(value || "").replace(/\/$/, "")).filter(Boolean)
  : [];
const API_BASES = [...new Set([configured, ...fallbacks].filter(Boolean))];
let rows = [];
let loading = false;
let mounted = false;
let issued = null;
let refreshTimer = 0;

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(body) {
  const user = await currentFirebaseUser();
  if (!user) throw new Error("관리자 로그인이 필요합니다.");
  const token = await user.getIdToken();
  let lastError = null;
  for (let index = 0; index < API_BASES.length; index += 1) {
    const base = API_BASES[index];
    try {
      const response = await fetch(`${base}/api/accounts/pin-reset-requests`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        cache: "no-store",
        body: JSON.stringify(body),
      });
      let data = {};
      try { data = await response.json(); } catch {}
      if (response.status === 404 && data?.error === "route-not-found" && index < API_BASES.length - 1) continue;
      if (!response.ok) {
        const error = new Error(data?.error || "request-failed");
        error.status = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      if (error?.status) throw error;
      lastError = error;
    }
  }
  throw lastError || new Error("계정 서버에 연결하지 못했습니다.");
}

function qrUrl(sessionId) {
  const base = API_BASES[0] || "";
  return `${base}/api/accounts/enrollment?action=qr&session=${encodeURIComponent(sessionId)}`;
}

function timestamp(ms) {
  const value = Number(ms || 0);
  if (!value) return "";
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function rowsMarkup() {
  if (loading && !rows.length) return `<div class="pin-reset-empty">요청을 불러오는 중…</div>`;
  if (!rows.length) return `<div class="pin-reset-empty"><md-icon>verified</md-icon><div><strong>대기 중인 PIN 초기화 요청이 없습니다</strong><span>학생이 로그인 화면에서 요청하면 이곳에 표시됩니다.</span></div></div>`;
  return `<div class="pin-reset-list">${rows.map((item) => `<div class="pin-reset-row">
    <div class="pin-reset-student"><strong>${String(item.number || "").padStart(2, "0")} · ${esc(item.name || "학생")}</strong><span>${esc(item.studentNumber)} · ${esc(item.grade)}학년 ${esc(item.classNumber)}반 · ${esc(timestamp(item.requestedAtMs))}</span></div>
    <div class="pin-reset-actions"><md-filled-tonal-button data-reset-approve="${esc(item.studentNumber)}"><md-icon slot="icon">key</md-icon>승인</md-filled-tonal-button><md-text-button data-reset-reject="${esc(item.studentNumber)}">거절</md-text-button></div>
  </div>`).join("")}</div>`;
}

function issuedMarkup() {
  if (!issued?.session?.id) return "";
  return `<div class="pin-reset-issued"><img src="${esc(qrUrl(issued.session.id))}" alt="PIN 재설정용 QR 코드"><div><span>개별 재개통 링크 발급 완료</span><strong>${esc(issued.studentNumber)} 학생 전용 · 10분</strong><p>${esc(issued.joinUrl)}</p><md-filled-button id="copyPinResetLink">링크 복사</md-filled-button></div></div>`;
}

function markup() {
  return `<section class="admin-card admin-card--wide pin-reset-card" id="pinconPinResetRequests" aria-labelledby="pin-reset-title">
    <div class="admin-card__header"><div><span class="admin-meta">계정 복구</span><h2 id="pin-reset-title">PIN 초기화 요청</h2><p>학생 요청을 확인한 뒤 승인하면 그 학생만 사용할 수 있는 10분 재개통 링크를 발급합니다.</p></div><span class="pin-reset-count">${rows.length ? `${rows.length}건 대기` : "대기 없음"}</span></div>
    ${issuedMarkup()}
    <div data-pin-reset-rows>${rowsMarkup()}</div>
    <div class="pin-reset-status" role="status" aria-live="polite"></div>
  </section>`;
}

function ensureStyle() {
  if (document.querySelector("#pinconPinResetStyle")) return;
  const style = document.createElement("style");
  style.id = "pinconPinResetStyle";
  style.textContent = `.pin-reset-card{grid-column:1/-1}.pin-reset-count{font-size:12px;font-weight:800;color:var(--md-sys-color-primary,#49662e)}.pin-reset-list{display:grid;gap:8px;margin-top:12px}.pin-reset-row{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:14px;border-radius:18px;background:var(--md-sys-color-surface-container-low,#f5f6f1)}.pin-reset-student{display:grid;gap:4px}.pin-reset-student span{font-size:12px;color:var(--md-sys-color-on-surface-variant,#60645c)}.pin-reset-actions{display:flex;gap:6px;align-items:center}.pin-reset-empty{min-height:90px;display:flex;align-items:center;justify-content:center;gap:10px;color:var(--md-sys-color-on-surface-variant,#60645c)}.pin-reset-empty>div{display:grid;gap:2px}.pin-reset-empty span{font-size:12px}.pin-reset-issued{display:grid;grid-template-columns:120px 1fr;gap:16px;align-items:center;margin:14px 0;padding:16px;border-radius:20px;background:var(--md-sys-color-tertiary-container,#e7eedc)}.pin-reset-issued img{width:120px;height:120px;background:#fff;border-radius:12px;padding:6px}.pin-reset-issued div{display:grid;gap:5px}.pin-reset-issued span{font-size:11px;font-weight:800}.pin-reset-issued p{margin:0;font-size:12px;word-break:break-all}.pin-reset-status{min-height:20px;margin-top:8px;font-size:12px}.pin-reset-status.is-error{color:var(--md-sys-color-error,#ba1a1a);font-weight:700}@media(max-width:680px){.pin-reset-row{align-items:flex-start;flex-direction:column}.pin-reset-actions{width:100%}.pin-reset-issued{grid-template-columns:1fr}.pin-reset-issued img{width:140px;height:140px}}`;
  document.head.appendChild(style);
}

function status(message, error = false) {
  const box = root?.querySelector("#pinconPinResetRequests .pin-reset-status");
  if (!box) return;
  box.textContent = message;
  box.classList.toggle("is-error", error);
}

function render(force = false) {
  ensureStyle();
  const grid = root?.querySelector("#adminMain .admin-grid");
  if (!grid) return false;
  const existing = grid.querySelector("#pinconPinResetRequests");
  if (existing && !force) return true;
  const html = markup();
  if (existing) existing.outerHTML = html;
  else {
    const enrollment = grid.querySelector("#pinconClassEnrollment");
    if (enrollment) enrollment.insertAdjacentHTML("afterend", html);
    else grid.insertAdjacentHTML("afterbegin", html);
  }
  bind();
  mounted = true;
  return true;
}

async function refresh({ rerender = true } = {}) {
  if (loading) return;
  loading = true;
  try {
    const result = await api({ action: "list" });
    rows = Array.isArray(result.requests) ? result.requests : [];
    if (rerender) render(true);
  } catch (error) {
    status(error?.message || "요청 목록을 불러오지 못했습니다.", true);
  } finally {
    loading = false;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh({ rerender: true }), 5000);
  }
}

function bind() {
  const section = root?.querySelector("#pinconPinResetRequests");
  if (!section) return;
  section.querySelectorAll("[data-reset-approve]").forEach((button) => button.addEventListener("click", async () => {
    const studentNumber = button.dataset.resetApprove;
    if (!confirm(`${studentNumber} 학생의 기존 로그인 세션을 끊고 PIN 재설정을 허용할까요?`)) return;
    button.disabled = true;
    status("기존 계정을 보호한 채 재설정 링크를 만드는 중…");
    try {
      issued = await api({ action: "approve", studentNumber });
      await refresh({ rerender: true });
      status("10분짜리 개별 PIN 재설정 링크를 발급했습니다.");
    } catch (error) {
      button.disabled = false;
      status(error?.message || "승인하지 못했습니다.", true);
    }
  }));
  section.querySelectorAll("[data-reset-reject]").forEach((button) => button.addEventListener("click", async () => {
    const studentNumber = button.dataset.resetReject;
    if (!confirm(`${studentNumber} 학생의 PIN 초기화 요청을 거절할까요?`)) return;
    button.disabled = true;
    try {
      await api({ action: "reject", studentNumber });
      await refresh({ rerender: true });
      status("요청을 거절했습니다.");
    } catch (error) {
      button.disabled = false;
      status(error?.message || "요청을 처리하지 못했습니다.", true);
    }
  }));
  section.querySelector("#copyPinResetLink")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(issued?.joinUrl || "");
      status("재설정 링크를 복사했습니다.");
    } catch {
      status("링크를 직접 복사해주세요.", true);
    }
  });
}

const observer = new MutationObserver(() => {
  if (!root?.querySelector("#adminMain .admin-grid")) return;
  if (!mounted || !root.querySelector("#pinconPinResetRequests")) requestAnimationFrame(() => {
    if (render(false) && !rows.length) refresh({ rerender: true });
  });
});
if (root) observer.observe(root, { childList: true, subtree: true });
if (render(false)) refresh({ rerender: true });
