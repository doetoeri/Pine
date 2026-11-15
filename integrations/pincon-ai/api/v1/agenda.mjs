import { readOnly } from "../../lib/http.mjs";
import { getToday, getUpcoming } from "../../lib/pincon-data.mjs";

export default readOnly(params => {
  const agenda = {
    classKey: params.get("classKey"),
    date: params.get("date") || undefined,
  };
  return params.get("agendaView") === "upcoming" ? getUpcoming({ ...agenda, days: params.get("days") || undefined })
    : getToday(agenda);
});
