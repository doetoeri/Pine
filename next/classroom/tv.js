import { accountRequest } from "../core/student-auth.js";

const root = document.querySelector("#tvApp");
const forcedScene = new URL(location.href).searchParams.get("scene") || "";
const motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");

const SCREEN_STATES = Object.freeze(["waiting", "intro", "movement", "final", "messageOnly", "error"]);
const SCENE_LABELS = Object.freeze({
  morning: "아침시간",
  assessment: "수행평가 전",
  "seat-change": "자리 바꾸는 시간",
  "history-group": "한국사 모둠 시작 전",
  special: "특별 상황",
});
const DEFAULT_TIMING = Object.freeze({ intro: 2.4, move: 1.5, final: 4.5 });
const FADE_OUT_MS = 180;
const FADE_IN_MS = 200;
const POLL_INTERVAL_MS = 15000;

let view = null;
let screenState = "waiting";
let screenKey = "";
let timer = null;
let movementIndex = 0;
let transitionToken = 0;
let flowToken = 0;
let lastFlowSignature = "";

const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const reducedMotion = () => motionQuery?.matches === true;

function clearTimer() {
  if (timer) clearTimeout(timer);
  timer = null;
}

function activeSceneKey(source = view) {
  return forcedScene || source?.classroomLayout?.display?.activeScene || "morning";
}

function activeScene(source = view) {
  const display = source?.classroomLayout?.display || {};
  const key = activeSceneKey(source);
  return display.scenes?.[key] || display.scenes?.morning || {
    message: display.message || "",
    targetMode: "general",
    showMovement: false,
    startAt: "",
    leadMinutes: 0,
  };
}

function targetMode(source = view) {
  return activeScene(source).targetMode || "general";
}

function durations(source = view) {
  const display = source?.classroomLayout?.display || {};
  const idle = Number(display.idleSeconds);
  const move = Number(display.stepSeconds);
  const final = Number(display.finalSeconds);
  const legacyDefaults = idle === 12 && move === 5 && final === 8;

  if (legacyDefaults) return { ...DEFAULT_TIMING };

  return {
    intro: Math.max(2, Math.min(4, idle || DEFAULT_TIMING.intro)),
    move: Math.max(1.2, Math.min(2.5, move || DEFAULT_TIMING.move)),
    final: Math.max(3.5, Math.min(7, final || DEFAULT_TIMING.final)),
  };
}

function student(uid) {
  return view?.roster?.find((item) => item.uid === uid) || null;
}

function studentLabel(uid) {
  const item = student(uid);
  return item ? `${Number(item.number) || "-"}번 ${item.name || "이름 없음"}` : "빈자리";
}

function rotationArrow(rotation) {
  return ({ 0: "↑", 90: "→", 180: "↓", 270: "←" })[Number(rotation)] || "↑";
}

async function transitionTo(nextState, html, key, { instant = false } = {}) {
  if (!SCREEN_STATES.includes(nextState)) throw new Error(`unknown-tv-state:${nextState}`);
  const transitionId = ++transitionToken;
  const skipMotion = instant || reducedMotion();
  const current = root.firstElementChild;

  if (!skipMotion && current && screenKey !== key) {
    current.classList.add("is-fading-out");
    await sleep(FADE_OUT_MS);
    if (transitionId !== transitionToken) return false;
  }

  root.innerHTML = html;
  screenState = nextState;
  screenKey = key;

  const next = root.firstElementChild;
  if (!skipMotion && next) {
    next.classList.add("is-fading-in");
    requestAnimationFrame(() => requestAnimationFrame(() => next.classList.add("is-visible")));
    await sleep(FADE_IN_MS);
    if (transitionId !== transitionToken) return false;
    next.classList.remove("is-fading-in", "is-visible");
  }

  return true;
}

function generalPositions(usePrevious = false) {
  const positions = new Map();
  const general = view.classroomLayout.general;
  const hasPrevious = Array.isArray(general.previousSeats) && general.previousSeats.some(Boolean);
  const seats = usePrevious && hasPrevious ? general.previousSeats : general.seats || [];

  seats.forEach((uid, index) => {
    if (uid) positions.set(uid, { index, label: `${index + 1}번 자리`, rotation: 0 });
  });
  return positions;
}

function targetPositions() {
  const layout = view.classroomLayout;
  const mode = targetMode();

  if (mode === "assessment") {
    const positions = new Map();
    (layout.assessment.seats || []).forEach((uid, index) => {
      if (uid) positions.set(uid, { index, label: `${index + 1}번 자리`, rotation: 0 });
    });
    return positions;
  }

  if (mode === "groups") {
    const positions = new Map();
    const groups = layout.groups;
    for (let group = 1; group <= groups.groupCount; group += 1) {
      const members = groups.members?.[group - 1] || [];
      const desks = (groups.desks || [])
        .filter((desk) => desk.group === group)
        .sort((a, b) => a.index - b.index);
      members.forEach((uid, index) => {
        const desk = desks[index];
        if (uid && desk) {
          positions.set(uid, {
            index: desk.index,
            label: `${group}모둠 · ${desk.index + 1}번 책상`,
            rotation: desk.rotation,
          });
        }
      });
    }
    return positions;
  }

  return generalPositions(false);
}

