import {
  ROLE,
  canReportClassroomLayout,
  canSeeClassroomReporter,
  canViewClassroomLayout,
  corsHeaders,
  hasRole,
  isClassOperator,
  requireProfileOrLegacy,
} from "../../lib/class-accounts.mjs";
import { safeText } from "../../lib/class-operations.mjs";
import { appendOpsAudit, classUsers, document } from "../../lib/class-ops-store.mjs";
import { jsonBody, sendJson } from "../../lib/request.mjs";

function deny(message = "classroom-layout-access-denied") {
  throw Object.assign(new Error(message), { status: 403 });
}
function assertViewer(profile) { if (!canViewClassroomLayout(profile)) deny(); }
function assertReporter(profile) { if (!canReportClassroomLayout(profile)) deny("classroom-report-access-denied"); }
function assertOperator(profile) { if (!isClassOperator(profile)) deny("class-operator-required"); }

function validClassKey(value) {
  const match = /^([1-3])-(10|[1-9])$/.exec(String(value || ""));
  return match ? `${match[1]}-${Number(match[2])}` : "";
}
function targetClassKey(actor, requested = "") {
  const own = validClassKey(actor?.classKey);
  if (!hasRole(actor, ROLE.ADMIN)) {
    if (!own) deny("class-scope-required");
    return own;
  }
  const selected = validClassKey(requested) || own;
  if (!selected) throw Object.assign(new Error("target-class-required"), { status: 400 });
  return selected;
}
function integer(value, min, max, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}
function uid(value) { return safeText(value, 160).replace(/[^a-zA-Z0-9_-]/g, ""); }
function uidList(value, known, limit = 80) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value.slice(0, limit)) {
    const clean = uid(raw);
    if (!clean || (known.size && !known.has(clean)) || seen.has(clean)) continue;
    seen.add(clean); out.push(clean);
  }
  return out;
}
function seatList(value, known, limit = 100) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.slice(0, limit).map((raw) => {
    const clean = uid(raw);
    if (!clean || (known.size && !known.has(clean)) || seen.has(clean)) return "";
    seen.add(clean); return clean;
  });
}
function dateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function roleLabel(actor) {
  if (hasRole(actor, ROLE.ADMIN)) return "관리자";
  if (hasRole(actor, ROLE.TEACHER)) return "교사";
  if (hasRole(actor, ROLE.CLASS_PRESIDENT)) return "회장";
  if (hasRole(actor, ROLE.CLASS_VICE_PRESIDENT)) return "부회장";
  if (hasRole(actor, ROLE.DEPARTMENT_HEAD)) return "부장";
  return "임원";
}
function nominations(value, known) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 200).map((item, index) => {
    const studentUid = uid(item?.studentUid);
    const partnerUid = uid(item?.partnerUid);
    if (!studentUid || (known.size && !known.has(studentUid))) return null;
    return {
      id: safeText(item?.id || `nom-${index}`, 100).replace(/[^a-zA-Z0-9_-]/g, "-") || `nom-${index}`,
      studentUid,
      reason: safeText(item?.reason || "기타", 100),
      partnerUid: partnerUid && partnerUid !== studentUid && (!known.size || known.has(partnerUid)) ? partnerUid : "",
      note: safeText(item?.note, 180),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(item?.date || "")) ? String(item.date) : "",
      proposerUid: uid(item?.proposerUid),
      proposerName: safeText(item?.proposerName, 40),
      proposerRole: safeText(item?.proposerRole, 40),
    };
  }).filter(Boolean);
}
function displaySettings(value = {}) {
  return {
    message: safeText(value?.message || "면학 분위기를 위해 조용히 이동해주세요.", 180),
    idleSeconds: integer(value?.idleSeconds, 3, 120, 12),
    stepSeconds: integer(value?.stepSeconds, 2, 20, 5),
  };
}
function normalizeLayout(value, rosterUids = []) {
  const input = value && typeof value === "object" ? value : {};
  const known = new Set(rosterUids);
  const general = input.general && typeof input.general === "object" ? input.general : {};
  const groups = input.groups && typeof input.groups === "object" ? input.groups : {};
  const assessment = input.assessment && typeof input.assessment === "object" ? input.assessment : {};
  const groupCount = integer(groups.groupCount, 1, 12, 1);
  const sizes = Array.from({ length: groupCount }, (_, index) => integer(groups.sizes?.[index], 0, 12, 0));
  const members = Array.isArray(groups.members) ? groups.members.slice(0, groupCount).map((items) => uidList(items, known, 12)) : [];
  const separationPairs = Array.isArray(general.separationPairs)
    ? general.separationPairs.slice(0, 100).map((pair) => {
        if (!Array.isArray(pair) || pair.length < 2) return null;
        const a = uid(pair[0]), b = uid(pair[1]);
        return a && b && a !== b && (!known.size || (known.has(a) && known.has(b))) ? [a, b] : null;
      }).filter(Boolean) : [];
  const desks = Array.isArray(groups.desks) ? groups.desks.slice(0, 60).map((desk, index) => ({
    index: integer(desk?.index, 0, 99, index),
    group: integer(desk?.group, 1, groupCount, 1),
    rotation: [0, 90, 180, 270].includes(Number(desk?.rotation)) ? Number(desk.rotation) : 0,
  })) : [];
  return {
    schemaVersion: 2,
    mode: ["general", "groups", "assessment"].includes(input.mode) ? input.mode : "general",
    display: displaySettings(input.display),
    general: {
      rows: integer(general.rows, 3, 10, 6), cols: integer(general.cols, 3, 10, 6),
      seats: seatList(general.seats, known),
      blocked: Array.isArray(general.blocked) ? [...new Set(general.blocked.map((item) => integer(item, 0, 99, -1)).filter((item) => item >= 0))].slice(0, 30) : [],
      focusStudentIds: uidList(general.focusStudentIds, known, 60), separationPairs,
      nominations: nominations(general.nominations, known),
    },
    groups: { groupCount, sizes, members, deskRows: integer(groups.deskRows, 3, 10, 6), deskCols: integer(groups.deskCols, 3, 10, 6), desks },
    assessment: { lines: Number(assessment.lines) === 5 ? 5 : 6, seats: seatList(assessment.seats, known) },
  };
}
function publicLayout(layout, actor) {
  const copy = structuredClone(layout);
  if (!canSeeClassroomReporter(actor)) {
    copy.general.nominations = copy.general.nominations.map(({ proposerUid, proposerName, proposerRole, ...rest }) => rest);
  }
  return copy;
}
function auditLayout(layout) {
  const copy = structuredClone(layout || {});
  if (copy?.general) copy.general.nominations = (copy.general.nominations || []).map(({ proposerUid, proposerName, proposerRole, ...rest }) => rest);
  return copy;
}
async function context(actor, requestedClassKey) {
  const classKey = targetClassKey(actor, requestedClassKey);
  const [users, snapshot] = await Promise.all([classUsers(classKey), document("classroomLayouts", classKey).get()]);
  const roster = users.map((student) => ({ uid: student.uid, name: student.name, number: student.number, studentNumber: student.studentNumber || "" }));
  const saved = snapshot.exists ? snapshot.data() : {};
  const layout = normalizeLayout(saved.classroomLayout, roster.map((student) => student.uid));
  return { classKey, roster, saved, layout };
}
async function view(actor, requestedClassKey) {
  assertViewer(actor);
  const { classKey, roster, saved, layout } = await context(actor, requestedClassKey);
  return {
    classKey, roster, classroomLayout: publicLayout(layout, actor),
    permissions: { canEdit: isClassOperator(actor), canReport: canReportClassroomLayout(actor), canSeeReporter: canSeeClassroomReporter(actor) },
    updatedAtMs: Number(saved.updatedAtMs || 0), updatedByName: safeText(saved.updatedByName, 40),
  };
}
async function persist(actor, classKey, roster, beforeRaw, layout, action) {
  const ref = document("classroomLayouts", classKey);
  const after = { schemaVersion: 2, classKey, classroomLayout: normalizeLayout(layout, roster.map((student) => student.uid)), updatedAtMs: Date.now(), updatedByUid: actor.uid, updatedByName: safeText(actor.name, 40) };
  await ref.set(after, { merge: false });
  await appendOpsAudit({ actor: { ...actor, classKey }, action, collectionName: "classroomLayouts", recordId: classKey, before: beforeRaw ? { ...beforeRaw, classroomLayout: auditLayout(beforeRaw.classroomLayout) } : null, after: { ...after, classroomLayout: auditLayout(after.classroomLayout) } });
  return after;
}
async function save(actor, body) {
  assertOperator(actor);
  const { classKey, roster, saved, layout: previousLayout } = await context(actor, body.classKey);
  const incoming = normalizeLayout(body.classroomLayout, roster.map((student) => student.uid));
  incoming.general.nominations = previousLayout.general.nominations;
  if (!body?.classroomLayout?.display) incoming.display = previousLayout.display;
  const after = await persist(actor, classKey, roster, saved, incoming, "CLASSROOM_LAYOUT_UPDATE");
  return { classKey, classroomLayout: publicLayout(after.classroomLayout, actor), updatedAtMs: after.updatedAtMs };
}
async function addNomination(actor, body) {
  assertReporter(actor);
  const { classKey, roster, saved, layout } = await context(actor, body.classKey);
  const known = new Set(roster.map((student) => student.uid));
  const studentUid = uid(body.studentUid), partnerUid = uid(body.partnerUid);
  if (!studentUid || !known.has(studentUid)) throw Object.assign(new Error("student-required"), { status: 400 });
  if (partnerUid && (partnerUid === studentUid || !known.has(partnerUid))) throw Object.assign(new Error("invalid-partner"), { status: 400 });
  layout.general.nominations.push({
    id: `nom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    studentUid, partnerUid: partnerUid || "", reason: safeText(body.reason || "기타", 100), note: safeText(body.note, 180), date: dateKey(),
    proposerUid: actor.uid, proposerName: safeText(actor.name, 40), proposerRole: roleLabel(actor),
  });
  const after = await persist(actor, classKey, roster, saved, layout, "CLASSROOM_NOMINATION_ADD");
  return { classKey, classroomLayout: publicLayout(after.classroomLayout, actor) };
}
async function removeNomination(actor, body) {
  assertOperator(actor);
  const { classKey, roster, saved, layout } = await context(actor, body.classKey);
  const id = safeText(body.nominationId, 100);
  layout.general.nominations = layout.general.nominations.filter((item) => item.id !== id);
  const after = await persist(actor, classKey, roster, saved, layout, "CLASSROOM_NOMINATION_REMOVE");
  return { classKey, classroomLayout: publicLayout(after.classroomLayout, actor) };
}
async function setDisplay(actor, body) {
  assertOperator(actor);
  const { classKey, roster, saved, layout } = await context(actor, body.classKey);
  layout.display = displaySettings(body.display);
  const after = await persist(actor, classKey, roster, saved, layout, "CLASSROOM_DISPLAY_UPDATE");
  return { classKey, classroomLayout: publicLayout(after.classroomLayout, actor) };
}

export default async function classroomLayout(req, res) {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return sendJson(res, 204, {}, headers);
  try {
    const { profile: actor } = await requireProfileOrLegacy(req);
    if (req.method === "GET") {
      const url = new URL(req.url || "/", "https://pincon.invalid");
      return sendJson(res, 200, await view(actor, url.searchParams.get("classKey") || ""), headers);
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "method-not-allowed" }, headers);
    const body = await jsonBody(req);
    const action = String(body.action || "").toUpperCase();
    let result;
    if (action === "SAVE") result = await save(actor, body);
    else if (action === "ADD_NOMINATION") result = await addNomination(actor, body);
    else if (action === "REMOVE_NOMINATION") result = await removeNomination(actor, body);
    else if (action === "SET_DISPLAY") result = await setDisplay(actor, body);
    else throw Object.assign(new Error("unsupported-action"), { status: 400 });
    return sendJson(res, 200, result, headers);
  } catch (error) {
    return sendJson(res, error?.status || 500, { error: error?.message || "classroom-layout-failed" }, headers);
  }
}
