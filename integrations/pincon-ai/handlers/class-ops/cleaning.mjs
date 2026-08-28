import { firestore } from "../../lib/firebase.mjs";
import {
  SCHOOL_ID,
  canManageDepartment,
  publicProfile,
  requireProfile,
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
  cleaningAssignmentsForMonth,
  collection,
  departmentUsers,
  document,
  phoneStates,
} from "../../lib/class-ops-store.mjs";
import { jsonBody, sendJson } from "../../lib/request.mjs";
import { corsHeaders } from "../../lib/class-accounts.mjs";

async function allRows(name, classKey, limit = 300) {
  const snapshot = await collection(name).where("classKey", "==", classKey).limit(limit).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function profileByUid(uid) {
  const snapshot = await document("users", uid).get();
  return snapshot.exists ? publicProfile({ id: snapshot.id, ...snapshot.data() }) : null;
}

function assertDepartment(actor, departmentId) {
  const clean = safeText(departmentId, 80);
  if (!clean || !canManageDepartment(actor, clean)) {
    throw Object.assign(new Error("department-scope-denied"), { status: 403 });
  }
  return clean;
}

async function recommendation(actor, departmentId, date, additionalExcluded = []) {
  const department = assertDepartment(actor, departmentId);
  const [members, assignments, exemptions, phones] = await Promise.all([
    departmentUsers(actor.classKey, department),
    cleaningAssignmentsForMonth(actor.classKey, department, date),
    activeExemptions(actor.classKey, date),
    phoneStates(actor.classKey, date),
  ]);
  const excluded = new Set(additionalExcluded);
  for (const item of exemptions) excluded.add(item.userUid);
  for (const item of phones) if (["ABSENT"].includes(item.status)) excluded.add(item.userUid);
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

async function writeAssignment(actor, { departmentId, date, candidate, mode = "MANUAL", reason = "" }) {
  const id = assignmentId(actor.classKey, departmentId, date);
  const ref = document("cleaningAssignments", id);
  const beforeSnapshot = await ref.get();
  const before = beforeSnapshot.exists ? { id: beforeSnapshot.id, ...beforeSnapshot.data() } : null;
  const now = Date.now();
  const after = {
    schemaVersion: 1,
    classKey: actor.classKey,
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
  await appendOpsAudit({ actor, action: mode === "AUTO_FAIR" ? "CLEANING_AUTO_ASSIGN" : "CLEANING_ASSIGN", collectionName: "cleaningAssignments", recordId: id, before, after });
  return { id, ...after };
}

async function recommendAction(actor, body) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : dateKey();
  const { result } = await recommendation(actor, body.departmentId, date);
  return {
    date,
    candidate: publicProfile(result.user),
    reason: result.reason,
    fairness: { monthlyCount: result.count, lastAssignedDate: result.lastDate || null, roleBurden: result.burden },
  };
}

async function assignAction(actor, body, auto = false) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : dateKey();
  const departmentId = assertDepartment(actor, body.departmentId);
  if (auto) {
    const settings = await classSettings(actor.classKey);
    if (settings.cleaningAutoAssignEnabled === false) throw Object.assign(new Error("automatic-assignment-disabled"), { status: 409 });
    const { result } = await recommendation(actor, departmentId, date, Array.isArray(body.excludedUids) ? body.excludedUids : []);
    return writeAssignment(actor, { departmentId, date, candidate: result.user, mode: "AUTO_FAIR", reason: result.reason });
  }
  const candidate = await profileByUid(String(body.assigneeUid || ""));
  if (!candidate || candidate.classKey !== actor.classKey || candidate.departmentId !== departmentId || candidate.status !== "ACTIVE") {
    throw Object.assign(new Error("invalid-cleaning-assignee"), { status: 400 });
  }
  return writeAssignment(actor, { departmentId, date, candidate, mode: "MANUAL", reason: "해당 부서장이 직접 확정했습니다." });
}

async function ownAssignment(actor, assignmentIdValue) {
  const snapshot = await document("cleaningAssignments", safeText(assignmentIdValue, 180)).get();
  if (!snapshot.exists) throw Object.assign(new Error("cleaning-assignment-not-found"), { status: 404 });
  const assignment = { id: snapshot.id, ...snapshot.data() };
  if (assignment.classKey !== actor.classKey) throw Object.assign(new Error("class-scope-denied"), { status: 403 });
  return assignment;
}

async function acceptAction(actor, body) {
  const assignment = await ownAssignment(actor, body.assignmentId);
  if (assignment.assigneeUid !== actor.uid) throw Object.assign(new Error("not-current-assignee"), { status: 403 });
  if (!["ASSIGNED", "EXCHANGE_PENDING"].includes(assignment.status)) throw Object.assign(new Error("assignment-not-accepting"), { status: 409 });
  const after = { ...assignment, status: "ACCEPTED", acceptedAtMs: Date.now(), updatedAtMs: Date.now() };
  delete after.id;
  await document("cleaningAssignments", assignment.id).set(after, { merge: false });
  await appendOpsAudit({ actor, action: "CLEANING_ACCEPT", collectionName: "cleaningAssignments", recordId: assignment.id, before: assignment, after });
  return { id: assignment.id, ...after };
}

async function exchangeRequest(actor, body) {
  const assignment = await ownAssignment(actor, body.assignmentId);
  if (assignment.assigneeUid !== actor.uid) throw Object.assign(new Error("not-current-assignee"), { status: 403 });
  const target = await profileByUid(String(body.targetUid || ""));
  if (!target || target.uid === actor.uid || target.classKey !== actor.classKey || target.departmentId !== assignment.departmentId || target.status !== "ACTIVE") {
    throw Object.assign(new Error("invalid-exchange-target"), { status: 400 });
  }
  const id = collection("cleaningRequests").doc().id;
  const request = {
    schemaVersion: 1,
    classKey: actor.classKey,
    departmentId: assignment.departmentId,
    assignmentId: assignment.id,
    type: "EXCHANGE",
    requesterUid: actor.uid,
    requesterName: safeText(actor.name, 30),
    targetUid: target.uid,
    targetName: safeText(target.name, 30),
    status: "PENDING",
    reasonCode: "EXCHANGE",
    note: safeText(body.note, 160),
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
  };
  await document("cleaningRequests", id).set(request);
  await document("cleaningAssignments", assignment.id).set({ status: "EXCHANGE_PENDING", updatedAtMs: Date.now() }, { merge: true });
  await appendOpsAudit({ actor, action: "CLEANING_EXCHANGE_REQUEST", collectionName: "cleaningRequests", recordId: id, after: request });
  return { id, ...request };
}

async function exchangeAccept(actor, body) {
  const requestRef = document("cleaningRequests", safeText(body.requestId, 180));
  const requestSnapshot = await requestRef.get();
  if (!requestSnapshot.exists) throw Object.assign(new Error("cleaning-request-not-found"), { status: 404 });
  const request = { id: requestSnapshot.id, ...requestSnapshot.data() };
  if (request.type !== "EXCHANGE" || request.status !== "PENDING" || request.targetUid !== actor.uid) {
    throw Object.assign(new Error("exchange-request-not-acceptable"), { status: 403 });
  }
  const assignmentRef = document("cleaningAssignments", request.assignmentId);
  const assignmentSnapshot = await assignmentRef.get();
  if (!assignmentSnapshot.exists) throw Object.assign(new Error("cleaning-assignment-not-found"), { status: 404 });
  const beforeAssignment = { id: assignmentSnapshot.id, ...assignmentSnapshot.data() };
  if (beforeAssignment.assigneeUid !== request.requesterUid) throw Object.assign(new Error("assignment-changed"), { status: 409 });

  const now = Date.now();
  const afterAssignment = {
    ...beforeAssignment,
    assigneeUid: actor.uid,
    assigneeName: safeText(actor.name, 30),
    assigneeNumber: Number(actor.number || 0),
    status: "ACCEPTED",
    assignmentMode: "EXCHANGE",
    selectionReason: `${request.requesterName}님의 교환 요청을 ${safeText(actor.name, 30)}님이 수락했습니다.`,
    acceptedAtMs: now,
    updatedAtMs: now,
  };
  delete afterAssignment.id;
  const afterRequest = { ...request, status: "ACCEPTED", acceptedAtMs: now, updatedAtMs: now };
  delete afterRequest.id;
  const batch = firestore().batch();
  batch.set(assignmentRef, afterAssignment, { merge: false });
  batch.set(requestRef, afterRequest, { merge: false });
  await batch.commit();
  await appendOpsAudit({ actor, action: "CLEANING_EXCHANGE_ACCEPT", collectionName: "cleaningAssignments", recordId: request.assignmentId, before: beforeAssignment, after: afterAssignment });
  return { assignment: { id: request.assignmentId, ...afterAssignment }, request: { id: request.id, ...afterRequest } };
}

async function exemptionRequest(actor, body) {
  const assignment = await ownAssignment(actor, body.assignmentId);
  if (assignment.assigneeUid !== actor.uid) throw Object.assign(new Error("not-current-assignee"), { status: 403 });
  const settings = await classSettings(actor.classKey);
  const reasonCode = String(body.reasonCode || "").toUpperCase();
  if (settings.cleaningExemptionPolicy?.[reasonCode]?.enabled !== true) throw Object.assign(new Error("exemption-reason-not-allowed"), { status: 400 });
  const id = collection("cleaningRequests").doc().id;
  const request = {
    schemaVersion: 1,
    classKey: actor.classKey,
    departmentId: assignment.departmentId,
    assignmentId: assignment.id,
    type: "EXEMPTION",
    requesterUid: actor.uid,
    requesterName: safeText(actor.name, 30),
    targetUid: "",
    targetName: "",
    status: "PENDING",
    reasonCode,
    reasonLabel: safeText(settings.cleaningExemptionPolicy[reasonCode].label, 80),
    note: safeText(body.note, 160),
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
  };
  await document("cleaningRequests", id).set(request);
  await document("cleaningAssignments", assignment.id).set({ status: "EXEMPTION_PENDING", updatedAtMs: Date.now() }, { merge: true });
  await appendOpsAudit({ actor, action: "CLEANING_EXEMPTION_REQUEST", collectionName: "cleaningRequests", recordId: id, after: request });
  return { id, ...request };
}

async function decideRequest(actor, body) {
  const ref = document("cleaningRequests", safeText(body.requestId, 180));
  const snapshot = await ref.get();
  if (!snapshot.exists) throw Object.assign(new Error("cleaning-request-not-found"), { status: 404 });
  const before = { id: snapshot.id, ...snapshot.data() };
  assertDepartment(actor, before.departmentId);
  if (before.status !== "PENDING" || before.type !== "EXEMPTION") throw Object.assign(new Error("request-not-decidable"), { status: 409 });
  const approve = body.approve === true;
  const now = Date.now();
  const after = {
    ...before,
    status: approve ? "APPROVED" : "REJECTED",
    decisionNote: safeText(body.decisionNote, 200),
    decidedByUid: actor.uid,
    decidedByName: safeText(actor.name, 30),
    decidedAtMs: now,
    updatedAtMs: now,
  };
  delete after.id;
  const assignmentRef = document("cleaningAssignments", before.assignmentId);
  const assignmentSnapshot = await assignmentRef.get();
  const assignment = assignmentSnapshot.exists ? { id: assignmentSnapshot.id, ...assignmentSnapshot.data() } : null;
  const batch = firestore().batch();
  batch.set(ref, after, { merge: false });
  if (assignment) batch.set(assignmentRef, {
    status: approve ? "EXEMPTED" : "ASSIGNED",
    exemptionRequestId: before.id,
    updatedAtMs: now,
  }, { merge: true });
  if (approve) {
    const exemptionId = `${before.assignmentId}_${before.requesterUid}`.slice(0, 180);
    batch.set(document("cleaningExemptions", exemptionId), {
      schemaVersion: 1,
      classKey: before.classKey,
      departmentId: before.departmentId,
      date: assignment?.date || dateKey(),
      userUid: before.requesterUid,
      status: "APPROVED",
      reasonCode: before.reasonCode,
      requestId: before.id,
      approvedByUid: actor.uid,
      createdAtMs: now,
      updatedAtMs: now,
    }, { merge: false });
  }
  await batch.commit();
  await appendOpsAudit({ actor, action: approve ? "CLEANING_EXEMPTION_APPROVE" : "CLEANING_EXEMPTION_REJECT", collectionName: "cleaningRequests", recordId: before.id, before, after });

  let replacement = null;
  if (approve && assignment) {
    const settings = await classSettings(actor.classKey);
    if (settings.cleaningAutoAssignEnabled !== false) {
      const { result } = await recommendation(actor, before.departmentId, assignment.date, [before.requesterUid]);
      replacement = await writeAssignment(actor, {
        departmentId: before.departmentId,
        date: assignment.date,
        candidate: result.user,
        mode: "AUTO_FAIR",
        reason: `면제 승인 후 자동 재배정: ${result.reason}`,
      });
    }
  }
  return { request: { id: before.id, ...after }, replacement };
}

async function completeAction(actor, body) {
  const assignment = await ownAssignment(actor, body.assignmentId);
  const manager = canManageDepartment(actor, assignment.departmentId);
  if (assignment.assigneeUid !== actor.uid && !manager) throw Object.assign(new Error("cleaning-complete-denied"), { status: 403 });
  const after = { ...assignment, status: "COMPLETED", completedAtMs: Date.now(), updatedAtMs: Date.now() };
  delete after.id;
  await document("cleaningAssignments", assignment.id).set(after, { merge: false });
  await appendOpsAudit({ actor, action: "CLEANING_COMPLETE", collectionName: "cleaningAssignments", recordId: assignment.id, before: assignment, after });
  return { id: assignment.id, ...after };
}

async function view(actor, url) {
  const requestedDepartment = safeText(url.searchParams.get("departmentId"), 80);
  const departmentId = requestedDepartment || actor.departmentId || "";
  assertDepartment(actor, departmentId);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("date") || "") ? url.searchParams.get("date") : dateKey();
  const [members, assignments, requests] = await Promise.all([
    departmentUsers(actor.classKey, departmentId),
    allRows("cleaningAssignments", actor.classKey),
    allRows("cleaningRequests", actor.classKey),
  ]);
  return {
    date,
    departmentId,
    members,
    todayAssignment: assignments.find((item) => item.departmentId === departmentId && item.date === date) || null,
    pendingRequests: requests.filter((item) => item.departmentId === departmentId && item.status === "PENDING"),
  };
}

