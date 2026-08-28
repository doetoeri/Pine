import { corsHeaders, publicProfile, requireProfile } from "../../lib/class-accounts.mjs";
import { sendJson } from "../../lib/request.mjs";

export default async function accountSession(req, res) {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return sendJson(res, 204, {}, headers);
  if (req.method !== "GET") return sendJson(res, 405, { error: "method-not-allowed" }, headers);

  try {
    const { profile } = await requireProfile(req);
    return sendJson(res, 200, { account: publicProfile(profile) }, headers);
  } catch (error) {
    return sendJson(res, error?.status || 500, { error: error?.message || "session-failed" }, headers);
  }
}
