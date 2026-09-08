import { readClassProfile } from "../core/data-gateway.js";
import { accountRequest } from "../core/student-auth.js";

const root = document.querySelector("#adminApp");
let view = null;
let draft = null;
let opened = false;
let loading = false;
let saving = false;
let selectedKey = "";
let queued = false;
let dragState = null;

const ROTATIONS = [0, 90, 180, 270];
const ARROW = Object.freeze({ 0: "↑", 90: "→", 180: "↓", 270: "←" });
const DIRECTION = Object.freeze({ 0: "세로 · 교탁", 90: "가로 · 오른쪽", 180: "세로 · 뒤쪽", 270: "가로 · 왼쪽" });

const classKey = () => readClassProfile()?.classKey || "";
const clamp = (value, min, max, fallback = min) => Math.max(min, Math.min(max, Number(value) || fallback));
const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

function installStyles() {
  if (document.querySelector("#pinconFreeGroupDeskStyles")) return;
  const style = document.createElement("style");
  style.id = "pinconFreeGroupDeskStyles";
  style.textContent = `
    .pincon-free-group-card {
      margin: 18px 0 8px;
      border: 1px solid color-mix(in srgb, var(--md-sys-color-outline-variant, #c9cec7) 70%, transparent);
      border-radius: 26px;
      background: color-mix(in srgb, var(--md-sys-color-surface-container-low, #f7f9f6) 95%, white);
      overflow: hidden;
    }
    .pincon-free-group-head {
      display:flex; align-items:center; justify-content:space-between; gap:16px;
      padding:18px 20px;
    }
    .pincon-free-group-head h4 { margin:0 0 5px; font-size:17px; }
    .pincon-free-group-head p { margin:0; font-size:13px; line-height:1.45; color:var(--md-sys-color-on-surface-variant,#626862); }
    .pincon-free-group-body { padding:0 20px 20px; }
    .pincon-free-toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-bottom:14px; }
    .pincon-free-status { margin-left:auto; font-size:12px; color:var(--md-sys-color-on-surface-variant,#626862); }
    .pincon-free-editor { display:grid; grid-template-columns:minmax(0,1fr) 230px; gap:16px; align-items:start; }
    .pincon-free-stage-wrap { min-width:0; }
    .pincon-free-front {
      width:min(300px,62%); margin:0 auto 12px; padding:8px 12px; text-align:center;
      border-radius:999px; font-size:12px; font-weight:750;
      background:var(--md-sys-color-primary-container,#dcebd8); color:var(--md-sys-color-on-primary-container,#153418);
    }
    .pincon-free-board {
      position:relative; width:100%; min-height:440px; aspect-ratio:var(--free-cols) / var(--free-rows);
      border:1px solid var(--md-sys-color-outline-variant,#d8ddd6); border-radius:22px; overflow:hidden;
      background-color:var(--md-sys-color-surface,#fff);
      background-image:
        linear-gradient(to right, color-mix(in srgb, var(--md-sys-color-outline-variant,#d8ddd6) 72%, transparent) 1px, transparent 1px),
        linear-gradient(to bottom, color-mix(in srgb, var(--md-sys-color-outline-variant,#d8ddd6) 72%, transparent) 1px, transparent 1px);
      background-size:calc(100% / var(--free-cols)) calc(100% / var(--free-rows));
      touch-action:none;
    }
    .pincon-free-desk-shell {
      position:absolute; left:var(--desk-left); top:var(--desk-top); width:var(--desk-width); height:var(--desk-height);
      display:grid; place-items:center; box-sizing:border-box;
      background:hsl(var(--group-hue) 55% 93% / .72);
      border:1px solid hsl(var(--group-hue) 42% 80% / .55);
    }
    .pincon-free-desk-shell.is-selected { z-index:4; outline:3px solid var(--md-sys-color-primary,#386a3d); outline-offset:-3px; }
    .pincon-free-desk {
      display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px;
      border:1px solid hsl(var(--group-hue) 44% 64%); border-radius:11px;
      background:hsl(var(--group-hue) 62% 96%); color:var(--md-sys-color-on-surface,#1b1c1b);
      box-shadow:0 2px 7px rgb(0 0 0 / .08); user-select:none; -webkit-user-select:none; touch-action:none; cursor:grab;
      transition:width .16s ease,height .16s ease,box-shadow .16s ease,transform .16s ease;
    }
    .pincon-free-desk:active { cursor:grabbing; box-shadow:0 5px 16px rgb(0 0 0 / .14); }
    .pincon-free-desk.is-vertical { width:62%; height:94%; }
    .pincon-free-desk.is-horizontal { width:94%; height:62%; }
    .pincon-free-desk strong { font-size:12px; line-height:1; }
    .pincon-free-desk small { font-size:10px; opacity:.68; line-height:1; }
    .pincon-free-desk b { font-size:15px; line-height:1; }
    .pincon-free-drop-target {
      position:absolute; display:none; pointer-events:none; z-index:8;
      left:var(--target-left); top:var(--target-top); width:var(--desk-width); height:var(--desk-height);
      border:2px solid var(--md-sys-color-primary,#386a3d); border-radius:12px; box-sizing:border-box;
      background:color-mix(in srgb, var(--md-sys-color-primary-container,#dcebd8) 45%, transparent);
    }
    .pincon-free-board.is-dragging .pincon-free-drop-target { display:block; }
    .pincon-free-side {
      position:sticky; top:12px; padding:15px; border-radius:20px;
      background:var(--md-sys-color-surface-container,#eef1ed); min-height:180px;
    }
    .pincon-free-side h5 { margin:0 0 12px; font-size:15px; }
    .pincon-free-side p { margin:0; color:var(--md-sys-color-on-surface-variant,#626862); font-size:13px; line-height:1.45; }
    .pincon-free-side label { display:grid; gap:6px; margin:12px 0; font-size:12px; font-weight:700; }
    .pincon-free-side select {
      width:100%; min-height:40px; border:1px solid var(--md-sys-color-outline-variant,#d5dad4); border-radius:12px;
      padding:0 10px; background:var(--md-sys-color-surface,#fff); color:inherit; font:inherit;
    }
    .pincon-free-rotation { display:grid; grid-template-columns:1fr 1fr; gap:7px; margin-top:8px; }
    .pincon-free-rotation button {
      min-height:42px; border:1px solid var(--md-sys-color-outline-variant,#d5dad4); border-radius:12px;
      background:var(--md-sys-color-surface,#fff); color:inherit; font:inherit; cursor:pointer;
    }
    .pincon-free-rotation button[data-selected="true"] { border-color:var(--md-sys-color-primary,#386a3d); background:var(--md-sys-color-primary-container,#dcebd8); }
    .pincon-free-help { margin-top:12px; font-size:12px; line-height:1.5; color:var(--md-sys-color-on-surface-variant,#626862); }
    .pincon-free-legend { display:flex; flex-wrap:wrap; gap:6px; margin-top:12px; }
    .pincon-free-legend span { padding:5px 8px; border-radius:999px; font-size:11px; background:hsl(var(--group-hue) 55% 93%); border:1px solid hsl(var(--group-hue) 42% 80%); }
    @media (max-width:860px) {
      .pincon-free-editor { grid-template-columns:1fr; }
      .pincon-free-side { position:static; }
      .pincon-free-board { min-height:380px; }
      .pincon-free-status { width:100%; margin-left:0; }
    }
  `;
  document.head.appendChild(style);
}

