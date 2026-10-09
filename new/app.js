import { NextDataGateway, readClassProfile, saveClassProfile } from "../next/core/data-gateway.js";
import { ContentServiceV2 } from "../next/admin/content-service-v2.js?v=20261009-upload2";
import { coverflowMarkup, mountCoverflow } from "../next/assessments/coverflow.js?v=20261009-motion2";
import { mountAttachmentViewer } from "../next/assessments/viewer.js?v=20261009-motion2";

import { ATTACHMENT_ACCEPT } from "../next/assessments/attachments.js?v=20261009-upload2";

import { prepareDialog, openDialog, closeDialog, revealDialogContent } from "../next/assessments/dialog-motion.js?v=20261009-motion2";

const $ = id => document.getElementById(id);
const escape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
if (!readClassProfile()) saveClassProfile(1, 8);
const gateway = new NextDataGateway(), service = new ContentServiceV2(gateway);
let signature = "", detailId = "", detailTrigger = null, saving = false, editing = false;
prepareDialog($("details"), () => !saving);
prepareDialog($("preferences"));
const record = id => (gateway.snapshot().data?.classAssignments || []).find(row => row.id === id && !row.deleted);

function render() {
  const snapshot = gateway.snapshot();
  const rows = (snapshot.data?.classAssignments || []).filter(row => !row.deleted && row.published !== false && (!row.type || row.type === "assessment") && (!row.classKey || row.classKey === snapshot.profile?.classKey))
    .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"))
    .map(row => ({ ...row, detailKey: row.id, kind: row.evaluationMethod || "수행평가" }));
  const next = JSON.stringify([snapshot.profile?.classKey, rows]);
  if (next !== signature) {
    signature = next;
    $("covers").innerHTML = coverflowMarkup(rows, snapshot.profile?.classKey || "");
    mountCoverflow($("covers"), openDetail);
  }
  $("add").hidden = !snapshot.canArchiveContent;
  $("connection").hidden = !snapshot.error && !snapshot.usingCache;
  $("connection").textContent = snapshot.error ? "연결을 확인해 주세요. 설정에서 다시 연결할 수 있어요." : "저장된 자료를 보고 있어요.";
  if (!editing && $("details").open && $("details").dataset.dialogMotion !== "closing") {
    const row = record(detailId);
    if (row && row.published !== false) fillDetail(row);
    else closeDialog($("details"));
  }
  updateAccount();
}

function fillDetail(row) {
  $("details").innerHTML = `<header><h1 id="detail-title">${escape(row.title)}</h1><button type="button" data-close aria-label="닫기">×</button></header><div class="dialog-body">
    <p class="detail-meta">${escape(row.subject || "수행평가")} · ${escape(row.evaluationMethod || "수행평가")} · ${escape(row.dueDate || "날짜 미정")}</p>
    <p class="detail-description">${escape(row.description || "등록된 상세 내용이 없습니다.")}</p>
    ${row.evaluationRange ? `<p><strong>평가 범위</strong><br>${escape(row.evaluationRange)}</p>` : ""}
    ${row.materials ? `<p><strong>준비물</strong><br>${escape(row.materials)}</p>` : ""}
    <div class="attachments">${[["noticeAttachment", "안내문"], ["worksheetPack", "학습지팩"]].filter(([slot]) => (row[slot]?.storagePath || row[slot]?.fileId)).map(([slot, label]) => `<button type="button" class="pc-attachment-button" data-assessment-file="${slot}" data-assessment-id="${escape(row.id)}">${label} · ${escape(row[slot].fileName)}</button>`).join("") || '<p class="muted">등록된 안내문이나 학습지팩이 없습니다.</p>'}</div>
    ${gateway.snapshot().canArchiveContent ? '<div class="dialog-actions"><button type="button" id="edit">내용·첨부 수정</button></div>' : ""}</div>`;
}

function openDetail(id, trigger) {
  const row = record(id);
  if (!row || row.published === false) return;
  detailId = id; detailTrigger = trigger; editing = false;
  fillDetail(row);
  openDialog($("details"));
}

