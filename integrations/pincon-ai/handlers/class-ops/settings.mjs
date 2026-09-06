import {
  ROLE,
  corsHeaders,
  hasRole,
  isClassOperator,
  requireProfileOrLegacy,
} from "../../lib/class-accounts.mjs";
import { safeText } from "../../lib/class-operations.mjs";
import { appendOpsAudit, classSettings, classUsers, collection, document } from "../../lib/class-ops-store.mjs";
import { jsonBody, sendJson } from "../../lib/request.mjs";

function assertOperator(profile) {
  if (!isClassOperator(profile)) throw Object.assign(new Error("class-operator-required"), { status: 403 });
}

function validClassKey(value) {
  const match = /^([1-3])-(10|[1-9])$/.exec(String(value || ""));
  return match ? `${match[1]}-${Number(match[2])}` : "";
}

function targetClassKey(actor, requested = "") {
  const own = validClassKey(actor?.classKey);
  if (!hasRole(actor, ROLE.ADMIN)) {
    if (!own) throw Object.assign(new Error("class-scope-required"), { status: 403 });
    return own;
  }
  const selected = validClassKey(requested) || own;
  if (!selected) throw Object.assign(new Error("target-class-required"), { status: 400 });
  return selected;
}

function scopedId(classKey, raw, fallback) {
  const clean = safeText(raw, 100).replace(/[^a-zA-Z0-9가-힣_-]/g, "-");
  const base = clean || fallback;
  return base.startsWith(`${classKey}_`) ? base : `${classKey}_${base}`;
}

function normalizeExemptionPolicy(value, current = {}) {
  if (!value || typeof value !== "object") return current;
  const output = {};
  for (const [rawCode, entry] of Object.entries(value).slice(0, 12)) {
    const code = String(rawCode || "").toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 40);
    if (!code) continue;
    output[code] = {
      enabled: entry?.enabled !== false,
      label: safeText(entry?.label || code, 80),
    };
  }
  return Object.keys(output).length ? output : current;
}

function safeUid(value) {
  return safeText(value, 160).replace(/[^a-zA-Z0-9_-]/g, "");
}

function safeInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

function normalizeUidList(value, limit = 80) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(safeUid).filter(Boolean))].slice(0, limit);
}

function normalizeClassroomLayout(value, rosterUids = []) {
  const input = value && typeof value === "object" ? value : {};
  const known = new Set(rosterUids);
  const keepKnown = (uid) => !known.size || known.has(uid);
  const general = input.general && typeof input.general === "object" ? input.general : {};
  const groups = input.groups && typeof input.groups === "object" ? input.groups : {};
  const assessment = input.assessment && typeof input.assessment === "object" ? input.assessment : {};
  const groupCount = safeInteger(groups.groupCount, 1, 12, 1);
  const sizes = Array.from({ length: groupCount }, (_, index) => safeInteger(groups.sizes?.[index], 0, 12, 0));
  const pairs = Array.isArray(general.separationPairs)
    ? general.separationPairs.slice(0, 100).map((pair) => Array.isArray(pair) ? pair.map(safeUid).slice(0, 2) : []).filter((pair) => pair.length === 2 && pair[0] !== pair[1] && pair.every(keepKnown))
    : [];
  const members = Array.isArray(groups.members)
    ? groups.members.slice(0, groupCount).map((items) => normalizeUidList(items, 12).filter(keepKnown))
    : [];
  const desks = Array.isArray(groups.desks)
    ? groups.desks.slice(0, 60).map((desk, index) => ({
        index: safeInteger(desk?.index, 0, 99, index),
        group: safeInteger(desk?.group, 1, groupCount, 1),
        rotation: [0, 90, 180, 270].includes(Number(desk?.rotation)) ? Number(desk.rotation) : 0,
      }))
    : [];
  return {
    schemaVersion: 1,
    mode: ["general", "groups", "assessment"].includes(input.mode) ? input.mode : "general",
    general: {
      rows: safeInteger(general.rows, 3, 10, 6),
      cols: safeInteger(general.cols, 3, 10, 6),
      seats: normalizeUidList(general.seats, 60).filter(keepKnown),
      blocked: Array.isArray(general.blocked)
        ? [...new Set(general.blocked.map((item) => safeInteger(item, 0, 99, -1)).filter((item) => item >= 0))].slice(0, 30)
        : [],
      focusStudentIds: normalizeUidList(general.focusStudentIds, 60).filter(keepKnown),
      separationPairs: pairs,
    },
    groups: {
      groupCount,
      sizes,
      members,
      deskRows: safeInteger(groups.deskRows, 3, 10, 6),
      deskCols: safeInteger(groups.deskCols, 3, 10, 6),
      desks,
    },
    assessment: {
      lines: Number(assessment.lines) === 5 ? 5 : 6,
      seats: normalizeUidList(assessment.seats, 60).filter(keepKnown),
    },
  };
}

async function listRows(name, classKey, limit = 100) {
  const snapshot = await collection(name).where("classKey", "==", classKey).limit(limit).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function getView(actor, requestedClassKey) {
  assertOperator(actor);
  const classKey = targetClassKey(actor, requestedClassKey);
  const [settings, departments, onePersonRoles, roster] = await Promise.all([
    classSettings(classKey),
    listRows("classDepartments", classKey),
    listRows("onePersonRoles", classKey),
    classUsers(classKey),
  ]);
  return {
    classKey,
    settings,
    roster: roster.map((student) => ({ uid: student.uid, name: student.name, number: student.number, studentNumber: student.studentNumber || "" })),
    departments: departments.sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)),
    onePersonRoles: onePersonRoles.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ko")),
  };
}

