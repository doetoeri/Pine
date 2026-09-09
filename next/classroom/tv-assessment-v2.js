import { accountRequest } from "../core/student-auth.js";

const root = document.querySelector("#tvApp");
const forcedScene = new URL(location.href).searchParams.get("scene") || "";
const reducedMotionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
const POLL_MS = 15000;
const FADE_OUT_MS = 180;
const FADE_IN_MS = 200;

let classroomView = null;
let assessmentView = null;
let flowToken = 0;
let screenKey = "";
let lastSignature = "";
let pollTimer = null;

const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const reducedMotion = () => reducedMotionQuery?.matches === true;

function installStyles() {
  if (document.querySelector("#pinconAssessmentTvStyles")) return;
  const style = document.createElement("style");
  style.id = "pinconAssessmentTvStyles";
  style.textContent = `
    .tv-assessment-move{display:grid;align-content:center;gap:1.1vw}
    .tv-assessment-step{margin:0;color:var(--accent);font-size:clamp(15px,1vw,20px);font-weight:800}
    .tv-assessment-move h1{margin:.2vw 0 1vw;font-size:clamp(46px,4.6vw,88px);line-height:1.03;letter-spacing:-.055em}
    .tv-assessment-card{width:min(92vw,1320px);margin:0 auto;padding:1.05vw 1.4vw;border:1px solid var(--line);border-radius:14px;background:var(--surface);text-align:left}
    .tv-assessment-card>small{display:block;color:var(--muted);font-size:clamp(13px,.9vw,18px);font-weight:750}
    .tv-assessment-card .tv-route{margin:.55vw 0 0;justify-content:flex-start;gap:1.2vw;font-size:clamp(24px,2.25vw,44px);max-width:none}
    .tv-assessment-seat-note{margin:.5vw 0 0;color:var(--muted);font-size:clamp(14px,1vw,20px);font-weight:600}
    .tv-assessment-final .tv-seat{padding:.35vw .45vw}
    .tv-assessment-final .tv-seat .seat-no{margin-bottom:.12vw;color:var(--accent);font-size:clamp(9px,.62vw,12px);font-weight:800}
    .tv-assessment-final .tv-seat strong{font-size:clamp(12px,1vw,19px)}
    .tv-assessment-final .tv-seat .desk-owner{margin-top:.16vw;margin-bottom:0;font-size:clamp(9px,.67vw,13px)}
    @media(max-aspect-ratio:4/3){.tv-assessment-card{padding:1.2vh 1.5vw}.tv-assessment-card .tv-route{font-size:clamp(21px,2.7vw,38px)}}
  `;
  document.head.appendChild(style);
}

function sceneKey() {
  return forcedScene || classroomView?.classroomLayout?.display?.activeScene || "assessment";
}

function scene() {
  const display = classroomView?.classroomLayout?.display || {};
  return display.scenes?.[sceneKey()] || display.scenes?.assessment || {
    message: "수행평가가 곧 시작됩니다. 안내에 따라 이동해주세요.",
    targetMode: "assessment",
    showMovement: true,
    startAt: "",
    leadMinutes: 5,
  };
}

function durations() {
  const display = classroomView?.classroomLayout?.display || {};
  return {
    intro: Math.max(2, Math.min(5, Number(display.idleSeconds) || 3)),
    move: Math.max(2, Math.min(12, Number(display.stepSeconds) || 5)),
    final: Math.max(4, Math.min(20, Number(display.finalSeconds) || 8)),
  };
}

function roster() {
  return Array.isArray(assessmentView?.roster) ? assessmentView.roster : [];
}

function plan() {
  return assessmentView?.assessmentPlan || { lines: 5, seatOrder: [], deskOwners: [], slotCount: 5, tvLabelMode: "both" };
}

function student(uid) {
  return roster().find((item) => item.uid === uid) || null;
}

function studentLabel(uid) {
  const item = student(uid);
  return item ? `${Number(item.number) || "-"}번 ${item.name || "이름 없음"}` : "빈자리";
}

