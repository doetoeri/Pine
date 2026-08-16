import { f as firebaseApi } from "./assets/firebase-IW9tbrMW.js";

const KIND_LABELS = Object.freeze({
  notice: "공지사항",
  schedule: "시간표",
  supply: "준비물",
  event: "일정",
  group: "모둠",
});

const WRITE_KEYS = [
  "kind", "targets", "scope", "authorName", "title", "body", "category", "date",
  "subject", "day", "period", "room", "status", "groupLabel", "members", "icon", "source",
];

let currentUser = null;
let currentClassKey = "";
let contentItems = [];
let unsubscribeContent = null;
let renderQueued = false;
let editingItem = null;

const style = document.createElement("style");
style.textContent = `
  .pincon-collab-manager { margin-top: 18px; }
  .pincon-collab-manager .pincon-manager-note { margin: 0 0 12px; color: var(--md-sys-color-on-surface-variant, #4b5563); }
  .pincon-collab-manager .pincon-manager-toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
  .pincon-collab-manager .pincon-manager-list { display: grid; gap: 8px; }
  .pincon-collab-manager .pincon-manager-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 12px 0; border-bottom: 1px solid rgba(100,116,139,.18); }
  .pincon-collab-manager .pincon-manager-row:last-child { border-bottom: 0; }
  .pincon-collab-manager .pincon-manager-title { font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pincon-collab-manager .pincon-manager-meta { margin-top: 3px; font-size: .82rem; color: var(--md-sys-color-on-surface-variant, #6b7280); }
  .pincon-collab-manager .pincon-manager-actions { display: flex; gap: 6px; }
  .pincon-collab-manager .pincon-empty { padding: 12px 0; color: var(--md-sys-color-on-surface-variant, #6b7280); }
  #pincon-collab-edit-dialog { border: 0; border-radius: 28px; width: min(92vw, 560px); max-height: 84vh; padding: 0; background: var(--md-sys-color-surface-container-high, #fff); color: var(--md-sys-color-on-surface, #111827); box-shadow: 0 24px 64px rgba(0,0,0,.25); }
  #pincon-collab-edit-dialog::backdrop { background: rgba(15,23,42,.38); backdrop-filter: blur(4px); }
  #pincon-collab-edit-dialog form { display: grid; gap: 14px; padding: 24px; }
  #pincon-collab-edit-dialog h2 { margin: 0; font-size: 1.35rem; }
  #pincon-collab-edit-dialog #pincon-collab-fields { display: grid; gap: 12px; }
  #pincon-collab-edit-dialog label { display: grid; gap: 6px; font-size: .86rem; color: var(--md-sys-color-on-surface-variant, #4b5563); }
  #pincon-collab-edit-dialog input, #pincon-collab-edit-dialog textarea, #pincon-collab-edit-dialog select { box-sizing: border-box; width: 100%; border: 1px solid rgba(100,116,139,.45); border-radius: 14px; padding: 11px 12px; font: inherit; background: transparent; color: inherit; }
  #pincon-collab-edit-dialog textarea { resize: vertical; min-height: 88px; }
  #pincon-collab-edit-dialog .pincon-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
  #pincon-collab-edit-dialog .pincon-native-button { border: 0; border-radius: 999px; padding: 10px 16px; font: inherit; cursor: pointer; }
  #pincon-collab-edit-dialog .pincon-native-button.primary { background: var(--md-sys-color-primary, #4054b2); color: var(--md-sys-color-on-primary, #fff); }
  #pincon-collab-edit-dialog .pincon-native-button.tonal { background: var(--md-sys-color-secondary-container, #e1e2ec); color: var(--md-sys-color-on-secondary-container, #1b1b1f); }
  #pincon-collab-edit-dialog .pincon-form-error { min-height: 1.2em; margin: 0; color: var(--md-sys-color-error, #ba1a1a); font-size: .84rem; }
`;
document.head.appendChild(style);

function profileClassKey() {
  try {
    const profile = JSON.parse(localStorage.getItem("pincon-profile-v2") || "null");
    const grade = Number(profile?.grade);
    const classNumber = Number(profile?.classNumber);
    if (!Number.isInteger(grade) || grade < 1 || grade > 3) return "";
    if (!Number.isInteger(classNumber) || classNumber < 1 || classNumber > 10) return "";
    return `${grade}-${classNumber}`;
  } catch {
    return "";
  }
}

