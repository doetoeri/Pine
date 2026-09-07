import { NextDataGateway, readClassProfile } from "./core/data-gateway.js";
import { cleanText, kstDate, subjectKey, validDate } from "./core/school-life.js";

const SCHOOL = globalThis.PINCON_SCHOOL_CONFIG || { id: "gochon-high" };
const gateway = new NextDataGateway();
let snapshot = gateway.snapshot();
let classMaterials = [];
let personalMaterials = [];
let listenerKey = "";
let stops = [];

function profile() { return snapshot.profile || readClassProfile(); }
function account() { return globalThis.PINCON_ACCOUNT?.account || null; }
function hasAccountRole(role) { return Array.isArray(account()?.roles) && account().roles.includes(role); }
function roleInClass() {
  const key = profile()?.classKey || "";
  const role = snapshot.role;
  if (!role?.enabled || !key) return false;
  if (role.level === "school") return true;
  return Array.isArray(role.classKeys) && role.classKeys.includes(key);
}
function canManageClass() {
  if (snapshot.canArchiveContent || snapshot.canManageContent) return true;
  if (!roleInClass()) return false;
  return ["class", "grade", "president"].includes(snapshot.role?.level)
    || ["CLASS_PRESIDENT", "CLASS_VICE_PRESIDENT", "TEACHER", "ADMIN"].some(hasAccountRole);
}
function managedSubjectKeys() {
  const keys = new Set(Array.isArray(snapshot.role?.subjectKeys) ? snapshot.role.subjectKeys.map(subjectKey) : []);
  for (const item of account()?.subjectRoles || []) {
    const key = subjectKey(item?.subject || "");
    if (key) keys.add(key);
  }
  return keys;
}
function canManageSubject(subject) {
  if (canManageClass()) return true;
  if (!roleInClass() || !hasAccountRole("SUBJECT_MANAGER")) return false;
  return managedSubjectKeys().has(subjectKey(subject));
}
function active(rows) { return (rows || []).filter((item) => item && item.deleted !== true); }
function esc(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function toast(message) {
  const node = document.createElement("div");
  node.className = "school-life__toast";
  node.textContent = cleanText(message, 180);
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2400);
}
function subjectNames() {
  const names = new Set();
  for (const table of active(snapshot.data?.neisTimetables)) for (const period of table.periods || []) if (period?.subject) names.add(cleanText(period.subject, 60));
  for (const item of active(snapshot.data?.classAssignments)) if (item.subject) names.add(cleanText(item.subject, 60));
  for (const item of account()?.subjectRoles || []) if (item.subject) names.add(cleanText(item.subject, 60));
  return [...names].filter(Boolean).sort((a, b) => a.localeCompare(b, "ko"));
}
function allowedCommonSubjects() {
  return subjectNames().filter((subject) => canManageSubject(subject));
}
function optionList(selected = "", onlyManaged = false) {
  const names = onlyManaged ? allowedCommonSubjects() : subjectNames();
  if (selected && !names.includes(selected)) names.unshift(selected);
  return names.map((name) => `<option value="${esc(name)}" ${name === selected ? "selected" : ""}>${esc(name)}</option>`).join("");
}
function actorLabel() {
  const name = cleanText(account()?.name || snapshot.user?.displayName || "", 40);
  return {
    display: name ? `${name.slice(0, 1)}○○` : "학급 운영자",
    role: canManageClass() ? "학급 운영" : "과목부장",
  };
}
function dialogShell(title, body) {
  document.getElementById("schoolLifeEditorDialog")?.remove();
  const dialog = document.createElement("dialog");
  dialog.id = "schoolLifeEditorDialog";
  dialog.className = "school-life__dialog";
  dialog.innerHTML = `<form class="school-life__dialog-form"><h2>${esc(title)}</h2>${body}<div class="school-life__dialog-actions"><button type="button" class="school-life__button" data-editor-cancel>취소</button><button type="submit" class="school-life__button school-life__button--primary">저장</button></div></form>`;
  document.body.appendChild(dialog);
  dialog.querySelector("[data-editor-cancel]")?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
  return dialog;
}
function materialScopeFields(record = {}) {
  const mode = record.recurrence === "subject-default" ? "subject-default" : (Number(record.period || 0) ? "date-period" : "date");
  return `<label class="school-life__field"><span>적용 범위</span><select name="applyMode"><option value="subject-default" ${mode === "subject-default" ? "selected" : ""}>모든 해당 과목 수업</option><option value="date" ${mode === "date" ? "selected" : ""}>특정 날짜</option><option value="date-period" ${mode === "date-period" ? "selected" : ""}>특정 날짜 + 특정 교시</option></select></label><label class="school-life__field" data-date-field><span>날짜</span><input type="date" name="date" value="${esc(record.date || kstDate())}"></label><label class="school-life__field" data-period-field><span>교시</span><select name="period">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${Number(record.period || 1) === i + 1 ? "selected" : ""}>${i + 1}교시</option>`).join("")}</select></label>`;
}
function syncMaterialFields(dialog) {
  const mode = dialog.querySelector('[name="applyMode"]')?.value;
  const dateField = dialog.querySelector("[data-date-field]");
  const periodField = dialog.querySelector("[data-period-field]");
  if (dateField) dateField.hidden = mode === "subject-default";
  if (periodField) periodField.hidden = mode !== "date-period";
}
function openMaterialEditor(record = null, source = "") {
  const editing = Boolean(record?.id);
  const isPersonal = editing ? source === "personal" : true;
  const commonAllowed = canManageClass() || allowedCommonSubjects().length > 0;
  const selectedSubject = cleanText(record?.subject || subjectNames()[0] || "", 60);
  const target = editing ? (isPersonal ? "personal" : record.scope || "class") : "personal";
  const body = `<label class="school-life__field"><span>과목</span><select name="subject" required>${optionList(selectedSubject, editing && !isPersonal)}</select></label>${materialScopeFields(record || {})}<label class="school-life__field"><span>준비물</span><input name="title" maxlength="80" required value="${esc(record?.title || "")}" placeholder="예: 이어폰"></label><label class="school-life__field"><span>대상</span><select name="target" ${editing ? "disabled" : ""}><option value="personal" ${target === "personal" ? "selected" : ""}>나만</option>${commonAllowed ? `<option value="class" ${target === "class" ? "selected" : ""}>학급 전체</option><option value="subject" ${target === "subject" ? "selected" : ""}>특정 과목</option>` : ""}</select></label>`;
  const dialog = dialogShell(editing ? "준비물 수정" : "준비물 추가", body);
  dialog.dataset.recordId = record?.id || "";
  dialog.dataset.recordSource = source || "";
  dialog.querySelector('[name="applyMode"]')?.addEventListener("change", () => syncMaterialFields(dialog));
  syncMaterialFields(dialog);
  dialog.querySelector("form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await saveMaterial(Object.fromEntries(new FormData(event.currentTarget)), record, source);
      dialog.close();
      toast(editing ? "준비물을 수정했습니다." : "준비물을 저장했습니다.");
    } catch (error) { toast(error?.message || "준비물을 저장하지 못했습니다."); }
  });
}
function editDistanceAtMostOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else { i += 1; j += 1; }
  }
  if (i < a.length || j < b.length) edits += 1;
  return edits <= 1;
}
function materialChangeNeedsPush(before, after) {
  if (!before) return false;
  if (["subject", "date", "period", "recurrence", "scope", "deleted"].some((key) => String(before[key] ?? "") !== String(after[key] ?? ""))) return true;
  const oldTitle = cleanText(before.title, 80).replace(/\s+/g, "");
  const newTitle = cleanText(after.title, 80).replace(/\s+/g, "");
  return oldTitle !== newTitle && !editDistanceAtMostOne(oldTitle, newTitle);
}
async function saveMaterial(values, before = null, source = "") {
  if (!gateway.repository?.api) await gateway.start();
  const api = gateway.repository?.api;
  const user = snapshot.user;
  const p = profile();
  if (!api || !user?.uid || !p?.classKey) throw new Error("로그인과 데이터 연결을 확인해 주세요.");
  const title = cleanText(values.title, 80);
  const subject = cleanText(values.subject, 60);
  if (!title || !subject) throw new Error("과목과 준비물을 입력해 주세요.");
  const applyMode = values.applyMode || "date-period";
  const recurrence = applyMode === "subject-default" ? "subject-default" : "once";
  const date = recurrence === "subject-default" ? "" : cleanText(values.date, 10);
  const period = applyMode === "date-period" ? Number(values.period || 0) : 0;
  if (date && !validDate(date)) throw new Error("날짜를 확인해 주세요.");
  if (applyMode === "date-period" && (!Number.isInteger(period) || period < 1 || period > 12)) throw new Error("교시를 확인해 주세요.");
  const target = before ? (source === "personal" ? "personal" : before.scope || "class") : (values.target || "personal");
  const personal = target === "personal";
  if (!personal && !canManageSubject(subject)) throw new Error("이 과목의 공통 준비물을 관리할 권한이 없습니다.");
  const now = Date.now();
  const actor = actorLabel();
  const payload = {
    ...(before || {}), classKey: p.classKey, title, subject, subjectKey: subjectKey(subject), date, period, recurrence,
    scope: personal ? "personal" : (target === "subject" ? "subject" : "class"), ownerUid: personal ? user.uid : "",
    authorUid: before?.authorUid || user.uid, authorDisplay: personal ? "나" : (before?.authorDisplay || actor.display), authorRole: personal ? "개인" : (before?.authorRole || actor.role),
    deleted: false, createdAtMs: Number(before?.createdAtMs || now), updatedAtMs: now,
    createdAt: before?.createdAt || api.serverTimestamp(), updatedAt: api.serverTimestamp(),
  };
  if (personal) {
    const ref = before?.id ? api.doc(api.db, "schools", SCHOOL.id, "schoolLifeUsers", user.uid, "materials", before.id) : api.doc(api.collection(api.db, "schools", SCHOOL.id, "schoolLifeUsers", user.uid, "materials"));
    await api.setDoc(ref, payload, { merge: false });
    return;
  }
  const ref = before?.id ? api.doc(api.db, "schools", SCHOOL.id, "lessonMaterials", before.id) : api.doc(api.collection(api.db, "schools", SCHOOL.id, "lessonMaterials"));
  const batch = api.writeBatch(api.db);
  batch.set(ref, payload, { merge: false });
  addAudit(batch, api, user, p.classKey, "lessonMaterials", ref.id, before ? "update" : "create", before, payload, `${subject} · ${title}`);
  if (materialChangeNeedsPush(before, payload)) addMaterialEvent(batch, api, user, p.classKey, ref.id, before, payload);
  await batch.commit();
}
function addAudit(batch, api, user, classKey, collection, documentId, action, before, after, label) {
  const ref = api.doc(api.collection(api.db, "schools", SCHOOL.id, "changeLogs"));
  batch.set(ref, { classKey, collection, documentId, action, label: cleanText(label, 120), before: before || null, after: after || null, actorUid: user.uid, actorName: actorLabel().display, createdAtMs: Date.now(), createdAt: api.serverTimestamp() });
}
function addMaterialEvent(batch, api, user, classKey, relatedId, before, after) {
  const ref = api.doc(api.collection(api.db, "schools", SCHOOL.id, "notificationEvents"));
  const deleted = after.deleted === true;
  const body = deleted ? `${after.subject} · ${after.title} 준비물이 삭제됐어요.` : `${after.subject} · ${cleanText(before?.title, 80)} → ${after.title}`;
  batch.set(ref, { type: "MATERIAL_REMINDER", classKey, subjectKey: after.subjectKey, audience: "class", targetUserIds: [], date: after.date || "", period: Number(after.period || 0), title: "준비물이 변경됐어요", body, relatedId, status: "pending", createdBy: user.uid, createdAtMs: Date.now(), createdAt: api.serverTimestamp(), sentAtMs: 0 });
}
async function deleteMaterial(record, source) {
  if (!record?.id) return;
  if (!gateway.repository?.api) await gateway.start();
  const api = gateway.repository?.api;
  const user = snapshot.user;
  const p = profile();
  if (!api || !user?.uid || !p?.classKey) return;
  const personal = source === "personal";
  if (!personal && !canManageSubject(record.subject)) throw new Error("이 준비물을 삭제할 권한이 없습니다.");
  const payload = { ...record, deleted: true, updatedAtMs: Date.now(), updatedAt: api.serverTimestamp() };
  const ref = personal ? api.doc(api.db, "schools", SCHOOL.id, "schoolLifeUsers", user.uid, "materials", record.id) : api.doc(api.db, "schools", SCHOOL.id, "lessonMaterials", record.id);
  if (personal) return api.setDoc(ref, payload, { merge: false });
  const batch = api.writeBatch(api.db);
  batch.set(ref, payload, { merge: false });
  addAudit(batch, api, user, p.classKey, "lessonMaterials", record.id, "delete", record, payload, `${record.subject} · ${record.title}`);
  addMaterialEvent(batch, api, user, p.classKey, record.id, record, payload);
  await batch.commit();
}
function openAssessmentEditor(record = null) {
  const selected = cleanText(record?.subject || allowedCommonSubjects()[0] || subjectNames()[0] || "", 60);
  if (!selected || !canManageSubject(selected)) { toast("관리 가능한 과목이 없습니다."); return; }
  const body = `<label class="school-life__field"><span>과목</span><select name="subject" required>${optionList(selected, true)}</select></label><label class="school-life__field"><span>날짜</span><input type="date" name="date" required value="${esc(record?.dueDate || kstDate())}"></label><label class="school-life__field"><span>교시</span><select name="period">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${Number(record?.period || 1) === i + 1 ? "selected" : ""}>${i + 1}교시</option>`).join("")}</select></label><label class="school-life__field"><span>제목</span><input name="title" maxlength="120" required value="${esc(record?.title || "")}" placeholder="예: 공통수학2 수행평가"></label><label class="school-life__field"><span>준비물</span><input name="materials" maxlength="500" value="${esc(record?.materials || "")}" placeholder="예: 계산기, 보고서"></label><label class="school-life__field"><span>설명</span><textarea name="description" maxlength="1200">${esc(record?.description || "")}</textarea></label>`;
  const dialog = dialogShell(record ? "수행평가 수정" : "수행평가 추가", body);
  dialog.querySelector("form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try { await saveAssessment(Object.fromEntries(new FormData(event.currentTarget)), record); dialog.close(); toast(record ? "수행평가를 수정했습니다." : "수행평가를 저장했습니다."); }
    catch (error) { toast(error?.message || "수행평가를 저장하지 못했습니다."); }
  });
}
async function saveAssessment(values, before = null) {
  if (!gateway.repository?.api) await gateway.start();
  const api = gateway.repository?.api;
  const user = snapshot.user;
  const p = profile();
  const subject = cleanText(values.subject, 60), title = cleanText(values.title, 120), date = cleanText(values.date, 10), period = Number(values.period || 0);
  if (!api || !user?.uid || !p?.classKey) throw new Error("로그인과 데이터 연결을 확인해 주세요.");
  if (!subject || !title || !validDate(date) || period < 1 || period > 12) throw new Error("과목, 날짜, 교시, 제목을 확인해 주세요.");
  if (!canManageSubject(subject)) throw new Error("이 과목의 수행평가를 관리할 권한이 없습니다.");
  const materialItems = String(values.materials || "").split(/[,\n·]+/).map((item) => cleanText(item, 80)).filter(Boolean).slice(0, 12);
  const now = Date.now();
  const payload = { ...(before || {}), classKey: p.classKey, type: "assessment", title, subject, subjectKey: subjectKey(subject), period, dueDate: date, dueAtMs: Date.parse(`${date}T23:59:00+09:00`), description: cleanText(values.description, 1200), dateType: "exact", evaluationRange: before?.evaluationRange || "", evaluationMethod: before?.evaluationMethod || "", materials: materialItems.join(", "), materialItems, points: before?.points || "", evaluationPlanId: before?.evaluationPlanId || "", pageReferences: before?.pageReferences || "", verificationStatus: "verified", confirmed: true, changed: Boolean(before), published: true, announcedDate: before?.announcedDate || kstDate(), recoveryRelevant: true, createdBy: before?.createdBy || user.uid, deleted: false, createdAtMs: Number(before?.createdAtMs || now), updatedAtMs: now, createdAt: before?.createdAt || api.serverTimestamp(), updatedAt: api.serverTimestamp() };
  const ref = before?.id ? api.doc(api.db, "schools", SCHOOL.id, "classAssignments", before.id) : api.doc(api.collection(api.db, "schools", SCHOOL.id, "classAssignments"));
  const batch = api.writeBatch(api.db);
  batch.set(ref, payload, { merge: false });
  addAudit(batch, api, user, p.classKey, "classAssignments", ref.id, before ? "update" : "create", before, payload, `${subject} · ${title}`);
  await batch.commit();
}
async function deleteAssessment(record) {
  if (!record?.id || !canManageSubject(record.subject)) throw new Error("이 수행평가를 삭제할 권한이 없습니다.");
  if (!gateway.repository?.api) await gateway.start();
  const api = gateway.repository?.api, user = snapshot.user, p = profile();
  const payload = { ...record, deleted: true, updatedAtMs: Date.now(), updatedAt: api.serverTimestamp() };
  const ref = api.doc(api.db, "schools", SCHOOL.id, "classAssignments", record.id);
  const batch = api.writeBatch(api.db);
  batch.set(ref, payload, { merge: false });
  addAudit(batch, api, user, p.classKey, "classAssignments", record.id, "delete", record, payload, `${record.subject} · ${record.title}`);
  await batch.commit();
}
function managementRows() {
  const personal = active(personalMaterials).map((item) => ({ ...item, source: "personal" }));
  const common = active(classMaterials).filter((item) => canManageSubject(item.subject)).map((item) => ({ ...item, source: "common" }));
  const assessments = active(snapshot.data?.classAssignments).filter((item) => ["assessment", "exam"].includes(item.type || "assessment") && canManageSubject(item.subject));
  return { materials: [...personal, ...common], assessments };
}
function mountManagement() {
  const host = document.querySelector('#schoolLifeAssistant[data-school-life-route="more"] .school-life__surface');
  if (!host) return;
  let node = document.getElementById("schoolLifeManagement");
  if (!node) { node = document.createElement("section"); node.id = "schoolLifeManagement"; node.className = "school-life__lesson"; host.appendChild(node); }
  const { materials, assessments } = managementRows();
  const materialHtml = materials.slice(0, 40).map((item) => `<div class="school-life__setting-row"><div><strong>${esc(item.title)}</strong><div class="school-life__meta">${esc(item.subject || "과목 미정")} · ${item.recurrence === "subject-default" ? "매 수업" : `${esc(item.date || "날짜 미정")}${item.period ? ` · ${item.period}교시` : ""}`}${item.source === "common" && item.authorDisplay ? ` · ${esc(item.authorDisplay)} ${esc(item.authorRole || "")}` : ""}</div></div><div class="school-life__actions"><button type="button" class="school-life__button" data-material-edit="${esc(item.id)}" data-material-source="${item.source}">수정</button><button type="button" class="school-life__button" data-material-delete="${esc(item.id)}" data-material-source="${item.source}">삭제</button></div></div>`).join("");
  const assessmentHtml = assessments.slice(0, 30).map((item) => `<div class="school-life__setting-row"><div><strong>${esc(item.title)}</strong><div class="school-life__meta">${esc(item.subject)} · ${esc(item.dueDate || "날짜 미정")}${item.period ? ` · ${item.period}교시` : ""}</div></div><div class="school-life__actions"><button type="button" class="school-life__button" data-assessment-edit="${esc(item.id)}">수정</button><button type="button" class="school-life__button" data-assessment-delete="${esc(item.id)}">삭제</button></div></div>`).join("");
  node.innerHTML = `<div><p class="school-life__eyebrow">학교생활 데이터</p><h3>준비물 관리</h3></div><div class="school-life__settings">${materialHtml || '<p class="school-life__empty">관리할 준비물이 없습니다.</p>'}</div>${canManageClass() || allowedCommonSubjects().length ? `<div style="margin-top:18px"><p class="school-life__eyebrow">평가</p><h3>수행평가 관리</h3></div><div class="school-life__settings">${assessmentHtml || '<p class="school-life__empty">관리할 수행평가가 없습니다.</p>'}</div>` : ""}`;
}
async function connect() {
  const p = profile(), user = snapshot.user, api = gateway.repository?.api;
  if (!p?.classKey || !user?.uid || !api) return;
  const key = `${p.classKey}:${user.uid}`;
  if (key === listenerKey) return;
  stops.splice(0).forEach((stop) => { try { stop(); } catch {} });
  listenerKey = key;
  stops.push(api.onSnapshot(api.query(api.collection(api.db, "schools", SCHOOL.id, "lessonMaterials"), api.where("classKey", "==", p.classKey), api.limit(300)), (value) => { classMaterials = value.docs.map((doc) => ({ id: doc.id, ...doc.data() })); mountManagement(); }, () => {}));
  stops.push(api.onSnapshot(api.collection(api.db, "schools", SCHOOL.id, "schoolLifeUsers", user.uid, "materials"), (value) => { personalMaterials = value.docs.map((doc) => ({ id: doc.id, ...doc.data() })); mountManagement(); }, () => {}));
}
function findMaterial(id, source) { return (source === "personal" ? personalMaterials : classMaterials).find((item) => item.id === id); }
function findAssessment(id) { return (snapshot.data?.classAssignments || []).find((item) => item.id === id); }

