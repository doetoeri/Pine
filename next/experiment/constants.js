export const EXPERIMENT_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  CANARY: "CANARY",
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  ROLLOUT: "ROLLOUT",
  COMPLETED: "COMPLETED",
  ABORTED: "ABORTED",
});

export const RUNNING_STATUSES = Object.freeze(new Set([
  EXPERIMENT_STATUS.CANARY,
  EXPERIMENT_STATUS.ACTIVE,
  EXPERIMENT_STATUS.ROLLOUT,
]));

export const UI_EXPERIMENT_ID = "pincon-next-ui";
export const NOTIFICATION_EXPERIMENT_ID = "notification-frequency";
export const UI_FLAG_ID = "pincon_next_ui";
export const NOTIFICATION_FLAG_ID = "notification_experiment";

export const UI_VARIANTS = Object.freeze(["legacy", "next"]);
export const NOTIFICATION_CONDITIONS = Object.freeze(["LOW", "MID", "HIGH"]);

export const STABLE_UI_VARIANT = "legacy";
export const EXPERIMENT_SCHEMA_VERSION = 1;

export const ALLOWED_EVENT_TYPES = Object.freeze(new Set([
  "session_start",
  "session_end",
  "schedule_view",
  "assignment_view",
  "material_view",
  "notice_view",
  "meal_view",
  "notification_click",
  "notification_received",
  "navigation_change",
  "item_expand",
  "task_start",
  "target_information_view",
  "return_visit",
  "js_error",
  "data_load_failure",
  "login_failure",
  "fcm_failure",
  "page_load",
  "navigation_error",
  "ui_satisfaction",
  "notification_scheduled",
  "notification_sent",
  "app_open_after_notification_5m",
  "app_open_after_notification_30m",
  "app_open_after_notification_1h",
  "target_view_after_notification",
]));

export const ALLOWED_EVENT_PROPERTY_KEYS = Object.freeze(new Set([
  "from",
  "to",
  "route",
  "task",
  "itemType",
  "durationMs",
  "errorType",
  "source",
  "notificationId",
  "condition",
  "category",
  "window",
  "value",
  "reason",
]));

export function experimentIsRunning(status) {
  return RUNNING_STATUSES.has(String(status || ""));
}

export function deviceCategory() {
  const width = Math.min(
    Number(globalThis.innerWidth || 0) || Number(globalThis.screen?.width || 0),
    Number(globalThis.screen?.width || 0) || Number(globalThis.innerWidth || 0),
  );
  if (width > 0 && width < 600) return "mobile";
  if (width > 0 && width < 1024) return "tablet";
  return "desktop";
}
