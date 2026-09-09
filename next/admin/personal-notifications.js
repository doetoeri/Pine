import { accountRequest } from "../core/student-auth.js";

const root = document.querySelector("#adminApp");
let recipients = [];
let loaded = false;
let loading = false;
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
  return [...recipients]
    .filter((item) => item && item.status === "ACTIVE" && item.uid)
    .filter((item) => /^\d{5}$/.test(String(item.studentNumber || "")))
    .sort((a, b) => Number(a.number || 0) - Number(b.number || 0));
}

function cardMarkup() {
  const students = studentRows();
  return `<section class="admin-card admin-card--wide" id="personalNotificationComposer" aria-labelledby="personal-notification-title">
    <div class="admin-card__header">
      <div><h2 id="personal-notification-title">학생 알림</h2><p class="admin-meta">한 학생에게 보내거나 같은 반 활성 계정 전체에 한 번에 보낼 수 있습니다. 전체 알림은 앱 알림함에 기록되고, 허용된 기기에는 푸시도 전송됩니다.</p></div>
      <span class="beta-badge">${loading ? "불러오는 중" : `${students.length}명`}</span>
    </div>
    <div class="managed-editor-split" style="align-items:end">
      <label style="display:grid;gap:6px;min-width:0"><span class="admin-meta">받는 대상</span>
        <select id="personalNotificationStudent" ${loading ? "disabled" : ""} style="min-height:56px;border:1px solid var(--md-sys-color-outline-variant);border-radius:16px;padding:0 14px;background:var(--md-sys-color-surface-container-lowest);font:inherit;min-width:0;width:100%">
          <option value="">${loading ? "학생 목록 불러오는 중" : students.length ? "대상 선택" : "수신 가능한 학생 없음"}</option>
          ${students.length ? `<option value="__ALL__" data-name="반 전체">📣 반 전체 · 활성 학생 ${students.length}명</option>` : ""}
          ${students.map((item) => `<option value="${escapeHtml(item.uid)}" data-name="${escapeHtml(item.name || "")}" data-student-number="${escapeHtml(item.studentNumber)}">${escapeHtml(`${item.number || "?"}번 · ${item.name || "이름 없음"} · ${item.studentNumber}`)}</option>`).join("")}
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
      <div id="broadcastNotice" hidden style="padding:12px 14px;border-radius:14px;background:var(--md-sys-color-primary-container);font-size:12px;line-height:1.55"><strong>반 전체 알림</strong><br>활성 학생 전체의 PinCon 알림함에 저장되고, 푸시를 허용한 기기에도 전송됩니다.</div>
      <div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap">
        <md-filled-button id="sendPersonalNotification" ${students.length ? "" : "disabled"}><md-icon slot="icon">send</md-icon><span data-send-label>알림 보내기</span></md-filled-button>
      </div>
      <p class="managed-editor-status" id="personalNotificationStatus" role="status" aria-live="polite">${loaded && !students.length ? "현재 계정으로 확인 가능한 같은 반 활성 학생이 없습니다." : ""}</p>
    </div>
  </section>`;
}

function mount(force = false) {
  if (!root) return;
  const existing = root.querySelector("#personalNotificationComposer");
  if (existing && !force) return;
  const contentEditor = root.querySelector("[data-managed-editor]");
  if (!contentEditor) return;
  existing?.remove();
  contentEditor.insertAdjacentHTML("afterend", cardMarkup());
  syncTargetMode();
}

function syncTargetMode() {
  const select = root?.querySelector("#personalNotificationStudent");
  const all = select?.value === "__ALL__";
  const notice = root?.querySelector("#broadcastNotice");
  const label = root?.querySelector("[data-send-label]");
  if (notice) notice.hidden = !all;
  if (label) label.textContent = all ? "반 전체에 보내기" : "알림 보내기";
}

