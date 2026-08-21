import { registerOAuthClient } from "../../lib/oauth-store.mjs";
import { jsonBody, sendJson } from "../../lib/request.mjs";

export default async function oauthRegister(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return sendJson(res, 405, { error: "method_not_allowed" });
  }

  try {
    const input = await jsonBody(req);
    const client = await registerOAuthClient(input);
    return sendJson(res, 201, {
      client_id: client.clientId,
      client_id_issued_at: Math.floor(client.createdAtMs / 1000),
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: client.grantTypes,
      response_types: client.responseTypes,
    });
  } catch (error) {
    return sendJson(res, 400, {
      error: "invalid_client_metadata",
      error_description: error?.message || "Client registration failed.",
    });
  }
}
