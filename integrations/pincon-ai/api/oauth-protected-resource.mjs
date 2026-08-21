import {
  MCP_RESOURCE,
  OAUTH_ISSUER,
  OAUTH_SCOPES,
  PUBLIC_ORIGIN,
} from "../lib/oauth-config.mjs";
import { sendJson } from "../lib/request.mjs";

export default async function oauthProtectedResource(req, res) {
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    return sendJson(res, 405, { error: "method_not_allowed" });
  }

  return sendJson(res, 200, {
    resource: MCP_RESOURCE,
    authorization_servers: [OAUTH_ISSUER],
    scopes_supported: OAUTH_SCOPES,
    bearer_methods_supported: ["header"],
    resource_documentation: `${PUBLIC_ORIGIN}/docs.html`,
  });
}
