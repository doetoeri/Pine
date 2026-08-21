import { readOnly } from "../../lib/http.mjs";
import { getMeal } from "../../lib/pincon-data.mjs";

export default readOnly((params) => getMeal({
  date: params.get("date") || undefined,
}));
