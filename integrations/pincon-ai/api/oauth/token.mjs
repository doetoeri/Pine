import {
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  getOAuthClient,
} from "../../lib/oauth-store.mjs";
import { MCP_RESOURCE } from "../../lib/oauth-config.mjs";
import { formBody, sendJson } from "../../lib/request.mjs";

function oauthError(res, status, error, description) {
  return sendJson(res, status, {
    error,
    error_description: description,
  }, {
    pragma: "no-cache",
  });
}

export default async function oauthToken(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return oauthError(res, 405, "invalid_request", "POST is required.");
  }

  try {
    const form = await formBody(req);
    const grantType = form.get("grant_type") || "";
    const clientId = form.get("client_id") || "";
    const resource = form.get("resource") || "";

    const client = await getOAuthClient(clientId);
    if (!client) return oauthError(res, 400, "invalid_client", "Unknown client_id.");
    if (resource !== MCP_RESOURCE) return oauthError(res, 400, "invalid_target", "resource must identify the PinCon MCP server.");

    let tokens;
    if (grantType === "authorization_code") {
      tokens = await exchangeAuthorizationCode({
        code: form.get("code") || "",
        clientId,
        redirectUri: form.get("redirect_uri") || "",
        codeVerifier: form.get("code_verifier") || "",
        resource,
      });
    } else if (grantType === "refresh_token") {
      tokens = await exchangeRefreshToken({
        refreshToken: form.get("refresh_token") || "",
        clientId,
        resource,
      });
    } else {
      return oauthError(res, 400, "unsupported_grant_type", "Use authorization_code or refresh_token.");
    }

    return sendJson(res, 200, tokens, { pragma: "no-cache" });
  } catch (error) {
    return oauthError(res, 400, "invalid_grant", error?.message || "Token exchange failed.");
  }
}
