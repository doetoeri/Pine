import { readOnly } from "../../lib/http.mjs";
import { getTimetable } from "../../lib/pincon-data.mjs";

export default readOnly((params) => getTimetable({
  classKey: params.get("classKey"),
  date: params.get("date") || undefined,
}));
