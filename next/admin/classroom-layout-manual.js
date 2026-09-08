import { readClassProfile } from "../core/data-gateway.js";
import { accountRequest } from "../core/student-auth.js";

const root = document.querySelector("#adminApp");
let view = null;
let draftSeats = [];
let opened = false;
let loading = false;
let saving = false;
let queued = false;

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const classKey = () => readClassProfile()?.classKey || "";
const roster = () => Array.isArray(view?.roster) ? view.roster : [];

function installStyles() {
  if (document.querySelector("#pinconManualSeatStyles")) return;
  const style = document.createElement("style");
  style.id = "pinconManualSeatStyles";
  style.textContent = `
    .pincon-manual-seat-card {
      margin: 14px 0 18px;
      border: 1px solid color-mix(in srgb, var(--md-sys-color-outline-variant, #c5c8c4) 72%, transparent);
      border-radius: 24px;
      background: color-mix(in srgb, var(--md-sys-color-surface-container-low, #f7f8f5) 94%, white);
      overflow: hidden;
    }
    .pincon-manual-seat-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 16px 18px;
    }
    .pincon-manual-seat-head h4 { margin: 0 0 4px; font-size: 16px; }
    .pincon-manual-seat-head p { margin: 0; color: var(--md-sys-color-on-surface-variant, #5f6360); font-size: 13px; }
    .pincon-manual-seat-body { padding: 0 18px 18px; }
    .pincon-manual-seat-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-bottom: 14px;
    }
    .pincon-manual-seat-status { margin-left: auto; font-size: 12px; color: var(--md-sys-color-on-surface-variant, #5f6360); }
    .pincon-manual-unassigned {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 12px;
      margin-bottom: 14px;
      border-radius: 16px;
      background: color-mix(in srgb, var(--md-sys-color-surface-container, #eef0ec) 78%, transparent);
    }
    .pincon-manual-unassigned strong { width: 100%; font-size: 12px; }
    .pincon-manual-chip {
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      padding: 0 10px;
      border-radius: 999px;
      background: var(--md-sys-color-surface, #fff);
      border: 1px solid var(--md-sys-color-outline-variant, #d9ddd7);
      font-size: 12px;
    }
    .pincon-manual-classroom {
      display: grid;
      grid-template-columns: repeat(var(--manual-cols), minmax(110px, 1fr));
      gap: 9px;
      overflow-x: auto;
      padding-bottom: 4px;
    }
    .pincon-manual-front {
      margin: 0 auto 12px;
      width: min(300px, 65%);
      padding: 8px 12px;
      border-radius: 999px;
      text-align: center;
      font-size: 12px;
      font-weight: 700;
      background: var(--md-sys-color-primary-container, #dcebd8);
      color: var(--md-sys-color-on-primary-container, #153418);
    }
    .pincon-manual-seat {
      min-width: 0;
      min-height: 78px;
      border: 1px solid var(--md-sys-color-outline-variant, #d9ddd7);
      border-radius: 16px;
      background: var(--md-sys-color-surface, #fff);
      padding: 8px;
    }
    .pincon-manual-seat small { display: block; margin-bottom: 6px; color: var(--md-sys-color-on-surface-variant, #666); }
    .pincon-manual-seat select {
      width: 100%;
      min-height: 36px;
      border: 0;
      outline: 0;
      border-radius: 10px;
      padding: 0 7px;
      font: inherit;
      font-size: 13px;
      background: var(--md-sys-color-surface-container-low, #f7f8f5);
      color: var(--md-sys-color-on-surface, #1b1c1b);
    }
    .pincon-manual-seat.is-blocked {
      display: grid;
      place-items: center;
      background: color-mix(in srgb, var(--md-sys-color-surface-container, #eceeeb) 82%, transparent);
      color: var(--md-sys-color-on-surface-variant, #777);
    }
    .pincon-manual-seat.is-blocked small { margin: 0; }
    @media (max-width: 720px) {
      .pincon-manual-seat-head { align-items: flex-start; flex-direction: column; }
      .pincon-manual-seat-status { width: 100%; margin-left: 0; }
      .pincon-manual-classroom { grid-template-columns: repeat(var(--manual-cols), minmax(96px, 1fr)); }
    }
  `;
  document.head.appendChild(style);
}

function editorHost() {
  return root?.querySelector("#pinconClassroomLayout [data-mode-panel='general'] [data-manual-seat-editor]") || null;
}

