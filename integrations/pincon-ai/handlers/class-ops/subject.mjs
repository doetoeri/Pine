import { corsHeaders, isClassOperator, requireProfile } from "../../lib/class-accounts.mjs";
import { assertSubjectPermission, safeText, subjectEntryType } from "../../lib/class-operations.mjs";
import { appendOpsAudit, collection, document } from "../../lib/class-ops-store.mjs";
import { jsonBody, sendJson } from "../../lib/request.mjs";

function safeUrl(value) {
  const raw = safeText(value, 1200);
  if (!raw) return "";
  const url = new URL(raw);
  if (!["https:", "http:"].includes(url.protocol)) throw Object.assign(new Error("invalid-resource-url"), { status: 400 });
  return url.href;
}

function validDate(value) {
  const raw = safeText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

async function rowsForClass(classKey) {
  const snapshot = await collection("subjectEntries").where("classKey", "==", classKey).limit(400).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function view(actor, subject) {
  assertSubjectPermission(actor, subject);
  const rows = await rowsForClass(actor.classKey);
  return {
    subject,
    canApprove: isClassOperator(actor),
    entries: rows.filter((item) => item.subject === subject && item.deleted !== true)
      .sort((a, b) => Number(b.updatedAtMs || 0) - Number(a.updatedAtMs || 0)),
  };
}

async function upsert(actor, body) {
  const subject = safeText(body.subject, 40);
  assertSubjectPermission(actor, subject);
  const type = subjectEntryType(body.type);
  const title = safeText(body.title, 120);
  if (!title) throw Object.assign(new Error("title-required"), { status: 400 });
  const id = safeText(body.id, 180) || collection("subjectEntries").doc().id;
  const ref = document("subjectEntries", id);
  const snapshot = await ref.get();
  const before = snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
  if (before && (before.classKey !== actor.classKey || before.subject !== subject)) {
    throw Object.assign(new Error("subject-scope-denied"), { status: 403 });
  }
  if (before?.status === "APPROVED" && !isClassOperator(actor)) {
    throw Object.assign(new Error("approved-entry-must-be-reopened-by-manager"), { status: 409 });
  }

  const importantReview = type === "ASSESSMENT";
  const manager = isClassOperator(actor);
  const now = Date.now();
  const status = importantReview && !manager ? "PENDING_REVIEW" : "APPROVED";
  const after = {
    schemaVersion: 1,
    classKey: actor.classKey,
    subject,
    type,
    title,
    body: safeText(body.body, 1600),
    dueDate: validDate(body.dueDate),
    materials: safeText(body.materials, 500),
    classroom: safeText(body.classroom, 80),
    resourceUrl: safeUrl(body.resourceUrl),
    status,
    deleted: false,
    authorUid: before?.authorUid || actor.uid,
    authorName: before?.authorName || safeText(actor.name, 30),
    createdAtMs: before?.createdAtMs || now,
    updatedByUid: actor.uid,
    updatedByName: safeText(actor.name, 30),
    updatedAtMs: now,
    approvedByUid: status === "APPROVED" ? actor.uid : null,
    approvedByName: status === "APPROVED" ? safeText(actor.name, 30) : "",
    approvedAtMs: status === "APPROVED" ? now : null,
  };
  await ref.set(after, { merge: false });
  await appendOpsAudit({ actor, action: before ? "SUBJECT_ENTRY_UPDATE" : "SUBJECT_ENTRY_CREATE", collectionName: "subjectEntries", recordId: id, before, after });
  return { id, ...after };
}

async function approve(actor, body) {
  if (!isClassOperator(actor)) throw Object.assign(new Error("approval-required-role"), { status: 403 });
  const id = safeText(body.id, 180);
  const ref = document("subjectEntries", id);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw Object.assign(new Error("subject-entry-not-found"), { status: 404 });
  const before = { id: snapshot.id, ...snapshot.data() };
  if (before.classKey !== actor.classKey) throw Object.assign(new Error("class-scope-denied"), { status: 403 });
  if (before.status !== "PENDING_REVIEW") throw Object.assign(new Error("entry-not-pending-review"), { status: 409 });
  const now = Date.now();
  const after = {
    ...before,
    status: body.approve === false ? "REJECTED" : "APPROVED",
    reviewNote: safeText(body.reviewNote, 300),
    approvedByUid: body.approve === false ? null : actor.uid,
    approvedByName: body.approve === false ? "" : safeText(actor.name, 30),
    approvedAtMs: body.approve === false ? null : now,
    reviewedByUid: actor.uid,
    reviewedByName: safeText(actor.name, 30),
    reviewedAtMs: now,
    updatedAtMs: now,
  };
  delete after.id;
  await ref.set(after, { merge: false });
  await appendOpsAudit({ actor, action: body.approve === false ? "SUBJECT_ENTRY_REJECT" : "SUBJECT_ENTRY_APPROVE", collectionName: "subjectEntries", recordId: id, before, after });
  return { id, ...after };
}

async function archive(actor, body) {
  const id = safeText(body.id, 180);
  const ref = document("subjectEntries", id);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw Object.assign(new Error("subject-entry-not-found"), { status: 404 });
  const before = { id: snapshot.id, ...snapshot.data() };
  assertSubjectPermission(actor, before.subject);
  if (before.classKey !== actor.classKey) throw Object.assign(new Error("class-scope-denied"), { status: 403 });
  const after = { ...before, deleted: true, deletedAtMs: Date.now(), deletedByUid: actor.uid, updatedAtMs: Date.now() };
  delete after.id;
  await ref.set(after, { merge: false });
  await appendOpsAudit({ actor, action: "SUBJECT_ENTRY_ARCHIVE", collectionName: "subjectEntries", recordId: id, before, after });
  return { id, ...after };
}

export default async function subject(req, res) {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return sendJson(res, 204, {}, headers);
  try {
    const { profile: actor } = await requireProfile(req);
    if (req.method === "GET") {
      const url = new URL(req.url || "/", "https://pincon.invalid");
      const subjectName = safeText(url.searchParams.get("subject"), 40);
      return sendJson(res, 200, await view(actor, subjectName), headers);
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "method-not-allowed" }, headers);
    const body = await jsonBody(req);
    const action = String(body.action || "").toUpperCase();
    let result;
    if (action === "UPSERT") result = await upsert(actor, body);
    else if (action === "APPROVE") result = await approve(actor, body);
    else if (action === "ARCHIVE") result = await archive(actor, body);
    else throw Object.assign(new Error("unsupported-action"), { status: 400 });
    return sendJson(res, 200, result, headers);
  } catch (error) {
    return sendJson(res, error?.status || 500, { error: error?.message || "subject-operation-failed" }, headers);
  }
}