function openEditor(id = "") {
  if (!gateway.snapshot().canArchiveContent || saving) return;
  detailId = id || crypto.randomUUID(); editing = true;
  const wasOpen = $("details").open;
  const row = record(id) || {};
  $("details").innerHTML = `<header><h1 id="detail-title">${id ? "수행평가 수정" : "수행평가 추가"}</h1><button type="button" data-close aria-label="닫기">×</button></header><form id="editor-form" class="dialog-body">
    <label>수행평가 이름<input name="title" maxlength="120" value="${escape(row.title)}" required></label>
    <div class="fields"><label>과목<input name="subject" maxlength="40" value="${escape(row.subject)}" required></label><label>평가 방식<input name="evaluationMethod" maxlength="500" value="${escape(row.evaluationMethod)}" placeholder="보고서, 발표, 서·논술형"></label></div>
    <label>마감일<input name="dueDate" type="date" min="2000-01-01" max="2100-12-31" value="${escape(row.dueDate)}"></label>
    <label>상세 내용<textarea name="description" rows="5" maxlength="1200">${escape(row.description)}</textarea></label>
    <label>평가 범위<textarea name="evaluationRange" rows="2" maxlength="600">${escape(row.evaluationRange)}</textarea></label>
    <label>준비물<input name="materials" maxlength="500" value="${escape(row.materials)}"></label>
    <div class="attachments"><fieldset><legend>첨부 자료</legend>
      <label>안내문 · PDF 또는 이미지 · 10MB 이하<input name="noticeFile" type="file" accept="${ATTACHMENT_ACCEPT}"><small>${escape(row.noticeAttachment?.fileName || "PDF 또는 이미지 파일을 선택해 주세요.")}</small></label>
      ${row.noticeAttachment ? '<label class="check"><input name="removeNotice" type="checkbox">기존 안내문 첨부 해제</label>' : ""}
      <label>학습지팩 · PDF 또는 이미지 · 10MB 이하<input name="packFile" type="file" accept="${ATTACHMENT_ACCEPT}"><small>${escape(row.worksheetPack?.fileName || "PDF 또는 이미지 파일을 선택해 주세요.")}</small></label>
      ${row.worksheetPack ? '<label class="check"><input name="removePack" type="checkbox">기존 학습지팩 첨부 해제</label>' : ""}
      <label class="check"><input name="fileConfirmed" type="checkbox">파일 공유 권한과 개인정보 제거를 확인함</label>
      <small>저장을 누르면 업로드돼요. 파일을 선택하지 않으면 기존 첨부가 유지돼요.</small>
    </fieldset></div>
    <label class="check"><input name="published" type="checkbox" ${row.published !== false ? "checked" : ""}>학생에게 공개</label>
    <p id="save-status" role="status"></p><div class="dialog-actions"><button type="button" data-close>취소</button><button type="submit" class="primary">저장</button></div></form>`;
  openDialog($("details"));
  if (wasOpen) revealDialogContent($("details"));
}

$("details").addEventListener("click", event => {
  if (event.target.closest("[data-close]") && !saving) closeDialog($("details"));
  if (event.target.closest("#edit")) openEditor(detailId);
});
$("details").addEventListener("close", () => {
  if ($("details").open) return;
  editing = false;
  const target = detailTrigger?.isConnected ? detailTrigger : $("covers").querySelector('.pc-cover[aria-pressed="true"]');
  target?.focus({ preventScroll: true });
});
$("details").addEventListener("submit", async event => {
  event.preventDefault();
  if (saving || event.target.id !== "editor-form") return;
  const form = event.target, data = new FormData(form), current = record(detailId) || {};
  saving = true;
  form.querySelectorAll("button,input,textarea,select").forEach(control => control.disabled = true);
  $("details").querySelector("[data-close]").disabled = true;
  $("save-status").className = "";
  $("save-status").textContent = "연결과 파일을 확인하는 중…";
  try {
    const values = { ...current, type: "assessment", published: data.has("published") };
    for (const key of ["title", "subject", "evaluationMethod", "dueDate", "description", "evaluationRange", "materials"]) values[key] = data.get(key) || "";
    const result = await service.save("classAssignments", values, { id: detailId, noticeFile: form.elements.noticeFile.files[0] || null, packFile: form.elements.packFile.files[0] || null, removeNotice: data.has("removeNotice"), removePack: data.has("removePack"), fileConfirmed: data.has("fileConfirmed"), onProgress: progress => {
      $("save-status").textContent = progress.phase === "upload" ? `${progress.fileName} · 업로드 ${Math.round(progress.transferred / progress.totalBytes * 100)}%` : progress.phase === "save" ? "업로드 완료 · 수행평가 내용을 저장하는 중…" : "서버 저장을 확인하는 중…";
    } });
    // Keep the just-verified record visible while the realtime listener catches up.
    const rows = gateway.state.data.classAssignments || [];
    gateway.state.data.classAssignments = [...rows.filter(row => row.id !== result.id), { ...result.record, id: result.id }];
    closeDialog($("details"));
    render();
  } catch (error) {
    $("save-status").textContent = error?.message || "저장하지 못했어요. 다시 시도해 주세요.";
    $("save-status").className = "error";
  } finally {
    saving = false;
    form.querySelectorAll("button,input,textarea,select").forEach(control => control.disabled = false);
    $("details").querySelector("[data-close]").disabled = false;
  }
});
$("add").onclick = () => { detailTrigger = $("add"); openEditor(); };

