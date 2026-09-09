import {
  ROLE,
  canViewClassroomLayout,
  corsHeaders,
  hasRole,
  isClassOperator,
  requireProfileOrLegacy,
} from "../../lib/class-accounts.mjs";
import { safeText } from "../../lib/class-operations.mjs";
import { appendOpsAudit, classUsers, document } from "../../lib/class-ops-store.mjs";
import { jsonBody, sendJson } from "../../lib/request.mjs";

const LINES = 5;
const LABEL_MODES = new Set(["student", "desk", "both"]);

function deny(message = "assessment-layout-access-denied") {
  throw Object.assign(new Error(message), { status: 403 });
}

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

function sortedRoster(users = []) {
  return users
    .map((student) => ({
      uid: String(student.uid || ""),
      name: safeText(student.name, 40),
      number: Number(student.number) || 0,
      studentNumber: safeText(student.studentNumber, 30),
    }))
    .filter((student) => student.uid)
    .sort((a, b) => {
      const an = a.number || 999;
      const bn = b.number || 999;
      return an - bn || a.name.localeCompare(b.name, "ko");
    });
}

function normalizeLabelMode(value) {
  return LABEL_MODES.has(String(value || "")) ? String(value) : "both";
}

function normalizeDeskOwners(value, seatOrder, slotCount) {
  const known = new Set(seatOrder);
  const result = Array(slotCount).fill("");
  const used = new Set();

  if (Array.isArray(value)) {
    value.slice(0, slotCount).forEach((raw, index) => {
      const uid = String(raw || "");
      if (!uid || !known.has(uid) || used.has(uid)) return;
      result[index] = uid;
      used.add(uid);
    });
  }

  const missing = seatOrder.filter((uid) => !used.has(uid));
  let cursor = 0;
  for (let index = 0; index < result.length && cursor < missing.length; index += 1) {
    if (result[index]) continue;
    result[index] = missing[cursor];
    cursor += 1;
  }
  return result;
}

async function context(actor, requestedClassKey = "") {
  if (!canViewClassroomLayout(actor)) deny();
  const classKey = targetClassKey(actor, requestedClassKey);
  const [users, snapshot] = await Promise.all([
    classUsers(classKey),
    document("assessmentLayouts", classKey).get(),
  ]);
  const roster = sortedRoster(users);
  const seatOrder = roster.map((student) => student.uid);
  const slotCount = Math.max(LINES, Math.ceil(Math.max(1, seatOrder.length) / LINES) * LINES);
  const raw = snapshot.exists ? snapshot.data() : {};
  const assessmentPlan = {
    schemaVersion: 1,
    lines: LINES,
    seatOrder,
    slotCount,
    deskOwners: normalizeDeskOwners(raw.deskOwners, seatOrder, slotCount),
    tvLabelMode: normalizeLabelMode(raw.tvLabelMode),
    updatedAtMs: Number(raw.updatedAtMs || 0),
    updatedByName: safeText(raw.updatedByName, 40),
  };
  return { classKey, roster, assessmentPlan, raw };
}

async function getView(actor, requestedClassKey = "") {
  const { classKey, roster, assessmentPlan } = await context(actor, requestedClassKey);
  return {
    classKey,
    roster,
    assessmentPlan,
    permissions: {
      canEdit: isClassOperator(actor),
      canView: canViewClassroomLayout(actor),
    },
  };
}

async function save(actor, body) {
  if (!isClassOperator(actor)) deny("class-operator-required");
  const { classKey, roster, assessmentPlan, raw } = await context(actor, body.classKey);
  const after = {
    schemaVersion: 1,
    classKey,
    lines: LINES,
    deskOwners: normalizeDeskOwners(body.deskOwners, assessmentPlan.seatOrder, assessmentPlan.slotCount),
    tvLabelMode: normalizeLabelMode(body.tvLabelMode),
    updatedAtMs: Date.now(),
    updatedByUid: actor.uid,
    updatedByName: safeText(actor.name, 40),
  };
  await document("assessmentLayouts", classKey).set(after, { merge: false });
  await appendOpsAudit({
    actor: { ...actor, classKey },
    action: "ASSESSMENT_LAYOUT_UPDATE",
    collectionName: "assessmentLayouts",
    recordId: classKey,
    before: raw || null,
    after,
  });
  return {
    classKey,
    roster,
    assessmentPlan: {
      ...assessmentPlan,
      deskOwners: after.deskOwners,
      tvLabelMode: after.tvLabelMode,
      updatedAtMs: after.updatedAtMs,
      updatedByName: after.updatedByName,
    },
    permissions: { canEdit: true, canView: true },
  };
}

export default async function assessmentLayout(req, res) {
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
    const action = String(body.action || "SAVE").toUpperCase();
    if (action !== "SAVE") throw Object.assign(new Error("unsupported-action"), { status: 400 });
    return sendJson(res, 200, await save(actor, body), headers);
  } catch (error) {
    return sendJson(res, error?.status || 500, { error: error?.message || "assessment-layout-operation-failed" }, headers);
  }
}
