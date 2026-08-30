import { NextDataGateway } from "../core/data-gateway.js";

const root = document.querySelector("#adminApp");
const gateway = new NextDataGateway();
let snapshot = gateway.snapshot();
let renderQueued = false;
let saving = false;

const EDITABLE = Object.freeze({
  announcements: { label: "공지", icon: "campaign" },
  classAssignments: { label: "수행·숙제", icon: "assignment" },
  evaluationPlans: { label: "평가계획서", icon: "picture_as_pdf" },
  events: { label: "학급 행사", icon: "celebration" },
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setText(node, value) {
  const next = String(value ?? "");
  if (node && node.textContent !== next) node.textContent = next;
}

function dateValue(value) {
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function localToday() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function itemTitle(item) {
  return item?.title || item?.name || item?.subject || item?.id || "제목 없음";
}

function itemSupport(collection, item) {
  if (collection === "announcements") {
    return [item.priority === "urgent" ? "긴급" : item.priority === "important" ? "중요" : "일반", item.body].filter(Boolean).join(" · ");
  }
  if (collection === "classAssignments") {
    return [item.subject, item.dueDate || "날짜 미정", item.type, item.verificationStatus].filter(Boolean).join(" · ");
  }
  if (collection === "evaluationPlans") {
    return [item.subject, `${item.schoolYear || "-"}학년도 ${item.semester || "-"}학기`, item.status].filter(Boolean).join(" · ");
  }
  if (collection === "events") {
    return [item.date, item.status, item.question].filter(Boolean).join(" · ");
  }
  return "";
}

function activeRows(collection) {
  return (snapshot.data?.[collection] || []).filter((item) => item && item.deleted !== true);
}

function archivedRows() {
  const rows = [];
  for (const collection of Object.keys(EDITABLE)) {
    for (const item of snapshot.data?.[collection] || []) {
      if (item?.deleted === true) rows.push({ collection, item });
    }
  }
  return rows.sort((a, b) => Number(b.item.updatedAtMs || 0) - Number(a.item.updatedAtMs || 0));
}

function rowMarkup(collection, item) {
  const config = EDITABLE[collection];
  return `<div class="managed-editor-row">
    <div class="managed-editor-row__copy">
      <strong>${escapeHtml(itemTitle(item))}</strong>
      <span>${escapeHtml(itemSupport(collection, item) || config.label)}</span>
    </div>
    <div class="managed-editor-row__actions">
      <md-text-button data-managed-edit="${collection}" data-record-id="${escapeHtml(item.id)}"><md-icon slot="icon">edit</md-icon>수정</md-text-button>
      <md-text-button data-managed-archive="${collection}" data-record-id="${escapeHtml(item.id)}"><md-icon slot="icon">archive</md-icon>보관</md-text-button>
    </div>
  </div>`;
}

function sectionMarkup(collection) {
  const config = EDITABLE[collection];
  const rows = activeRows(collection);
  return `<section class="managed-editor-section" aria-labelledby="managed-${collection}-title">
    <div class="managed-editor-section__head">
      <h3 id="managed-${collection}-title"><md-icon>${config.icon}</md-icon> ${config.label}</h3>
      <md-filled-tonal-button data-managed-create="${collection}"><md-icon slot="icon">add</md-icon>새 ${config.label}</md-filled-tonal-button>
    </div>
    <div class="managed-editor-list">
      ${rows.length ? rows.slice(0, 40).map((item) => rowMarkup(collection, item)).join("") : `<div class="managed-editor-empty">아직 등록된 ${config.label} 항목이 없습니다.</div>`}
    </div>
  </section>`;
}

function archiveMarkup() {
  const rows = archivedRows();
  return `<section class="admin-card admin-card--wide" data-managed-archive-card aria-labelledby="managed-archive-title">
    <div class="admin-card__header">
      <h2 id="managed-archive-title">보관함 · 복원</h2>
      <span class="admin-meta">영구 삭제 없음</span>
    </div>
    ${rows.length ? `<div class="managed-editor-list">${rows.slice(0, 50).map(({ collection, item }) => `<div class="managed-editor-row">
      <div class="managed-editor-row__copy"><strong>${escapeHtml(itemTitle(item))}</strong><span>${escapeHtml(`${EDITABLE[collection].label} · 보관됨`)}</span></div>
      <div class="managed-editor-row__actions"><md-outlined-button data-managed-restore="${collection}" data-record-id="${escapeHtml(item.id)}"><md-icon slot="icon">restore</md-icon>복원</md-outlined-button></div>
    </div>`).join("")}</div>` : `<div class="managed-editor-empty">보관된 공지·수행·평가계획서·행사가 없습니다.</div>`}
  </section>`;
}

function cardMarkup() {
  const allowed = Boolean(snapshot.canManageContent);
  const roleNote = allowed
    ? "저장하면 학생 화면에 실시간 반영되고, 생성·수정·보관·복원 기록이 changeLogs에 남습니다. 평가계획서는 먼저 한 번 등록한 뒤 여러 수행평가에 재사용할 수 있습니다."
    : "현재 계정은 production Firestore의 학급 운영 권한과 일치하지 않아 편집할 수 없습니다.";
  return `<section class="admin-card admin-card--wide" data-managed-editor aria-labelledby="managed-editor-title">
    <div class="admin-card__header">
      <h2 id="managed-editor-title">학급 콘텐츠 편집</h2>
      <span class="beta-badge ${allowed ? "admin-write-enabled" : ""}">${allowed ? "WRITE ENABLED" : "READ ONLY"}</span>
    </div>
    <div class="admin-status ${allowed ? "admin-write-enabled" : "admin-status--denied"}" role="status"><md-icon>${allowed ? "edit_square" : "lock"}</md-icon><p>${escapeHtml(roleNote)}</p></div>
    ${allowed ? `<div class="managed-editor-stack">${Object.keys(EDITABLE).map(sectionMarkup).join("")}</div>` : ""}
    <p class="managed-editor-status" id="managedEditorStatus" role="status"></p>
    ${editorDialogMarkup()}
    ${archiveDialogMarkup()}
  </section>`;
}

function selectOptions(options, selected) {
  return options.map(([value, label]) => `<md-select-option value="${value}" ${value === selected ? "selected" : ""}><div slot="headline">${label}</div></md-select-option>`).join("");
}

function planOptions(selected) {
  const rows = activeRows("evaluationPlans").filter((item) => item.status !== "draft");
  return selectOptions([
    ["", "연결하지 않음"],
    ...rows.map((item) => [item.id, `${item.subject || "과목 미정"} · ${item.title || "평가계획서"}`]),
  ], selected || "");
}

function nativeCheckbox(id, label, checked = false) {
  return `<label class="managed-native-check" for="${id}"><input id="${id}" type="checkbox" ${checked ? "checked" : ""}><span>${escapeHtml(label)}</span></label>`;
}

function fieldsMarkup(collection, item = {}) {
  if (collection === "announcements") {
    return `<md-outlined-text-field id="managedTitle" label="공지 제목" value="${escapeHtml(item.title || "")}" maxlength="100" required></md-outlined-text-field>
      <md-outlined-text-field id="managedBody" label="내용" type="textarea" rows="5" value="${escapeHtml(item.body || "")}" maxlength="1800"></md-outlined-text-field>
      <md-outlined-select id="managedPriority" label="중요도" value="${escapeHtml(item.priority || "normal")}">${selectOptions([["normal","일반"],["important","중요"],["urgent","긴급"]], item.priority || "normal")}</md-outlined-select>`;
  }

  if (collection === "classAssignments") {
    return `<md-outlined-text-field id="managedTitle" label="제목" value="${escapeHtml(item.title || "")}" maxlength="120" required></md-outlined-text-field>
      <md-outlined-text-field id="managedSubject" label="과목" value="${escapeHtml(item.subject || "")}" maxlength="40"></md-outlined-text-field>
      <md-outlined-select id="managedType" label="종류" value="${escapeHtml(item.type || "assessment")}">${selectOptions([["assessment","수행평가"],["exam","시험"],["preparation","준비물·숙제"]], item.type || "assessment")}</md-outlined-select>
      <md-outlined-select id="managedDateType" label="날짜 확정 상태" value="${escapeHtml(item.dateType || (item.dueDate ? "exact" : "undecided"))}">${selectOptions([["exact","정확한 날짜"],["range","기간형"],["month","월 중 예정"],["undecided","날짜 미정"]], item.dateType || (item.dueDate ? "exact" : "undecided"))}</md-outlined-select>
      <md-outlined-text-field id="managedDueDate" label="마감 날짜 · 확정된 경우만" type="date" value="${escapeHtml(dateValue(item.dueDate))}"></md-outlined-text-field>
      <md-outlined-text-field id="managedEvaluationRange" label="평가 범위" value="${escapeHtml(item.evaluationRange || "")}" maxlength="600"></md-outlined-text-field>
      <md-outlined-text-field id="managedEvaluationMethod" label="평가 방식" value="${escapeHtml(item.evaluationMethod || "")}" maxlength="500"></md-outlined-text-field>
      <md-outlined-text-field id="managedMaterials" label="준비물·제출물" value="${escapeHtml(item.materials || "")}" maxlength="500"></md-outlined-text-field>
      <md-outlined-text-field id="managedPoints" label="배점·반영 비율" value="${escapeHtml(item.points || "")}" maxlength="120"></md-outlined-text-field>
      <md-outlined-select id="managedEvaluationPlanId" label="연결할 평가계획서" value="${escapeHtml(item.evaluationPlanId || "")}">${planOptions(item.evaluationPlanId)}</md-outlined-select>
      <md-outlined-text-field id="managedPageReferences" label="관련 페이지 · 예: 4~6쪽" value="${escapeHtml(item.pageReferences || "")}" maxlength="120"></md-outlined-text-field>
      <md-outlined-select id="managedVerificationStatus" label="확인 상태" value="${escapeHtml(item.verificationStatus || "review")}">${selectOptions([["hidden","표시 안 함"],["review","확인 중"],["verified","공식 자료 확인"],["changed","수업 중 변경됨"]], item.verificationStatus || "review")}</md-outlined-select>
      <md-outlined-text-field id="managedAnnouncedDate" label="학생에게 안내된 날짜" type="date" value="${escapeHtml(dateValue(item.announcedDate) || localToday())}"></md-outlined-text-field>
      <md-outlined-text-field id="managedDescription" label="학생용 요약" type="textarea" rows="4" value="${escapeHtml(item.description || "")}" maxlength="1200"></md-outlined-text-field>
      ${nativeCheckbox("managedPublished", "학생 화면에 공개", item.published !== false)}
      ${nativeCheckbox("managedRecoveryRelevant", "안내 날짜의 결석자 복귀팩에 포함", item.recoveryRelevant !== false)}`;
  }

  if (collection === "evaluationPlans") {
    return `<md-outlined-text-field id="managedTitle" label="평가계획서 제목" value="${escapeHtml(item.title || "")}" maxlength="140" required></md-outlined-text-field>
      <md-outlined-text-field id="managedSubject" label="과목" value="${escapeHtml(item.subject || "")}" maxlength="40" required></md-outlined-text-field>
      <div class="managed-editor-split">
        <md-outlined-text-field id="managedSchoolYear" label="학년도" type="number" value="${escapeHtml(item.schoolYear || new Date().getFullYear())}"></md-outlined-text-field>
        <md-outlined-select id="managedSemester" label="학기" value="${escapeHtml(String(item.semester || 2))}">${selectOptions([["1","1학기"],["2","2학기"]], String(item.semester || 2))}</md-outlined-select>
      </div>
      <md-outlined-select id="managedPlanStatus" label="검토 상태" value="${escapeHtml(item.status || "review")}">${selectOptions([["draft","초안 · 학생에게 숨김"],["review","담당자 확인 중"],["verified","원본 확인 완료"]], item.status || "review")}</md-outlined-select>
      <md-outlined-text-field id="managedSourceUrl" label="학교 홈페이지 원문 링크 · 선택" type="url" value="${escapeHtml(item.sourceUrl || "")}" maxlength="1200"></md-outlined-text-field>
      <label class="managed-file-field" for="managedPlanFile"><span>PDF 파일 · 10MB 이하</span><input id="managedPlanFile" type="file" accept="application/pdf,.pdf"><small>${escapeHtml(item.fileName ? `현재 파일: ${item.fileName}` : "PDF 또는 원문 링크 중 하나는 필요합니다.")}</small></label>
      <md-outlined-text-field id="managedSourceAttribution" label="출처" value="${escapeHtml(item.sourceAttribution || "고촌고등학교 평가계획서")}" maxlength="300"></md-outlined-text-field>
      <md-outlined-text-field id="managedPageCount" label="전체 페이지 수 · 선택" type="number" value="${escapeHtml(item.pageCount || 0)}"></md-outlined-text-field>
      <md-outlined-text-field id="managedPlanAnnouncedDate" label="학생에게 공개한 날짜" type="date" value="${escapeHtml(dateValue(item.announcedDate) || localToday())}"></md-outlined-text-field>
      <md-outlined-text-field id="managedDescription" label="설명" type="textarea" rows="3" value="${escapeHtml(item.description || "")}" maxlength="1000"></md-outlined-text-field>
      ${nativeCheckbox("managedPlanRecoveryRelevant", "공개 날짜의 결석자 복귀팩에 포함", item.recoveryRelevant !== false)}
      ${nativeCheckbox("managedPlanFileConfirmed", "학급 내 공유 권한을 확인했고 개인정보가 없는 문서입니다", false)}`;
  }

  return `<md-outlined-text-field id="managedTitle" label="행사 제목" value="${escapeHtml(item.title || "")}" maxlength="120" required></md-outlined-text-field>
    <md-outlined-text-field id="managedQuestion" label="질문 또는 행사 설명" type="textarea" rows="4" value="${escapeHtml(item.question || "")}" maxlength="500" required></md-outlined-text-field>
    <md-outlined-text-field id="managedDate" label="행사 날짜" type="date" value="${escapeHtml(dateValue(item.date))}"></md-outlined-text-field>
    <md-outlined-select id="managedKind" label="행사 형식" value="${escapeHtml(item.kind || "survey34")}">${selectOptions([["survey34","우리 반 34명에게 물었습니다"],["family-arcade","가족오락관"],["quiz","퀴즈"],["balance","밸런스 게임"],["class-vote","학급 투표"],["survey","설문"],["mini-game","미니게임"]], item.kind || "survey34")}</md-outlined-select>
    <md-outlined-select id="managedStatus" label="상태" value="${escapeHtml(item.status || "draft")}">${selectOptions([["draft","초안"],["open","진행 중"],["closed","종료"]], item.status || "draft")}</md-outlined-select>`;
}

function editorDialogMarkup() {
  return `<md-dialog id="managedEditorDialog">
    <div slot="headline" id="managedEditorHeadline">콘텐츠 편집</div>
    <div slot="content"><form class="managed-editor-dialog-form" id="managedEditorForm"></form><p class="managed-editor-status" id="managedDialogStatus" role="status"></p></div>
    <div slot="actions"><md-text-button id="managedEditorCancel">취소</md-text-button><md-filled-button id="managedEditorSave"><md-icon slot="icon">save</md-icon>저장</md-filled-button></div>
  </md-dialog>`;
}

function archiveDialogMarkup() {
  return `<md-dialog id="managedArchiveDialog">
    <div slot="headline">항목을 보관할까요?</div>
    <div slot="content"><p>영구 삭제하지 않습니다. 보관 후 관리자 화면에서 다시 복원할 수 있고 변경 기록도 남습니다.</p><p class="managed-editor-status" id="managedArchiveStatus" role="status"></p></div>
    <div slot="actions"><md-text-button id="managedArchiveCancel">취소</md-text-button><md-filled-tonal-button id="managedArchiveConfirm"><md-icon slot="icon">archive</md-icon>보관</md-filled-tonal-button></div>
  </md-dialog>`;
}

function findRecord(collection, id) {
  return (snapshot.data?.[collection] || []).find((item) => item.id === id) || null;
}

function openEditor(collection, id = "") {
  const dialog = root?.querySelector("#managedEditorDialog");
  const form = root?.querySelector("#managedEditorForm");
  const headline = root?.querySelector("#managedEditorHeadline");
  const status = root?.querySelector("#managedDialogStatus");
  if (!dialog || !form || !EDITABLE[collection]) return;
  const item = id ? findRecord(collection, id) : {};
  if (id && !item) return;
  dialog.dataset.collection = collection;
  dialog.dataset.recordId = id;
  dialog.dataset.startsAtMs = String(item?.startsAtMs || "");
  setText(headline, `${id ? "수정" : "새로 만들기"} · ${EDITABLE[collection].label}`);
  form.innerHTML = fieldsMarkup(collection, item || {});
  if (status) { setText(status, ""); status.dataset.kind = ""; }
  dialog.show?.();
  requestAnimationFrame(() => form.querySelector("md-outlined-text-field")?.focus?.());
}

function fieldValue(id) {
  return root?.querySelector(`#${id}`)?.value ?? "";
}

function fieldChecked(id) {
  return root?.querySelector(`#${id}`)?.checked === true;
}

function valuesFromDialog(dialog) {
  const collection = dialog.dataset.collection;
  const current = dialog.dataset.recordId ? findRecord(collection, dialog.dataset.recordId) : null;
  if (collection === "announcements") {
    return { title: fieldValue("managedTitle"), body: fieldValue("managedBody"), priority: fieldValue("managedPriority") };
  }
  if (collection === "classAssignments") {
    return {
      title: fieldValue("managedTitle"), subject: fieldValue("managedSubject"), type: fieldValue("managedType"),
      dateType: fieldValue("managedDateType"), dueDate: fieldValue("managedDueDate"),
      evaluationRange: fieldValue("managedEvaluationRange"), evaluationMethod: fieldValue("managedEvaluationMethod"),
      materials: fieldValue("managedMaterials"), points: fieldValue("managedPoints"),
      evaluationPlanId: fieldValue("managedEvaluationPlanId"), pageReferences: fieldValue("managedPageReferences"),
      verificationStatus: fieldValue("managedVerificationStatus"), announcedDate: fieldValue("managedAnnouncedDate"),
      description: fieldValue("managedDescription"), published: fieldChecked("managedPublished"),
      recoveryRelevant: fieldChecked("managedRecoveryRelevant"),
    };
  }
  if (collection === "evaluationPlans") {
    return {
      title: fieldValue("managedTitle"), subject: fieldValue("managedSubject"),
      schoolYear: fieldValue("managedSchoolYear"), semester: fieldValue("managedSemester"),
      status: fieldValue("managedPlanStatus"), sourceUrl: fieldValue("managedSourceUrl"),
      sourceAttribution: fieldValue("managedSourceAttribution"), pageCount: fieldValue("managedPageCount"),
      announcedDate: fieldValue("managedPlanAnnouncedDate"), description: fieldValue("managedDescription"),
      recoveryRelevant: fieldChecked("managedPlanRecoveryRelevant"),
    };
  }
  return {
    title: fieldValue("managedTitle"), question: fieldValue("managedQuestion"), date: fieldValue("managedDate"),
    kind: fieldValue("managedKind"), status: fieldValue("managedStatus"),
    startsAtMs: Number(dialog.dataset.startsAtMs || current?.startsAtMs || 0),
    resultsVisible: current?.resultsVisible === true,
    publishedResults: Array.isArray(current?.publishedResults) ? current.publishedResults : [],
  };
}

function setStatus(message, kind = "") {
  const status = root?.querySelector("#managedEditorStatus");
  if (!status) return;
  setText(status, message);
  status.dataset.kind = kind;
}

async function saveDialog() {
  const dialog = root?.querySelector("#managedEditorDialog");
  const save = root?.querySelector("#managedEditorSave");
  const status = root?.querySelector("#managedDialogStatus");
  if (!dialog || saving) return;
  saving = true;
  if (save) save.disabled = true;
  if (status) { setText(status, "서버에 저장하고 변경 기록을 남기는 중…"); status.dataset.kind = ""; }
  try {
    const file = dialog.dataset.collection === "evaluationPlans" ? root?.querySelector("#managedPlanFile")?.files?.[0] || null : null;
    await gateway.saveManagedRecord(dialog.dataset.collection, valuesFromDialog(dialog), {
      id: dialog.dataset.recordId || "",
      file,
      fileConfirmed: fieldChecked("managedPlanFileConfirmed"),
    });
    dialog.close?.();
    setStatus("저장되었습니다. 학생 화면에 실시간 반영됩니다.", "success");
  } catch (error) {
    if (status) { setText(status, error?.message || "저장하지 못했습니다."); status.dataset.kind = "error"; }
  } finally {
    saving = false;
    if (save) save.disabled = false;
  }
}

function openArchive(collection, id) {
  const dialog = root?.querySelector("#managedArchiveDialog");
  const status = root?.querySelector("#managedArchiveStatus");
  if (!dialog || !findRecord(collection, id)) return;
  dialog.dataset.collection = collection;
  dialog.dataset.recordId = id;
  if (status) { setText(status, ""); status.dataset.kind = ""; }
  dialog.show?.();
}

async function confirmArchive() {
  const dialog = root?.querySelector("#managedArchiveDialog");
  const button = root?.querySelector("#managedArchiveConfirm");
  const status = root?.querySelector("#managedArchiveStatus");
  if (!dialog || saving) return;
  saving = true;
  if (button) button.disabled = true;
  if (status) { setText(status, "보관하고 변경 기록을 남기는 중…"); status.dataset.kind = ""; }
  try {
    await gateway.archiveManagedRecord(dialog.dataset.collection, dialog.dataset.recordId);
    dialog.close?.();
    setStatus("보관했습니다. 필요하면 아래 보관함에서 복원할 수 있습니다.", "success");
  } catch (error) {
    if (status) { setText(status, error?.message || "보관하지 못했습니다."); status.dataset.kind = "error"; }
  } finally {
    saving = false;
    if (button) button.disabled = false;
  }
}

async function restoreRecord(collection, id, button) {
  if (saving) return;
  saving = true;
  if (button) button.disabled = true;
  try {
    await gateway.restoreManagedRecord(collection, id);
    setStatus("복원되었습니다.", "success");
  } catch (error) {
    setStatus(error?.message || "복원하지 못했습니다.", "error");
  } finally {
    saving = false;
    if (button) button.disabled = false;
  }
}

function patchBaseDashboard() {
  const allowed = Boolean(snapshot.canManageContent);
  const heroCopy = root?.querySelector(".admin-hero p:last-child");
  setText(heroCopy, allowed
    ? "학생 화면과 같은 데이터 원본을 사용합니다. 권한이 있는 학급 운영 계정은 공지·수행·평가계획서·행사를 실제로 편집할 수 있고 모든 변경이 기록됩니다."
    : "학생 화면과 같은 데이터 원본을 사용합니다. 현재 계정의 서버 권한을 확인한 뒤 허용된 경우에만 편집 기능이 열립니다.");

  const accessCard = root?.querySelector("#access-title")?.closest(".admin-card");
  if (accessCard) {
    const badge = accessCard.querySelector(".beta-badge");
    setText(badge, allowed ? "WRITE ENABLED" : "READ ONLY");
    badge?.classList.toggle("admin-write-enabled", allowed);

    const rows = accessCard.querySelectorAll(".admin-row");
    const writeRow = rows[2];
    if (writeRow) {
      const strong = writeRow.querySelector("strong");
      const support = writeRow.querySelector(".admin-row__main span");
      setText(strong, allowed ? "활성" : "잠김");
      setText(support, allowed
        ? "공지·수행·평가계획서·행사는 production 서버 권한과 변경 기록을 거쳐 저장됩니다."
        : "현재 계정은 서버의 학급 운영 권한 범위에 포함되지 않습니다.");
    }
  }

  const oldArchive = root?.querySelector("#archive-title")?.closest(".admin-card");
  if (oldArchive && !oldArchive.hidden) oldArchive.hidden = true;
}

function bindCard() {
  root?.querySelector("#managedEditorCancel")?.addEventListener("click", () => root.querySelector("#managedEditorDialog")?.close?.());
  root?.querySelector("#managedEditorSave")?.addEventListener("click", saveDialog);
  root?.querySelector("#managedArchiveCancel")?.addEventListener("click", () => root.querySelector("#managedArchiveDialog")?.close?.());
  root?.querySelector("#managedArchiveConfirm")?.addEventListener("click", confirmArchive);
}

function eventAction(event, attribute) {
  return event.composedPath?.().find((node) => node instanceof HTMLElement && node.hasAttribute(attribute)) || null;
}

function handleManagedAction(event) {
  const create = eventAction(event, "data-managed-create");
  if (create) return openEditor(create.dataset.managedCreate);
  const edit = eventAction(event, "data-managed-edit");
  if (edit) return openEditor(edit.dataset.managedEdit, edit.dataset.recordId);
  const archive = eventAction(event, "data-managed-archive");
  if (archive) return openArchive(archive.dataset.managedArchive, archive.dataset.recordId);
  const restore = eventAction(event, "data-managed-restore");
  if (restore) return restoreRecord(restore.dataset.managedRestore, restore.dataset.recordId, restore);
}

function render() {
  renderQueued = false;
  const grid = root?.querySelector(".admin-grid");
  if (!grid) return;
  patchBaseDashboard();
  const existing = grid.querySelector("[data-managed-editor]");
  if (existing) {
    if (root?.querySelector("#managedEditorDialog")?.open || root?.querySelector("#managedArchiveDialog")?.open) return;
    existing.remove();
    grid.querySelector("[data-managed-archive-card]")?.remove();
  }
  grid.insertAdjacentHTML("afterbegin", cardMarkup());
  if (snapshot.canManageContent) grid.insertAdjacentHTML("beforeend", archiveMarkup());
  bindCard();
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

const observer = new MutationObserver(() => queueRender());
if (root) observer.observe(root, { childList: true, subtree: true });
root?.addEventListener("click", handleManagedAction);
queueRender();
