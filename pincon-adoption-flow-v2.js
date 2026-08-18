import { f as firebaseApi } from "./assets/firebase-IW9tbrMW.js";
await globalThis.PINCON_MATERIAL_READY;

const PROFILE_KEY = "pincon-profile-v2";
const PENDING_KEY = "pincon-quick-add-pending-v2";
const VIEW_KEY = "pincon-adoption-view-v2";

let currentUser = null;
let quickDialog = null;
let selectedKind = "";
let resumeBusy = false;

function profileClassKey() {
  try {
    const profile = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
    const grade = Number(profile?.grade);
    const classNumber = Number(profile?.classNumber);
    return Number.isInteger(grade) && grade >= 1 && grade <= 3 && Number.isInteger(classNumber) && classNumber >= 1 && classNumber <= 10
      ? `${grade}-${classNumber}`
      : "";
  } catch {
    return "";
  }
}

function authorName() {
  return currentUser?.displayName || globalThis.PINCON_GUEST_AUTH?.displayName?.() || "학생";
}

function kstDate(offset = 0) {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  now.setUTCDate(now.getUTCDate() + offset);
  return now.toISOString().slice(0, 10);
}

function todayDay() {
  return ["일", "월", "화", "수", "목", "금", "토"][new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCDay()] || "월";
}

function safeAnalyticsParams(params = {}) {
  const out = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") out[key] = value.slice(0, 60);
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

function track(name, params = {}) {
  const safe = safeAnalyticsParams(params);
  try {
    if (typeof globalThis.gtag === "function") globalThis.gtag("event", name, safe);
  } catch {}
  window.dispatchEvent(new CustomEvent("pincon-adoption-analytics", { detail: { name, params: safe } }));
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function ensureDialog() {
  if (quickDialog?.isConnected) return quickDialog;
  quickDialog = document.createElement("md-dialog");
  quickDialog.id = "pincon-quick-add-v2";
  quickDialog.setAttribute("aria-label", "빠른 등록");
  quickDialog.innerHTML = `
    <div slot="headline" data-quick-title>빠른 등록</div>
    <div slot="content" class="pincon-quick-content" data-quick-content></div>
    <div slot="actions" class="pincon-quick-actions">
      <md-text-button type="button" data-quick-back hidden>이전</md-text-button>
      <md-text-button type="button" data-quick-close>닫기</md-text-button>
      <md-filled-button type="button" data-quick-save hidden>등록</md-filled-button>
    </div>`;
  document.body.appendChild(quickDialog);

  quickDialog.querySelector("[data-quick-close]")?.addEventListener("click", () => { quickDialog.open = false; });
  quickDialog.querySelector("[data-quick-back]")?.addEventListener("click", () => renderChooser());
  quickDialog.querySelector("[data-quick-save]")?.addEventListener("click", publishFromDialog);
  quickDialog.querySelector("[data-quick-content]")?.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-quick-kind]");
    if (!button) return;
    renderForm(button.dataset.quickKind || "");
  });
  return quickDialog;
}

function setError(message = "") {
  const box = ensureDialog().querySelector("[data-quick-error]");
  if (!box) return;
  box.textContent = message;
  box.hidden = !message;
}

function renderChooser() {
  selectedKind = "";
  const dialog = ensureDialog();
  dialog.querySelector("[data-quick-title]").textContent = "빠른 등록";
  dialog.querySelector("[data-quick-back]").hidden = true;
  dialog.querySelector("[data-quick-save]").hidden = true;
  dialog.querySelector("[data-quick-content]").innerHTML = `
    <div class="pincon-quick-intro">
      <p>등록할 종류를 고르면 필요한 항목만 간단히 입력할 수 있습니다.</p>
    </div>
    <div class="pincon-quick-kind-grid">
      <md-filled-tonal-button type="button" data-quick-kind="schedule"><md-icon slot="icon">swap_horiz</md-icon>시간표 변경</md-filled-tonal-button>
      <md-filled-tonal-button type="button" data-quick-kind="supply"><md-icon slot="icon">backpack</md-icon>준비물</md-filled-tonal-button>
      <md-filled-tonal-button type="button" data-quick-kind="event"><md-icon slot="icon">event</md-icon>수행·일정</md-filled-tonal-button>
      <md-filled-tonal-button type="button" data-quick-kind="notice"><md-icon slot="icon">campaign</md-icon>공지</md-filled-tonal-button>
    </div>
    <div class="pincon-quick-hint"><md-icon>verified</md-icon><span>등록 전 내용을 확인하고, 변경 내용은 기존 PinCon 기록 체계에 저장됩니다.</span></div>`;
}

