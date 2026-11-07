// A bounded, code-only error summary for workflow logs and runtime heartbeats.
// Never serialize Error objects: Firebase/HTTP errors can include request data.
export function safeNotificationErrorCode(error) {
  const code = error?.code;
  return typeof code === "string" && /^[A-Za-z][A-Za-z0-9/_-]{0,63}$/.test(code)
    ? code : "dispatcher-failed";
}

export function notificationFailureSummary(error) {
  return { component: "notification-frequency", status: "error", errorCode: safeNotificationErrorCode(error) };
}