function movementItems() {
  const currentScene = activeScene();
  const mode = targetMode();
  if (!currentScene.showMovement || mode === "message") return [];

  const start = activeSceneKey() === "seat-change" ? generalPositions(true) : generalPositions(false);
  const target = targetPositions();
  const groupMode = mode === "groups";

  return view.roster.map((item) => {
    const to = target.get(item.uid);
    if (!to) return null;
    const from = start.get(item.uid);
    const moved = groupMode || !from || from.index !== to.index || Number(to.rotation) !== 0;
    if (!moved) return null;
    return {
      uid: item.uid,
      name: studentLabel(item.uid),
      from: from?.label || "출발 자리 미정",
      to: to.label,
      rotation: to.rotation || 0,
    };
  }).filter(Boolean);
}

function scheduleState() {
  const currentScene = activeScene();
  if (!currentScene.startAt) return null;
  const start = new Date(currentScene.startAt);
  if (!Number.isFinite(start.getTime())) return null;
  const guideAt = new Date(start.getTime() - Number(currentScene.leadMinutes || 0) * 60000);
  return { start, guideAt };
}

function countdownText(milliseconds) {
  const total = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
  return minutes ? `${minutes}분 ${String(seconds).padStart(2, "0")}초` : `${seconds}초`;
}

function introMarkup() {
  const key = activeSceneKey();
  const currentScene = activeScene();
  return `<section class="tv-screen tv-intro"><p class="tv-kicker">${esc(SCENE_LABELS[key] || "PINCON")}</p><h1>${esc(currentScene.message)}</h1></section>`;
}

function messageMarkup() {
  const key = activeSceneKey();
  const currentScene = activeScene();
  return `<section class="tv-screen tv-message"><p class="tv-kicker">${esc(SCENE_LABELS[key] || "PINCON")}</p><h1>${esc(currentScene.message)}</h1></section>`;
}

async function renderWaiting(milliseconds) {
  const key = activeSceneKey();
  const currentScene = activeScene();
  const html = `<section class="tv-screen tv-waiting"><p class="tv-kicker">${esc(SCENE_LABELS[key] || "PINCON")}</p><h1>${esc(currentScene.message)}</h1><strong class="tv-countdown" data-countdown>${esc(countdownText(milliseconds))}</strong></section>`;
  return transitionTo("waiting", html, `waiting:${key}`);
}

async function renderIntro() {
  return transitionTo("intro", introMarkup(), `intro:${activeSceneKey()}`);
}

async function renderMessage() {
  return transitionTo("messageOnly", messageMarkup(), `message:${activeSceneKey()}`);
}

async function renderMovement(item, index) {
  const groupMode = targetMode() === "groups";
  const html = `<section class="tv-screen tv-movement"><h1>${esc(item.name)}</h1><div class="tv-route"><span>${esc(item.from)}</span><b aria-hidden="true">→</b><span>${esc(item.to)}</span></div>${groupMode ? `<p class="tv-rotation">책상 방향 <strong>${rotationArrow(item.rotation)}</strong></p>` : ""}</section>`;
  return transitionTo("movement", html, `movement:${activeSceneKey()}:${item.uid}:${index}`);
}

function finalCells() {
  const layout = view.classroomLayout;
  const mode = targetMode();

  if (mode === "groups") {
    const groups = layout.groups;
    const positions = targetPositions();
    const uidByIndex = new Map();
    for (const [uid, position] of positions) uidByIndex.set(position.index, uid);
    const deskByIndex = new Map((groups.desks || []).map((desk) => [desk.index, desk]));
    const total = groups.deskRows * groups.deskCols;
    return {
      cols: groups.deskCols,
      cells: Array.from({ length: total }, (_, index) => {
        const desk = deskByIndex.get(index);
        const uid = uidByIndex.get(index) || "";
        if (!desk) return `<div class="tv-seat is-empty" aria-hidden="true"></div>`;
        return `<div class="tv-seat ${uid ? "" : "is-empty"}"><small>${desk.group}모둠 · ${rotationArrow(desk.rotation)}</small><strong>${esc(studentLabel(uid))}</strong></div>`;
      }),
    };
  }

  if (mode === "assessment") {
    const assessment = layout.assessment;
    const cols = assessment.lines;
    const rows = Math.ceil(Math.max(view.roster.length, assessment.seats?.length || 0) / cols);
    return {
      cols,
      cells: Array.from({ length: rows * cols }, (_, index) => {
        const uid = assessment.seats?.[index] || "";
        return `<div class="tv-seat ${uid ? "" : "is-empty"}"><strong>${esc(studentLabel(uid))}</strong></div>`;
      }),
    };
  }

  const general = layout.general;
  return {
    cols: general.cols,
    cells: Array.from({ length: general.rows * general.cols }, (_, index) => {
      const uid = general.seats?.[index] || "";
      return `<div class="tv-seat ${uid ? "" : "is-empty"}"><strong>${esc(studentLabel(uid))}</strong></div>`;
    }),
  };
}