function renderForm(kind) {
  if (!["schedule", "supply", "event", "notice"].includes(kind)) return renderChooser();
  selectedKind = kind;
  const dialog = ensureDialog();
  const titleMap = { schedule: "시간표 변경", supply: "준비물", event: "수행·일정", notice: "공지" };
  dialog.querySelector("[data-quick-title]").textContent = titleMap[kind];
  dialog.querySelector("[data-quick-back]").hidden = false;
  dialog.querySelector("[data-quick-save]").hidden = false;

  let fields = "";
  if (kind === "schedule") {
    fields = `
      <div class="pincon-quick-two">
        <md-outlined-select label="요일" data-q="day">
          ${["월", "화", "수", "목", "금"].map((day) => `<md-select-option value="${day}" ${day === todayDay() ? "selected" : ""}><div slot="headline">${day}</div></md-select-option>`).join("")}
        </md-outlined-select>
        <md-outlined-text-field label="교시" type="number" min="1" max="9" value="1" data-q="period"></md-outlined-text-field>
      </div>
      <md-outlined-text-field label="바뀐 과목" maxlength="40" required data-q="subject"></md-outlined-text-field>
      <md-outlined-text-field label="교실 · 선택" maxlength="40" data-q="room"></md-outlined-text-field>`;
  } else if (kind === "supply") {
    fields = `
      <md-outlined-text-field label="준비물" maxlength="60" required data-q="title"></md-outlined-text-field>
      <md-outlined-text-field label="준비 날짜" type="date" value="${kstDate(1)}" data-q="date"></md-outlined-text-field>
      <md-outlined-text-field label="짧은 설명 · 선택" maxlength="180" data-q="body"></md-outlined-text-field>`;
  } else if (kind === "event") {
    fields = `
      <md-outlined-select label="종류" data-q="category">
        <md-select-option value="수행평가" selected><div slot="headline">수행평가</div></md-select-option>
        <md-select-option value="학교 행사"><div slot="headline">학교 행사</div></md-select-option>
        <md-select-option value="기타"><div slot="headline">기타</div></md-select-option>
      </md-outlined-select>
      <md-outlined-text-field label="제목" maxlength="70" required data-q="title"></md-outlined-text-field>
      <div class="pincon-quick-two">
        <md-outlined-text-field label="과목 · 선택" maxlength="40" data-q="subject"></md-outlined-text-field>
        <md-outlined-text-field label="날짜" type="date" value="${kstDate(1)}" data-q="date"></md-outlined-text-field>
      </div>
      <md-outlined-text-field label="설명 · 선택" maxlength="220" data-q="body"></md-outlined-text-field>`;
  } else {
    fields = `
      <md-outlined-select label="분류" data-q="category">
        <md-select-option value="일반 공지" selected><div slot="headline">일반 공지</div></md-select-option>
        <md-select-option value="수업 변경"><div slot="headline">수업 변경</div></md-select-option>
        <md-select-option value="준비물"><div slot="headline">준비물</div></md-select-option>
      </md-outlined-select>
      <md-outlined-text-field label="제목" maxlength="70" required data-q="title"></md-outlined-text-field>
      <md-outlined-text-field label="내용" type="textarea" rows="3" maxlength="500" required data-q="body"></md-outlined-text-field>`;
  }

  dialog.querySelector("[data-quick-content]").innerHTML = `<div class="pincon-quick-fields">${fields}<div class="pincon-quick-error" data-quick-error hidden></div></div>`;
  setTimeout(() => dialog.querySelector("[data-q='subject'],[data-q='title']")?.focus?.(), 120);
  track("adoption_quick_add_kind", { item_type: kind });
}

function value(key) {
  return String(ensureDialog().querySelector(`[data-q="${key}"]`)?.value ?? "").trim();
}

function payloadFromForm() {
  const classKey = profileClassKey();
  if (!classKey || !selectedKind) throw new Error("학급과 등록 종류를 확인해 주세요.");
  const base = {
    kind: selectedKind,
    targets: [classKey],
    scope: "class",
    authorName: authorName(),
    source: "quick-add-v2",
  };

  if (selectedKind === "schedule") {
    const period = Number(value("period"));
    const subject = value("subject");
    if (!subject || !Number.isInteger(period) || period < 1 || period > 9) throw new Error("교시와 바뀐 과목을 입력해 주세요.");
    return { ...base, title: subject, subject, day: value("day") || todayDay(), period, room: value("room"), status: "변경", body: "", date: kstDate(0) };
  }
  if (selectedKind === "supply") {
    const title = value("title");
    if (!title) throw new Error("준비물을 입력해 주세요.");
    return { ...base, title, body: value("body"), date: value("date") || kstDate(1) };
  }
  if (selectedKind === "event") {
    const title = value("title");
    if (!title) throw new Error("일정 제목을 입력해 주세요.");
    return { ...base, title, category: value("category") || "수행평가", subject: value("subject"), date: value("date") || kstDate(1), body: value("body") };
  }
  const title = value("title"), body = value("body");
  if (!title || !body) throw new Error("공지 제목과 내용을 입력해 주세요.");
  return { ...base, title, body, category: value("category") || "일반 공지" };
}