function panel() {
  return root?.querySelector("#pinconClassroomLayout [data-mode-panel='groups']") || null;
}

function host() {
  return panel()?.querySelector("#pinconFreeGroupDeskEditor") || null;
}

function setStatus(text) {
  const target = host()?.querySelector("[data-free-status]");
  if (target) target.textContent = text;
}

function normalizeDraft(groups) {
  const rows = clamp(groups?.deskRows, 3, 10, 6);
  const cols = clamp(groups?.deskCols, 3, 10, 6);
  const groupCount = clamp(groups?.groupCount, 1, 12, 1);
  const seen = new Set();
  const desks = [];
  for (const [order, raw] of (Array.isArray(groups?.desks) ? groups.desks : []).entries()) {
    const index = clamp(raw?.index, 0, rows * cols - 1, order);
    if (seen.has(index)) continue;
    seen.add(index);
    desks.push({
      key: `desk-${order}-${index}`,
      index,
      group: clamp(raw?.group, 1, groupCount, 1),
      rotation: ROTATIONS.includes(Number(raw?.rotation)) ? Number(raw.rotation) : 0,
    });
  }
  return {
    rows,
    cols,
    groupCount,
    sizes: Array.from({ length: groupCount }, (_, index) => clamp(groups?.sizes?.[index], 0, 12, 0)),
    desks,
  };
}

