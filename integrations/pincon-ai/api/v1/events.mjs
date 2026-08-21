import { readOnly } from "../../lib/http.mjs";
import { getSchoolEvents } from "../../lib/pincon-data.mjs";

export default readOnly((params) => getSchoolEvents({
  classKey: params.get("classKey"),
  startDate: params.get("startDate") || params.get("date") || undefined,
  endDate: params.get("endDate") || params.get("date") || undefined,
}));