function sourceDeskLabel(uid) {
  const seats = classroomView?.classroomLayout?.general?.seats || [];
  const index = seats.findIndex((value) => value === uid);
  return index >= 0 ? `일반 자리 ${index + 1}` : "현재 책상 위치";
}

function seatTargetIndex(uid) {
  return (plan().seatOrder || []).findIndex((value) => value === uid);
}

function deskTargetIndex(uid) {
  return (plan().deskOwners || []).findIndex((value) => value === uid);
}

async function transition(html, key, { instant = false } = {}) {
  const current = root.firstElementChild;
  const skip = instant || reducedMotion();
  if (!skip && current && screenKey !== key) {
    current.classList.add("is-fading-out");
    await sleep(FADE_OUT_MS);
  }
  root.innerHTML = html;
  screenKey = key;
  const next = root.firstElementChild;
  if (!skip && next) {
    next.classList.add("is-fading-in");
    requestAnimationFrame(() => requestAnimationFrame(() => next.classList.add("is-visible")));
    await sleep(FADE_IN_MS);
    next.classList.remove("is-fading-in", "is-visible");
  }
}

function introMarkup() {
  return `<section class="tv-screen tv-intro"><p class="tv-kicker">PINCON · 수행평가</p><h1>${esc(scene().message || "번호순으로 이동해주세요.")}</h1></section>`;
}

function movementMarkup(item, index) {
  const deskTarget = deskTargetIndex(item.uid);
  const seatTarget = seatTargetIndex(item.uid);
  const seatDeskOwner = seatTarget >= 0 ? plan().deskOwners?.[seatTarget] || "" : "";
  const deskDestination = deskTarget >= 0 ? `수행평가 자리 ${deskTarget + 1}` : "책상 이동 없음";
  const seatDestination = seatTarget >= 0 ? `수행평가 자리 ${seatTarget + 1}` : "착석 자리 미정";
  const ownerNote = seatDeskOwner ? `${studentLabel(seatDeskOwner)}의 책상` : "책상 없음";
  return `<section class="tv-screen tv-assessment-move">
    <p class="tv-assessment-step">${index + 1} / ${roster().length}</p>
    <h1>${esc(studentLabel(item.uid))}</h1>
    <div class="tv-assessment-card"><small>① 내 책상 옮기기</small><div class="tv-route"><span>${esc(sourceDeskLabel(item.uid))}</span><b>→</b><span>${esc(deskDestination)}</span></div></div>
    <div class="tv-assessment-card"><small>② 내가 앉을 곳</small><div class="tv-route"><span>${esc(studentLabel(item.uid))}</span><b>→</b><span>${esc(seatDestination)}</span></div><p class="tv-assessment-seat-note">그 자리의 책상: ${esc(ownerNote)}</p></div>
  </section>`;
}

function finalCell(index) {
  const sitterUid = plan().seatOrder?.[index] || "";
  const ownerUid = plan().deskOwners?.[index] || "";
  const mode = ["student", "desk", "both"].includes(plan().tvLabelMode) ? plan().tvLabelMode : "both";
  if (!sitterUid && !ownerUid) return `<div class="tv-seat is-empty"><span class="seat-no">${index + 1}</span></div>`;
  if (mode === "student") {
    return `<div class="tv-seat"><span class="seat-no">${index + 1}번 자리</span><strong>${esc(studentLabel(sitterUid))}</strong></div>`;
  }
  if (mode === "desk") {
    return `<div class="tv-seat"><span class="seat-no">${index + 1}번 자리</span><strong>${esc(studentLabel(ownerUid))}</strong><small class="desk-owner">책상 주인</small></div>`;
  }
  return `<div class="tv-seat"><span class="seat-no">${index + 1}번 자리</span><strong>앉는 사람 · ${esc(studentLabel(sitterUid))}</strong><small class="desk-owner">책상 · ${esc(studentLabel(ownerUid))}</small></div>`;
}

