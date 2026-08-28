import { firestore } from "../../lib/firebase.mjs";
import {
  SCHOOL_ID,
  corsHeaders,
  hasRole,
  isClassOperator,
  requireProfileOrLegacy,
  ROLE,
} from "../../lib/class-accounts.mjs";
import { dateKey } from "../../lib/class-operations.mjs";
import { sendJson } from "../../lib/request.mjs";

const collection = (name) => firestore().collection(`schools/${SCHOOL_ID}/${name}`);

async function rows(name, limit = 300) {
  const snapshot = await collection(name).limit(limit).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function newestRows(name, limit = 300) {
  const snapshot = await collection(name).orderBy("createdAtMs", "desc").limit(limit).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

function inScope(actor, item) {
  if (hasRole(actor, ROLE.ADMIN)) return true;
  return Boolean(actor?.classKey) && item?.classKey === actor.classKey;
}

function safeAudit(item, source) {
  return {
    id: item.id,
    source,
    classKey: String(item.classKey || ""),
    action: String(item.action || "변경").slice(0, 80),
    collection: String(item.collection || (source === "account" ? "users" : "")).slice(0, 80),
    recordId: String(item.recordId || item.targetUid || "").slice(0, 180),
    actorUid: String(item.actorUid || "system").slice(0, 128),
    actorName: String(item.actorName || "시스템").slice(0, 40),
    note: String(item.note || "").slice(0, 300),
    createdAtMs: Number(item.createdAtMs || 0),
  };
}

function publicAccount(item) {
  return {
    uid: item.uid || item.id,
    studentNumber: String(item.studentNumber || ""),
    name: String(item.name || ""),
    classKey: String(item.classKey || ""),
    number: Number(item.number || 0),
    roles: Array.isArray(item.roles) ? item.roles.slice(0, 10) : [],
    status: item.status === "DISABLED" ? "DISABLED" : "ACTIVE",
    mustChangePin: item.mustChangePin === true,
  };
}

export default async function adminOverview(req, res) {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return sendJson(res, 204, {}, headers);
  if (req.method !== "GET") return sendJson(res, 405, { error: "method-not-allowed" }, headers);

  try {
    const { profile: actor } = await requireProfileOrLegacy(req, { legacyLevels: ["school", "president", "class", "grade"] });
    if (!isClassOperator(actor)) throw Object.assign(new Error("class-operator-required"), { status: 403 });

    const today = dateKey();
    const [users, subjectEntries, cleaningRequests, phoneStates, accountAudit, opsAudit] = await Promise.all([
      rows("users", 300),
      rows("subjectEntries", 500),
      rows("cleaningRequests", 500),
      rows("phoneStates", 500),
      newestRows("accountAudit", 300),
      newestRows("classOpsAudit", 300),
    ]);

    const scopedUsers = users.filter((item) => inScope(actor, item)).map(publicAccount);
    const pendingSubjects = subjectEntries.filter((item) => inScope(actor, item) && item.status === "PENDING_REVIEW" && item.archived !== true);
    const pendingCleaning = cleaningRequests.filter((item) => inScope(actor, item) && item.status === "PENDING");
    const phoneChecks = phoneStates.filter((item) => inScope(actor, item) && item.date === today && item.status === "CHECK_REQUIRED");
    const audits = [
      ...accountAudit.filter((item) => inScope(actor, item)).map((item) => safeAudit(item, "account")),
      ...opsAudit.filter((item) => inScope(actor, item)).map((item) => safeAudit(item, "class-ops")),
    ].sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, 100);

    return sendJson(res, 200, {
      classKey: actor.classKey || "",
      schoolWide: hasRole(actor, ROLE.ADMIN),
      generatedAtMs: Date.now(),
      counts: {
        accounts: scopedUsers.length,
        activeAccounts: scopedUsers.filter((item) => item.status === "ACTIVE").length,
        disabledAccounts: scopedUsers.filter((item) => item.status === "DISABLED").length,
        firstLoginPending: scopedUsers.filter((item) => item.mustChangePin).length,
        pendingSubjects: pendingSubjects.length,
        pendingCleaning: pendingCleaning.length,
        phoneChecks: phoneChecks.length,
      },
      pending: {
        subjects: pendingSubjects.slice(0, 30).map((item) => ({ id: item.id, classKey: item.classKey, subject: item.subject || "", type: item.type || "", title: item.title || item.name || "", updatedAtMs: Number(item.updatedAtMs || item.createdAtMs || 0) })),
        cleaning: pendingCleaning.slice(0, 30).map((item) => ({ id: item.id, classKey: item.classKey, type: item.type || item.requestType || "", requesterName: item.requesterName || item.actorName || "", departmentId: item.departmentId || "", createdAtMs: Number(item.createdAtMs || 0) })),
        phoneChecks: phoneChecks.slice(0, 30).map((item) => ({ id: item.id, classKey: item.classKey, uid: item.uid || "", studentName: item.studentName || "", status: item.status || "", updatedAtMs: Number(item.updatedAtMs || 0) })),
      },
      audits,
    }, headers);
  } catch (error) {
    return sendJson(res, error?.status || 500, { error: error?.message || "admin-overview-failed" }, headers);
  }
}