document.addEventListener("click", (event) => {
  const addMaterial = event.target.closest?.("[data-add-material]");
  if (addMaterial) { event.preventDefault(); event.stopImmediatePropagation(); openMaterialEditor(); return; }
  const addAssessment = event.target.closest?.("[data-add-assessment]");
  if (addAssessment) { event.preventDefault(); event.stopImmediatePropagation(); openAssessmentEditor(); return; }
  const editMaterial = event.target.closest?.("[data-material-edit]");
  if (editMaterial) { openMaterialEditor(findMaterial(editMaterial.dataset.materialEdit, editMaterial.dataset.materialSource), editMaterial.dataset.materialSource); return; }
  const deleteMaterialButton = event.target.closest?.("[data-material-delete]");
  if (deleteMaterialButton) { const item = findMaterial(deleteMaterialButton.dataset.materialDelete, deleteMaterialButton.dataset.materialSource); if (item && confirm(`'${item.title}' 준비물을 삭제할까요?`)) deleteMaterial(item, deleteMaterialButton.dataset.materialSource).then(() => toast("준비물을 삭제했습니다.")).catch((error) => toast(error?.message || "삭제하지 못했습니다.")); return; }
  const editAssessment = event.target.closest?.("[data-assessment-edit]");
  if (editAssessment) { openAssessmentEditor(findAssessment(editAssessment.dataset.assessmentEdit)); return; }
  const deleteAssessmentButton = event.target.closest?.("[data-assessment-delete]");
  if (deleteAssessmentButton) { const item = findAssessment(deleteAssessmentButton.dataset.assessmentDelete); if (item && confirm(`'${item.title}' 수행평가를 삭제할까요?`)) deleteAssessment(item).then(() => toast("수행평가를 삭제했습니다.")).catch((error) => toast(error?.message || "삭제하지 못했습니다.")); }
}, true);

gateway.addEventListener("change", (event) => { snapshot = event.detail; connect().catch(() => {}); requestAnimationFrame(mountManagement); });
await gateway.start().catch(() => null);
snapshot = gateway.snapshot();
await connect().catch(() => {});
new MutationObserver(() => requestAnimationFrame(mountManagement)).observe(document.documentElement, { childList: true, subtree: true });
mountManagement();
