import { accountRequest } from "../core/student-auth.js";

const root = document.querySelector("#tvApp");
const forcedScene = new URL(location.href).searchParams.get("scene") || "";
let view = null;
let timer = null;
let phase = "idle";
let moveIndex = 0;
let lastSceneKey = "";
let screenKey = "";

const SCENE_LABELS = Object.freeze({
  morning: "아침시간",
  assessment: "수행평가 전",
  "seat-change": "자리 바꾸는 시간",
  "history-group": "한국사 모둠 시작 전",
  special: "특별 상황",
});
const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const student = (uid) => view?.roster?.find((x) => x.uid === uid) || null;
const label = (uid) => {
  const s = student(uid);
  return s ? `${Number(s.number) || "-"}번 ${s.name || "이름 없음"}` : "빈자리";
};
const rot = (r) => ({ 0: "↑", 90: "→", 180: "↓", 270: "←" })[Number(r)] || "↑";

function setScreen(html, key, { animate = true } = {}) {
  const sameScreen = screenKey === key;
  const previous = root.firstElementChild;
  const ghost = !sameScreen && animate && previous ? previous.cloneNode(true) : null;
  root.innerHTML = html;
  screenKey = key;
  if (sameScreen || !animate) return;
  const next = root.firstElementChild;
  next?.classList.add("tv-screen-enter");
  if (!ghost) return;
  ghost.querySelectorAll?.(".tv-progress").forEach((node) => node.remove());
  ghost.classList.add("tv-transition-ghost");
  root.appendChild(ghost);
  requestAnimationFrame(() => ghost.classList.add("is-leaving"));
  setTimeout(() => ghost.remove(), 680);
}
function sceneKey() {
  return forcedScene || view?.classroomLayout?.display?.activeScene || "morning";
}
function scene() {
  const d = view.classroomLayout.display;
  return d.scenes?.[sceneKey()] || d.scenes?.morning || { message: d.message || "", targetMode: "general", showMovement: false, startAt: "", leadMinutes: 0 };
}
function targetMode() { return scene().targetMode || "general"; }
function generalPos(usePrevious = false) {
  const out = new Map();
  const g = view.classroomLayout.general;
  const seats = usePrevious && Array.isArray(g.previousSeats) && g.previousSeats.some(Boolean) ? g.previousSeats : g.seats || [];
  seats.forEach((uid, i) => {
    if (uid) out.set(uid, { index: i, label: `일반 ${i + 1}번 자리`, rotation: 0 });
  });
  return out;
}
function targetPos() {
  const layout = view.classroomLayout;
  const mode = targetMode();
  if (mode === "assessment") {
    const out = new Map();
    (layout.assessment.seats || []).forEach((uid, i) => {
      if (uid) out.set(uid, { index: i, label: `수행평가 ${i + 1}번 자리`, rotation: 0 });
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
        if (uid && d) out.set(uid, { index: d.index, label: `${group}모둠 · ${d.index + 1}번 책상`, rotation: d.rotation });
      });
    }
    return out;
  }
  return generalPos(false);
}
function movements() {
  const currentScene = scene();
  if (!currentScene.showMovement || targetMode() === "message") return [];
  const start = sceneKey() === "seat-change" ? generalPos(true) : generalPos(false);
  const target = targetPos();
  const rows = [];
  for (const s of view.roster) {
    const to = target.get(s.uid);
    if (!to) continue;
    const from = start.get(s.uid);
    rows.push({
      uid: s.uid,
      name: label(s.uid),
      from: from?.label || "현재 위치",
      to: to.label,
      rotation: to.rotation || 0,
      moved: !from || from.index !== to.index || Number(to.rotation) !== 0,
    });
  }
  return rows.filter((x) => x.moved);
}
function progress(seconds) { return `<div class="tv-progress"><i style="animation-duration:${seconds}s"></i></div>`; }
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
function idle() {
  clearTimeout(timer);
  phase = "idle";
  const d = view.classroomLayout.display;
  const s = scene();
  const schedule = scheduleState();
  const waiting = schedule && schedule.now < schedule.guideAt;
  const kicker = SCENE_LABELS[sceneKey()] || "교실 안내";
  const timing = waiting
    ? `이동 안내까지 ${countdownText(schedule.guideAt - schedule.now)}`
    : schedule && schedule.now < schedule.start
      ? `시작까지 ${countdownText(schedule.start - schedule.now)}`
      : "안내 화면";
  const html = `<section class="tv-idle"><div class="brand">PINCON · ${esc(kicker)}</div><h1>${esc(s.message)}</h1><p>${esc(view.classKey)} · ${esc(timing)}</p>${waiting ? `<div class="tv-countdown">${esc(countdownText(schedule.guideAt - schedule.now))}</div>` : targetMode() === "message" ? "" : progress(d.idleSeconds)}</section>`;
  setScreen(html, `idle:${sceneKey()}`);
  if (waiting) {
    timer = setTimeout(idle, 1000);
    return;
  }
  if (targetMode() === "message") {
    timer = setTimeout(idle, 30000);
    return;
  }
  timer = setTimeout(() => {
    moveIndex = 0;
    showMove();
  }, d.idleSeconds * 1000);
}
function showMove() {
  clearTimeout(timer);
  const moves = movements();
  const d = view.classroomLayout.display;
  if (!moves.length) {
    showFinal();
    return;
  }
  phase = "move";
  const item = moves[moveIndex % moves.length];
  const groupMode = targetMode() === "groups";
  const html = `<section class="tv-move"><header><div class="tv-kicker">${esc(SCENE_LABELS[sceneKey()] || "자리 이동")} · ${moveIndex + 1} / ${moves.length}</div><h2>${esc(item.name)}</h2></header><div class="move-stage"><div class="move-box"><span>현재</span><strong>${esc(item.from)}</strong></div><div class="move-arrow">→</div><div class="move-box"><span>이동</span><strong>${esc(item.to)}</strong>${groupMode ? `<em>${rot(item.rotation)}</em>` : ""}</div></div><footer class="tv-step">${groupMode ? `책상 방향 ${rot(item.rotation)} · ` : ""}통로를 막지 않게 순서대로 이동하세요.</footer>${progress(d.stepSeconds)}</section>`;
  setScreen(html, `move:${sceneKey()}:${item.uid}:${moveIndex}`);
  timer = setTimeout(() => {
    moveIndex += 1;
    if (moveIndex >= moves.length) showFinal();
    else showMove();
  }, d.stepSeconds * 1000);
}
function finalCells() {
  const l = view.classroomLayout;
  const mode = targetMode();
  if (mode === "groups") {
    const g = l.groups;
    const map = targetPos();
    const byIndex = new Map();
    for (const [uid, p] of map) byIndex.set(p.index, uid);
    const deskMap = new Map((g.desks || []).map((d) => [d.index, d]));
    const total = g.deskRows * g.deskCols;
    return { cols: g.deskCols, cells: Array.from({ length: total }, (_, i) => {
      const d = deskMap.get(i);
      const uid = byIndex.get(i) || "";
      return d ? `<div class="tv-seat ${uid ? "" : "empty"}"><span class="grp">${d.group}모둠</span><span class="rot">${rot(d.rotation)}</span><small>${i + 1}번 책상</small><strong>${esc(label(uid))}</strong></div>` : `<div class="tv-seat empty"></div>`;
    }) };
  }
  if (mode === "assessment") {
    const a = l.assessment;
    const cols = a.lines;
    const rows = Math.ceil(Math.max(view.roster.length, a.seats?.length || 0) / cols);
    return { cols, cells: Array.from({ length: rows * cols }, (_, i) => {
      const uid = a.seats?.[i] || "";
      return `<div class="tv-seat ${uid ? "" : "empty"}"><small>${i + 1}번 자리</small><strong>${esc(label(uid))}</strong></div>`;
    }) };
  }
  const g = l.general;
  return { cols: g.cols, cells: Array.from({ length: g.rows * g.cols }, (_, i) => {
    const uid = g.seats?.[i] || "";
    return `<div class="tv-seat ${uid ? "" : "empty"}"><small>${i + 1}번 자리</small><strong>${esc(label(uid))}</strong></div>`;
  }) };
}
function showFinal() {
  clearTimeout(timer);
  phase = "final";
  const d = view.classroomLayout.display;
  const mode = targetMode();
  if (mode === "message") {
    idle();
    return;
  }
  const data = finalCells();
  const title = mode === "groups" ? "모둠 배치 완료" : mode === "assessment" ? `${view.classroomLayout.assessment.lines}줄 수행평가 배치` : "일반 자리배치";
  const html = `<section class="tv-final"><div class="tv-kicker">${esc(SCENE_LABELS[sceneKey()] || "교실 안내")}</div><h1>${title}</h1><p>최종 위치를 확인한 뒤 조용히 착석해주세요.</p><div class="tv-teacher">교탁</div><div class="tv-room" style="grid-template-columns:repeat(${data.cols},1fr)">${data.cells.join("")}</div>${progress(d.finalSeconds)}</section>`;
  setScreen(html, `final:${sceneKey()}:${mode}`);
  timer = setTimeout(idle, d.finalSeconds * 1000);
}
async function refresh() {
  try {
    view = await accountRequest("/api/class-ops/classroom-layout");
    lastSceneKey = sceneKey();
    idle();
  } catch {
    setScreen(`<section class="tv-error"><strong>교실 배치를 불러오지 못했습니다</strong><span>로그인과 권한을 확인해주세요.</span></section>`, "error");
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
      idle();
    }
  } catch {}
}, 15000);
