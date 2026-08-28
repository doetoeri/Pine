import { randomInt } from "node:crypto";
import { firebaseAuth, firestore } from "./firebase.mjs";

export const SCHOOL_ID = process.env.PINCON_SCHOOL_ID || "gochon-high";
export const ACCOUNT_SCHEMA_VERSION = 1;

export const ROLE = Object.freeze({
  STUDENT: "STUDENT",
  DEPARTMENT_HEAD: "DEPARTMENT_HEAD",
  SUBJECT_MANAGER: "SUBJECT_MANAGER",
  CLASS_PRESIDENT: "CLASS_PRESIDENT",
  TEACHER: "TEACHER",
  ADMIN: "ADMIN",
});

export const PHONE_STATUS = Object.freeze([
  "SUBMITTED",
  "NOT_SUBMITTED",
  "NOT_BROUGHT",
  "TEACHER_APPROVED",
  "ABSENT",
  "EARLY_LEAVE",
  "CHECK_REQUIRED",
]);

export const ROLE_TIMING = Object.freeze([
  "MORNING",
  "LUNCH",
  "CLEANING_TIME",
  "BEFORE_LEAVING",
  "WEEKLY",
]);

const ELEVATED = new Set([ROLE.CLASS_PRESIDENT, ROLE.TEACHER, ROLE.ADMIN]);
const ACCOUNT_STATUSES = new Set(["ACTIVE", "DISABLED"]);

function text(value, max = 160) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

export function validStudentNumber(value) {
  return /^\d{5}$/.test(String(value || ""));
}

export function studentEmail(studentNumber, schoolId = SCHOOL_ID) {
  if (!validStudentNumber(studentNumber)) throw new Error("invalid-student-number");
  const safeSchool = String(schoolId).toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 50);
  return `${safeSchool}.${studentNumber}@students.pincon.invalid`;
}

export function generateTemporaryPin(length = 8) {
  const size = Math.max(6, Math.min(12, Number(length) || 8));
  let pin = "";
  for (let index = 0; index < size; index += 1) pin += String(randomInt(0, 10));
  return pin;
}

export function normalizeRoles(value) {
  const input = Array.isArray(value) ? value : [];
  const allowed = new Set(Object.values(ROLE));
  const roles = [...new Set(input.map((item) => String(item || "").toUpperCase()).filter((item) => allowed.has(item)))];
  if (!roles.includes(ROLE.STUDENT)) roles.unshift(ROLE.STUDENT);
  return roles;
}

export function normalizeSubjectRoles(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const subject = text(item?.subject, 40);
    if (!subject || seen.has(subject)) continue;
    seen.add(subject);
    result.push({ subject, role: ROLE.SUBJECT_MANAGER });
    if (result.length >= 20) break;
  }
  return result;
}

export function normalizeClassKey(grade, classNumber) {
  const g = Number(grade);
  const c = Number(classNumber);
  if (!Number.isInteger(g) || g < 1 || g > 3 || !Number.isInteger(c) || c < 1 || c > 10) {
    throw new Error("invalid-class");
  }
  return `${g}-${c}`;
}

export function normalizeProfile(input = {}, { uid = "", existing = null } = {}) {
  const grade = Number(input.grade ?? existing?.grade);
  const classNumber = Number(input.classNumber ?? existing?.classNumber);
  const number = Number(input.number ?? existing?.number);
  const studentNumber = text(input.studentNumber ?? existing?.studentNumber, 12);
  if (!validStudentNumber(studentNumber)) throw new Error("invalid-student-number");
  if (!Number.isInteger(number) || number < 1 || number > 60) throw new Error("invalid-seat-number");
  const classKey = normalizeClassKey(grade, classNumber);
  const roles = normalizeRoles(input.roles ?? existing?.roles);
  const subjectRoles = normalizeSubjectRoles(input.subjectRoles ?? existing?.subjectRoles);
  if (subjectRoles.length && !roles.includes(ROLE.SUBJECT_MANAGER)) roles.push(ROLE.SUBJECT_MANAGER);
  const status = String(input.status ?? existing?.status ?? "ACTIVE").toUpperCase();
  if (!ACCOUNT_STATUSES.has(status)) throw new Error("invalid-account-status");

  return {
    schemaVersion: ACCOUNT_SCHEMA_VERSION,
    uid: text(uid || existing?.uid, 128),
    schoolId: SCHOOL_ID,
    studentNumber,
    name: text(input.name ?? existing?.name, 30),
    grade,
    classNumber,
    classKey,
    number,
    roles,
    subjectRoles,
    departmentId: text(input.departmentId ?? existing?.departmentId, 80),
    onePersonRoleId: text(input.onePersonRoleId ?? existing?.onePersonRoleId, 120),
    status,
    mustChangePin: Boolean(input.mustChangePin ?? existing?.mustChangePin ?? true),
  };
}

function bearer(req) {
  const header = String(req?.headers?.authorization || "");
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] || "";
}

export async function requireFirebaseUser(req) {
  const token = bearer(req);
  if (!token) throw Object.assign(new Error("authentication-required"), { status: 401 });
  try {
    return await firebaseAuth().verifyIdToken(token, true);
  } catch {
    throw Object.assign(new Error("authentication-required"), { status: 401 });
  }
}