const classForm = $("class-form");
classForm.elements.classNumber.innerHTML = Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}">${i + 1}반</option>`).join("");
function updateAccount() {
  const snapshot = gateway.snapshot(), signedIn = Boolean(snapshot.user && !snapshot.user.isAnonymous);
  $("account-status").textContent = `${snapshot.profile?.grade || 1}학년 ${snapshot.profile?.classNumber || 8}반 · ${snapshot.canArchiveContent ? "관리자 · 내용과 첨부를 수정할 수 있어요." : signedIn ? "로그인됨" : "로그인하면 첨부 파일을 볼 수 있어요."}`;
  $("login-form").hidden = signedIn;
  $("google-login").hidden = signedIn;
  $("logout").hidden = !signedIn;
}
$("settings").onclick = () => {
  const profile = gateway.snapshot().profile;
  classForm.elements.grade.value = profile.grade;
  classForm.elements.classNumber.value = profile.classNumber;
  updateAccount(); openDialog($("preferences"));
};
$("preferences").querySelector("[data-close]").onclick = () => closeDialog($("preferences"));
classForm.onsubmit = async event => {
  event.preventDefault();
  saveClassProfile(classForm.elements.grade.value, classForm.elements.classNumber.value);
  closeDialog($("preferences"));
  await gateway.retry();
};
async function accountAction(action, refresh = true) {
  const controls = $("preferences").querySelectorAll("button,input,select");
  controls.forEach(control => control.disabled = true);
  $("preferences-status").textContent = "계정을 확인하는 중…";
  try { await action(); if (refresh) await gateway.retry(); $("preferences-status").textContent = "완료됐어요."; }
  catch (error) { $("preferences-status").textContent = error?.message || "로그인을 완료하지 못했어요."; }
  finally { controls.forEach(control => control.disabled = false); $("login-form").elements.pin.value = ""; updateAccount(); }
}
$("login-form").onsubmit = event => {
  event.preventDefault();
  const form = event.target;
  accountAction(async () => {
    const { signInStudent, signOutStudent } = await import("../next/core/student-auth.js");
    const session = await signInStudent({ studentNumber: form.elements.studentNumber.value, pin: form.elements.pin.value });
    if (session.account.mustChangePin) { await signOutStudent(); throw new Error("PinCon 로그인 화면에서 첫 PIN 설정을 완료해 주세요."); }
    saveClassProfile(session.account.grade, session.account.classNumber);
  });
};
$("google-login").onclick = () => accountAction(async () => {
  await import("../pincon-guest-auth.js");
  await globalThis.PINCON_GUEST_AUTH.signInWithGoogleAndSync();
});
$("logout").onclick = () => accountAction(async () => { const { signOutStudent } = await import("../next/core/student-auth.js"); await signOutStudent(); });
$("retry").onclick = () => accountAction(() => gateway.retry(), false);
mountAttachmentViewer(gateway);
gateway.addEventListener("change", render);
render();
gateway.start().catch(() => render());
