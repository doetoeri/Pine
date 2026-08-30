import { NextDataGateway } from "../core/data-gateway.js";

const root = document.querySelector("#adminApp");
const gateway = new NextDataGateway();
let snapshot = gateway.snapshot();
let saving = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function studentRows() {
  return (snapshot.data?.users || [])
    .filter((item) => item && item.deleted !== true)
    .filter((item) => /^\d{5}$/.test(String(item.studentNumber || "")))
    .sort((a, b) => String(a.studentNumber).localeCompare(String(b.studentNumber)));
}

function cardMarkup() {
  const students = studentRows();
  return `<section class="admin-card admin-card--wide" id="personalNotificationComposer" aria-labelledby="personal-notification-title">
    <div class="admin-card__header">
      <div><h2 id="personal-notification-title">개별 학생 알림</h2><p class="admin-meta">한 학생에게만 PinCon 알림함과 오늘 화면에 표시</p></div>
      <span class="beta-badge">${students.length}명</span>
    </div>
    <div class="managed-editor-split" style="align-items:end">
      <label style="display:grid;gap:6px;min-width:0"><span class="admin-meta">받는 학생</span>
        <select id="personalNotificationStudent" style="min-height:56px;border:1px solid var(--md-sys-color-outline-variant);border-radius:16px;padding:0 14px;background:var(--md-sys-color-surface-container-lowest);font:inherit;min-width:0;width:100%">
          <option value="">학생 선택</option>
          ${students.map((item) => `<option value="${escapeHtml(item.studentNumber)}" data-name="${escapeHtml(item.name || "")}">${escapeHtml(`${item.studentNumber} · ${item.name || `${item.number || "?"}번 학생`}`)}</option>`).join("")}
        </select>
      </label>
      <md-outlined-select id="personalNotificationPriority" label="중요도" value="normal">
        <md-select-option value="normal" selected><div slot="headline">일반</div></md-select-option>
        <md-select-option value="important"><div slot="headline">중요</div></md-select-option>
        <md-select-option value="urgent"><div slot="headline">긴급</div></md-select-option>
      </md-outlined-select>
    </div>
    <div style="display:grid;gap:12px;margin-top:12px">
      <md-outlined-text-field id="personalNotificationTitle" label="알림 제목" maxlength="100" required></md-outlined-text-field>
      <md-outlined-text-field id="personalNotificationBody" label="내용" type="textarea" rows="4" maxlength="800"></md-outlined-text-field>
      <div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap">
        <md-filled-button id="sendPersonalNotification"><md-icon slot="icon">send</md-icon>이 학생에게 보내기</md-filled-button>
      </div>
      <p class="managed-editor-status" id="personalNotificationStatus" role="status" aria-live="polite"></p>
    </div>
  </section>`;
}

function mount() {
  if (!root || root.querySelector("#personalNotificationComposer")) return;
  const contentEditor = root.querySelector("[data-managed-editor]");
  if (!contentEditor) return;
  contentEditor.insertAdjacentHTML("afterend", cardMarkup());
}

async function send() {
  if (saving) return;
  const studentSelect = root.querySelector("#personalNotificationStudent");
  const studentNumber = String(studentSelect?.value || "").trim();
  const selected = studentSelect?.selectedOptions?.[0];
  const studentName = String(selected?.dataset?.name || "").trim();
  const title = String(root.querySelector("#personalNotificationTitle")?.value || "").trim();
  const body = String(root.querySelector("#personalNotificationBody")?.value || "").trim();
  const priority = String(root.querySelector("#personalNotificationPriority")?.value || "normal");
  const status = root.querySelector("#personalNotificationStatus");
  const button = root.querySelector("#sendPersonalNotification");

  if (!/^\d{5}$/.test(studentNumber)) {
    if (status) status.textContent = "받는 학생을 선택하세요.";
    return;
  }
  if (!title) {
    if (status) status.textContent = "알림 제목을 입력하세요.";
    return;
  }
  if (!snapshot.canArchiveContent || !gateway.repository) {
    if (status) status.textContent = "개별 알림을 보낼 관리자 권한이 없습니다.";
    return;
  }

  saving = true;
  if (button) button.disabled = true;
  if (status) status.textContent = "학생 알림을 저장하는 중…";
  try {
    const safePriority = ["normal", "important", "urgent"].includes(priority) ? priority : "normal";
    await gateway.repository.adminWrite("announcements", {
      title: title.slice(0, 100),
      body: body.slice(0, 800),
      priority: safePriority,
      important: safePriority !== "normal",
      targetStudentNumber: studentNumber,
      targetStudentName: studentName,
      personalNotification: true,
      deleted: false,
    }, {
      action: "create",
      label: `개별 알림 · ${studentNumber} · ${title.slice(0, 40)}`,
    });
    if (status) status.textContent = `${studentName || studentNumber} 학생에게 보냈습니다.`;
    const titleField = root.querySelector("#personalNotificationTitle");
    const bodyField = root.querySelector("#personalNotificationBody");
    if (titleField) titleField.value = "";
    if (bodyField) bodyField.value = "";
  } catch (error) {
    if (status) status.textContent = error?.message || "개별 알림을 보내지 못했습니다.";
  } finally {
    saving = false;
    if (button) button.disabled = false;
  }
}

root?.addEventListener("click", (event) => {
  const path = event.composedPath?.() || [];
  if (path.some((node) => node instanceof HTMLElement && node.id === "sendPersonalNotification")) send();
});

gateway.addEventListener("change", (event) => {
  snapshot = event.detail;
  requestAnimationFrame(mount);
});

const observer = new MutationObserver(() => requestAnimationFrame(mount));
if (root) observer.observe(root, { childList: true, subtree: true });
mount();
