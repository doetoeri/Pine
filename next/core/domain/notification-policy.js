export const NOTIFICATION_CATEGORIES = Object.freeze({ assessment:"수행평가", preparation:"준비물", timetable:"시간표 변경", event:"행사", classroom:"학급 운영", urgent:"긴급 공지" });
export function categoryFor(item) {
  return ({assessmentToday:"assessment",assessmentTomorrow:"assessment",importantPreparation:"preparation",timetableChange:"timetable",eventStart:"event",pollClosing:"classroom",urgentAnnouncement:"urgent"})[item.preference] || item.category || "classroom";
}
export function allowsNotification(preferences, item) {
  return preferences?.[categoryFor(item)] !== false && preferences?.[item.preference] !== false;
}
export function notificationDelivery(item, today) {
  if (item.priority === "urgent") return "immediate";
  if ((item.date || item.dueDate) === today && ["TIMETABLE_CHANGE", "CLASSROOM_CHANGE", "CANCELLED", "URGENT_OPERATION"].includes(item.type)) return "immediate";
  return "briefing";
}
