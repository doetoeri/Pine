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
const MAX_DUMMIES = 20;

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
      dummy: false,
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

function dummyId(value, index) {
  const raw = String(value || "").trim();
  if (/^dummy-[a-zA-Z0-9_-]{1,80}$/.test(raw)) return raw;
  return `dummy-${Date.now().toString(36)}-${index}`;
}

function normalizeDummies(value = []) {
  if (!Array.isArray(value)) return [];
  const used = new Set();
  const result = [];
  for (let index = 0; index < value.slice(0, MAX_DUMMIES).length; index += 1) {
    const item = value[index] || {};
    let id = dummyId(item.id, index);
    while (used.has(id)) id = `${id}-${index}`;
    used.add(id);
    result.push({
      id,
      uid: id,
      name: safeText(item.name, 40) || `가상 자리 ${index + 1}`,
      slotIndex: Math.max(0, Math.trunc(Number(item.slotIndex) || 0)),
      dummy: true,
      number: 0,
      studentNumber: "",
    });
  }
  return result;
}

function slotCountFor(realCount, dummies = []) {
  const occupants = Math.max(1, Number(realCount || 0) + dummies.length);
  const requestedMax = dummies.reduce((max, item) => Math.max(max, Number(item.slotIndex || 0) + 1), 0);
  const needed = Math.max(occupants, requestedMax, LINES);
  return Math.ceil(needed / LINES) * LINES;
}

function verticalIndexes(slotCount) {
  const rows = Math.max(1, Math.ceil(slotCount / LINES));
  const indexes = [];
  for (let column = 0; column < LINES; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const index = row * LINES + column;
      if (index < slotCount) indexes.push(index);
    }
  }
  return indexes;
}

function buildSeatOrder(realRoster, dummies, slotCount) {
  const result = Array(slotCount).fill("");
  const occupied = new Set();
  const order = verticalIndexes(slotCount);

  for (const dummy of dummies) {
    let target = Math.max(0, Math.min(slotCount - 1, Number(dummy.slotIndex || 0)));
    if (occupied.has(target)) target = order.find((index) => !occupied.has(index)) ?? target;
    result[target] = dummy.uid;
    dummy.slotIndex = target;
    occupied.add(target);
  }

  let cursor = 0;
  for (const index of order) {
    if (occupied.has(index)) continue;
    const student = realRoster[cursor];
    if (!student) break;
    result[index] = student.uid;
    cursor += 1;
  }
  return result;
}

function normalizeDeskOwners(value, validIds, slotCount) {
  const known = new Set(validIds);
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

  const missing = validIds.filter((uid) => !used.has(uid));
  let cursor = 0;
  for (let index = 0; index < result.length && cursor < missing.length; index += 1) {
    if (result[index]) continue;
    result[index] = missing[cursor];
    cursor += 1;
  }
  return result;
}

async function context(actor, requestedClassKey = "", override = null) {
  if (!canViewClassroomLayout(actor)) deny();
  const classKey = targetClassKey(actor, requestedClassKey);
  const [users, snapshot] = await Promise.all([
    classUsers(classKey),
    document("assessmentLayouts", classKey).get(),
  ]);
  const raw = snapshot.exists ? snapshot.data() : {};
  const realRoster = sortedRoster(users);
  const dummies = normalizeDummies(override?.dummies ?? raw.dummies ?? []);
  const slotCount = slotCountFor(realRoster.length, dummies);
  const seatOrder = buildSeatOrder(realRoster, dummies, slotCount);
  const roster = [...realRoster, ...dummies];
  const validIds = seatOrder.filter(Boolean);
  const assessmentPlan = {
    schemaVersion: 2,
    lines: LINES,
    numberingMode: "vertical",
    seatOrder,
    slotCount,
    dummies: dummies.map(({ id, name, slotIndex }) => ({ id, name, slotIndex })),
    deskOwners: normalizeDeskOwners(override?.deskOwners ?? raw.deskOwners, validIds, slotCount),
    tvLabelMode: normalizeLabelMode(override?.tvLabelMode ?? raw.tvLabelMode),
    updatedAtMs: Number(raw.updatedAtMs || 0),
    updatedByName: safeText(raw.updatedByName, 40),
  };
  return { classKey, roster, realRoster, dummies, assessmentPlan, raw };
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
  const { classKey, roster, assessmentPlan, raw } = await context(actor, body.classKey, {
    dummies: body.dummies,
    deskOwners: body.deskOwners,
    tvLabelMode: body.tvLabelMode,
  });
  const after = {
    schemaVersion: 2,
    classKey,
    lines: LINES,
    numberingMode: "vertical",
    dummies: assessmentPlan.dummies,
    deskOwners: assessmentPlan.deskOwners,
    tvLabelMode: assessmentPlan.tvLabelMode,
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
