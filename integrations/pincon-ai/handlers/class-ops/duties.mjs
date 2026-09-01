import { firestore } from "../../lib/firebase.mjs";
import {
  ROLE,
  corsHeaders,
  hasRole,
  isClassOperator,
  publicProfile,
  requireProfileOrLegacy,
} from "../../lib/class-accounts.mjs";
import {
  dateKey,
  recommendCleaningCandidate,
  safeText,
} from "../../lib/class-operations.mjs";
import {
  activeExemptions,
  appendOpsAudit,
  assignmentId,
  classSettings,
  classUsers,
  cleaningAssignmentsForMonth,
  collection,
  document,
  phoneStates,
} from "../../lib/class-ops-store.mjs";
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
    if (requested && validClassKey(requested) && validClassKey(requested) !== own) {
      throw Object.assign(new Error("class-scope-denied"), { status: 403 });
    }
    return own;
  }
  const selected = validClassKey(requested) || own;
  if (!selected) throw Object.assign(new Error("target-class-required"), { status: 400 });
  return selected;
}

function scopedActor(actor, classKey) {
  return { ...actor, classKey };
}

function cleanDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : dateKey();
}

async function classRows(name, classKey, limit = 200) {
  const snapshot = await collection(name).where("classKey", "==", classKey).limit(limit).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function definitions(classKey) {
  const [departments, onePersonRoles] = await Promise.all([
    classRows("classDepartments", classKey, 100),
    classRows("onePersonRoles", classKey, 100),
  ]);
  return {
    departments: departments.sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)),
    onePersonRoles: onePersonRoles.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ko")),
  };
}

async function getDepartment(classKey, departmentId) {
  const id = safeText(departmentId, 100);
  if (!id) return null;
  const snapshot = await document("classDepartments", id).get();
  if (!snapshot.exists) return null;
  const value = { id: snapshot.id, ...snapshot.data() };
  return value.classKey === classKey && value.active !== false ? value : null;
}

async function getRole(classKey, roleId) {
  const id = safeText(roleId, 140);
  if (!id) return null;
  const snapshot = await document("onePersonRoles", id).get();
  if (!snapshot.exists) return null;
  const value = { id: snapshot.id, ...snapshot.data() };
  return value.classKey === classKey && value.active !== false ? value : null;
}

function cleaningStats(members, assignments) {
  const stats = new Map(members.map((member) => [member.uid, { count: 0, lastDate: "" }]));
  for (const assignment of assignments) {
    const stat = stats.get(assignment.assigneeUid);
    if (!stat || assignment.status === "EXEMPTED") continue;
    stat.count += 1;
    if (String(assignment.date || "") > stat.lastDate) stat.lastDate = String(assignment.date || "");
  }
  return members.map((member) => ({
    uid: member.uid,
    name: member.name,
    number: member.number,
    count: stats.get(member.uid)?.count || 0,
    lastDate: stats.get(member.uid)?.lastDate || "",
  }));
}

async function cleaningView(classKey, departmentId, date) {
  const department = await getDepartment(classKey, departmentId);
  if (!department) return null;
  const [members, assignments, requests] = await Promise.all([
    classUsers(classKey).then((rows) => rows.filter((item) => item.departmentId === department.id)),
    cleaningAssignmentsForMonth(classKey, department.id, date),
    classRows("cleaningRequests", classKey, 300),
  ]);
  return {
    department,
    members,
    todayAssignment: assignments.find((item) => item.date === date) || null,
    monthAssignments: assignments,
    memberStats: cleaningStats(members, assignments),
    pendingRequests: requests.filter((item) => item.departmentId === department.id && item.status === "PENDING"),
  };
}

async function fullView(actor, requestedClassKey, requestedDepartmentId = "", requestedDate = "") {
  assertOperator(actor);
  const classKey = targetClassKey(actor, requestedClassKey);
  const date = cleanDate(requestedDate);
  const [members, defs, settings] = await Promise.all([
    classUsers(classKey, { activeOnly: false }),
    definitions(classKey),
    classSettings(classKey),
  ]);
  const activeDepartments = defs.departments.filter((item) => item.active !== false);
  const departmentId = safeText(requestedDepartmentId, 100) || activeDepartments[0]?.id || "";
  const cleaning = departmentId ? await cleaningView(classKey, departmentId, date) : null;
  return { classKey, date, settings, members, ...defs, departmentId, cleaning };
}

