import { academicSchedulesForGrade, normalizedRecord } from "../../../pincon-class-ops-core.js";
// These collections already permit anonymous reads in firestore.rules. No tokens,
// Admin SDK credentials or service-account authorization are used by this path.
export const PUBLIC_SCHOOL_COLLECTIONS = Object.freeze(["classSettings", "announcements", "classAssignments", "events", "academicSchedules", "neisTimetables", "meals", "content"]);
export function publicRows(name, rows, profile) {
  const visible = rows.filter((r) => !r.deleted && !r.__private && !r.personalNotification && !r.targetStudentNumber && r.published !== false && r.status !== "draft");
  return name === "academicSchedules" ? academicSchedulesForGrade(visible, profile?.grade) : visible;
}
export function decodeValue(value = {}) {
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) return value.timestampValue;
  if (value.arrayValue) return (value.arrayValue.values || []).map(decodeValue);
  if (value.mapValue) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([k,v]) => [k, decodeValue(v)]));
  return null;
}
export function schoolQuery(name, classKey, date) {
  if (!PUBLIC_SCHOOL_COLLECTIONS.includes(name)) throw new Error("non-public-collection");
  const field = ["meals", "academicSchedules"].includes(name) ? "date" : name === "content" ? "targets" : "classKey";
  const op = field === "date" ? "GREATER_THAN_OR_EQUAL" : field === "targets" ? "ARRAY_CONTAINS" : "EQUAL";
  return { from: [{ collectionId: name }], where: { fieldFilter: { field: { fieldPath: field }, op, value: { stringValue: field === "date" ? date : classKey } } }, limit: 250 };
}
export async function fetchPublicSchool(name, profile, { signal, fetcher = fetch } = {}) {
  const config = globalThis.PINCON_FIREBASE_CONFIG || {};
  const school = globalThis.PINCON_SCHOOL_CONFIG?.id || "gochon-high";
  const date = new Date(Date.now() - 86400000 + 9*3600000).toISOString().slice(0,10);
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/databases/(default)/documents/schools/${encodeURIComponent(school)}:runQuery?key=${encodeURIComponent(config.apiKey)}`;
  const response = await fetcher(url, { method: "POST", headers: { "content-type": "application/json" }, credentials: "omit", cache: "no-store", signal, body: JSON.stringify({ structuredQuery: schoolQuery(name, profile.classKey, date) }) });
  if (!response.ok) throw new Error("학교 정보를 불러오지 못했습니다.");
  const payload = await response.json();
  return publicRows(name, payload.filter((r) => r.document).map(({document: d}) => normalizedRecord({ ...Object.fromEntries(Object.entries(d.fields || {}).map(([k,v]) => [k,decodeValue(v)])), id: d.name.split("/").at(-1) })), profile);
}
