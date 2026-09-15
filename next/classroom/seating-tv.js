import { accountRequest } from "../core/student-auth.js";
import { publicSeatingView } from "../../integrations/pincon-ai/lib/seating-planner.mjs";
import { demoView, DEMO_KEY } from "./seating-demo.js";
import { createSeatingCeremony, isCeremonyRequested } from "./seating-ceremony.js";

const root = document.getElementById("seatingTV"), params = new URL(location.href).searchParams;
const demo = params.get("demo") === "1", classKey = params.get("classKey") || "";
const esc = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const ceremony = createSeatingCeremony({ root, enabled: isCeremonyRequested(params) });
let view, flipped = false, loading = false, signature = "", liveError = "", timer, wakeLock;

function render() {
  const g = view.general, byId = new Map(view.roster.map(s => [s.uid, s]));
  const indexes = Array.from({ length: 36 }, (_, i) => i); if (flipped) indexes.reverse();
  const hasSeats = g.seats.some(Boolean);
  const time = view.updatedAtMs ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(view.updatedAtMs) : "아직 저장 전";
  root.innerHTML = `<div class="tv-shell"><header class="tv-header"><div><div class="tv-heading"><span class="wordmark">PinCon</span><h1>${esc(view.classKey)} 우리 반 자리표</h1></div><p>${demo ? `<span class="tv-demo">예시 명단 · 실제 배치 아님</span>` : "3분단 · 6줄 / 6줄 / 5줄 · 2명씩 짝"}</p></div><div class="tv-controls"><button id="flip">교탁을 ${flipped ? "위로" : "아래로"}</button>${ceremony.enabled ? '<button id="replayCeremony">세레머니 다시 공개</button>' : ""}<button id="fullscreen">${document.fullscreenElement ? "전체화면 종료" : "전체화면"}</button><button id="print">인쇄</button></div></header>
    ${hasSeats ? `<div class="tv-room-wrap ${flipped ? "is-flipped" : ""}"><div class="seat-board">칠판 · 교탁</div><div class="section-labels">${(flipped ? [3, 2, 1] : [1, 2, 3]).map(n => `<span>${n}분단</span>`).join("")}</div><div class="planner-room">${indexes.map(index => {
      if (index === 34 || index === 35) return `<span class="desk-absent" aria-hidden="true"></span>`;
      const s = byId.get(g.seats[index]), blocked = g.blocked.includes(index);
      return `<div class="desk ${blocked || !s ? "is-blocked" : ""}" data-seat-index="${index}" data-seat-zone="${Math.floor((index % 6) / 2) + 1}"><small>${Math.floor(index / 6) + 1}–${index % 6 + 1}</small><strong>${esc(blocked ? "―" : s?.name || "빈자리")}</strong><span class="desk-number">${s && !blocked ? `${s.number}번` : ""}</span></div>`;
    }).join("")}</div></div>` : `<section class="tv-empty"><h2>아직 저장된 자리표가 없습니다.</h2><p>자리 설계에서 배치를 만들고 저장해주세요.</p></section>`}
    <footer class="tv-footer"><span>${flipped ? "화면 아래쪽이 교실 앞" : "화면 위쪽이 교실 앞"}</span><span class="tv-brand-signature"><img src="../assets/pincon-icon.svg" alt=""><b>PinCon</b></span><span id="tvStatus" role="status" class="${liveError ? "tv-error" : ""}">${esc(liveError || `${time} 기준`)}</span></footer></div>`;
  document.getElementById("flip").addEventListener("click", () => { flipped = !flipped; render(); });
  document.getElementById("replayCeremony")?.addEventListener("click", () => ceremony.replay());
  document.getElementById("print").addEventListener("click", () => window.print());
  document.getElementById("fullscreen").addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else { await document.documentElement.requestFullscreen(); await keepAwake(); }
    } catch { liveError = "브라우저의 전체화면 기능을 이용해주세요."; render(); }
  });
  ceremony.onRender(view);
}

async function keepAwake() {
  if (document.visibilityState !== "visible" || !document.fullscreenElement) return;
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch { /* Optional on older classroom TVs. */ }
}

async function load() {
  if (loading) return;
  loading = true;
  try {
    let next;
    if (demo) {
      const saved = localStorage.getItem(DEMO_KEY);
      if (saved) next = JSON.parse(saved);
      else { const d = demoView(); next = publicSeatingView({ ...d, general: d.classroomLayout.general }); }
    } else {
      next = await accountRequest(`/api/class-ops/classroom-layout?projection=seating-tv${classKey ? `&classKey=${encodeURIComponent(classKey)}` : ""}`);
    }
    if (next.projection !== "seating-tv") throw new Error("server-update-required");
    if (next.general?.rows !== 6 || next.general?.cols !== 6) throw new Error("layout-update-required");
    const newSignature = JSON.stringify(next);
    if (newSignature !== signature || liveError) { view = next; signature = newSignature; liveError = ""; render(); }
  } catch (error) {
    if (error.status === 401 || error.status === 403) { view = null; signature = ""; }
    if (view) {
      liveError = "연결을 확인 중 · 마지막으로 받은 자리표";
      const status = document.getElementById("tvStatus"); if (status) { status.textContent = liveError; status.className = "tv-error"; }
    } else {
      ceremony.destroy();
      root.innerHTML = `<section class="seat-loading"><span class="wordmark">PinCon</span><h1>자리표를 불러올 수 없습니다.</h1><p>${error.message === "server-update-required" ? "자리 설계 서버 업데이트가 필요합니다." : error.message === "layout-update-required" ? "자리 설계에서 3분단 자리표를 먼저 저장해주세요." : "PinCon 로그인과 학급 열람 권한, 연결 상태를 확인해주세요."}</p><div class="button-row"><a href="../">PinCon 열기</a><button id="retry">다시 시도</button></div></section>`;
      document.getElementById("retry").addEventListener("click", load);
    }
  } finally { loading = false; }
}

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) { wakeLock?.release().catch(() => {}); wakeLock = null; }
  const button = document.getElementById("fullscreen"); if (button) button.textContent = document.fullscreenElement ? "전체화면 종료" : "전체화면";
});
document.addEventListener("visibilitychange", () => {
  clearInterval(timer);
  if (document.visibilityState === "visible") { load(); keepAwake(); timer = setInterval(load, 15000); }
});
window.addEventListener("storage", event => { if (demo && event.key === DEMO_KEY) load(); });
window.addEventListener("pagehide", () => ceremony.destroy(), { once: true });

load();
timer = setInterval(load, 15000);
