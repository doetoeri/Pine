import { firebaseAuth } from "../lib/firebase.mjs";
import {
  MCP_RESOURCE,
  OAUTH_ISSUER,
  OAUTH_SCOPES,
  PUBLIC_ORIGIN,
  allowedEmailDomains,
  normalizeScope,
} from "../lib/oauth-config.mjs";
import {
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  getOAuthClient,
  issueAuthorizationCode,
  registerOAuthClient,
  validateOAuthRequest,
} from "../lib/oauth-store.mjs";
import { formBody, jsonBody, sendJson } from "../lib/request.mjs";

const CLASS_KEY = /^([1-3])-(10|[1-9])$/;

function oauthError(res, status, error, description) {
  return sendJson(res, status, {
    error,
    error_description: description,
  }, { pragma: "no-cache" });
}

function emailAllowed(email) {
  const domains = allowedEmailDomains();
  if (!domains.length) return true;
  const normalized = String(email || "").trim().toLowerCase();
  return domains.some((domain) => normalized.endsWith(`@${domain}`));
}

function redirectWithCode(redirectUri, code, state) {
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

async function protectedResource(req, res) {
  if (req.method !== "GET") return oauthError(res, 405, "method_not_allowed", "GET is required.");
  return sendJson(res, 200, {
    resource: MCP_RESOURCE,
    authorization_servers: [OAUTH_ISSUER],
    scopes_supported: OAUTH_SCOPES,
    bearer_methods_supported: ["header"],
    resource_documentation: `${PUBLIC_ORIGIN}/docs.html`,
  });
}

async function authorizationServer(req, res) {
  if (req.method !== "GET") return oauthError(res, 405, "method_not_allowed", "GET is required.");
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

async function register(req, res) {
  if (req.method !== "POST") return oauthError(res, 405, "method_not_allowed", "POST is required.");
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
    return oauthError(res, 400, "invalid_client_metadata", error?.message || "Client registration failed.");
  }
}

async function token(req, res) {
  if (req.method !== "POST") return oauthError(res, 405, "invalid_request", "POST is required.");
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

async function authorizeComplete(req, res) {
  if (req.method !== "POST") return oauthError(res, 405, "method_not_allowed", "POST is required.");
  try {
    const input = await jsonBody(req);
    const clientId = String(input.client_id || "");
    const redirectUri = String(input.redirect_uri || "");
    const resource = String(input.resource || "");
    const codeChallenge = String(input.code_challenge || "");
    const codeChallengeMethod = String(input.code_challenge_method || "");
    const state = String(input.state || "");
    const classKey = String(input.classKey || "");

    if (!CLASS_KEY.test(classKey)) throw new Error("Choose a valid PinCon class.");
    if (resource !== MCP_RESOURCE) throw new Error("Invalid resource.");
    if (String(input.response_type || "") !== "code") throw new Error("Only response_type=code is supported.");

    const scopes = normalizeScope(input.scope);
    const client = await getOAuthClient(clientId);
    validateOAuthRequest({ client, redirectUri, resource, codeChallenge, codeChallengeMethod });

    const decoded = await firebaseAuth().verifyIdToken(String(input.idToken || ""), true);
    const email = decoded.email || "";
    if (!decoded.uid) throw new Error("Firebase user identity is missing.");
    if (!emailAllowed(email)) throw new Error("This Google account is not allowed to connect to PinCon.");

    const code = await issueAuthorizationCode({
      clientId,
      redirectUri,
      codeChallenge,
      resource,
      scope: scopes.join(" "),
      uid: decoded.uid,
      email,
      classKey,
    });

    return sendJson(res, 200, { redirect: redirectWithCode(redirectUri, code, state) });
  } catch (error) {
    return oauthError(res, 400, "access_denied", error?.message || "Authorization failed.");
  }
}

const routes = {
  "protected-resource": protectedResource,
  "authorization-server": authorizationServer,
  register,
  token,
  "authorize-complete": authorizeComplete,
};

export default async function oauthRouter(req, res) {
  const url = new URL(req.url || "/", "https://pincon.invalid");
  const route = url.searchParams.get("route") || "";
  const handler = routes[route];
  if (!handler) return oauthError(res, 404, "not_found", "Unknown OAuth route.");
  return handler(req, res);
}