async function setDepartmentMembers(actor, body) {
  assertOperator(actor);
  const classKey = targetClassKey(actor, body.classKey);
  const department = await getDepartment(classKey, body.departmentId);
  if (!department) throw Object.assign(new Error("department-not-found"), { status: 404 });
  const requested = [...new Set((Array.isArray(body.userUids) ? body.userUids : []).map((item) => safeText(item, 128)).filter(Boolean))].slice(0, 80);
  const members = await classUsers(classKey, { activeOnly: false });
  const byUid = new Map(members.map((item) => [item.uid, item]));
  if (requested.some((uid) => !byUid.has(uid))) throw Object.assign(new Error("invalid-department-member"), { status: 400 });
  const selected = new Set(requested);
  const changed = members.filter((member) => selected.has(member.uid) || member.departmentId === department.id)
    .filter((member) => (selected.has(member.uid) ? department.id : "") !== (member.departmentId || ""));
  const batch = firestore().batch();
  const now = Date.now();
  for (const member of changed) {
    batch.set(document("users", member.uid), {
      departmentId: selected.has(member.uid) ? department.id : "",
      updatedAtMs: now,
      updatedByUid: actor.uid,
    }, { merge: true });
  }
  if (changed.length) await batch.commit();
  await appendOpsAudit({
    actor: scopedActor(actor, classKey),
    action: "DEPARTMENT_MEMBERS_SET",
    collectionName: "users",
    recordId: department.id,
    before: { classKey, departmentId: department.id, memberUids: members.filter((item) => item.departmentId === department.id).map((item) => item.uid) },
    after: { classKey, departmentId: department.id, memberUids: requested },
  });
  return { departmentId: department.id, changed: changed.length };
}

async function assignOnePersonRole(actor, body) {
  assertOperator(actor);
  const classKey = targetClassKey(actor, body.classKey);
  const uid = safeText(body.userUid, 128);
  const roleId = safeText(body.roleId, 140);
  const members = await classUsers(classKey, { activeOnly: false });
  const target = members.find((item) => item.uid === uid);
  if (!target) throw Object.assign(new Error("user-not-found"), { status: 404 });
  if (roleId && !(await getRole(classKey, roleId))) throw Object.assign(new Error("one-person-role-not-found"), { status: 404 });

  const previousHolders = roleId ? members.filter((item) => item.uid !== uid && item.onePersonRoleId === roleId) : [];
  const batch = firestore().batch();
  const now = Date.now();
  for (const holder of previousHolders) {
    batch.set(document("users", holder.uid), { onePersonRoleId: "", updatedAtMs: now, updatedByUid: actor.uid }, { merge: true });
  }
  batch.set(document("users", uid), { onePersonRoleId: roleId, updatedAtMs: now, updatedByUid: actor.uid }, { merge: true });
  await batch.commit();
  await appendOpsAudit({
    actor: scopedActor(actor, classKey),
    action: roleId ? "ONE_PERSON_ROLE_ASSIGN" : "ONE_PERSON_ROLE_CLEAR",
    collectionName: "users",
    recordId: uid,
    before: target,
    after: { ...target, onePersonRoleId: roleId },
    note: previousHolders.length ? `${previousHolders.length}명의 기존 중복 배정을 해제했습니다.` : "",
  });
  return { userUid: uid, roleId, replacedUids: previousHolders.map((item) => item.uid) };
}

async function recommendation(classKey, departmentId, date, additionalExcluded = []) {
  const department = await getDepartment(classKey, departmentId);
  if (!department) throw Object.assign(new Error("department-not-found"), { status: 404 });
  const [members, assignments, exemptions, phones] = await Promise.all([
    classUsers(classKey).then((rows) => rows.filter((item) => item.departmentId === department.id)),
    cleaningAssignmentsForMonth(classKey, department.id, date),
    activeExemptions(classKey, date),
    phoneStates(classKey, date),
  ]);
  const excluded = new Set(additionalExcluded);
  for (const item of exemptions) excluded.add(item.userUid);
  for (const item of phones) if (item.status === "ABSENT") excluded.add(item.userUid);
  const latest = assignments
    .filter((item) => item.status !== "EXEMPTED" && item.assigneeUid)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0];
  const result = recommendCleaningCandidate(members, assignments, {
    lastAssigneeUid: latest?.assigneeUid || "",
    excludedUids: [...excluded],
  });
  if (!result) throw Object.assign(new Error("no-eligible-cleaning-candidate"), { status: 409 });
  return { department, members, assignments, result };
}

async function writeCleaningAssignment(actor, classKey, { departmentId, date, candidate, mode, reason }) {
  const id = assignmentId(classKey, departmentId, date);
  const ref = document("cleaningAssignments", id);
  const beforeSnapshot = await ref.get();
  const before = beforeSnapshot.exists ? { id: beforeSnapshot.id, ...beforeSnapshot.data() } : null;
  const now = Date.now();
  const after = {
    schemaVersion: 1,
    classKey,
    departmentId,
    date,
    task: "MOP",
    assigneeUid: candidate.uid,
    assigneeName: safeText(candidate.name, 30),
    assigneeNumber: Number(candidate.number || 0),
    status: "ASSIGNED",
    assignmentMode: mode,
    selectionReason: safeText(reason, 300),
    assignedByUid: actor.uid,
    assignedByName: safeText(actor.name, 30),
    acceptedAtMs: null,
    completedAtMs: null,
    createdAtMs: before?.createdAtMs || now,
    updatedAtMs: now,
  };
  await ref.set(after, { merge: false });
  await appendOpsAudit({
    actor: scopedActor(actor, classKey),
    action: mode === "AUTO_FAIR" ? "CLEANING_AUTO_ASSIGN" : "CLEANING_ASSIGN",
    collectionName: "cleaningAssignments",
    recordId: id,
    before,
    after,
  });
  return { id, ...after };
}