async function publishPayload(payload, { resumed = false } = {}) {
  if (!currentUser) {
    try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(payload)); } catch {}
    const result = await globalThis.PINCON_GUEST_AUTH?.ensureNamedUserAndSync?.();
    if (!result) {
      try { sessionStorage.removeItem(PENDING_KEY); } catch {}
      throw new Error("편집 이름을 확인한 뒤 다시 등록해 주세요.");
    }
    return;
  }

  const clean = { ...payload, authorName: authorName() };
  await firebaseApi.publishContent(clean);
  try { sessionStorage.removeItem(PENDING_KEY); } catch {}
  globalThis.PINCON_ADOPTION_CORE?.refresh?.();
  track("adoption_quick_add_publish", { item_type: clean.kind, resumed });
}

async function publishFromDialog() {
  const save = ensureDialog().querySelector("[data-quick-save]");
  try {
    const payload = payloadFromForm();
    setError("");
    save.disabled = true;
    await publishPayload(payload);
    if (currentUser) {
      quickDialog.open = false;
      renderChooser();
    }
  } catch (error) {
    setError(error?.message || "등록하지 못했습니다.");
    track("adoption_quick_add_error", { item_type: selectedKind || "unknown" });
  } finally {
    save.disabled = false;
  }
}

async function resumePending() {
  if (!currentUser || resumeBusy) return;
  let pending = null;
  try { pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null"); } catch {}
  if (!pending?.kind) return;
  resumeBusy = true;
  try {
    await publishPayload(pending, { resumed: true });
    const dialog = ensureDialog();
    dialog.open = false;
    renderChooser();
    globalThis.PINCON_ADOPTION_CORE?.refresh?.();
    const messageDialog = document.getElementById("pincon-adoption-message");
    if (messageDialog?.querySelector?.("[data-adoption-message]")) {
      messageDialog.querySelector("[data-adoption-message]").textContent = "빠른 등록을 완료했습니다.";
      messageDialog.open = true;
    }
  } catch {
    try { sessionStorage.removeItem(PENDING_KEY); } catch {}
  } finally {
    resumeBusy = false;
  }
}

function openQuickAdd() {
  const classKey = profileClassKey();
  if (!classKey) return;
  const dialog = ensureDialog();
  renderChooser();
  dialog.open = true;
  track("adoption_quick_add_open", { auth_mode: currentUser ? (currentUser.isAnonymous ? "guest" : "account") : "signed_out" });
}

function installInteractionTracking() {
  document.addEventListener("click", (event) => {
    const add = event.target.closest?.("[data-adoption-add]");
    if (add) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openQuickAdd();
      return;
    }
    if (event.target.closest?.("[data-adoption-share]")) track("adoption_share_open", {});
    if (event.target.closest?.("[data-adoption-bag]")) track("adoption_bag_open", {});
  }, { capture: true });

  document.addEventListener("change", (event) => {
    const box = event.target.closest?.("[data-bag-check]");
    if (box) track("adoption_bag_check", { checked: Boolean(box.checked) });
  }, { capture: true, passive: true });
}

function trackFirstView() {
  if (!document.querySelector(".pincon-adoption-core")) return;
  try {
    if (sessionStorage.getItem(VIEW_KEY) === "1") return;
    sessionStorage.setItem(VIEW_KEY, "1");
  } catch {}
  const hasChanges = !/오늘 변경 없음/.test(document.querySelector(".pincon-adoption-core")?.textContent || "");
  track("adoption_core_view", { has_changes: hasChanges, pwa: Boolean(matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone) });
}

firebaseApi.observeAuth((user) => {
  currentUser = user || null;
  resumePending();
});

installInteractionTracking();
const root = document.getElementById("root");
if (root) new MutationObserver(() => setTimeout(trackFirstView, 40)).observe(root, { childList: true, subtree: true });
window.addEventListener("pageshow", () => setTimeout(trackFirstView, 120), { passive: true });
setTimeout(trackFirstView, 300);

globalThis.PINCON_QUICK_ADD_V2 = Object.freeze({ open: openQuickAdd });
