import { readOnly } from "../../lib/http.mjs";
import { getUpcoming } from "../../lib/pincon-data.mjs";

export default readOnly((params) => getUpcoming({
  classKey: params.get("classKey"),
  date: params.get("date") || undefined,
  days: params.get("days") || undefined,
}));
