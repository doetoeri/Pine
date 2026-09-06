import { readClassProfile } from "../core/data-gateway.js";
import { currentFirebaseUser } from "../core/student-auth.js?v=20260903-pinreauth1";

const root = document.querySelector("#adminApp");
const PREVIEW_API = "https://pincon-ai-git-feature-class-enrollment-doeyoungkims-projects.vercel.app";
const configured = String(globalThis.PINCON_ACCOUNT_API_BASE || "").replace(/\/$/, "");
const fallbacks = Array.isArray(globalThis.PINCON_ACCOUNT_API_FALLBACKS) ? globalThis.PINCON_ACCOUNT_API_FALLBACKS : [];
const apiBases = [...new Set([
  ...(location.hostname.includes("feature-class-enrollment") ? [PREVIEW_API] : []),
  configured,
  ...fallbacks.map((x) => String(x || "").replace(/\/$/, "")),
  "https://pincon-ai-git-main-doeyoungkims-projects.vercel.app",
].filter(Boolean))];

let rosterRows = [];
let preview = null;
let activeSession = null;
let statusData = null;
let pollTimer = 0;
let filter = "all";

function esc(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function selectedClass() {
  const profile = readClassProfile?.() || {};
  const [kg, kc] = String(profile.classKey || "").split("-").map(Number);
  return { grade: Number(profile.grade || kg || 1), classNumber: Number(profile.classNumber || kc || 8) };
}
function apiQrUrl(sessionId) {
  const base = apiBases[0] || "https://pincon-ai-git-main-doeyoungkims-projects.vercel.app";
  return `${base}/api/accounts/enrollment?action=qr&session=${encodeURIComponent(sessionId)}`;
}
async function api(body) {
  const user = await currentFirebaseUser();
  if (!user) throw new Error("관리자 로그인이 필요합니다.");
  const token = await user.getIdToken();
  let last = null;
  for (const base of apiBases) {
    try {
      const response = await fetch(`${base}/api/accounts/enrollment`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        cache: "no-store",
        body: JSON.stringify(body),
      });
      let data = {};
      try { data = await response.json(); } catch {}
      if (response.status === 404 && data?.error === "route-not-found") continue;
      if (!response.ok) {
        const error = new Error(data?.error || "request-failed");
        error.status = response.status;
        error.data = data;
        throw error;
      }
      return data;
    } catch (error) {
      if (error?.status) throw error;
      last = error;
    }
  }
  throw last || new Error("계정 서버에 연결하지 못했습니다.");
}
function parseCsv(text) {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV에 학생 행이 없습니다.");
  const parseLine = (line) => {
    const out = []; let value = ""; let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { value += '"'; i += 1; }
        else quoted = !quoted;
      } else if (ch === "," && !quoted) { out.push(value.trim()); value = ""; }
      else value += ch;
    }
    out.push(value.trim());
    return out;
  };
  const headers = parseLine(lines[0]);
  const required = ["studentId", "name", "grade", "classNumber", "number"];
  const studentHeader = headers.includes("studentId") ? "studentId" : headers.includes("studentNumber") ? "studentNumber" : "";
  if (!studentHeader || !required.slice(1).every((h) => headers.includes(h))) throw new Error("CSV 머리글은 studentId,name,grade,classNumber,number 형식이어야 합니다.");
  return lines.slice(1).map((line) => {
    const values = parseLine(line); const row = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ""; });
    return { studentNumber: row[studentHeader], name: row.name, grade: Number(row.grade), classNumber: Number(row.classNumber), number: Number(row.number) };
  });
}
function ensureStyle() {
  if (document.querySelector("#pinconEnrollmentStyle")) return;
  const style = document.createElement("style");
  style.id = "pinconEnrollmentStyle";
  style.textContent = `.enroll-card{grid-column:1/-1}.enroll-toolbar,.enroll-actions,.enroll-filters{display:flex;gap:10px;flex-wrap:wrap;align-items:end}.enroll-toolbar label{display:grid;gap:5px;font-size:12px;font-weight:700}.enroll-toolbar select,.enroll-toolbar input{min-height:42px;border:1px solid var(--md-sys-color-outline-variant,#c5c8bd);border-radius:14px;padding:0 12px;background:var(--md-sys-color-surface,#fff)}.enroll-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:16px 0}.enroll-stat{padding:14px;border-radius:18px;background:var(--md-sys-color-surface-container,#f0f2ec)}.enroll-stat span{display:block;font-size:11px;color:var(--md-sys-color-on-surface-variant,#60645c)}.enroll-stat strong{font-size:24px}.enroll-session{display:grid;grid-template-columns:180px 1fr;gap:18px;align-items:center;padding:18px;border-radius:22px;background:var(--md-sys-color-surface-container-low,#f7f8f3);margin-top:16px}.enroll-session img{width:180px;height:180px;background:white;border-radius:14px;padding:8px}.enroll-url{word-break:break-all;font-size:12px;color:var(--md-sys-color-on-surface-variant,#60645c)}.enroll-list{margin-top:14px;border-top:1px solid var(--md-sys-color-outline-variant,#ddd)}.enroll-row{display:grid;grid-template-columns:46px 1fr 110px auto;gap:10px;align-items:center;padding:11px 4px;border-bottom:1px solid var(--md-sys-color-outline-variant,#eee)}.enroll-row small{color:var(--md-sys-color-on-surface-variant,#60645c)}.enroll-ok{color:#2f6b25;font-weight:800}.enroll-pending{color:#7a5b00;font-weight:800}.enroll-message{min-height:22px;margin-top:10px;font-size:13px}.enroll-message.error{color:var(--md-sys-color-error,#ba1a1a);font-weight:700}@media(max-width:720px){.enroll-summary{grid-template-columns:1fr}.enroll-session{grid-template-columns:1fr}.enroll-session img{width:160px;height:160px}.enroll-row{grid-template-columns:40px 1fr auto}.enroll-row .enroll-row-actions{grid-column:2/-1}}`;
  document.head.appendChild(style);
}
function classOptions(max, selected) { return Array.from({ length: max }, (_, i) => i + 1).map((n) => `<option value="${n}" ${n === selected ? "selected" : ""}>${n}</option>`).join(""); }
function previewMarkup() {
  if (!preview) return "";
  return `<div class="enroll-summary"><div class="enroll-stat"><span>신규</span><strong>${preview.new}</strong></div><div class="enroll-stat"><span>기존/연결</span><strong>${preview.existing}</strong></div><div class="enroll-stat"><span>충돌 · 오류</span><strong>${preview.conflicts + preview.errors}</strong></div></div><div class="enroll-actions"><md-filled-button id="enrollCommit" ${preview.errors ? "disabled" : ""}>${preview.conflicts ? "충돌 확인 후 등록" : `${preview.valid}명 등록`}</md-filled-button></div>`;
}
function sessionMarkup() {
  if (!activeSession) return "";
  const s = statusData?.session || activeSession.session || activeSession;
  const joinUrl = activeSession.joinUrl || `https://pincon.app/next/join/?session=${encodeURIComponent(s.id)}`;
  const total = statusData?.total ?? 0;
  const completed = statusData?.completed ?? 0;
  const pending = statusData?.pending ?? total;
  const remain = Math.max(0, Number(s.expiresAtMs || 0) - Number(statusData?.serverNowMs || Date.now()));
  const mm = String(Math.floor(remain / 60000)).padStart(2,"0");
  const ss = String(Math.floor((remain % 60000) / 1000)).padStart(2,"0");
  const roster = (statusData?.roster || []).filter((x) => filter === "all" || (filter === "done" ? x.activated : !x.activated));
  return `<div class="enroll-session"><img src="${esc(apiQrUrl(s.id))}" alt="학생 계정 개통 QR 코드" /><div><strong>${esc(s.grade)}학년 ${esc(s.classNumber)}반 계정 개통</strong><div class="enroll-summary"><div class="enroll-stat"><span>가입 완료</span><strong>${completed} / ${total}</strong></div><div class="enroll-stat"><span>미가입</span><strong>${pending}</strong></div><div class="enroll-stat"><span>남은 시간</span><strong>${mm}:${ss}</strong></div></div><div class="enroll-url">${esc(joinUrl)}</div><div class="enroll-actions"><md-filled-tonal-button id="copyJoin">링크 복사</md-filled-tonal-button><md-filled-tonal-button id="extendJoin">5분 연장</md-filled-tonal-button><md-text-button id="endJoin">가입 종료</md-text-button></div></div></div><div class="enroll-filters" style="margin-top:14px"><md-filter-chip data-filter="all" label="전체 ${total}" ${filter === "all" ? "selected" : ""}></md-filter-chip><md-filter-chip data-filter="done" label="가입 완료 ${completed}" ${filter === "done" ? "selected" : ""}></md-filter-chip><md-filter-chip data-filter="pending" label="미가입 ${pending}" ${filter === "pending" ? "selected" : ""}></md-filter-chip></div><div class="enroll-list">${roster.map((x) => `<div class="enroll-row"><strong>${String(x.number).padStart(2,"0")}</strong><div><strong>${esc(x.name)}</strong><small> ${esc(x.studentNumber)}</small></div><span class="${x.activated ? "enroll-ok" : "enroll-pending"}">${x.activated ? "가입 완료" : "미가입"}</span><div class="enroll-row-actions">${x.activated ? `<md-text-button data-student-action="reset" data-student="${esc(x.studentNumber)}">PIN 초기화</md-text-button><md-text-button data-student-action="disable" data-student="${esc(x.studentNumber)}">비활성화</md-text-button>` : `<md-text-button data-student-action="allow-enrollment" data-student="${esc(x.studentNumber)}">개별 가입</md-text-button>`}</div></div>`).join("") || `<div class="admin-empty">표시할 학생이 없습니다.</div>`}</div>`;
}
function markup() {
  const c = selectedClass();
  return `<section class="admin-card admin-card--wide enroll-card" id="pinconClassEnrollment"><div class="admin-card__header"><div><span class="admin-meta">학생 계정 관리</span><h2>계정 개통</h2><p>공용 QR 하나로 학급 전체를 빠르게 개통합니다.</p></div></div><div class="enroll-toolbar"><label>학년<select id="enrollGrade">${classOptions(3,c.grade)}</select></label><label>반<select id="enrollClass">${classOptions(10,c.classNumber)}</select></label><label>가입 시간<select id="enrollDuration"><option>5</option><option>10</option><option selected>15</option><option>30</option></select></label><label>학생 명단 CSV<input type="file" id="enrollCsv" accept=".csv,text/csv" /></label><md-filled-tonal-button id="startEnrollment">학급 가입 시작</md-filled-tonal-button></div><div id="enrollPreview">${previewMarkup()}</div><div id="enrollSession">${sessionMarkup()}</div><div id="enrollMessage" class="enroll-message" role="status"></div></section>`;
}
function message(text, error = false) { const el = root?.querySelector("#enrollMessage"); if (el) { el.textContent = text; el.className = `enroll-message${error ? " error" : ""}`; } }
async function refreshStatus(render = true) {
  if (!activeSession?.session?.id && !activeSession?.id) return;
  const sessionId = activeSession.session?.id || activeSession.id;
  try {
    statusData = await api({ action: "session-status", sessionId });
    if (render) renderSection(true);
    clearTimeout(pollTimer);
    if (statusData.session?.active && Number(statusData.session.expiresAtMs || 0) > Number(statusData.serverNowMs || Date.now())) pollTimer = setTimeout(() => refreshStatus(true), 1800);
  } catch (error) { message(error.message, true); }
}
function bind() {
  const section = root?.querySelector("#pinconClassEnrollment");
  if (!section) return;
  section.querySelector("#enrollCsv")?.addEventListener("change", async (event) => {
    try {
      const file = event.target.files?.[0]; if (!file) return;
      rosterRows = parseCsv(await file.text());
      preview = (await api({ action: "roster-import", rows: rosterRows, commit: false })).preview;
      renderSection(true);
      message(`${preview.valid}명의 명단을 확인했습니다.`);
    } catch (error) { message(error.message, true); }
  });
  section.querySelector("#enrollCommit")?.addEventListener("click", async () => {
    try {
      const confirmConflicts = preview?.conflicts ? confirm(`기존 정보와 다른 학생 ${preview.conflicts}명이 있습니다. 기존 활성화 상태와 UID는 보존하고 명단 정보만 갱신할까요?`) : true;
      if (!confirmConflicts) return;
      const result = await api({ action: "roster-import", rows: rosterRows, commit: true, confirmConflicts: true });
      preview = result.preview; renderSection(true); message(`${preview.valid}명의 학생 명단을 등록했습니다.`);
    } catch (error) { message(error.message, true); }
  });
  section.querySelector("#startEnrollment")?.addEventListener("click", async () => {
    try {
      const grade = Number(section.querySelector("#enrollGrade").value); const classNumber = Number(section.querySelector("#enrollClass").value); const durationMinutes = Number(section.querySelector("#enrollDuration").value);
      activeSession = await api({ action: "session-start", grade, classNumber, durationMinutes });
      await refreshStatus(true);
    } catch (error) { message(error.message, true); }
  });
  section.querySelector("#copyJoin")?.addEventListener("click", async () => { const s = activeSession.session || activeSession; const url = activeSession.joinUrl || `https://pincon.app/next/join/?session=${s.id}`; await navigator.clipboard.writeText(url); message("가입 링크를 복사했습니다."); });
  section.querySelector("#extendJoin")?.addEventListener("click", async () => { const s = activeSession.session || activeSession; statusData = await api({ action: "session-extend", sessionId: s.id, minutes: 5 }); renderSection(true); });
  section.querySelector("#endJoin")?.addEventListener("click", async () => { if (!confirm("현재 학급 가입 세션을 종료할까요?")) return; const s = activeSession.session || activeSession; statusData = await api({ action: "session-end", sessionId: s.id }); clearTimeout(pollTimer); renderSection(true); message("가입 세션을 종료했습니다."); });
  section.querySelectorAll("[data-filter]").forEach((el) => el.addEventListener("click", () => { filter = el.dataset.filter; renderSection(true); }));
  section.querySelectorAll("[data-student-action]").forEach((el) => el.addEventListener("click", async () => {
    const studentNumber = el.dataset.student; const studentAction = el.dataset.studentAction;
    const destructive = studentAction === "disable" || studentAction === "reset";
    if (destructive && !confirm(`${studentNumber} 학생 계정에 ${studentAction === "reset" ? "PIN 초기화" : "비활성화"}를 적용할까요?`)) return;
    try {
      const result = await api({ action: "student-action", studentNumber, studentAction, durationMinutes: 10 });
      if (result?.session) { activeSession = result; statusData = null; message("개별 가입 링크를 열었습니다."); await refreshStatus(true); }
      else { await refreshStatus(true); message("학생 계정 상태를 변경했습니다."); }
    } catch (error) { message(error.message, true); }
  }));
}
function renderSection(force = false) {
  ensureStyle();
  const grid = root?.querySelector("#adminMain .admin-grid");
  if (!grid) return;
  const existing = grid.querySelector("#pinconClassEnrollment");
  if (existing && !force) return;
  const html = markup();
  if (existing) existing.outerHTML = html; else grid.insertAdjacentHTML("afterbegin", html);
  bind();
}
const observer = new MutationObserver(() => requestAnimationFrame(() => renderSection(false)));
if (root) observer.observe(root, { childList: true, subtree: true });
renderSection();