export default async function cleaning(req, res) {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return sendJson(res, 204, {}, headers);
  try {
    const { profile: actor } = await requireProfile(req);
    if (req.method === "GET") {
      const url = new URL(req.url || "/", "https://pincon.invalid");
      return sendJson(res, 200, await view(actor, url), headers);
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "method-not-allowed" }, headers);
    const body = await jsonBody(req);
    const action = String(body.action || "").toUpperCase();
    let result;
    if (action === "RECOMMEND") result = await recommendAction(actor, body);
    else if (action === "ASSIGN") result = await assignAction(actor, body, false);
    else if (action === "AUTO_ASSIGN") result = await assignAction(actor, body, true);
    else if (action === "ACCEPT") result = await acceptAction(actor, body);
    else if (action === "EXCHANGE_REQUEST") result = await exchangeRequest(actor, body);
    else if (action === "EXCHANGE_ACCEPT") result = await exchangeAccept(actor, body);
    else if (action === "EXEMPTION_REQUEST") result = await exemptionRequest(actor, body);
    else if (action === "REQUEST_DECIDE") result = await decideRequest(actor, body);
    else if (action === "COMPLETE") result = await completeAction(actor, body);
    else throw Object.assign(new Error("unsupported-action"), { status: 400 });
    return sendJson(res, 200, result, headers);
  } catch (error) {
    return sendJson(res, error?.status || 500, { error: error?.message || "cleaning-operation-failed" }, headers);
  }
}
