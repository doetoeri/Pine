// Emit only fixed, non-identifying error categories in CI logs and heartbeats.
// Never serialize Error objects or reflect arbitrary provider-supplied codes.
const KNOWN_ERROR_CODES = new Set([
  "permission-denied", "unauthenticated", "unavailable", "deadline-exceeded",
  "resource-exhausted", "failed-precondition", "invalid-argument", "internal",
  "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ECONNABORTED",
  "messaging/server-unavailable", "messaging/internal-error",
  "messaging/authentication-error", "messaging/invalid-argument",
  "messaging/invalid-registration-token", "messaging/registration-token-not-registered",
  "messaging/mismatched-credential", "messaging/third-party-auth-error",
  "messaging/message-rate-exceeded", "messaging/device-message-rate-exceeded",
  "messaging/topics-message-rate-exceeded", "messaging/invalid-apns-credentials",
  "app/no-app", "app/invalid-credential",
]);

export function safeNotificationErrorCode(error) {
  try {
    const code = error?.code;
    return typeof code === "string" && KNOWN_ERROR_CODES.has(code)
      ? code : "dispatcher-failed";
  } catch {
    return "dispatcher-failed";
  }
}

export function notificationFailureSummary(error) {
  return { component: "notification-frequency", status: "error", errorCode: safeNotificationErrorCode(error) };
}
