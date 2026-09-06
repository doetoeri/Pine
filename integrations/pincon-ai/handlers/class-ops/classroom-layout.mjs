import { ROLE, corsHeaders, hasRole, isClassOperator, requireProfileOrLegacy } from "../../lib/class-accounts.mjs";
import { safeText } from "../../lib/class-operations.mjs";
import { appendOpsAudit, classUsers, document } from "../../lib/class-ops-store.mjs";
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

function integer(value, min, max, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

function uid(value) {
  return safeText(value, 160).replace(/[^a-zA-Z0-9_-]/g, "");
}

function uidList(value, known, limit = 80) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value.slice(0, limit)) {
    const clean = uid(raw);
    if (!clean || (known.size && !known.has(clean)) || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function seatList(value, known, limit = 100) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.slice(0, limit).map((raw) => {
    const clean = uid(raw);
    if (!clean || (known.size && !known.has(clean)) || seen.has(clean)) return "";
    seen.add(clean);
    return clean;
  });
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
      proposerRole: safeText(item?.proposerRole || "부장", 40),
      reason: safeText(item?.reason || "기타", 100),
      partnerUid: partnerUid && partnerUid !== studentUid && (!known.size || known.has(partnerUid)) ? partnerUid : "",
      note: safeText(item?.note, 180),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(item?.date || "")) ? String(item.date) : "",
    };
  }).filter(Boolean);
}

function normalizeLayout(value, rosterUids = []) {
  const input = value && typeof value === "object" ? value : {};
  const known = new Set(rosterUids);
  const general = input.general && typeof input.general === "object" ? input.general : {};
  const groups = input.groups && typeof input.groups === "object" ? input.groups : {};
  const assessment = input.assessment && typeof input.assessment === "object" ? input.assessment : {};
  const groupCount = integer(groups.groupCount, 1, 12, 1);
  const sizes = Array.from({ length: groupCount }, (_, index) => integer(groups.sizes?.[index], 0, 12, 0));
  const memberGroups = Array.isArray(groups.members)
    ? groups.members.slice(0, groupCount).map((items) => uidList(items, known, 12))
    : [];
  const separationPairs = Array.isArray(general.separationPairs)
    ? general.separationPairs.slice(0, 100).map((pair) => {
        if (!Array.isArray(pair) || pair.length < 2) return null;
        const a = uid(pair[0]);
        const b = uid(pair[1]);
        return a && b && a !== b && (!known.size || (known.has(a) && known.has(b))) ? [a, b] : null;
      }).filter(Boolean)
    : [];
  const desks = Array.isArray(groups.desks)
    ? groups.desks.slice(0, 60).map((desk, index) => ({
        index: integer(desk?.index, 0, 99, index),
        group: integer(desk?.group, 1, groupCount, 1),
        rotation: [0, 90, 180, 270].includes(Number(desk?.rotation)) ? Number(desk.rotation) : 0,
      }))
    : [];
  return {
    schemaVersion: 1,
    mode: ["general", "groups", "assessment"].includes(input.mode) ? input.mode : "general",
    general: {
      rows: integer(general.rows, 3, 10, 6),
      cols: integer(general.cols, 3, 10, 6),
      seats: seatList(general.seats, known),
      blocked: Array.isArray(general.blocked)
        ? [...new Set(general.blocked.map((item) => integer(item, 0, 99, -1)).filter((item) => item >= 0))].slice(0, 30)
        : [],
      focusStudentIds: uidList(general.focusStudentIds, known, 60),
      separationPairs,
      nominations: nominations(general.nominations, known),
    },
    groups: {
      groupCount,
      sizes,
      members: memberGroups,
      deskRows: integer(groups.deskRows, 3, 10, 6),
      deskCols: integer(groups.deskCols, 3, 10, 6),
      desks,
    },
    assessment: {
      lines: Number(assessment.lines) === 5 ? 5 : 6,
      seats: seatList(assessment.seats, known),
    },
  };
}

async function view(actor, requestedClassKey) {
  assertOperator(actor);
  const classKey = targetClassKey(actor, requestedClassKey);
  const [users, snapshot] = await Promise.all([
    classUsers(classKey),
    document("classroomLayouts", classKey).get(),
  ]);
  const roster = users.map((student) => ({
    uid: student.uid,
    name: student.name,
    number: student.number,
    studentNumber: student.studentNumber || "",
  }));
  const saved = snapshot.exists ? snapshot.data() : {};
  return {
    classKey,
    roster,
    classroomLayout: normalizeLayout(saved.classroomLayout, roster.map((student) => student.uid)),
    updatedAtMs: Number(saved.updatedAtMs || 0),
    updatedByName: safeText(saved.updatedByName, 40),
  };
}

async function save(actor, body) {
  assertOperator(actor);
  const classKey = targetClassKey(actor, body.classKey);
  const users = await classUsers(classKey);
  const ref = document("classroomLayouts", classKey);
  const previous = await ref.get();
  const before = previous.exists ? previous.data() : null;
  const classroomLayout = normalizeLayout(body.classroomLayout, users.map((student) => student.uid));
  const after = {
    schemaVersion: 1,
    classKey,
    classroomLayout,
    updatedAtMs: Date.now(),
    updatedByUid: actor.uid,
    updatedByName: safeText(actor.name, 40),
  };
  await ref.set(after, { merge: false });
  await appendOpsAudit({
    actor: { ...actor, classKey },
    action: "CLASSROOM_LAYOUT_UPDATE",
    collectionName: "classroomLayouts",
    recordId: classKey,
    before,
    after,
  });
  return { classKey, classroomLayout, updatedAtMs: after.updatedAtMs };
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
    if (String(body.action || "").toUpperCase() !== "SAVE") throw Object.assign(new Error("unsupported-action"), { status: 400 });
    return sendJson(res, 200, await save(actor, body), headers);
  } catch (error) {
    return sendJson(res, error?.status || 500, { error: error?.message || "classroom-layout-failed" }, headers);
  }
}
