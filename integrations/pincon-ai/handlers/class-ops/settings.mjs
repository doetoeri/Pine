import { corsHeaders, isClassOperator, requireProfile } from "../../lib/class-accounts.mjs";
import { safeText } from "../../lib/class-operations.mjs";
import { appendOpsAudit, classSettings, collection, document } from "../../lib/class-ops-store.mjs";
import { jsonBody, sendJson } from "../../lib/request.mjs";

function assertOperator(profile) {
  if (!isClassOperator(profile)) throw Object.assign(new Error("class-operator-required"), { status: 403 });
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

async function listRows(name, classKey, limit = 100) {
  const snapshot = await collection(name).where("classKey", "==", classKey).limit(limit).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function getView(actor) {
  assertOperator(actor);
  const [settings, departments, onePersonRoles] = await Promise.all([
    classSettings(actor.classKey),
    listRows("classDepartments", actor.classKey),
    listRows("onePersonRoles", actor.classKey),
  ]);
  return { settings, departments, onePersonRoles };
}

async function updateSettings(actor, body) {
  assertOperator(actor);
  const before = await classSettings(actor.classKey);
  const phoneMovementPolicy = ["TAKE", "KEEP_IN_CLASSROOM"].includes(body.phoneMovementPolicy)
    ? body.phoneMovementPolicy
    : before.phoneMovementPolicy;
  const after = {
    schemaVersion: 1,
    classKey: actor.classKey,
    phoneMovementPolicy,
    cleaningAutoAssignEnabled: body.cleaningAutoAssignEnabled !== false,
    cleaningExemptionPolicy: normalizeExemptionPolicy(body.cleaningExemptionPolicy, before.cleaningExemptionPolicy),
    updatedAtMs: Date.now(),
    updatedByUid: actor.uid,
    updatedByName: safeText(actor.name, 30),
  };
  await document("classOpsSettings", actor.classKey).set(after, { merge: true });
  await appendOpsAudit({ actor, action: "CLASS_OPS_SETTINGS_UPDATE", collectionName: "classOpsSettings", recordId: actor.classKey, before, after });
  return after;
}

async function upsertDepartment(actor, body) {
  assertOperator(actor);
  const id = safeText(body.id, 80).replace(/[^a-zA-Z0-9가-힣_-]/g, "-") || collection("classDepartments").doc().id;
  const ref = document("classDepartments", id);
  const snapshot = await ref.get();
  const before = snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
  if (before && before.classKey !== actor.classKey) throw Object.assign(new Error("class-scope-denied"), { status: 403 });
  const name = safeText(body.name, 60);
  if (!name) throw Object.assign(new Error("department-name-required"), { status: 400 });
  const after = {
    schemaVersion: 1,
    classKey: actor.classKey,
    name,
    active: body.active !== false,
    sortOrder: Math.max(0, Math.min(100, Number(body.sortOrder || 0))),
    updatedAtMs: Date.now(),
    updatedByUid: actor.uid,
  };
  await ref.set(after, { merge: true });
  await appendOpsAudit({ actor, action: "DEPARTMENT_UPSERT", collectionName: "classDepartments", recordId: id, before, after });
  return { id, ...after };
}

async function upsertOnePersonRole(actor, body) {
  assertOperator(actor);
  const id = safeText(body.id, 120).replace(/[^a-zA-Z0-9가-힣_-]/g, "-") || collection("onePersonRoles").doc().id;
  const ref = document("onePersonRoles", id);
  const snapshot = await ref.get();
  const before = snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
  if (before && before.classKey !== actor.classKey) throw Object.assign(new Error("class-scope-denied"), { status: 403 });
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
    classKey: actor.classKey,
    name,
    description: safeText(body.description, 300),
    timing,
    permissions,
    active: body.active !== false,
    updatedAtMs: Date.now(),
    updatedByUid: actor.uid,
  };
  await ref.set(after, { merge: true });
  await appendOpsAudit({ actor, action: "ONE_PERSON_ROLE_UPSERT", collectionName: "onePersonRoles", recordId: id, before, after });
  return { id, ...after };
}

export default async function settings(req, res) {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return sendJson(res, 204, {}, headers);
  try {
    const { profile: actor } = await requireProfile(req);
    if (req.method === "GET") return sendJson(res, 200, await getView(actor), headers);
    if (req.method !== "POST") return sendJson(res, 405, { error: "method-not-allowed" }, headers);
    const body = await jsonBody(req);
    const action = String(body.action || "").toUpperCase();
    let result;
    if (action === "UPDATE_SETTINGS") result = await updateSettings(actor, body);
    else if (action === "UPSERT_DEPARTMENT") result = await upsertDepartment(actor, body);
    else if (action === "UPSERT_ONE_PERSON_ROLE") result = await upsertOnePersonRole(actor, body);
    else throw Object.assign(new Error("unsupported-action"), { status: 400 });
    return sendJson(res, 200, result, headers);
  } catch (error) {
    return sendJson(res, error?.status || 500, { error: error?.message || "settings-operation-failed" }, headers);
  }
}
