import { readOnly } from "../../lib/http.mjs";
import { getToday } from "../../lib/pincon-data.mjs";

export default readOnly((params) => getToday({
  classKey: params.get("classKey"),
  date: params.get("date") || undefined,
}));