async function updateSettings(actor, body) {
  assertOperator(actor);
  const classKey = targetClassKey(actor, body.classKey);
  const before = await classSettings(classKey);
  const phoneMovementPolicy = ["TAKE", "KEEP_IN_CLASSROOM"].includes(body.phoneMovementPolicy)
    ? body.phoneMovementPolicy
    : before.phoneMovementPolicy;
  const after = {
    schemaVersion: 1,
    classKey,
    phoneMovementPolicy,
    cleaningAutoAssignEnabled: body.cleaningAutoAssignEnabled !== false,
    cleaningExemptionPolicy: normalizeExemptionPolicy(body.cleaningExemptionPolicy, before.cleaningExemptionPolicy),
    updatedAtMs: Date.now(),
    updatedByUid: actor.uid,
    updatedByName: safeText(actor.name, 30),
  };
  await document("classOpsSettings", classKey).set(after, { merge: true });
  await appendOpsAudit({ actor: { ...actor, classKey }, action: "CLASS_OPS_SETTINGS_UPDATE", collectionName: "classOpsSettings", recordId: classKey, before, after });
  return after;
}

async function updateClassroomLayout(actor, body) {
  assertOperator(actor);
  const classKey = targetClassKey(actor, body.classKey);
  const [before, roster] = await Promise.all([classSettings(classKey), classUsers(classKey)]);
  const classroomLayout = normalizeClassroomLayout(body.classroomLayout, roster.map((student) => student.uid));
  const after = {
    schemaVersion: 1,
    classKey,
    classroomLayout,
    classroomLayoutUpdatedAtMs: Date.now(),
    classroomLayoutUpdatedByUid: actor.uid,
    classroomLayoutUpdatedByName: safeText(actor.name, 30),
  };
  await document("classOpsSettings", classKey).set(after, { merge: true });
  await appendOpsAudit({
    actor: { ...actor, classKey },
    action: "CLASSROOM_LAYOUT_UPDATE",
    collectionName: "classOpsSettings",
    recordId: classKey,
    before: { classKey, classroomLayout: before.classroomLayout || null },
    after,
  });
  return { classKey, classroomLayout };
}

async function upsertDepartment(actor, body) {
  assertOperator(actor);
  const classKey = targetClassKey(actor, body.classKey);
  const id = scopedId(classKey, body.id, collection("classDepartments").doc().id);
  const ref = document("classDepartments", id);
  const snapshot = await ref.get();
  const before = snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
  if (before && before.classKey !== classKey) throw Object.assign(new Error("class-scope-denied"), { status: 403 });
  const name = safeText(body.name, 60);
  if (!name) throw Object.assign(new Error("department-name-required"), { status: 400 });
  const after = {
    schemaVersion: 1,
    classKey,
    name,
    active: body.active !== false,
    sortOrder: Math.max(0, Math.min(100, Number(body.sortOrder || 0))),
    updatedAtMs: Date.now(),
    updatedByUid: actor.uid,
  };
  await ref.set(after, { merge: true });
  await appendOpsAudit({ actor: { ...actor, classKey }, action: "DEPARTMENT_UPSERT", collectionName: "classDepartments", recordId: id, before, after });
  return { id, ...after };
}

async function upsertOnePersonRole(actor, body) {
  assertOperator(actor);
  const classKey = targetClassKey(actor, body.classKey);
  const id = scopedId(classKey, body.id, collection("onePersonRoles").doc().id);
  const ref = document("onePersonRoles", id);
  const snapshot = await ref.get();
  const before = snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
  if (before && before.classKey !== classKey) throw Object.assign(new Error("class-scope-denied"), { status: 403 });
  const name = safeText(body.name, 100);
  if (!name) throw Object.assign(new Error("one-person-role-name-required"), { status: 400 });
  const timing = ["MORNING", "LUNCH", "CLEANING_TIME", "BEFORE_LEAVING", "WEEKLY"].includes(body.timing)
    ? body.timing
    : "WEEKLY";
  const allowedPermissions = new Set(["MANAGE_PHONE"]);
  const permissions = Array.isArray(body.permissions)
    ? [...new Set(body.permissions.map((item) => String(item || "").toUpperCase()).filter((item) => allowedPermissions.has(item)))]
    : [];
  const after = {
    schemaVersion: 1,
    classKey,
    name,
    description: safeText(body.description, 300),
    timing,
    permissions,
    active: body.active !== false,
    updatedAtMs: Date.now(),
    updatedByUid: actor.uid,
  };
  await ref.set(after, { merge: true });
  await appendOpsAudit({ actor: { ...actor, classKey }, action: "ONE_PERSON_ROLE_UPSERT", collectionName: "onePersonRoles", recordId: id, before, after });
  return { id, ...after };
}

export default async function settings(req, res) {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return sendJson(res, 204, {}, headers);
  try {
    const { profile: actor } = await requireProfileOrLegacy(req);
    if (req.method === "GET") {
      const url = new URL(req.url || "/", "https://pincon.invalid");
      return sendJson(res, 200, await getView(actor, url.searchParams.get("classKey") || ""), headers);
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "method-not-allowed" }, headers);
    const body = await jsonBody(req);
    const action = String(body.action || "").toUpperCase();
    let result;
    if (action === "UPDATE_SETTINGS") result = await updateSettings(actor, body);
    else if (action === "UPDATE_CLASSROOM_LAYOUT") result = await updateClassroomLayout(actor, body);
    else if (action === "UPSERT_DEPARTMENT") result = await upsertDepartment(actor, body);
    else if (action === "UPSERT_ONE_PERSON_ROLE") result = await upsertOnePersonRole(actor, body);
    else throw Object.assign(new Error("unsupported-action"), { status: 400 });
    return sendJson(res, 200, result, headers);
  } catch (error) {
    return sendJson(res, error?.status || 500, { error: error?.message || "settings-operation-failed" }, headers);
  }
}
