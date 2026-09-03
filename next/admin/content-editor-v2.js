import { NextDataGateway } from "../core/data-gateway.js";
import { ContentServiceV2 } from "./content-service-v2.js";

const root = document.querySelector("#adminApp");
const gateway = new NextDataGateway();
const service = new ContentServiceV2(gateway);
let snapshot = gateway.snapshot();
let query = "";
let activeType = "all";
let showArchive = false;
let renderQueued = false;
let saving = false;

const TYPES = Object.freeze({
  announcements: { label: "공지", icon: "campaign", noun: "공지" },
  classAssignments: { label: "수행·숙제", icon: "assignment", noun: "수행·숙제" },
  evaluationPlans: { label: "평가계획서", icon: "picture_as_pdf", noun: "평가계획서" },
  events: { label: "학급 행사", icon: "celebration", noun: "행사" },
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function localToday() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateValue(value) {
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function titleOf(item) {
  return item?.title || item?.name || item?.subject || item?.id || "제목 없음";
}

function supportOf(collection, item) {
  if (collection === "announcements") {
    const priority = item.priority === "urgent" ? "긴급" : item.priority === "important" ? "중요" : "일반";
    return [priority, item.body].filter(Boolean).join(" · ");
  }
  if (collection === "classAssignments") {
    return [item.subject, item.dueDate || "날짜 미정", item.type, item.verificationStatus].filter(Boolean).join(" · ");
  }
  if (collection === "evaluationPlans") {
    return [item.subject, `${item.schoolYear || "-"}학년도 ${item.semester || "-"}학기`, item.status].filter(Boolean).join(" · ");
  }
  return [item.date, item.status, item.question].filter(Boolean).join(" · ");
}

function allRows() {
  const rows = [];
  for (const collection of Object.keys(TYPES)) {
    for (const item of snapshot.data?.[collection] || []) {
      if (!item) continue;
      rows.push({ collection, item });
    }
  }
  return rows.sort((a, b) => Number(b.item.updatedAtMs || b.item.createdAtMs || 0) - Number(a.item.updatedAtMs || a.item.createdAtMs || 0));
}

function visibleRows() {
  const needle = query.trim().toLowerCase();
  return allRows().filter(({ collection, item }) => {
    if (Boolean(item.deleted) !== showArchive) return false;
    if (activeType !== "all" && collection !== activeType) return false;
    if (!needle) return true;
    return `${titleOf(item)} ${supportOf(collection, item)} ${TYPES[collection].label}`.toLowerCase().includes(needle);
  });
}

function counts() {
  const rows = allRows();
  return {
    active: rows.filter(({ item }) => !item.deleted).length,
    archived: rows.filter(({ item }) => item.deleted).length,
    announcements: rows.filter(({ collection, item }) => collection === "announcements" && !item.deleted).length,
    assignments: rows.filter(({ collection, item }) => collection === "classAssignments" && !item.deleted).length,
  };
}

function selectOptions(options, selected = "") {
  return options.map(([value, label]) => `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

function field(label, name, value = "", options = {}) {
  const { type = "text", required = false, max = 300, placeholder = "" } = options;
  return `<label class="ops-v2-field"><span>${escapeHtml(label)}</span><input name="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}" ${required ? "required" : ""} ${max ? `maxlength="${max}"` : ""} placeholder="${escapeHtml(placeholder)}"></label>`;
}

function textarea(label, name, value = "", max = 1600) {
  return `<label class="ops-v2-field"><span>${escapeHtml(label)}</span><textarea name="${escapeHtml(name)}" maxlength="${max}" rows="4">${escapeHtml(value)}</textarea></label>`;
}

function selectField(label, name, options, selected) {
  return `<label class="ops-v2-field"><span>${escapeHtml(label)}</span><select name="${escapeHtml(name)}">${selectOptions(options, selected)}</select></label>`;
}

function checkField(label, name, checked = false) {
  return `<label class="ops-v2-check"><input name="${escapeHtml(name)}" type="checkbox" ${checked ? "checked" : ""}><span>${escapeHtml(label)}</span></label>`;
}

function formFields(collection, item = {}) {
  if (collection === "announcements") {
    return `${field("공지 제목", "title", item.title, { required: true, max: 100 })}
      ${textarea("내용", "body", item.body, 1800)}
      ${selectField("중요도", "priority", [["normal","일반"],["important","중요"],["urgent","긴급"]], item.priority || "normal")}
      ${checkField("학생 화면에 공개", "published", item.published !== false)}`;
  }

  if (collection === "classAssignments") {
    return `${field("제목", "title", item.title, { required: true, max: 120 })}
      <div class="ops-v2-form-grid">${field("과목", "subject", item.subject, { max: 40 })}${selectField("종류", "type", [["assessment","수행평가"],["exam","시험"],["preparation","준비물·숙제"]], item.type || "assessment")}</div>
      <div class="ops-v2-form-grid">${selectField("날짜 상태", "dateType", [["exact","정확한 날짜"],["range","기간형"],["month","월 중 예정"],["undecided","날짜 미정"]], item.dateType || (item.dueDate ? "exact" : "undecided"))}${field("마감 날짜", "dueDate", dateValue(item.dueDate), { type: "date", max: 0 })}</div>
      ${field("평가 범위", "evaluationRange", item.evaluationRange, { max: 600 })}
      ${field("평가 방식", "evaluationMethod", item.evaluationMethod, { max: 500 })}
      ${field("준비물·제출물", "materials", item.materials, { max: 500 })}
      ${field("배점·반영 비율", "points", item.points, { max: 120 })}
      ${field("평가계획서 ID", "evaluationPlanId", item.evaluationPlanId, { max: 160 })}
      ${field("관련 페이지", "pageReferences", item.pageReferences, { max: 120, placeholder: "예: 4~6쪽" })}
      ${selectField("확인 상태", "verificationStatus", [["review","확인 중"],["verified","공식 자료 확인"],["changed","수업 중 변경됨"]], item.verificationStatus || "review")}
      ${field("학생에게 안내된 날짜", "announcedDate", dateValue(item.announcedDate) || localToday(), { type: "date", max: 0 })}
      ${textarea("학생용 요약", "description", item.description, 1200)}
      <div class="ops-v2-check-row">${checkField("학생 화면에 공개", "published", item.published !== false)}${checkField("결석자 복귀팩에 포함", "recoveryRelevant", item.recoveryRelevant !== false)}</div>`;
  }

  if (collection === "evaluationPlans") {
    return `${field("평가계획서 제목", "title", item.title, { required: true, max: 140 })}
      ${field("과목", "subject", item.subject, { required: true, max: 40 })}
      <div class="ops-v2-form-grid">${field("학년도", "schoolYear", item.schoolYear || new Date().getFullYear(), { type: "number", max: 0 })}${selectField("학기", "semester", [["1","1학기"],["2","2학기"]], String(item.semester || 2))}</div>
      ${selectField("검토 상태", "status", [["draft","초안"],["review","담당자 확인 중"],["verified","원본 확인 완료"]], item.status || "review")}
      ${field("학교 홈페이지 원문 링크", "sourceUrl", item.sourceUrl, { type: "url", max: 1200 })}
      <label class="ops-v2-field"><span>PDF 파일 · 10MB 이하</span><input name="planFile" type="file" accept="application/pdf,.pdf"><small>${escapeHtml(item.fileName ? `현재 파일: ${item.fileName}` : "새 파일을 올리지 않으면 기존 파일을 유지합니다.")}</small></label>
      ${checkField("파일 공유 권한과 개인정보 제거를 확인함", "fileConfirmed", false)}
      ${field("출처", "sourceAttribution", item.sourceAttribution || "고촌고등학교 평가계획서", { max: 300 })}
      ${field("전체 페이지 수", "pageCount", item.pageCount || 0, { type: "number", max: 0 })}
      ${field("학생에게 공개한 날짜", "announcedDate", dateValue(item.announcedDate) || localToday(), { type: "date", max: 0 })}
      ${textarea("설명", "description", item.description, 1000)}
      ${checkField("결석자 복귀팩에 포함", "recoveryRelevant", item.recoveryRelevant !== false)}`;
  }

  return `${field("행사 제목", "title", item.title, { required: true, max: 120 })}
    ${textarea("질문 또는 설명", "question", item.question, 500)}
    <div class="ops-v2-form-grid">${field("행사 날짜", "date", dateValue(item.date), { type: "date", max: 0 })}${selectField("상태", "status", [["draft","초안"],["open","진행 중"],["closed","종료"]], item.status || "draft")}</div>
    ${selectField("행사 형식", "kind", [["survey34","우리 반 34명에게 물었습니다"],["family-arcade","가족오락관"],["quiz","퀴즈"],["balance","밸런스 게임"],["class-vote","학급 투표"],["survey","설문"],["mini-game","미니게임"]], item.kind || "survey34")}`;
}

function modalMarkup() {
  return `<dialog class="ops-v2-dialog" id="opsV2Dialog">
    <form id="opsV2Form" method="dialog">
      <header><div><span id="opsV2DialogEyebrow">콘텐츠</span><h2 id="opsV2DialogTitle">새 콘텐츠</h2></div><button type="button" class="ops-v2-icon-button" data-v2-close aria-label="닫기"><md-icon>close</md-icon></button></header>
      <div class="ops-v2-dialog-body" id="opsV2Fields"></div>
      <p class="ops-v2-inline-status" id="opsV2DialogStatus" role="status"></p>
      <footer><button type="button" class="ops-v2-secondary" data-v2-close>취소</button><button type="submit" class="ops-v2-primary" id="opsV2Save"><md-icon>save</md-icon><span>저장</span></button></footer>
    </form>
  </dialog>`;
}

function rowMarkup({ collection, item }) {
  const type = TYPES[collection];
  const archived = item.deleted === true;
  return `<article class="ops-v2-row" data-v2-row data-collection="${collection}" data-id="${escapeHtml(item.id)}">
    <div class="ops-v2-row-icon"><md-icon>${type.icon}</md-icon></div>
    <div class="ops-v2-row-copy"><span>${type.label}${archived ? " · 보관됨" : ""}</span><strong>${escapeHtml(titleOf(item))}</strong><small>${escapeHtml(supportOf(collection, item) || "추가 정보 없음")}</small></div>
    <div class="ops-v2-row-actions">
      ${archived
        ? `<button type="button" class="ops-v2-secondary" data-v2-restore><md-icon>restore</md-icon><span>복원</span></button>`
        : `<button type="button" class="ops-v2-secondary" data-v2-duplicate><md-icon>content_copy</md-icon><span>복사</span></button><button type="button" class="ops-v2-secondary" data-v2-edit><md-icon>edit</md-icon><span>수정</span></button><button type="button" class="ops-v2-icon-button" data-v2-archive title="보관"><md-icon>archive</md-icon></button>`}
    </div>
  </article>`;
}

function mainMarkup() {
  const total = counts();
  const rows = visibleRows();
  const connection = snapshot.ready && snapshot.online && !snapshot.error;
  return `<section class="admin-card admin-card--wide ops-v2" data-managed-editor aria-labelledby="ops-v2-title">
    <div class="ops-v2-hero">
      <div><span class="ops-v2-eyebrow">OPERATIONS CENTER 2.0</span><h2 id="ops-v2-title">콘텐츠 센터</h2><p>생성부터 서버 저장 확인, 수정, 복사, 보관, 복원까지 하나의 흐름으로 처리합니다.</p></div>
      <button type="button" class="ops-v2-primary" data-v2-create="announcements"><md-icon>add</md-icon><span>새 콘텐츠</span></button>
    </div>
    <div class="ops-v2-health ${connection ? "is-ok" : "is-warning"}"><md-icon>${connection ? "cloud_done" : "cloud_off"}</md-icon><div><strong>${connection ? "데이터 연결 정상" : "데이터 연결 확인 필요"}</strong><span>${escapeHtml(snapshot.error || (connection ? `${snapshot.profile?.grade || "-"}학년 ${snapshot.profile?.classNumber || "-"}반 · 저장 후 서버 재확인 사용` : "네트워크 또는 Firestore 상태를 확인하세요."))}</span></div></div>
    <div class="ops-v2-metrics"><button type="button" data-v2-archive-view="false"><span>게시·운영 중</span><strong>${total.active}</strong></button><button type="button" data-v2-type="announcements"><span>공지</span><strong>${total.announcements}</strong></button><button type="button" data-v2-type="classAssignments"><span>수행·숙제</span><strong>${total.assignments}</strong></button><button type="button" data-v2-archive-view="true"><span>보관함</span><strong>${total.archived}</strong></button></div>
    <div class="ops-v2-toolbar">
      <label class="ops-v2-search"><md-icon>search</md-icon><input id="opsV2Search" type="search" value="${escapeHtml(query)}" placeholder="제목, 과목, 내용 검색"></label>
      <select id="opsV2TypeFilter" aria-label="콘텐츠 종류"><option value="all" ${activeType === "all" ? "selected" : ""}>전체 종류</option>${Object.entries(TYPES).map(([key, value]) => `<option value="${key}" ${activeType === key ? "selected" : ""}>${value.label}</option>`).join("")}</select>
      <button type="button" class="ops-v2-secondary ${showArchive ? "is-active" : ""}" data-v2-toggle-archive><md-icon>inventory_2</md-icon><span>${showArchive ? "운영 콘텐츠" : "보관함"}</span></button>
    </div>
    <div class="ops-v2-create-strip">${Object.entries(TYPES).map(([key, value]) => `<button type="button" data-v2-create="${key}"><md-icon>${value.icon}</md-icon><span>새 ${value.noun}</span></button>`).join("")}</div>
    <p class="ops-v2-inline-status" id="opsV2Status" role="status"></p>
    <div class="ops-v2-list">${rows.length ? rows.map(rowMarkup).join("") : `<div class="ops-v2-empty"><md-icon>${showArchive ? "inventory_2" : "inbox"}</md-icon><strong>${showArchive ? "보관된 콘텐츠가 없습니다" : "조건에 맞는 콘텐츠가 없습니다"}</strong><span>${showArchive ? "보관한 항목은 여기에서 다시 복원할 수 있습니다." : "새 콘텐츠를 만들거나 검색 조건을 바꿔보세요."}</span></div>`}</div>
    ${modalMarkup()}
  </section>`;
}

function card() {
  return root?.querySelector("[data-managed-editor]");
}

function setStatus(message, kind = "") {
  const node = root?.querySelector("#opsV2Status");
  if (!node) return;
  node.textContent = message || "";
  node.dataset.kind = kind;
}

function openEditor(collection, id = "", duplicate = false) {
  const dialog = root?.querySelector("#opsV2Dialog");
  const fields = root?.querySelector("#opsV2Fields");
  const form = root?.querySelector("#opsV2Form");
  if (!dialog || !fields || !form || !TYPES[collection]) return;
  const item = id ? service.find(collection, id) : null;
  if (id && !item) return setStatus("콘텐츠를 찾지 못했습니다.", "error");
  const effectiveId = duplicate ? "" : id;
  dialog.dataset.collection = collection;
  dialog.dataset.recordId = effectiveId;
  dialog.dataset.sourceId = duplicate ? id : "";
  document.querySelector("#opsV2DialogEyebrow").textContent = TYPES[collection].label;
  document.querySelector("#opsV2DialogTitle").textContent = duplicate ? "복사하여 새로 만들기" : (id ? "콘텐츠 수정" : "새 콘텐츠 만들기");
  fields.innerHTML = formFields(collection, item || {});
  const status = root?.querySelector("#opsV2DialogStatus");
  if (status) { status.textContent = ""; status.dataset.kind = ""; }
  dialog.showModal();
  requestAnimationFrame(() => fields.querySelector("input, textarea, select")?.focus());
}

function closeEditor() {
  root?.querySelector("#opsV2Dialog")?.close();
}

function valuesFromForm(collection, form) {
  const data = new FormData(form);
  const value = (name) => String(data.get(name) ?? "");
  const checked = (name) => form.elements.namedItem(name)?.checked === true;
  if (collection === "announcements") return { title: value("title"), body: value("body"), priority: value("priority"), published: checked("published") };
  if (collection === "classAssignments") return {
    title: value("title"), subject: value("subject"), type: value("type"), dateType: value("dateType"), dueDate: value("dueDate"),
    evaluationRange: value("evaluationRange"), evaluationMethod: value("evaluationMethod"), materials: value("materials"), points: value("points"),
    evaluationPlanId: value("evaluationPlanId"), pageReferences: value("pageReferences"), verificationStatus: value("verificationStatus"),
    announcedDate: value("announcedDate"), description: value("description"), published: checked("published"), recoveryRelevant: checked("recoveryRelevant"),
  };
  if (collection === "evaluationPlans") return {
    title: value("title"), subject: value("subject"), schoolYear: value("schoolYear"), semester: value("semester"), status: value("status"),
    sourceUrl: value("sourceUrl"), sourceAttribution: value("sourceAttribution"), pageCount: value("pageCount"), announcedDate: value("announcedDate"),
    description: value("description"), recoveryRelevant: checked("recoveryRelevant"),
  };
  const current = service.find(collection, form.closest("dialog")?.dataset.recordId || "");
  return {
    title: value("title"), question: value("question"), date: value("date"), status: value("status"), kind: value("kind"),
    startsAtMs: Number(current?.startsAtMs || 0), resultsVisible: current?.resultsVisible === true,
    publishedResults: Array.isArray(current?.publishedResults) ? current.publishedResults : [],
  };
}

async function submitEditor(event) {
  event.preventDefault();
  if (saving) return;
  const form = event.currentTarget;
  const dialog = form.closest("dialog");
  const collection = dialog?.dataset.collection;
  const status = root?.querySelector("#opsV2DialogStatus");
  const saveButton = root?.querySelector("#opsV2Save");
  if (!dialog || !collection) return;
  saving = true;
  if (saveButton) saveButton.disabled = true;
  if (status) { status.textContent = "Firestore에 저장한 뒤 서버에서 다시 확인하고 있습니다…"; status.dataset.kind = ""; }
  try {
    const file = collection === "evaluationPlans" ? form.elements.namedItem("planFile")?.files?.[0] || null : null;
    const result = await service.save(collection, valuesFromForm(collection, form), {
      id: dialog.dataset.recordId || "",
      file,
      fileConfirmed: form.elements.namedItem("fileConfirmed")?.checked === true,
    });
    closeEditor();
    setStatus(`저장 완료 · 서버에서 ${result.id} 확인됨`, "success");
    await gateway.retry();
  } catch (error) {
    if (status) { status.textContent = error?.message || "저장하지 못했습니다."; status.dataset.kind = "error"; }
  } finally {
    saving = false;
    if (saveButton) saveButton.disabled = false;
  }
}

async function archiveAction(collection, id, restore = false) {
  if (saving) return;
  saving = true;
  setStatus(restore ? "복원 후 서버에서 확인하고 있습니다…" : "보관 후 서버에서 확인하고 있습니다…");
  try {
    if (restore) await service.restore(collection, id);
    else await service.archive(collection, id);
    setStatus(restore ? "복원되었습니다." : "보관되었습니다.", "success");
    await gateway.retry();
  } catch (error) {
    setStatus(error?.message || (restore ? "복원하지 못했습니다." : "보관하지 못했습니다."), "error");
  } finally {
    saving = false;
  }
}

function rowFromEvent(event) {
  return event.target.closest?.("[data-v2-row]") || null;
}

function handleClick(event) {
  const create = event.target.closest?.("[data-v2-create]");
  if (create) return openEditor(create.dataset.v2Create);
  const close = event.target.closest?.("[data-v2-close]");
  if (close) return closeEditor();
  const type = event.target.closest?.("[data-v2-type]");
  if (type) { activeType = type.dataset.v2Type || "all"; showArchive = false; return render(); }
  const archiveView = event.target.closest?.("[data-v2-archive-view]");
  if (archiveView) { showArchive = archiveView.dataset.v2ArchiveView === "true"; activeType = "all"; return render(); }
  const toggleArchive = event.target.closest?.("[data-v2-toggle-archive]");
  if (toggleArchive) { showArchive = !showArchive; return render(); }
  const row = rowFromEvent(event);
  if (!row) return;
  const collection = row.dataset.collection;
  const id = row.dataset.id;
  if (event.target.closest?.("[data-v2-edit]")) return openEditor(collection, id);
  if (event.target.closest?.("[data-v2-duplicate]")) return openEditor(collection, id, true);
  if (event.target.closest?.("[data-v2-archive]")) return archiveAction(collection, id, false);
  if (event.target.closest?.("[data-v2-restore]")) return archiveAction(collection, id, true);
}

function bindCard() {
  root?.querySelector("#opsV2Form")?.addEventListener("submit", submitEditor);
  root?.querySelector("#opsV2Search")?.addEventListener("input", (event) => {
    query = event.target.value;
    const list = root?.querySelector(".ops-v2-list");
    if (list) {
      const rows = visibleRows();
      list.innerHTML = rows.length ? rows.map(rowMarkup).join("") : `<div class="ops-v2-empty"><md-icon>search_off</md-icon><strong>검색 결과가 없습니다</strong><span>검색어 또는 필터를 바꿔보세요.</span></div>`;
    }
  });
  root?.querySelector("#opsV2TypeFilter")?.addEventListener("change", (event) => { activeType = event.target.value || "all"; render(); });
}

function patchQuickActions() {
  root?.querySelectorAll('[data-admin-action="new-announcement"]').forEach((button) => {
    if (button.dataset.v2Bound === "true") return;
    button.dataset.v2Bound = "true";
    button.addEventListener("click", () => {
      document.querySelector("[data-managed-editor]")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      setTimeout(() => openEditor("announcements"), 180);
    });
  });
}

function render() {
  renderQueued = false;
  const grid = root?.querySelector(".admin-grid");
  if (!grid) return;
  const currentDialog = root?.querySelector("#opsV2Dialog");
  if (currentDialog?.open) return;
  grid.querySelector("[data-managed-editor]")?.remove();
  grid.querySelector("[data-managed-archive-card]")?.remove();
  grid.insertAdjacentHTML("afterbegin", mainMarkup());
  bindCard();
  patchQuickActions();
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(render);
}

gateway.addEventListener("change", (event) => {
  snapshot = event.detail;
  queueRender();
});

root?.addEventListener("click", handleClick);
new MutationObserver(() => {
  patchQuickActions();
  if (!card()) queueRender();
}).observe(root, { childList: true, subtree: true });

queueRender();
