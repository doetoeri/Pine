import { accountRequest } from "../core/student-auth.js";

const root = document.querySelector("#tvApp");
const forcedScene = new URL(location.href).searchParams.get("scene") || "";
let view = null;
let timer = null;
let moveIndex = 0;
let lastSceneKey = "";
let screenKey = "";
let transitionToken = 0;

const SCENE_LABELS = Object.freeze({
  morning: "아침시간",
  assessment: "수행평가 전",
  "seat-change": "자리 바꾸는 시간",
  "history-group": "한국사 모둠 시작 전",
  special: "특별 상황",
});
const DEFAULT_TIMING = Object.freeze({ intro: 2.4, move: 1.5, final: 4.5, message: 7 });
const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const student = (uid) => view?.roster?.find((x) => x.uid === uid) || null;
const label = (uid) => {
  const s = student(uid);
  return s ? `${Number(s.number) || "-"}번 ${s.name || "이름 없음"}` : "빈자리";
};
const rot = (r) => ({ 0: "↑", 90: "→", 180: "↓", 270: "←" })[Number(r)] || "↑";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sceneKey() {
  return forcedScene || view?.classroomLayout?.display?.activeScene || "morning";
}
function scene() {
  const d = view.classroomLayout.display;
  return d.scenes?.[sceneKey()] || d.scenes?.morning || { message: d.message || "", targetMode: "general", showMovement: false, startAt: "", leadMinutes: 0 };
}
function targetMode() { return scene().targetMode || "general"; }
function durations() {
  const d = view?.classroomLayout?.display || {};
  const legacyIdle = Number(d.idleSeconds) === 12;
  const legacyMove = Number(d.stepSeconds) === 5;
  const legacyFinal = Number(d.finalSeconds) === 8;
  return {
    intro: legacyIdle ? DEFAULT_TIMING.intro : Math.max(2, Math.min(4, Number(d.idleSeconds) || DEFAULT_TIMING.intro)),
    move: legacyMove ? DEFAULT_TIMING.move : Math.max(1.2, Math.min(2.5, Number(d.stepSeconds) || DEFAULT_TIMING.move)),
    final: legacyFinal ? DEFAULT_TIMING.final : Math.max(3.5, Math.min(7, Number(d.finalSeconds) || DEFAULT_TIMING.final)),
    message: DEFAULT_TIMING.message,
  };
}
async function setScreen(html, key, { instant = false } = {}) {
  if (screenKey === key) {
    root.innerHTML = html;
    return;
  }
  const token = ++transitionToken;
  if (!instant && root.firstElementChild) {
    root.firstElementChild.classList.add("is-fading-out");
    await sleep(180);
    if (token !== transitionToken) return;
  }
  root.innerHTML = html;
  screenKey = key;
  const next = root.firstElementChild;
  if (!instant && next) {
    next.classList.add("is-fading-in");
    requestAnimationFrame(() => requestAnimationFrame(() => next.classList.add("is-visible")));
  }
}
function generalPos(usePrevious = false) {
  const out = new Map();
  const g = view.classroomLayout.general;
  const seats = usePrevious && Array.isArray(g.previousSeats) && g.previousSeats.some(Boolean) ? g.previousSeats : g.seats || [];
  seats.forEach((uid, i) => {
    if (uid) out.set(uid, { index: i, label: `${i + 1}번 자리`, rotation: 0 });
  });
  return out;
}
function targetPos() {
  const layout = view.classroomLayout;
  const mode = targetMode();
  if (mode === "assessment") {
    const out = new Map();
    (layout.assessment.seats || []).forEach((uid, i) => {
      if (uid) out.set(uid, { index: i, label: `${i + 1}번 자리`, rotation: 0 });
    });
    return out;
  }
  if (mode === "groups") {
    const out = new Map();
    const g = layout.groups;
    for (let group = 1; group <= g.groupCount; group += 1) {
      const members = g.members?.[group - 1] || [];
      const desks = (g.desks || []).filter((d) => d.group === group).sort((a, b) => a.index - b.index);
      members.forEach((uid, i) => {
        const d = desks[i];
        if (uid && d) out.set(uid, { index: d.index, label: `${group}모둠 · ${d.index + 1}번`, rotation: d.rotation });
      });
    }
    return out;
  }
  return generalPos(false);
}
function movements() {
  const s = scene();
  if (!s.showMovement || targetMode() === "message") return [];
  const start = sceneKey() === "seat-change" ? generalPos(true) : generalPos(false);
  const target = targetPos();
  return view.roster.map((item) => {
    const to = target.get(item.uid);
    if (!to) return null;
    const from = start.get(item.uid);
    return {
      uid: item.uid,
      name: label(item.uid),
      from: from?.label || "현재 위치",
      to: to.label,
      rotation: to.rotation || 0,
      moved: !from || from.index !== to.index || Number(to.rotation) !== 0,
    };
  }).filter((item) => item?.moved);
}
function scheduleState() {
  const s = scene();
  if (!s.startAt) return null;
  const start = new Date(s.startAt);
  if (!Number.isFinite(start.getTime())) return null;
  const guideAt = new Date(start.getTime() - Number(s.leadMinutes || 0) * 60000);
  return { start, guideAt, now: new Date() };
}
function countdownText(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
  return minutes ? `${minutes}분 ${String(seconds).padStart(2, "0")}초` : `${seconds}초`;
}
function progress(seconds) {
  return `<div class="tv-progress" aria-hidden="true"><span style="animation-duration:${seconds}s"></span></div>`;
}
async function idle() {
  clearTimeout(timer);
  const s = scene();
  const schedule = scheduleState();
  const waiting = schedule && schedule.now < schedule.guideAt;
  const timing = durations();
  const kicker = SCENE_LABELS[sceneKey()] || "교실 안내";
  const detail = waiting
    ? `안내 시작까지 ${countdownText(schedule.guideAt - schedule.now)}`
    : schedule && schedule.now < schedule.start
      ? `시작까지 ${countdownText(schedule.start - schedule.now)}`
      : view.classKey;
  const html = `<section class="tv-screen tv-intro"><div class="tv-badge">${esc(kicker)}</div><h1>${esc(s.message)}</h1><p>${esc(detail)}</p>${waiting ? `<strong class="tv-countdown">${esc(countdownText(schedule.guideAt - schedule.now))}</strong>` : targetMode() === "message" ? "" : progress(timing.intro)}</section>`;
  await setScreen(html, `intro:${sceneKey()}`);
  if (waiting) {
    timer = setTimeout(idle, 1000);
    return;
  }
  if (targetMode() === "message") {
    timer = setTimeout(idle, timing.message * 1000);
    return;
  }
  timer = setTimeout(() => {
    moveIndex = 0;
    showMove();
  }, timing.intro * 1000);
}
async function showMove() {
  clearTimeout(timer);
  const moves = movements();
  if (!moves.length) {
    showFinal();
    return;
  }
  const timing = durations();
  const item = moves[moveIndex % moves.length];
  const groupMode = targetMode() === "groups";
  const html = `<section class="tv-screen tv-move"><div class="tv-badge">${moveIndex + 1} / ${moves.length}</div><h2>${esc(item.name)}</h2><div class="tv-route"><span>${esc(item.from)}</span><b>→</b><span>${esc(item.to)}</span></div>${groupMode ? `<p class="tv-rotation">책상 방향 <strong>${rot(item.rotation)}</strong></p>` : ""}${progress(timing.move)}</section>`;
  await setScreen(html, `move:${sceneKey()}:${item.uid}:${moveIndex}`);
  timer = setTimeout(() => {
    moveIndex += 1;
    if (moveIndex >= moves.length) showFinal();
    else showMove();
  }, timing.move * 1000);
}
function finalCells() {
  const layout = view.classroomLayout;
  const mode = targetMode();
  if (mode === "groups") {
    const g = layout.groups;
    const map = targetPos();
    const byIndex = new Map();
    for (const [uid, pos] of map) byIndex.set(pos.index, uid);
    const desks = new Map((g.desks || []).map((desk) => [desk.index, desk]));
    const total = g.deskRows * g.deskCols;
    return {
      cols: g.deskCols,
      cells: Array.from({ length: total }, (_, i) => {
        const desk = desks.get(i);
        const uid = byIndex.get(i) || "";
        if (!desk) return `<div class="tv-seat is-empty"></div>`;
        return `<div class="tv-seat ${uid ? "" : "is-empty"}"><small>${desk.group}모둠 · ${rot(desk.rotation)}</small><strong>${esc(label(uid))}</strong></div>`;
      }),
    };
  }
  if (mode === "assessment") {
    const a = layout.assessment;
    const cols = a.lines;
    const rows = Math.ceil(Math.max(view.roster.length, a.seats?.length || 0) / cols);
    return {
      cols,
      cells: Array.from({ length: rows * cols }, (_, i) => {
        const uid = a.seats?.[i] || "";
        return `<div class="tv-seat ${uid ? "" : "is-empty"}"><small>${i + 1}</small><strong>${esc(label(uid))}</strong></div>`;
      }),
    };
  }
  const g = layout.general;
  return {
    cols: g.cols,
    cells: Array.from({ length: g.rows * g.cols }, (_, i) => {
      const uid = g.seats?.[i] || "";
      return `<div class="tv-seat ${uid ? "" : "is-empty"}"><small>${i + 1}</small><strong>${esc(label(uid))}</strong></div>`;
    }),
  };
}
async function showFinal() {
  clearTimeout(timer);
  const mode = targetMode();
  if (mode === "message") {
    idle();
    return;
  }
  const timing = durations();
  const data = finalCells();
  const title = mode === "groups" ? "모둠 배치" : mode === "assessment" ? `${view.classroomLayout.assessment.lines}줄 수행평가` : "새 자리";
  const html = `<section class="tv-screen tv-final"><div class="tv-final-head"><div><div class="tv-badge">${esc(SCENE_LABELS[sceneKey()] || "교실 안내")}</div><h2>${title}</h2></div><div class="tv-teacher">교탁</div></div><div class="tv-room" style="grid-template-columns:repeat(${data.cols},minmax(0,1fr))">${data.cells.join("")}</div>${progress(timing.final)}</section>`;
  await setScreen(html, `final:${sceneKey()}:${mode}`);
  timer = setTimeout(idle, timing.final * 1000);
}
async function refresh() {
  try {
    view = await accountRequest("/api/class-ops/classroom-layout");
    lastSceneKey = sceneKey();
    await idle();
  } catch {
    await setScreen(`<section class="tv-screen tv-error"><h2>교실 화면을 불러오지 못했습니다.</h2><p>로그인과 권한을 확인해주세요.</p></section>`, "error", { instant: true });
  }
}

refresh();
setInterval(async () => {
  try {
    const next = await accountRequest("/api/class-ops/classroom-layout");
    const changed = next.updatedAtMs !== view?.updatedAtMs;
    view = next;
    const nextScene = sceneKey();
    if (changed || nextScene !== lastSceneKey) {
      lastSceneKey = nextScene;
      await idle();
    }
  } catch {}
}, 10000);