function finalTitle() {
  const mode = targetMode();
  if (mode === "groups") return "모둠 최종 자리";
  if (mode === "assessment") return "수행평가 최종 자리";
  return "최종 자리";
}

async function renderFinal() {
  const data = finalCells();
  const html = `<section class="tv-screen tv-final"><header class="tv-final-head"><div><p class="tv-kicker">${esc(SCENE_LABELS[activeSceneKey()] || "PINCON")}</p><h1>${esc(finalTitle())}</h1></div><div class="tv-teacher">교탁</div></header><div class="tv-room" style="grid-template-columns:repeat(${data.cols},minmax(0,1fr))">${data.cells.join("")}</div></section>`;
  return transitionTo("final", html, `final:${activeSceneKey()}:${targetMode()}`);
}

async function renderError() {
  return transitionTo(
    "error",
    `<section class="tv-screen tv-error"><p class="tv-kicker">PINCON</p><h1>교실 화면을 불러오지 못했습니다.</h1><p>로그인과 권한을 확인해주세요.</p></section>`,
    "error",
    { instant: true },
  );
}

function waitForGuide(flowId) {
  clearTimer();
  const schedule = scheduleState();
  if (!schedule) return false;
  const remaining = schedule.guideAt.getTime() - Date.now();
  if (remaining <= 0) return false;

  renderWaiting(remaining).then(() => {
    if (flowId !== flowToken) return;
    const tick = () => {
      if (flowId !== flowToken) return;
      const nextSchedule = scheduleState();
      const nextRemaining = nextSchedule ? nextSchedule.guideAt.getTime() - Date.now() : 0;
      if (nextRemaining <= 0) {
        runSceneFlow(flowId);
        return;
      }
      const countdown = root.querySelector("[data-countdown]");
      if (countdown) countdown.textContent = countdownText(nextRemaining);
      timer = setTimeout(tick, 1000);
    };
    timer = setTimeout(tick, 1000);
  });
  return true;
}

async function runSceneFlow(existingFlowId = null) {
  clearTimer();
  const flowId = existingFlowId ?? ++flowToken;
  if (existingFlowId === null && waitForGuide(flowId)) return;
  if (flowId !== flowToken) return;

  const timing = durations();
  const mode = targetMode();
  if (mode === "message") {
    await renderMessage();
    return;
  }

  await renderIntro();
  if (flowId !== flowToken) return;

  timer = setTimeout(async () => {
    if (flowId !== flowToken) return;
    const moves = movementItems();
    movementIndex = 0;

    while (movementIndex < moves.length && flowId === flowToken) {
      await renderMovement(moves[movementIndex], movementIndex);
      if (flowId !== flowToken) return;
      await sleep(timing.move * 1000);
      movementIndex += 1;
    }

    if (flowId !== flowToken) return;
    await renderFinal();
    if (flowId !== flowToken) return;
    await sleep(timing.final * 1000);
    if (flowId !== flowToken) return;
    await renderMessage();
  }, timing.intro * 1000);
}

function tvSignature(source) {
  const layout = source?.classroomLayout || {};
  const display = layout.display || {};
  const key = activeSceneKey(source);
  const currentScene = activeScene(source);
  const mode = currentScene.targetMode || "general";
  const signature = {
    key,
    scene: currentScene,
    timing: {
      idleSeconds: display.idleSeconds,
      stepSeconds: display.stepSeconds,
      finalSeconds: display.finalSeconds,
    },
    roster: (source?.roster || []).map(({ uid, number, name }) => ({ uid, number, name })),
  };

  if (mode === "general") {
    signature.general = {
      rows: layout.general?.rows,
      cols: layout.general?.cols,
      seats: layout.general?.seats || [],
      previousSeats: key === "seat-change" ? layout.general?.previousSeats || [] : [],
    };
  } else if (mode === "assessment") {
    signature.assessment = {
      lines: layout.assessment?.lines,
      seats: layout.assessment?.seats || [],
    };
    signature.general = { seats: layout.general?.seats || [] };
  } else if (mode === "groups") {
    signature.groups = {
      groupCount: layout.groups?.groupCount,
      members: layout.groups?.members || [],
      deskRows: layout.groups?.deskRows,
      deskCols: layout.groups?.deskCols,
      desks: layout.groups?.desks || [],
    };
    signature.general = { seats: layout.general?.seats || [] };
  }

  return JSON.stringify(signature);
}

async function refreshInitial() {
  try {
    view = await accountRequest("/api/class-ops/classroom-layout");
    lastFlowSignature = tvSignature(view);
    await runSceneFlow();
  } catch {
    await renderError();
  }
}

refreshInitial();
setInterval(async () => {
  try {
    const next = await accountRequest("/api/class-ops/classroom-layout");
    const nextSignature = tvSignature(next);
    view = next;
    if (nextSignature !== lastFlowSignature) {
      lastFlowSignature = nextSignature;
      await runSceneFlow();
    }
  } catch {}
}, POLL_INTERVAL_MS);
