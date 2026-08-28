import { randomInt } from "node:crypto";
import { firestore } from "./firebase.mjs";
import {
  PHONE_STATUS,
  ROLE,
  SCHOOL_ID,
  canManageDepartment,
  canManageSubject,
  hasRole,
  isClassOperator,
} from "./class-accounts.mjs";

export const CLEANING_STATUS = Object.freeze([
  "ASSIGNED",
  "ACCEPTED",
  "EXCHANGE_PENDING",
  "EXEMPTION_PENDING",
  "COMPLETED",
  "EXEMPTED",
]);

export const REQUEST_STATUS = Object.freeze(["PENDING", "ACCEPTED", "APPROVED", "REJECTED", "CANCELLED"]);
export const SUBJECT_ENTRY_TYPE = Object.freeze(["HOMEWORK", "MATERIAL", "WORKSHEET", "NOTICE", "ASSESSMENT", "CLASSROOM_CHANGE"]);

export function dateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function monthStart(date = dateKey()) {
  return `${String(date).slice(0, 7)}-01`;
}

export function safeText(value, max = 400) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

export function phoneStatus(value) {
  const normalized = String(value || "").toUpperCase();
  if (!PHONE_STATUS.includes(normalized)) throw new Error("invalid-phone-status");
  return normalized;
}

export function subjectEntryType(value) {
  const normalized = String(value || "").toUpperCase();
  if (!SUBJECT_ENTRY_TYPE.includes(normalized)) throw new Error("invalid-subject-entry-type");
  return normalized;
}

export function cleaningReason(candidate, stats) {
  const stat = stats.get(candidate.uid) || { count: 0, lastDate: "" };
  if (stat.count === 0) return "이번 달 담당 횟수가 가장 적습니다.";
  return `이번 달 ${stat.count}회 담당했고, 마지막 담당일이 ${stat.lastDate || "기록 없음"}입니다.`;
}

export function recommendCleaningCandidate(candidates, assignments, { lastAssigneeUid = "", excludedUids = [] } = {}) {
  const excluded = new Set(excludedUids);
  const active = (candidates || []).filter((item) => item?.uid && item.status === "ACTIVE" && !excluded.has(item.uid));
  if (!active.length) return null;

  const stats = new Map(active.map((item) => [item.uid, { count: 0, lastDate: "" }]));
  for (const assignment of assignments || []) {
    const stat = stats.get(assignment?.assigneeUid);
    if (!stat || assignment.status === "EXEMPTED") continue;
    stat.count += 1;
    if (String(assignment.date || "") > stat.lastDate) stat.lastDate = String(assignment.date || "");
  }

  const ranked = active.map((candidate) => {
    const stat = stats.get(candidate.uid) || { count: 0, lastDate: "" };
    const repeatPenalty = candidate.uid === lastAssigneeUid ? 1 : 0;
    const burden = Math.max(0, (candidate.roles?.length || 1) - 1) + (candidate.onePersonRoleId ? 1 : 0) + (candidate.subjectRoles?.length || 0);
    return { candidate, stat, repeatPenalty, burden };
  }).sort((a, b) => (
    a.stat.count - b.stat.count
    || String(a.stat.lastDate || "").localeCompare(String(b.stat.lastDate || ""))
    || a.repeatPenalty - b.repeatPenalty
    || a.burden - b.burden
  ));

  const best = ranked[0];
  const ties = ranked.filter((item) => item.stat.count === best.stat.count
    && String(item.stat.lastDate || "") === String(best.stat.lastDate || "")
    && item.repeatPenalty === best.repeatPenalty
    && item.burden === best.burden);
  const chosen = ties[randomInt(0, ties.length)];
  return {
    user: chosen.candidate,
    count: chosen.stat.count,
    lastDate: chosen.stat.lastDate,
    repeatPenalty: chosen.repeatPenalty,
    burden: chosen.burden,
    reason: cleaningReason(chosen.candidate, stats),
  };
}

export async function onePersonRole(profile) {
  if (!profile?.onePersonRoleId) return null;
  const snapshot = await firestore().doc(`schools/${SCHOOL_ID}/onePersonRoles/${profile.onePersonRoleId}`).get();
  if (!snapshot.exists) return null;
  const role = { id: snapshot.id, ...snapshot.data() };
  return role.classKey === profile.classKey && role.active !== false ? role : null;
}

export async function canManagePhone(profile) {
  if (isClassOperator(profile)) return true;
  const role = await onePersonRole(profile);
  return Array.isArray(role?.permissions) && role.permissions.includes("MANAGE_PHONE");
}

export function assertDepartmentPermission(profile, departmentId) {
  if (!canManageDepartment(profile, departmentId)) throw Object.assign(new Error("department-scope-denied"), { status: 403 });
}

export function assertSubjectPermission(profile, subject) {
  if (!canManageSubject(profile, subject)) throw Object.assign(new Error("subject-scope-denied"), { status: 403 });
}

export function assertClassOperator(profile) {
  if (!isClassOperator(profile)) throw Object.assign(new Error("class-operator-required"), { status: 403 });
}

export function isDepartmentHead(profile) {
  return hasRole(profile, ROLE.DEPARTMENT_HEAD);
}
