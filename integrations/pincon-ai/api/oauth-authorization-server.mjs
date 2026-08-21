import {
  OAUTH_ISSUER,
  OAUTH_SCOPES,
  PUBLIC_ORIGIN,
} from "../lib/oauth-config.mjs";
import { sendJson } from "../lib/request.mjs";

export default async function oauthAuthorizationServer(req, res) {
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    return sendJson(res, 405, { error: "method_not_allowed" });
  }

  return sendJson(res, 200, {
    issuer: OAUTH_ISSUER,
    authorization_endpoint: `${PUBLIC_ORIGIN}/oauth/authorize`,
    token_endpoint: `${PUBLIC_ORIGIN}/oauth/token`,
    registration_endpoint: `${PUBLIC_ORIGIN}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: OAUTH_SCOPES,
    token_endpoint_auth_methods_supported: ["none"],
  });
}
