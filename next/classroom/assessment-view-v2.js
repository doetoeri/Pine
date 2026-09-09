import { accountRequest } from "../core/student-auth.js";

const root = document.querySelector("#classroomApp");
let view = null;
let loading = false;
let queued = false;
let pollTimer = null;

const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

function installStyles() {
  if (document.querySelector("#pinconAssessmentViewV2Styles")) return;
  const style = document.createElement("style");
  style.id = "pinconAssessmentViewV2Styles";
  style.textContent = `
    .assessment-seat-v2{display:grid;gap:5px}.assessment-seat-v2 small{margin:0}.assessment-seat-v2 .assessment-sitter{font-weight:760}.assessment-seat-v2 .assessment-desk-owner{color:var(--muted,#6e6e73);font-size:12px}.assessment-display-mode{min-width:180px}.seat[data-dummy='true']{border-style:dashed}
  `;
  document.head.appendChild(style);
}

function roster() {
  return Array.isArray(view?.roster) ? view.roster : [];
}

function plan() {
  return view?.assessmentPlan || { seatOrder: [], deskOwners: [], slotCount: 5, tvLabelMode: "both", dummies: [], numberingMode: "vertical" };
}

function student(uid) {
  return roster().find((item) => item.uid === uid) || null;
}

function label(uid) {
  const item = student(uid);
  if (!item) return "없음";
  if (item.dummy) return `가상 · ${item.name || "자리"}`;
  return `${Number(item.number) || "-"}번 ${item.name || "이름 없음"}`;
}

function coordinate(index) {
  return `${(index % 5) + 1}열 ${Math.floor(index / 5) + 1}행`;
}

function stamp() {
  return JSON.stringify([plan().updatedAtMs || 0, plan().tvLabelMode, plan().deskOwners, plan().seatOrder, plan().dummies]);
}

function renderAssessmentPanel() {
  const panel = root.querySelector("[data-panel='assessment']");
  if (!panel || !view) return;
  const nextStamp = stamp();
  if (panel.dataset.assessmentV2Stamp === nextStamp) return;
  panel.dataset.assessmentV2Stamp = nextStamp;

  const slotCount = Number(plan().slotCount || Math.ceil(Math.max(1, roster().length) / 5) * 5);
  const cells = Array.from({ length: slotCount }, (_, index) => {
    const sitterUid = plan().seatOrder?.[index] || "";
    const ownerUid = plan().deskOwners?.[index] || "";
    const sitter = student(sitterUid);
    return `<div class="seat ${sitterUid || ownerUid ? "" : "empty"}" data-dummy="${sitter?.dummy === true}"><div class="assessment-seat-v2"><small>${coordinate(index)} · ${index + 1}번 자리</small><strong class="assessment-sitter">앉는 학생 · ${esc(label(sitterUid))}</strong><span class="assessment-desk-owner">책상 주인 · ${esc(label(ownerUid))}</span></div></div>`;
  }).join("");

  panel.innerHTML = `<h2>수행평가 배치</h2><p>5줄 고정 · 번호는 각 세로줄에서 위에서 아래로 증가하며, 책상 이동 위치는 별도로 지정합니다.</p><div class="teacher">교탁</div><div class="room-wrap"><div class="room" style="grid-template-columns:repeat(5,minmax(72px,1fr))">${cells}</div></div><div class="classroom-meta"><span>5줄 · 세로 번호순</span><span>가상 자리 ${Array.isArray(plan().dummies) ? plan().dummies.length : 0}개 · 책상/착석 분리</span></div>`;
}

function injectDisplayMode() {
  const settings = root.querySelector(".display-settings");
  if (!settings || !view?.permissions?.canEdit) return;
  if (settings.querySelector("[data-assessment-display-mode]")) return;

  const labelEl = document.createElement("label");
  labelEl.className = "assessment-display-mode";
  labelEl.dataset.assessmentDisplayMode = "";
  labelEl.innerHTML = `수행평가 TV 표기<select data-assessment-display-select><option value="student" ${plan().tvLabelMode === "student" ? "selected" : ""}>앉는 학생</option><option value="desk" ${plan().tvLabelMode === "desk" ? "selected" : ""}>책상 주인</option><option value="both" ${plan().tvLabelMode === "both" ? "selected" : ""}>둘 다</option></select>`;

  const saveButton = settings.querySelector("#saveDisplay");
  if (saveButton) settings.insertBefore(labelEl, saveButton);
  else settings.appendChild(labelEl);

  labelEl.querySelector("[data-assessment-display-select]")?.addEventListener("change", async (event) => {
    const mode = ["student", "desk", "both"].includes(event.target.value) ? event.target.value : "both";
    try {
      const result = await accountRequest("/api/class-ops/assessment-layout", {
        method: "POST",
        body: {
          action: "SAVE",
          classKey: view.classKey,
          dummies: plan().dummies || [],
          deskOwners: plan().deskOwners || [],
          tvLabelMode: mode,
        },
      });
      view = result;
      renderAssessmentPanel();
    } catch (error) {
      console.warn("[PinCon] assessment TV label mode save failed", error);
    }
  });
}

function render() {
  renderAssessmentPanel();
  injectDisplayMode();
}

async function refresh() {
  if (loading) return;
  loading = true;
  try {
    view = await accountRequest("/api/class-ops/assessment-layout");
    render();
  } catch (error) {
    console.warn("[PinCon] assessment classroom view load failed", error);
  } finally {
    loading = false;
  }
}

function queue() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    if (!view) refresh();
    else render();
  });
}

installStyles();
new MutationObserver(queue).observe(root, { childList: true, subtree: true });
refresh();
pollTimer = setInterval(refresh, 15000);
window.addEventListener("beforeunload", () => { if (pollTimer) clearInterval(pollTimer); });
