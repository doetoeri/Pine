// PinCon Dream Challenge 2026: notification-frequency study configuration.
// This module is intentionally inert: importing it never sends notifications or tracks users.
export const STUDY_VERSION = "2026-10-pilot-1";
export const STUDY_GROUPS = Object.freeze({
  A: Object.freeze({ dailyExperimentalNotifications: 0, label: "알림 없음" }),
  B: Object.freeze({ dailyExperimentalNotifications: 1, label: "하루 요약" }),
  C: Object.freeze({ dailyExperimentalNotifications: 3, label: "분산 알림" }),
});
export const STUDY_CONTENT_CATEGORIES = Object.freeze([
  "routine-schedule", "routine-meal", "routine-study-summary",
]);
export const STUDY_EVENTS = Object.freeze([
  "experimental_notification_sent",
  "experimental_notification_opened",
  "information_viewed",
  "app_session_started",
  "survey_submitted",
  "participation_withdrawn",
]);
export const STUDY_POLICY = Object.freeze({
  optInRequired: true,
  defaultEnabled: false,
  allowWithdrawal: true,
  collectNames: false,
  collectRawDeviceIdentifiers: false,
  criticalNoticesExcluded: true,
  liveDeliveryEnabled: false,
  // Do not interpret a notification click as confirmed information comprehension.
  measureInformationViewsSeparately: true,
});
export function validateStudyGroup(group) {
  return Object.prototype.hasOwnProperty.call(STUDY_GROUPS, group);
}
export function dailyNotificationSlots(group) {
  if (!validateStudyGroup(group)) throw new TypeError("Unknown study group");
  // Clock times are intentionally not assigned until class schedules and consent are confirmed.
  return STUDY_GROUPS[group].dailyExperimentalNotifications;
}