async function cleaningRecommend(actor, body) {
  assertOperator(actor);
  const classKey = targetClassKey(actor, body.classKey);
  const date = cleanDate(body.date);
  const { result } = await recommendation(classKey, body.departmentId, date);
  return {
    date,
    candidate: publicProfile(result.user),
    reason: result.reason,
    fairness: { monthlyCount: result.count, lastAssignedDate: result.lastDate || null, roleBurden: result.burden },
  };
}

async function cleaningAssign(actor, body, automatic) {
  assertOperator(actor);
  const classKey = targetClassKey(actor, body.classKey);
  const date = cleanDate(body.date);
  const department = await getDepartment(classKey, body.departmentId);
  if (!department) throw Object.assign(new Error("department-not-found"), { status: 404 });
  if (automatic) {
    const settings = await classSettings(classKey);
    if (settings.cleaningAutoAssignEnabled === false) throw Object.assign(new Error("automatic-assignment-disabled"), { status: 409 });
    const { result } = await recommendation(classKey, department.id, date, Array.isArray(body.excludedUids) ? body.excludedUids : []);
    return writeCleaningAssignment(actor, classKey, { departmentId: department.id, date, candidate: result.user, mode: "AUTO_FAIR", reason: result.reason });
  }
  const members = await classUsers(classKey);
  const candidate = members.find((item) => item.uid === safeText(body.assigneeUid, 128));
  if (!candidate || candidate.departmentId !== department.id) throw Object.assign(new Error("invalid-cleaning-assignee"), { status: 400 });
  return writeCleaningAssignment(actor, classKey, { departmentId: department.id, date, candidate, mode: "MANUAL", reason: "학급 운영자가 직접 확정했습니다." });
}

async function cleaningComplete(actor, body) {
  assertOperator(actor);
  const classKey = targetClassKey(actor, body.classKey);
  const date = cleanDate(body.date);
  const department = await getDepartment(classKey, body.departmentId);
  if (!department) throw Object.assign(new Error("department-not-found"), { status: 404 });
  const id = assignmentId(classKey, department.id, date);
  const ref = document("cleaningAssignments", id);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw Object.assign(new Error("cleaning-assignment-not-found"), { status: 404 });
  const before = { id: snapshot.id, ...snapshot.data() };
  const after = { ...before, status: "COMPLETED", completedAtMs: Date.now(), updatedAtMs: Date.now() };
  delete after.id;
  await ref.set(after, { merge: false });
  await appendOpsAudit({ actor: scopedActor(actor, classKey), action: "CLEANING_COMPLETE", collectionName: "cleaningAssignments", recordId: id, before, after });
  return { id, ...after };
}

async function cleaningClear(actor, body) {
  assertOperator(actor);
  const classKey = targetClassKey(actor, body.classKey);
  const date = cleanDate(body.date);
  const department = await getDepartment(classKey, body.departmentId);
  if (!department) throw Object.assign(new Error("department-not-found"), { status: 404 });
  const id = assignmentId(classKey, department.id, date);
  const ref = document("cleaningAssignments", id);
  const snapshot = await ref.get();
  if (!snapshot.exists) return { id, cleared: false };
  const before = { id: snapshot.id, ...snapshot.data() };
  await ref.delete();
  await appendOpsAudit({ actor: scopedActor(actor, classKey), action: "CLEANING_CLEAR", collectionName: "cleaningAssignments", recordId: id, before, after: null });
  return { id, cleared: true };
}

export default async function duties(req, res) {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return sendJson(res, 204, {}, headers);
  try {
    const { profile: actor } = await requireProfileOrLegacy(req);
    assertOperator(actor);
    if (req.method === "GET") {
      const url = new URL(req.url || "/", "https://pincon.invalid");
      return sendJson(res, 200, await fullView(
        actor,
        url.searchParams.get("classKey") || "",
        url.searchParams.get("departmentId") || "",
        url.searchParams.get("date") || "",
      ), headers);
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "method-not-allowed" }, headers);
    const body = await jsonBody(req);
    const action = String(body.action || "").toUpperCase();
    let result;
    if (action === "SET_DEPARTMENT_MEMBERS") result = await setDepartmentMembers(actor, body);
    else if (action === "ASSIGN_ONE_PERSON_ROLE") result = await assignOnePersonRole(actor, body);
    else if (action === "CLEANING_RECOMMEND") result = await cleaningRecommend(actor, body);
    else if (action === "CLEANING_ASSIGN") result = await cleaningAssign(actor, body, false);
    else if (action === "CLEANING_AUTO_ASSIGN") result = await cleaningAssign(actor, body, true);
    else if (action === "CLEANING_COMPLETE") result = await cleaningComplete(actor, body);
    else if (action === "CLEANING_CLEAR") result = await cleaningClear(actor, body);
    else throw Object.assign(new Error("unsupported-action"), { status: 400 });
    return sendJson(res, 200, result, headers);
  } catch (error) {
    return sendJson(res, error?.status || 500, { error: error?.message || "duty-management-failed" }, headers);
  }
}
