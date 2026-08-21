import { readOnly } from "../../lib/http.mjs";
import { getNotices } from "../../lib/pincon-data.mjs";

export default readOnly((params) => getNotices({
  classKey: params.get("classKey"),
  limit: params.get("limit") || undefined,
}));