function setStatus(message) {
  const target = editorHost()?.querySelector("[data-manual-seat-status]");
  if (target) target.textContent = message;
}

function normalizedSeats(layout) {
  const rows = Math.max(3, Math.min(10, Number(layout?.general?.rows) || 6));
  const cols = Math.max(3, Math.min(10, Number(layout?.general?.cols) || 6));
  const total = rows * cols;
  const seats = Array(total).fill("");
  if (Array.isArray(layout?.general?.seats)) {
    layout.general.seats.slice(0, total).forEach((uid, index) => {
      seats[index] = String(uid || "");
    });
  }
  return seats;
}

function optionMarkup(selectedUid = "") {
  const students = roster().slice().sort((a, b) => (Number(a.number) || 999) - (Number(b.number) || 999));
  const options = [`<option value="">빈자리</option>`];
  for (const student of students) {
    const selected = student.uid === selectedUid ? " selected" : "";
    const label = `${Number(student.number) || "-"}번 ${student.name || "이름 없음"}`;
    options.push(`<option value="${escapeHtml(student.uid)}"${selected}>${escapeHtml(label)}</option>`);
  }
  return options.join("");
}

function unassignedMarkup() {
  const assigned = new Set(draftSeats.filter(Boolean));
  const missing = roster()
    .filter((student) => !assigned.has(student.uid))
    .sort((a, b) => (Number(a.number) || 999) - (Number(b.number) || 999));

  if (!missing.length) {
    return `<div class="pincon-manual-unassigned"><strong>미배정 학생</strong><span class="pincon-manual-chip">모두 배정됨</span></div>`;
  }

  return `<div class="pincon-manual-unassigned"><strong>미배정 학생 ${missing.length}명</strong>${missing.map((student) => `<span class="pincon-manual-chip">${escapeHtml(`${Number(student.number) || "-"}번 ${student.name || "이름 없음"}`)}</span>`).join("")}</div>`;
}

function renderEditor() {
  const host = editorHost();
  if (!host) return;

  const layout = view?.classroomLayout || {};
  const rows = Math.max(3, Math.min(10, Number(layout?.general?.rows) || 6));
  const cols = Math.max(3, Math.min(10, Number(layout?.general?.cols) || 6));
  const blocked = new Set(Array.isArray(layout?.general?.blocked) ? layout.general.blocked.map(Number) : []);

  if (!opened) {
    host.innerHTML = `
      <div class="pincon-manual-seat-head">
        <div><h4>수동 자리 지정</h4><p>자동 배치 대신 좌석마다 학생을 직접 지정할 수 있습니다.</p></div>
        <md-outlined-button data-open-manual-seats><md-icon slot="icon">edit_square</md-icon>수동 배치 열기</md-outlined-button>
      </div>`;
    host.querySelector("[data-open-manual-seats]")?.addEventListener("click", openEditor);
    return;
  }

  const cells = Array.from({ length: rows * cols }, (_, index) => {
    if (blocked.has(index)) {
      return `<div class="pincon-manual-seat is-blocked"><small>${index + 1} · 사용 안 함</small></div>`;
    }
    return `<label class="pincon-manual-seat"><small>좌석 ${index + 1}</small><select data-manual-seat-index="${index}">${optionMarkup(draftSeats[index] || "")}</select></label>`;
  }).join("");

  host.innerHTML = `
    <div class="pincon-manual-seat-head">
      <div><h4>수동 자리 지정</h4><p>학생을 고르면 기존 배정과 자동으로 교환되어 한 학생이 두 자리에 들어가지 않습니다.</p></div>
      <md-text-button data-close-manual-seats>닫기</md-text-button>
    </div>
    <div class="pincon-manual-seat-body">
      <div class="pincon-manual-seat-toolbar">
        <md-filled-button data-save-manual-seats><md-icon slot="icon">save</md-icon>수동 배치 저장</md-filled-button>
        <md-outlined-button data-clear-manual-seats>모두 비우기</md-outlined-button>
        <md-text-button data-reset-manual-seats>서버 상태로 되돌리기</md-text-button>
        <span class="pincon-manual-seat-status" data-manual-seat-status>저장 전</span>
      </div>
      ${unassignedMarkup()}
      <div class="pincon-manual-front">교탁</div>
      <div class="pincon-manual-classroom" style="--manual-cols:${cols}">${cells}</div>
    </div>`;

  host.querySelector("[data-close-manual-seats]")?.addEventListener("click", () => {
    opened = false;
    renderEditor();
  });
  host.querySelector("[data-save-manual-seats]")?.addEventListener("click", saveManualSeats);
  host.querySelector("[data-clear-manual-seats]")?.addEventListener("click", () => {
    draftSeats = Array(rows * cols).fill("");
    renderEditor();
    setStatus("변경됨 · 저장 필요");
  });
  host.querySelector("[data-reset-manual-seats]")?.addEventListener("click", async () => {
    await refreshView();
    draftSeats = normalizedSeats(view?.classroomLayout);
    renderEditor();
    setStatus("서버 상태로 되돌렸습니다.");
  });
  host.querySelectorAll("[data-manual-seat-index]").forEach((select) => {
    select.addEventListener("change", () => changeSeat(Number(select.dataset.manualSeatIndex), select.value));
  });
}

