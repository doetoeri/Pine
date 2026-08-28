import { firestore } from "./firebase.mjs";
import { SCHOOL_ID, publicProfile } from "./class-accounts.mjs";
import { dateKey, safeText } from "./class-operations.mjs";

export const collection = (name) => firestore().collection(`schools/${SCHOOL_ID}/${name}`);
export const document = (name, id) => firestore().doc(`schools/${SCHOOL_ID}/${name}/${id}`);

export function safeSnapshot(value) {
  if (!value || typeof value !== "object") return null;
  const result = {};
  const denied = /pin|password|secret|token|email|phone(number)?|imei|serial|contact|account/i;
  for (const [key, item] of Object.entries(value).slice(0, 80)) {
    if (denied.test(key)) continue;
    if (item === null || typeof item === "boolean" || typeof item === "number") result[key] = item;
    else if (typeof item === "string") result[key] = item.slice(0, 800);
    else if (Array.isArray(item)) result[key] = item.slice(0, 30).map((entry) => {
      if (entry === null || typeof entry !== "object") return String(entry).slice(0, 240);
      return Object.fromEntries(Object.entries(entry).slice(0, 15).filter(([nestedKey]) => !denied.test(nestedKey)));
    });
  }
  return result;
}

export async function appendOpsAudit({ actor, action, collectionName, recordId, before = null, after = null, note = "" }) {
  const ref = collection("classOpsAudit").doc();
  await ref.set({
    schemaVersion: 1,
    schoolId: SCHOOL_ID,
    classKey: after?.classKey || before?.classKey || actor?.classKey || "",
    action: safeText(action, 80),
    collection: safeText(collectionName, 80),
    recordId: safeText(recordId, 180),
    actorUid: actor?.uid || "system",
    actorName: safeText(actor?.name || "시스템", 40),
    actorRoles: Array.isArray(actor?.roles) ? actor.roles.slice(0, 10) : [],
    before: safeSnapshot(before),
    after: safeSnapshot(after),
    note: safeText(note, 300),
    createdAtMs: Date.now(),
  });
  return ref.id;
}

export async function classUsers(classKey, { activeOnly = true } = {}) {
  let query = collection("users").where("classKey", "==", classKey).limit(80);
  if (activeOnly) query = query.where("status", "==", "ACTIVE");
  const snapshot = await query.get();
  return snapshot.docs
    .map((doc) => publicProfile({ id: doc.id, ...doc.data() }))
    .filter(Boolean)
    .sort((a, b) => a.number - b.number);
}

export async function departmentUsers(classKey, departmentId) {
  const users = await classUsers(classKey);
  return users.filter((item) => item.departmentId === departmentId);
}

export async function classSettings(classKey) {
  const ref = document("classOpsSettings", classKey);
  const snapshot = await ref.get();
  const defaults = {
    schemaVersion: 1,
    classKey,
    phoneMovementPolicy: "KEEP_IN_CLASSROOM",
    cleaningAutoAssignEnabled: true,
    cleaningExemptionPolicy: {
      HEALTH: { enabled: true, label: "건강 사유" },
      ABSENCE: { enabled: true, label: "결석" },
      SCHOOL_SCHEDULE: { enabled: true, label: "학교 일정" },
      OTHER: { enabled: true, label: "기타 정당한 사유" },
    },
  };
  return snapshot.exists ? { ...defaults, ...snapshot.data(), id: snapshot.id } : defaults;
}

export async function activeExemptions(classKey, date = dateKey()) {
  const snapshot = await collection("cleaningExemptions")
    .where("classKey", "==", classKey)
    .where("date", "==", date)
    .where("status", "==", "APPROVED")
    .limit(80)
    .get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export async function cleaningAssignmentsForMonth(classKey, departmentId, date = dateKey()) {
  const from = `${date.slice(0, 7)}-01`;
  const to = `${date.slice(0, 7)}-31`;
  const snapshot = await collection("cleaningAssignments")
    .where("classKey", "==", classKey)
    .where("departmentId", "==", departmentId)
    .where("date", ">=", from)
    .where("date", "<=", to)
    .limit(200)
    .get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export function assignmentId(classKey, departmentId, date = dateKey()) {
  return `${classKey}_${safeText(departmentId, 60)}_${date}`.replace(/[^a-zA-Z0-9가-힣_-]/g, "-");
}

export function phoneStateId(classKey, date, uid) {
  return `${classKey}_${date}_${uid}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export async function phoneStates(classKey, date = dateKey()) {
  const snapshot = await collection("phoneStates")
    .where("classKey", "==", classKey)
    .where("date", "==", date)
    .limit(80)
    .get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export async function ownPhoneState(profile, date = dateKey()) {
  const snapshot = await document("phoneStates", phoneStateId(profile.classKey, date, profile.uid)).get();
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
}

export async function onePersonRoleFor(profile) {
  if (!profile?.onePersonRoleId) return null;
  const snapshot = await document("onePersonRoles", profile.onePersonRoleId).get();
  if (!snapshot.exists) return null;
  const role = { id: snapshot.id, ...snapshot.data() };
  return role.classKey === profile.classKey && role.active !== false ? role : null;
}
