// Only allow fixed, non-identifying transport error categories in CI logs.
// Provider-supplied codes are untrusted, even when they match an uppercase pattern.
const SAFE_CODES = new Set([
  "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN",
  "ECONNABORTED", "ERR_NETWORK", "ERR_BAD_RESPONSE", "ERR_CANCELED",
]);
const SAFE_STAGES = new Set(["school-search", "timetable", "priority-sync"]);

export function summarizeComciganError(error, { stage = "priority-sync", attempt } = {}) {
  let code = "UNKNOWN";
  try {
    const rawCode = error?.code;
    if (typeof rawCode === "string" && SAFE_CODES.has(rawCode)) code = rawCode;
  } catch {
    // A malicious or malformed error object must never break the logger.
  }
  const result = { code, stage: SAFE_STAGES.has(stage) ? stage : "priority-sync" };
  if (Number.isInteger(attempt) && attempt >= 1 && attempt <= 3) result.attempt = attempt;
  return result;
}
