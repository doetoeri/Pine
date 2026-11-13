// Log only fixed, non-identifying error categories. Never serialize Error,
// message, stack, request config, headers, or arbitrary provider error codes.
const KNOWN_CODES = new Set([
  "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN",
  "ECONNABORTED", "ERR_NETWORK", "ERR_BAD_RESPONSE", "ERR_CANCELED",
]);

export function safeAutomationErrorCode(error) {
  try {
    if (error?.name === "SyntaxError") return "INVALID_JSON";
    const code = error?.code;
    return typeof code === "string" && KNOWN_CODES.has(code) ? code : "UPSTREAM_FAILURE";
  } catch {
    return "UPSTREAM_FAILURE";
  }
}