function authorName() {
  return currentUser?.displayName || currentUser?.email || "학생";
}

function writableCopy(item) {
  const copy = {};
  for (const key of WRITE_KEYS) {
    if (item?.[key] !== undefined) copy[key] = item[key];
  }
  copy.kind = item.kind;
  copy.targets = Array.isArray(item.targets) ? item.targets : [currentClassKey];
  copy.scope = item.scope || "class";
  copy.authorName = authorName();
  copy.title = String(item.title || "");
  copy.body = String(item.body || "");
  return copy;
}

function parseMembers(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, ...roleParts] = line.split("|");
      return { name: name.trim(), role: roleParts.join("|").trim() };
    })
    .filter((member) => member.name)
    .slice(0, 12);
}

function membersText(item) {
  return (item.members || []).map((member) => `${member.name}${member.role ? ` | ${member.role}` : ""}`).join("\n");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function field(label, name, value = "", type = "text", extra = "") {
  if (type === "textarea") {
    return `<label>${label}<textarea name="${name}" ${extra}>${escapeHtml(value)}</textarea></label>`;
  }
  return `<label>${label}<input type="${type}" name="${name}" value="${escapeAttr(value)}" ${extra}></label>`;
}

function selectField(label, name, value, options) {
  return `<label>${label}<select name="${name}">${options.map((option) => `<option value="${escapeAttr(option)}" ${option === value ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select></label>`;
}

function fieldsFor(item) {
  if (item.kind === "notice") {
    return [
      selectField("분류", "category", item.category || "일반 공지", ["일반 공지", "수업 변경", "체육 장소", "준비물", "수행평가", "학생회"]),
      field("제목", "title", item.title, "text", "maxlength=80 required"),
      field("내용", "body", item.body, "textarea", "maxlength=1000 required"),
    ].join("");
  }
  if (item.kind === "schedule") {
    return [
      selectField("요일", "day", item.day || "월", ["월", "화", "수", "목", "금"]),
      field("교시", "period", item.period || 1, "number", "min=1 max=9 required"),
      field("과목", "subject", item.subject || item.title, "text", "maxlength=80 required"),
      field("수업 장소", "room", item.room || "", "text", "maxlength=80"),
      selectField("상태", "status", item.status || "정상", ["정상", "변경", "이동", "예정", "확정"]),
      field("추가 안내", "body", item.body || "", "textarea", "maxlength=1000"),
    ].join("");
  }
  if (item.kind === "supply") {
    return [
      field("준비물", "title", item.title, "text", "maxlength=80 required"),
      field("설명", "body", item.body || "", "textarea", "maxlength=1000"),
      field("준비 날짜", "date", item.date || "", "date"),
    ].join("");
  }
  if (item.kind === "event") {
    return [
      selectField("일정 종류", "category", item.category || "기타", ["수행평가", "학사 일정", "학교 행사", "기타"]),
      field("일정 제목", "title", item.title, "text", "maxlength=80 required"),
      field("과목 또는 담당", "subject", item.subject || "", "text", "maxlength=80"),
      field("날짜", "date", item.date || "", "date", "required"),
      field("설명", "body", item.body || "", "textarea", "maxlength=1000"),
    ].join("");
  }
  return [
    field("과목", "subject", item.subject || "", "text", "maxlength=80 required"),
    field("활동명", "title", item.title, "text", "maxlength=80 required"),
    field("모둠명", "groupLabel", item.groupLabel || "", "text", "maxlength=80"),
    field("구성원과 역할", "members", membersText(item), "textarea", "required"),
    field("추가 안내", "body", item.body || "", "textarea", "maxlength=1000"),
  ].join("");
}

function ensureDialog() {
  let dialog = document.getElementById("pincon-collab-edit-dialog");
  if (dialog) return dialog;

  dialog = document.createElement("dialog");
  dialog.id = "pincon-collab-edit-dialog";
  dialog.innerHTML = `
    <form method="dialog" id="pincon-collab-edit-form">
      <h2>항목 수정</h2>
      <div id="pincon-collab-fields"></div>
      <p class="pincon-form-error" id="pincon-collab-form-error"></p>
      <div class="pincon-dialog-actions">
        <button type="button" class="pincon-native-button tonal" data-action="cancel">취소</button>
        <button type="submit" class="pincon-native-button primary">저장</button>
      </div>
    </form>
  `;
  document.body.appendChild(dialog);
  dialog.querySelector('[data-action="cancel"]').addEventListener("click", () => dialog.close());
  dialog.querySelector("form").addEventListener("submit", saveEdit);
  return dialog;
}

function openEdit(item) {
  if (!currentUser) return;
  editingItem = item;
  const dialog = ensureDialog();
  dialog.querySelector("#pincon-collab-fields").innerHTML = fieldsFor(item);
  dialog.querySelector("#pincon-collab-form-error").textContent = "";
  dialog.showModal();
}

async function saveEdit(event) {
  event.preventDefault();
  if (!editingItem || !currentUser) return;

  const item = editingItem;
  const dialog = ensureDialog();
  const form = dialog.querySelector("form");
  const error = dialog.querySelector("#pincon-collab-form-error");
  const data = new FormData(form);
  const next = writableCopy(item);

  if (item.kind === "notice") {
    next.category = String(data.get("category") || "일반 공지");
    next.title = String(data.get("title") || "").trim();
    next.body = String(data.get("body") || "").trim();
  } else if (item.kind === "schedule") {
    next.day = String(data.get("day") || "월");
    next.period = Number(data.get("period"));
    next.subject = String(data.get("subject") || "").trim();
    next.title = next.subject;
    next.room = String(data.get("room") || "").trim();
    next.status = String(data.get("status") || "정상");
    next.body = String(data.get("body") || "").trim();
  } else if (item.kind === "supply") {
    next.title = String(data.get("title") || "").trim();
    next.body = String(data.get("body") || "").trim();
    next.date = String(data.get("date") || "");
  } else if (item.kind === "event") {
    next.category = String(data.get("category") || "기타");
    next.title = String(data.get("title") || "").trim();
    next.subject = String(data.get("subject") || "").trim();
    next.date = String(data.get("date") || "");
    next.body = String(data.get("body") || "").trim();
  } else if (item.kind === "group") {
    next.subject = String(data.get("subject") || "").trim();
    next.title = String(data.get("title") || "").trim();
    next.groupLabel = String(data.get("groupLabel") || "").trim();
    next.members = parseMembers(data.get("members"));
    next.body = String(data.get("body") || "").trim();
  }

  if (!next.title || (next.kind === "notice" && !next.body)) {
    error.textContent = "필수 항목을 입력해 주세요.";
    return;
  }
  if (next.kind === "schedule" && (!next.subject || !Number.isInteger(next.period) || next.period < 1 || next.period > 9)) {
    error.textContent = "요일, 교시, 과목을 확인해 주세요.";
    return;
  }
  if (next.kind === "event" && !next.date) {
    error.textContent = "일정 날짜를 입력해 주세요.";
    return;
  }
  if (next.kind === "group" && (!next.subject || !next.members?.length)) {
    error.textContent = "과목과 구성원을 입력해 주세요.";
    return;
  }

  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  error.textContent = "";
  try {
    await firebaseApi.updateContent(item.id, next, item);
    editingItem = null;
    dialog.close();
  } catch (caught) {
    error.textContent = caught?.message || "수정하지 못했습니다.";
  } finally {
    submit.disabled = false;
  }
}

async function deleteItem(item) {
  if (!currentUser) return;
  if (!confirm(`“${item.title}” 항목을 삭제할까요?\n변경 기록에서 되돌릴 수 있습니다.`)) return;
  try {
    await firebaseApi.deleteContent(item.id, item);
  } catch (caught) {
    alert(caught?.message || "삭제하지 못했습니다.");
  }
}

function clickExistingAdd(kind) {
  const label = KIND_LABELS[kind];
  const candidates = [...document.querySelectorAll('.action-grid md-filled-button, [aria-label="콘텐츠 등록 메뉴"] md-filled-button')];
  const button = candidates.find((candidate) => candidate.textContent?.trim().includes(label));
  button?.click();
}

function renderSignature() {
  const items = contentItems
    .map((item) => `${item.id}:${item.updatedAtMs || item.createdAtMs || 0}`)
    .sort()
    .join("|");
  return `${currentUser?.uid || ""}|${currentClassKey}|${items}`;
}

function managerHtml() {
  const rows = contentItems
    .slice()
    .sort((a, b) => (b.updatedAtMs || b.createdAtMs || 0) - (a.updatedAtMs || a.createdAtMs || 0))
    .map((item) => `
      <div class="pincon-manager-row" data-content-id="${escapeAttr(item.id)}">
        <div>
          <div class="pincon-manager-title">${escapeHtml(item.title || item.subject || "제목 없는 항목")}</div>
          <div class="pincon-manager-meta">${escapeHtml(KIND_LABELS[item.kind] || item.kind)} · ${escapeHtml(item.authorName || "학생")}</div>
        </div>
        <div class="pincon-manager-actions">
          <md-text-button type="button" data-action="edit">수정</md-text-button>
          <md-text-button type="button" data-action="delete">삭제</md-text-button>
        </div>
      </div>
    `).join("");

  return `
    <div class="section-heading">
      <div>
        <p class="md-typescale-label-large">모든 학생 공동 편집</p>
        <h2 class="md-typescale-headline-small">모든 항목 관리</h2>
      </div>
      <md-assist-chip label="${contentItems.length}개"></md-assist-chip>
    </div>
    <p class="pincon-manager-note md-typescale-body-medium">Google 로그인한 학생은 현재 학급의 공지, 시간표, 준비물, 일정, 모둠을 모두 추가·수정·삭제할 수 있습니다. 모든 변경은 변경 기록에 남고 되돌릴 수 있습니다.</p>
    <div class="pincon-manager-toolbar">
      ${Object.entries(KIND_LABELS).map(([kind, label]) => `<md-filled-tonal-button type="button" data-add-kind="${kind}"><md-icon slot="icon">add</md-icon>${label}</md-filled-tonal-button>`).join("")}
    </div>
    <div class="pincon-manager-list">${rows || '<div class="pincon-empty">등록된 항목이 없습니다.</div>'}</div>
  `;
}

function renderManager() {
  const settingsGrid = document.querySelector(".settings-grid");
  const managerHeading = document.getElementById("manager-title");
  let section = document.querySelector(".pincon-collab-manager");

  if (!settingsGrid || !managerHeading || !currentUser || !currentClassKey) {
    section?.remove();
    return;
  }

  if (!section) {
    section = document.createElement("section");
    section.className = "content-section editor-section pincon-collab-manager";
    section.setAttribute("aria-label", "모든 항목 공동 편집");
    const managerSection = managerHeading.closest("section");
    if (managerSection?.parentElement === settingsGrid) managerSection.insertAdjacentElement("afterend", section);
    else settingsGrid.appendChild(section);
  }

  const signature = renderSignature();
  if (section.dataset.signature === signature) return;
  section.dataset.signature = signature;
  section.innerHTML = managerHtml();

  section.querySelectorAll("[data-add-kind]").forEach((button) => {
    button.addEventListener("click", () => clickExistingAdd(button.dataset.addKind));
  });
  section.querySelectorAll("[data-content-id]").forEach((row) => {
    const item = contentItems.find((candidate) => candidate.id === row.dataset.contentId);
    if (!item) return;
    row.querySelector('[data-action="edit"]')?.addEventListener("click", () => openEdit(item));
    row.querySelector('[data-action="delete"]')?.addEventListener("click", () => deleteItem(item));
  });
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderManager();
  });
}

function refreshClassSubscription() {
  const nextClassKey = profileClassKey();
  if (nextClassKey === currentClassKey && unsubscribeContent) return;

  currentClassKey = nextClassKey;
  contentItems = [];
  unsubscribeContent?.();
  unsubscribeContent = null;

  if (currentClassKey) {
    unsubscribeContent = firebaseApi.subscribeClassContent(
      currentClassKey,
      (items) => {
        contentItems = items;
        queueRender();
      },
      () => {},
      () => {},
    );
  }
  queueRender();
}

firebaseApi.observeAuth((user) => {
  currentUser = user;
  refreshClassSubscription();
  queueRender();
});

new MutationObserver(() => {
  const nextClassKey = profileClassKey();
  if (nextClassKey !== currentClassKey) refreshClassSubscription();
  queueRender();
}).observe(document.documentElement, { childList: true, subtree: true });

window.addEventListener("storage", refreshClassSubscription);
refreshClassSubscription();