function finalMarkup() {
  const slotCount = Number(plan().slotCount || 5);
  const cells = Array.from({ length: slotCount }, (_, index) => finalCell(index)).join("");
  return `<section class="tv-screen tv-final tv-assessment-final"><header class="tv-final-head"><div><p class="tv-kicker">PINCON · 수행평가</p><h1>5줄 · 번호순 최종 자리</h1></div><div class="tv-teacher">교탁</div></header><div class="tv-room" style="grid-template-columns:repeat(5,minmax(0,1fr))">${cells}</div></section>`;
}

function waitingMarkup(milliseconds) {
  const total = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const text = minutes ? `${minutes}분 ${String(seconds).padStart(2, "0")}초` : `${seconds}초`;
  return `<section class="tv-screen tv-waiting"><p class="tv-kicker">PINCON · 수행평가</p><h1>${esc(scene().message || "이동 준비")}</h1><strong class="tv-countdown" data-countdown>${text}</strong></section>`;
}

async function waitUntilGuide(flowId) {
  const current = scene();
  if (!current.startAt) return true;
  const start = new Date(current.startAt);
  if (!Number.isFinite(start.getTime())) return true;
  const guideAt = start.getTime() - Number(current.leadMinutes || 0) * 60000;
  if (guideAt <= Date.now()) return true;

  while (flowId === flowToken && Date.now() < guideAt) {
    const remaining = guideAt - Date.now();
    await transition(waitingMarkup(remaining), `waiting:${sceneKey()}`);
    await sleep(Math.min(1000, remaining));
  }
  return flowId === flowToken;
}

async function runFlow() {
  const id = ++flowToken;
  if (!(await waitUntilGuide(id))) return;
  const timing = durations();

  while (id === flowToken) {
    await transition(introMarkup(), `intro:${sceneKey()}`);
    await sleep(timing.intro * 1000);
    if (id !== flowToken) return;

    if (scene().showMovement !== false) {
      for (let index = 0; index < roster().length; index += 1) {
        if (id !== flowToken) return;
        const item = roster()[index];
        await transition(movementMarkup(item, index), `movement:${item.uid}:${index}`);
        await sleep(timing.move * 1000);
      }
    }

    if (id !== flowToken) return;
    await transition(finalMarkup(), `final:${plan().updatedAtMs}:${plan().tvLabelMode}`);
    await sleep(timing.final * 1000);
  }
}

function signature() {
  return JSON.stringify({
    sceneKey: sceneKey(),
    scene: scene(),
    assessment: plan(),
    generalSeats: classroomView?.classroomLayout?.general?.seats || [],
  });
}

async function refresh({ restart = false } = {}) {
  const [nextClassroom, nextAssessment] = await Promise.all([
    accountRequest("/api/class-ops/classroom-layout"),
    accountRequest("/api/class-ops/assessment-layout"),
  ]);
  classroomView = nextClassroom;
  assessmentView = nextAssessment;

  if (scene().targetMode !== "assessment") {
    location.reload();
    return;
  }

  const nextSignature = signature();
  if (restart || nextSignature !== lastSignature) {
    lastSignature = nextSignature;
    runFlow();
  }
}

async function start() {
  installStyles();
  try {
    await refresh({ restart: true });
    pollTimer = setInterval(() => refresh().catch((error) => console.warn("[PinCon] assessment TV refresh failed", error)), POLL_MS);
  } catch (error) {
    console.error("[PinCon] assessment TV failed", error);
    await transition(`<section class="tv-screen tv-error"><p class="tv-kicker">PINCON</p><h1>수행평가 배치를 불러오지 못했습니다.</h1><p>로그인, 권한, 서버 연결을 확인해주세요.</p></section>`, "error", { instant: true });
  }
}

window.addEventListener("beforeunload", () => { if (pollTimer) clearInterval(pollTimer); });
start();