function neighbors(index) {
  const row = Math.floor(index / draft.cols);
  const col = index % draft.cols;
  const values = [];
  if (row > 0) values.push(index - draft.cols);
  if (col < draft.cols - 1) values.push(index + 1);
  if (row < draft.rows - 1) values.push(index + draft.cols);
  if (col > 0) values.push(index - 1);
  return values;
}

function snakePath() {
  const path = [];
  for (let row = 0; row < draft.rows; row += 1) {
    if (row % 2 === 0) {
      for (let col = 0; col < draft.cols; col += 1) path.push(row * draft.cols + col);
    } else {
      for (let col = draft.cols - 1; col >= 0; col -= 1) path.push(row * draft.cols + col);
    }
  }
  return path;
}

function groupDesks(group) {
  return draft.desks.filter((desk) => desk.group === group);
}

function isGroupConnected(group) {
  const desks = groupDesks(group);
  if (desks.length <= 1) return true;
  const wanted = new Set(desks.map((desk) => desk.index));
  const visited = new Set([desks[0].index]);
  const queue = [desks[0].index];
  while (queue.length) {
    const current = queue.shift();
    for (const next of neighbors(current)) {
      if (wanted.has(next) && !visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited.size === wanted.size;
}

function nearestFreeIndex(target, occupied) {
  target = clamp(target, 0, draft.rows * draft.cols - 1, 0);
  if (!occupied.has(target)) return target;
  const visited = new Set([target]);
  const queue = [target];
  while (queue.length) {
    const current = queue.shift();
    for (const next of neighbors(current)) {
      if (visited.has(next)) continue;
      visited.add(next);
      if (!occupied.has(next)) return next;
      queue.push(next);
    }
  }
  return -1;
}

function connectedCellsForGroup(group, target, count) {
  const occupied = new Set(draft.desks.filter((desk) => desk.group !== group).map((desk) => desk.index));
  const start = nearestFreeIndex(target, occupied);
  if (start < 0) return null;
  const result = [];
  const visited = new Set([start]);
  const queue = [start];
  while (queue.length && result.length < count) {
    const current = queue.shift();
    if (occupied.has(current)) continue;
    result.push(current);
    for (const next of neighbors(current)) {
      if (visited.has(next) || occupied.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  return result.length === count ? result : null;
}

function moveGroup(group, target) {
  const desks = groupDesks(group).slice().sort((a, b) => a.index - b.index);
  if (!desks.length) return false;
  const cells = connectedCellsForGroup(group, target, desks.length);
  if (!cells) return false;
  desks.forEach((desk, index) => { desk.index = cells[index]; });
  return true;
}

function connectLooseGroups() {
  let changed = false;
  for (let group = 1; group <= draft.groupCount; group += 1) {
    const desks = groupDesks(group);
    if (desks.length > 1 && !isGroupConnected(group)) {
      changed = moveGroup(group, desks[0].index) || changed;
    }
  }
  return changed;
}

function packAllGroups() {
  const total = draft.desks.length;
  if (total > draft.rows * draft.cols) return false;
  const path = snakePath();
  let cursor = 0;
  for (let group = 1; group <= draft.groupCount; group += 1) {
    const desks = groupDesks(group).slice().sort((a, b) => a.key.localeCompare(b.key));
    for (const desk of desks) {
      desk.index = path[cursor];
      cursor += 1;
    }
  }
  return true;
}

function rebuildFromSizes() {
  const total = draft.sizes.reduce((sum, size) => sum + Number(size || 0), 0);
  if (total > draft.rows * draft.cols) return false;
  draft.desks = [];
  let order = 0;
  for (let group = 1; group <= draft.groupCount; group += 1) {
    const count = Number(draft.sizes[group - 1]) || 0;
    for (let member = 0; member < count; member += 1) {
      draft.desks.push({ key: `desk-new-${order}`, index: order, group, rotation: member % 2 === 0 ? 0 : 180 });
      order += 1;
    }
  }
  packAllGroups();
  selectedKey = draft.desks[0]?.key || "";
  return true;
}

function changeDeskGroup(key, nextGroup) {
  const desk = draft.desks.find((item) => item.key === key);
  if (!desk) return;
  const oldGroup = desk.group;
  const oldIndex = desk.index;
  nextGroup = clamp(nextGroup, 1, draft.groupCount, oldGroup);
  if (oldGroup === nextGroup) return;
  desk.group = nextGroup;

  const targetPeer = draft.desks.find((item) => item.key !== desk.key && item.group === nextGroup);
  if (targetPeer) moveGroup(nextGroup, targetPeer.index);
  const oldMembers = groupDesks(oldGroup);
  if (oldMembers.length > 1 && !isGroupConnected(oldGroup)) moveGroup(oldGroup, Math.min(oldIndex, oldMembers[0].index));
}

function boardIndexFromPoint(clientX, clientY) {
  const board = host()?.querySelector("[data-free-board]");
  if (!board || !draft) return -1;
  const rect = board.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width - 1, clientX - rect.left));
  const y = Math.max(0, Math.min(rect.height - 1, clientY - rect.top));
  const col = Math.min(draft.cols - 1, Math.floor((x / rect.width) * draft.cols));
  const row = Math.min(draft.rows - 1, Math.floor((y / rect.height) * draft.rows));
  return row * draft.cols + col;
}

function deskStyle(desk) {
  const row = Math.floor(desk.index / draft.cols);
  const col = desk.index % draft.cols;
  const hue = (desk.group * 47 + 78) % 360;
  return `--desk-left:${(col / draft.cols) * 100}%;--desk-top:${(row / draft.rows) * 100}%;--desk-width:${100 / draft.cols}%;--desk-height:${100 / draft.rows}%;--group-hue:${hue}`;
}

function selectedDesk() {
  return draft?.desks.find((desk) => desk.key === selectedKey) || null;
}

function sideMarkup() {
  const desk = selectedDesk();
  if (!desk) return `<h5>책상 선택</h5><p>책상을 누르면 모둠과 방향을 바꿀 수 있습니다. 책상을 끌면 같은 모둠 전체가 격자에 맞춰 함께 이동합니다.</p>`;
  const order = draft.desks.findIndex((item) => item.key === desk.key) + 1;
  return `
    <h5>책상 ${order}</h5>
    <label>소속 모둠
      <select data-free-desk-group>
        ${Array.from({ length: draft.groupCount }, (_, index) => `<option value="${index + 1}" ${desk.group === index + 1 ? "selected" : ""}>${index + 1}모둠</option>`).join("")}
      </select>
    </label>
    <label>책상 방향</label>
    <div class="pincon-free-rotation">
      ${ROTATIONS.map((rotation) => `<button type="button" data-free-rotate="${rotation}" data-selected="${desk.rotation === rotation}">${ARROW[rotation]} ${DIRECTION[rotation]}</button>`).join("")}
    </div>
    <p class="pincon-free-help">모둠을 바꾸면 이 책상은 새 모둠 옆으로 자동 이동합니다. 한 모둠의 책상은 상하좌우로 이어지도록 유지됩니다.</p>`;
}

function legendMarkup() {
  return `<div class="pincon-free-legend">${Array.from({ length: draft.groupCount }, (_, index) => {
    const group = index + 1;
    const hue = (group * 47 + 78) % 360;
    return `<span style="--group-hue:${hue}">${group}모둠 · ${groupDesks(group).length}개</span>`;
  }).join("")}</div>`;
}

function render() {
  const target = host();
  if (!target) return;
  if (!opened || !draft) {
    target.innerHTML = `
      <div class="pincon-free-group-head">
        <div><h4>자유 책상 배치</h4><p>격자에 스냅되는 자유배치입니다. 같은 모둠 책상은 서로 붙고, 책상은 가로·세로로 회전할 수 있습니다.</p></div>
        <md-filled-tonal-button data-open-free-group><md-icon slot="icon">open_with</md-icon>자유배치 열기</md-filled-tonal-button>
      </div>`;
    target.querySelector("[data-open-free-group]")?.addEventListener("click", openEditor);
    return;
  }

  const desks = draft.desks.map((desk, order) => {
    const vertical = desk.rotation % 180 === 0;
    return `<div class="pincon-free-desk-shell ${desk.key === selectedKey ? "is-selected" : ""}" style="${deskStyle(desk)}" data-shell-key="${desk.key}">
      <button type="button" class="pincon-free-desk ${vertical ? "is-vertical" : "is-horizontal"}" data-free-desk="${desk.key}" aria-label="${desk.group}모둠 책상 ${order + 1}">
        <small>${order + 1}</small><strong>${desk.group}모둠</strong><b>${ARROW[desk.rotation]}</b>
      </button>
    </div>`;
  }).join("");

  target.innerHTML = `
    <div class="pincon-free-group-head">
      <div><h4>자유 책상 배치</h4><p>책상을 끌어 모둠을 이동하세요. 위치는 자동으로 격자에 맞고 같은 모둠은 한 덩어리로 붙습니다.</p></div>
      <md-text-button data-close-free-group>닫기</md-text-button>
    </div>
    <div class="pincon-free-group-body">
      <div class="pincon-free-toolbar">
        <label>행 <input type="number" min="3" max="10" value="${draft.rows}" data-free-rows style="width:54px"></label>
        <label>열 <input type="number" min="3" max="10" value="${draft.cols}" data-free-cols style="width:54px"></label>
        <md-outlined-button data-free-pack><md-icon slot="icon">grid_view</md-icon>모둠별 붙여 배치</md-outlined-button>
        <md-outlined-button data-free-rebuild>정원대로 책상 재생성</md-outlined-button>
        <md-filled-button data-save-free-group><md-icon slot="icon">save</md-icon>책상 배치 저장</md-filled-button>
        <span class="pincon-free-status" data-free-status>저장 전</span>
      </div>
      <div class="pincon-free-editor">
        <div class="pincon-free-stage-wrap">
          <div class="pincon-free-front">교탁</div>
          <div class="pincon-free-board" data-free-board style="--free-cols:${draft.cols};--free-rows:${draft.rows};--desk-width:${100 / draft.cols}%;--desk-height:${100 / draft.rows}%">
            ${desks}
            <div class="pincon-free-drop-target" data-free-drop-target></div>
          </div>
          ${legendMarkup()}
        </div>
        <aside class="pincon-free-side" data-free-side>${sideMarkup()}</aside>
      </div>
    </div>`;

  bindEditor();
}

function bindEditor() {
  const target = host();
  if (!target) return;
  target.querySelector("[data-close-free-group]")?.addEventListener("click", () => { opened = false; draft = null; selectedKey = ""; render(); });
  target.querySelector("[data-free-pack]")?.addEventListener("click", () => {
    if (!packAllGroups()) return alert("현재 격자 크기보다 책상이 많습니다.");
    render(); setStatus("모둠별로 붙였습니다 · 저장 필요");
  });
  target.querySelector("[data-free-rebuild]")?.addEventListener("click", () => {
    if (!rebuildFromSizes()) return alert("현재 격자 크기보다 필요한 책상이 많습니다.");
    render(); setStatus("정원대로 책상을 다시 만들었습니다 · 저장 필요");
  });
  target.querySelector("[data-save-free-group]")?.addEventListener("click", saveDraft);
  target.querySelector("[data-free-rows]")?.addEventListener("change", (event) => resizeBoard(event.target.value, draft.cols));
  target.querySelector("[data-free-cols]")?.addEventListener("change", (event) => resizeBoard(draft.rows, event.target.value));
  target.querySelector("[data-free-desk-group]")?.addEventListener("change", (event) => {
    changeDeskGroup(selectedKey, event.target.value);
    render(); setStatus("모둠 변경 · 자동으로 붙였습니다 · 저장 필요");
  });
  target.querySelectorAll("[data-free-rotate]").forEach((button) => button.addEventListener("click", () => {
    const desk = selectedDesk();
    if (!desk) return;
    desk.rotation = Number(button.dataset.freeRotate);
    render(); setStatus("책상 방향 변경 · 저장 필요");
  }));
  target.querySelectorAll("[data-free-desk]").forEach((button) => bindDeskPointer(button));
}

function resizeBoard(rows, cols) {
  const nextRows = clamp(rows, 3, 10, draft.rows);
  const nextCols = clamp(cols, 3, 10, draft.cols);
  if (draft.desks.length > nextRows * nextCols) {
    alert("격자가 책상 수보다 작아질 수 없습니다.");
    return render();
  }
  draft.rows = nextRows;
  draft.cols = nextCols;
  if (!packAllGroups()) return render();
  render();
  setStatus("격자 크기 변경 · 모둠을 다시 붙였습니다 · 저장 필요");
}

function bindDeskPointer(button) {
  button.addEventListener("pointerdown", (event) => {
    if (!draft) return;
    const key = button.dataset.freeDesk;
    const desk = draft.desks.find((item) => item.key === key);
    if (!desk) return;
    selectedKey = key;
    dragState = { key, group: desk.group, pointerId: event.pointerId, target: desk.index };
    button.setPointerCapture?.(event.pointerId);
    const shell = button.closest(".pincon-free-desk-shell");
    shell?.classList.add("is-selected");
    event.preventDefault();
  });

  button.addEventListener("pointermove", (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const index = boardIndexFromPoint(event.clientX, event.clientY);
    if (index < 0) return;
    dragState.target = index;
    const board = host()?.querySelector("[data-free-board]");
    const marker = host()?.querySelector("[data-free-drop-target]");
    if (board && marker) {
      const row = Math.floor(index / draft.cols);
      const col = index % draft.cols;
      marker.style.setProperty("--target-left", `${(col / draft.cols) * 100}%`);
      marker.style.setProperty("--target-top", `${(row / draft.rows) * 100}%`);
      board.classList.add("is-dragging");
    }
    event.preventDefault();
  });

  const finish = (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const current = dragState;
    dragState = null;
    const moved = moveGroup(current.group, current.target);
    render();
    setStatus(moved ? `${current.group}모둠 이동 · 격자에 맞춰 붙였습니다 · 저장 필요` : "이 위치에는 모둠 전체를 놓을 공간이 없습니다.");
    event.preventDefault();
  };

  button.addEventListener("pointerup", finish);
  button.addEventListener("pointercancel", finish);
}

async function syncBaseLayout() {
  const saveButton = root?.querySelector("#pinconClassroomLayout [data-save-layout]");
  if (!saveButton) return;
  const status = () => root?.querySelector("#pinconClassroomLayout [data-layout-status]")?.textContent || "";
  saveButton.click();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(100);
    const text = status();
    if (text.includes("저장했습니다")) return;
    if (text.includes("저장하지 못했습니다")) throw new Error("base layout save failed");
  }
}

async function refreshView() {
  const target = classKey();
  if (!target) throw new Error("classKey is unavailable");
  view = await accountRequest(`/api/class-ops/classroom-layout?classKey=${encodeURIComponent(target)}`);
  return view;
}

async function openEditor() {
  if (loading) return;
  loading = true;
  const openButton = host()?.querySelector("[data-open-free-group]");
  if (openButton) openButton.disabled = true;
  try {
    await syncBaseLayout();
    await refreshView();
    draft = normalizeDraft(view?.classroomLayout?.groups || {});
    if (!draft.desks.length && draft.sizes.some(Boolean)) rebuildFromSizes();
    const repaired = connectLooseGroups();
    selectedKey = draft.desks[0]?.key || "";
    opened = true;
    render();
    setStatus(repaired ? "떨어진 모둠 책상을 자동으로 붙였습니다 · 저장 필요" : "불러왔습니다");
  } catch (error) {
    console.warn("[PinCon] free group desk editor load failed", error);
    setStatus("불러오지 못했습니다.");
  } finally {
    loading = false;
  }
}

async function saveDraft() {
  if (saving || !draft) return;
  saving = true;
  setStatus("저장 중…");
  try {
    const latest = await refreshView();
    const layout = latest?.classroomLayout && typeof latest.classroomLayout === "object" ? structuredClone(latest.classroomLayout) : {};
    layout.groups = layout.groups && typeof layout.groups === "object" ? layout.groups : {};
    const maxGroup = clamp(layout.groups.groupCount, 1, 12, draft.groupCount);
    layout.groups.deskRows = draft.rows;
    layout.groups.deskCols = draft.cols;
    layout.groups.desks = draft.desks
      .filter((desk) => desk.index >= 0 && desk.index < draft.rows * draft.cols)
      .map((desk) => ({
        index: desk.index,
        group: clamp(desk.group, 1, maxGroup, 1),
        rotation: ROTATIONS.includes(Number(desk.rotation)) ? Number(desk.rotation) : 0,
      }));

    await accountRequest("/api/class-ops/classroom-layout", {
      method: "POST",
      body: { classKey: latest.classKey || classKey(), action: "SAVE", classroomLayout: layout },
    });
    setStatus("저장했습니다. 화면을 동기화합니다…");
    window.setTimeout(() => window.location.reload(), 180);
  } catch (error) {
    console.warn("[PinCon] free group desk editor save failed", error);
    setStatus("저장하지 못했습니다.");
  } finally {
    saving = false;
  }
}

function hideLegacyEditor(currentPanel) {
  const head = currentPanel.querySelector(".pincon-layout-desk-head");
  const editor = currentPanel.querySelector(".pincon-layout-desk-editor");
  const guide = [...currentPanel.querySelectorAll("details.pincon-layout-constraints")].find((detail) => detail.textContent.includes("책상 이동 가이드"));
  if (head) head.hidden = true;
  if (editor) editor.hidden = true;
  if (guide) guide.hidden = true;
  return head || editor || guide;
}

function mount() {
  installStyles();
  const currentPanel = panel();
  if (!currentPanel) return;
  const legacyAnchor = hideLegacyEditor(currentPanel);
  if (currentPanel.querySelector("#pinconFreeGroupDeskEditor")) return;
  const section = document.createElement("section");
  section.id = "pinconFreeGroupDeskEditor";
  section.className = "pincon-free-group-card";
  if (legacyAnchor) legacyAnchor.insertAdjacentElement("beforebegin", section);
  else currentPanel.appendChild(section);
  render();
}

function queueMount() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    mount();
  });
}

if (root) {
  new MutationObserver(queueMount).observe(root, { childList: true, subtree: true });
  queueMount();
}