function changeSeat(index, nextUid) {
  if (!Number.isInteger(index) || index < 0 || index >= draftSeats.length) return;
  const previousUid = draftSeats[index] || "";
  if (previousUid === nextUid) return;

  if (!nextUid) {
    draftSeats[index] = "";
  } else {
    const previousIndex = draftSeats.findIndex((uid, seatIndex) => seatIndex !== index && uid === nextUid);
    if (previousIndex >= 0) draftSeats[previousIndex] = previousUid;
    draftSeats[index] = nextUid;
  }

  renderEditor();
  setStatus("변경됨 · 저장 필요");
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
  try {
    await refreshView();
    draftSeats = normalizedSeats(view?.classroomLayout);
    opened = true;
    renderEditor();
  } catch (error) {
    console.warn("[PinCon] manual seat editor load failed", error);
    setStatus("불러오지 못했습니다.");
  } finally {
    loading = false;
  }
}

async function saveManualSeats() {
  if (saving || !opened) return;
  saving = true;
  setStatus("저장 중…");
  try {
    const latest = await refreshView();
    const latestLayout = latest?.classroomLayout && typeof latest.classroomLayout === "object"
      ? structuredClone(latest.classroomLayout)
      : {};
    latestLayout.schemaVersion = Number(latestLayout.schemaVersion) || 1;
    latestLayout.general = latestLayout.general && typeof latestLayout.general === "object" ? latestLayout.general : {};

    const rows = Math.max(3, Math.min(10, Number(latestLayout.general.rows) || 6));
    const cols = Math.max(3, Math.min(10, Number(latestLayout.general.cols) || 6));
    const blocked = new Set(Array.isArray(latestLayout.general.blocked) ? latestLayout.general.blocked.map(Number) : []);
    const allowedStudentIds = new Set(roster().map((student) => student.uid));
    const nextSeats = Array(rows * cols).fill("");
    const used = new Set();

    draftSeats.slice(0, rows * cols).forEach((uid, index) => {
      const normalizedUid = String(uid || "");
      if (blocked.has(index) || !normalizedUid || !allowedStudentIds.has(normalizedUid) || used.has(normalizedUid)) return;
      nextSeats[index] = normalizedUid;
      used.add(normalizedUid);
    });

    latestLayout.general.seats = nextSeats;

    await accountRequest("/api/class-ops/classroom-layout", {
      method: "POST",
      body: {
        classKey: latest.classKey || classKey(),
        action: "SAVE",
        classroomLayout: latestLayout,
      },
    });

    setStatus("저장했습니다. 화면을 동기화합니다…");
    window.setTimeout(() => window.location.reload(), 180);
  } catch (error) {
    console.warn("[PinCon] manual seat editor save failed", error);
    setStatus("저장하지 못했습니다.");
  } finally {
    saving = false;
  }
}

function mount() {
  installStyles();
  const panel = root?.querySelector("#pinconClassroomLayout [data-mode-panel='general']");
  if (!panel) return;

  let host = panel.querySelector("[data-manual-seat-editor]");
  if (host) return;

  host = document.createElement("section");
  host.className = "pincon-manual-seat-card";
  host.dataset.manualSeatEditor = "";
  const actions = panel.querySelector(".pincon-layout-actions");
  if (actions) actions.insertAdjacentElement("afterend", host);
  else panel.prepend(host);
  renderEditor();
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