export function userRef(uid) {
  return firestore().doc(`schools/${SCHOOL_ID}/users/${uid}`);
}

export function auditRef() {
  return firestore().collection(`schools/${SCHOOL_ID}/accountAudit`).doc();
}

export async function profileForUid(uid) {
  const snapshot = await userRef(uid).get();
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
}

export async function requireProfile(req, { allowDisabled = false } = {}) {
  const token = await requireFirebaseUser(req);
  const profile = await profileForUid(token.uid);
  if (!profile) throw Object.assign(new Error("account-not-provisioned"), { status: 403 });
  if (!allowDisabled && profile.status !== "ACTIVE") throw Object.assign(new Error("account-disabled"), { status: 403 });
  return { token, profile };
}

export function hasRole(profile, role) {
  return Array.isArray(profile?.roles) && profile.roles.includes(role);
}

export function isClassOperator(profile) {
  return [ROLE.CLASS_PRESIDENT, ROLE.TEACHER, ROLE.ADMIN].some((role) => hasRole(profile, role));
}

export function isAccountAdmin(profile) {
  return [ROLE.TEACHER, ROLE.ADMIN].some((role) => hasRole(profile, role));
}

export function canManageDepartment(profile, departmentId) {
  return isClassOperator(profile)
    || (hasRole(profile, ROLE.DEPARTMENT_HEAD) && Boolean(profile.departmentId) && profile.departmentId === departmentId);
}

export function canManageSubject(profile, subject) {
  if (isClassOperator(profile)) return true;
  if (!hasRole(profile, ROLE.SUBJECT_MANAGER)) return false;
  return Array.isArray(profile.subjectRoles) && profile.subjectRoles.some((item) => item?.subject === subject);
}

export function compatibilityRole(profile) {
  if (!profile || profile.status !== "ACTIVE") return null;
  if (hasRole(profile, ROLE.ADMIN)) return { enabled: true, level: "school", classKeys: [] };
  if (hasRole(profile, ROLE.TEACHER) || hasRole(profile, ROLE.CLASS_PRESIDENT)) {
    return { enabled: true, level: hasRole(profile, ROLE.CLASS_PRESIDENT) ? "president" : "class", classKeys: [profile.classKey] };
  }
  return null;
}

export async function syncCompatibilityRole(profile, actorUid) {
  const ref = firestore().doc(`schools/${SCHOOL_ID}/roles/${profile.uid}`);
  const compat = compatibilityRole(profile);
  if (!compat) {
    const existing = await ref.get();
    if (existing.exists && existing.data()?.managedByAccountSystem === true) {
      await ref.set({ enabled: false, managedByAccountSystem: true, updatedAtMs: Date.now(), updatedByUid: actorUid }, { merge: true });
    }
    return;
  }
  await ref.set({
    ...compat,
    managedByAccountSystem: true,
    updatedAtMs: Date.now(),
    updatedByUid: actorUid,
  }, { merge: true });
}

export function publicProfile(profile) {
  if (!profile) return null;
  return {
    uid: profile.uid,
    studentNumber: profile.studentNumber,
    name: profile.name,
    grade: profile.grade,
    classNumber: profile.classNumber,
    classKey: profile.classKey,
    number: profile.number,
    roles: normalizeRoles(profile.roles),
    subjectRoles: normalizeSubjectRoles(profile.subjectRoles),
    departmentId: profile.departmentId || "",
    onePersonRoleId: profile.onePersonRoleId || "",
    status: profile.status,
    mustChangePin: profile.mustChangePin === true,
  };
}

export async function appendAccountAudit({ actor, action, targetUid, before = null, after = null, metadata = {} }) {
  const ref = auditRef();
  const clean = (value) => {
    if (!value) return null;
    const copy = publicProfile(value) || {};
    delete copy.mustChangePin;
    return copy;
  };
  await ref.set({
    schemaVersion: 1,
    schoolId: SCHOOL_ID,
    classKey: after?.classKey || before?.classKey || actor?.classKey || "",
    action: text(action, 80),
    actorUid: actor?.uid || "system",
    actorName: text(actor?.name || "시스템", 40),
    targetUid: text(targetUid, 128),
    before: clean(before),
    after: clean(after),
    metadata: Object.fromEntries(Object.entries(metadata || {}).slice(0, 20).map(([key, value]) => [text(key, 60), text(value, 300)])),
    createdAtMs: Date.now(),
  });
}

export function corsHeaders(req) {
  const origin = String(req?.headers?.origin || "");
  const configured = String(process.env.PINCON_ALLOWED_ORIGINS || "https://pincon.app,https://www.pincon.app")
    .split(",").map((item) => item.trim()).filter(Boolean);
  const allowed = configured.includes(origin) || /^https:\/\/pine(?:-[a-z0-9-]+)?\.vercel\.app$/i.test(origin);
  return {
    "access-control-allow-origin": allowed ? origin : configured[0] || "https://pincon.app",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type",
    "access-control-max-age": "600",
    "vary": "Origin",
  };
}

export function assertSameClass(actor, target) {
  if (hasRole(actor, ROLE.ADMIN)) return;
  if (!actor?.classKey || actor.classKey !== target?.classKey) {
    throw Object.assign(new Error("class-scope-denied"), { status: 403 });
  }
}
