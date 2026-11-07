// Keep third-party HTTP client internals and request metadata out of public CI logs.
export function summarizeComciganError(error, { stage = "priority-sync", attempt } = {}) {
  const rawCode = typeof error?.code === "string" ? error.code : "";
  const code = /^[A-Z][A-Z0-9_]{0,47}$/.test(rawCode) ? rawCode : "UNKNOWN";
  const allowedStages = new Set(["school-search", "timetable", "priority-sync"]);
  const result = { code, stage: allowedStages.has(stage) ? stage : "priority-sync" };
  if (Number.isInteger(attempt) && attempt >= 1 && attempt <= 3) result.attempt = attempt;
  return result;
}
