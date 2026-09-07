import { readOnly } from "../lib/http.mjs";
import {
  getAssignments,
  getMeal,
  getNotices,
  getSchoolEvents,
  getTimetable,
  getToday,
  getUpcoming,
} from "../lib/pincon-data.mjs";

const handlers = Object.freeze({
  assignments: (params) => getAssignments({
    classKey: params.get("classKey"),
    startDate: params.get("startDate") || params.get("date") || undefined,
    endDate: params.get("endDate") || params.get("date") || undefined,
  }),
  events: (params) => getSchoolEvents({
    classKey: params.get("classKey"),
    startDate: params.get("startDate") || params.get("date") || undefined,
    endDate: params.get("endDate") || params.get("date") || undefined,
  }),
  meals: (params) => getMeal({
    date: params.get("date") || undefined,
  }),
  notices: (params) => getNotices({
    classKey: params.get("classKey"),
    limit: params.get("limit") || undefined,
  }),
  timetable: (params) => getTimetable({
    classKey: params.get("classKey"),
    date: params.get("date") || undefined,
  }),
  today: (params) => getToday({
    classKey: params.get("classKey"),
    date: params.get("date") || undefined,
  }),
  upcoming: (params) => getUpcoming({
    classKey: params.get("classKey"),
    date: params.get("date") || undefined,
    days: params.get("days") || undefined,
  }),
});

export default readOnly((params) => {
  const route = String(params.get("route") || "").trim();
  const handler = handlers[route];
  if (!handler) throw new Error("This PinCon API route is not allowed.");
  return handler(params);
});
