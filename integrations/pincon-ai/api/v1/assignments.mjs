import { readOnly } from "../../lib/http.mjs";
import { getAssignments } from "../../lib/pincon-data.mjs";

export default readOnly((params) => getAssignments({
  classKey: params.get("classKey"),
  startDate: params.get("startDate") || params.get("date") || undefined,
  endDate: params.get("endDate") || params.get("date") || undefined,
}));