async function loadRecipients() {
  if (loaded || loading) return;
  loading = true;
  mount(true);
  try {
    const result = await accountRequest("/api/accounts/personal-notifications?mode=recipients");
    recipients = Array.isArray(result?.recipients) ? result.recipients : [];
  } catch (error) {
    recipients = [];
    const status = root?.querySelector("#personalNotificationStatus");
    if (status) status.textContent = error?.message || "학생 목록을 불러오지 못했습니다.";
  } finally {
    loading = false;
    loaded = true;
    mount(true);
  }
}

async function send() {
  if (saving) return;
  const studentSelect = root.querySelector("#personalNotificationStudent");
  const targetUid = String(studentSelect?.value || "").trim();
  const selected = studentSelect?.selectedOptions?.[0];
  const studentName = String(selected?.dataset?.name || "").trim();
  const studentNumber = String(selected?.dataset?.studentNumber || "").trim();
  const title = String(root.querySelector("#personalNotificationTitle")?.value || "").trim();
  const body = String(root.querySelector("#personalNotificationBody")?.value || "").trim();
  const priority = String(root.querySelector("#personalNotificationPriority")?.value || "normal");
  const status = root.querySelector("#personalNotificationStatus");
  const button = root.querySelector("#sendPersonalNotification");
  const broadcast = targetUid === "__ALL__";

  if (!targetUid) {
    if (status) status.textContent = "받는 대상을 선택하세요.";
    return;
  }
  if (!title) {
    if (status) status.textContent = "알림 제목을 입력하세요.";
    return;
  }
  if (broadcast) {
    const ok = window.confirm(`같은 반 활성 학생 ${studentRows().length}명 전체에게 이 알림을 보낼까요?\n\n${title}`);
    if (!ok) return;
  }

  saving = true;
  if (button) button.disabled = true;
  if (status) status.textContent = broadcast ? "전체 학생 알림함과 푸시 대상으로 전송 중…" : "서버에서 수신자 권한을 확인하고 보내는 중…";
  try {
    const safePriority = ["normal", "important", "urgent"].includes(priority) ? priority : "normal";
    const result = await accountRequest("/api/accounts/personal-notifications", {
      method: "POST",
      body: broadcast ? {
        mode: "all",
        title: title.slice(0, 100),
        body: body.slice(0, 800),
        priority: safePriority,
      } : {
        mode: "one",
        targetUid,
        title: title.slice(0, 100),
        body: body.slice(0, 800),
        priority: safePriority,
      },
    });
    if (status) {
      if (broadcast) {
        const sent = Number(result?.pushSent || 0);
        const recipientsCount = Number(result?.recipients || studentRows().length);
        status.textContent = `반 전체 ${recipientsCount}명 알림함에 저장했습니다${sent ? ` · 푸시 ${sent}개 전송` : " · 등록된 푸시 기기는 없거나 전송되지 않았습니다"}.`;
      } else {
        status.textContent = `${studentName || studentNumber || "선택한 학생"}에게 개인 알림을 보냈습니다.`;
      }
    }
    const titleField = root.querySelector("#personalNotificationTitle");
    const bodyField = root.querySelector("#personalNotificationBody");
    if (titleField) titleField.value = "";
    if (bodyField) bodyField.value = "";
  } catch (error) {
    if (status) status.textContent = error?.message || (broadcast ? "전체 알림을 보내지 못했습니다." : "개별 알림을 보내지 못했습니다.");
  } finally {
    saving = false;
    if (button) button.disabled = false;
  }
}

root?.addEventListener("change", (event) => {
  if (event.target instanceof HTMLElement && event.target.id === "personalNotificationStudent") syncTargetMode();
});

root?.addEventListener("click", (event) => {
  const path = event.composedPath?.() || [];
  if (path.some((node) => node instanceof HTMLElement && node.id === "sendPersonalNotification")) send();
});

const observer = new MutationObserver(() => {
  requestAnimationFrame(() => {
    mount();
    if (root?.querySelector("[data-managed-editor]")) loadRecipients();
  });
});
if (root) observer.observe(root, { childList: true, subtree: true });
mount();
loadRecipients();
