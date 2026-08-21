import { firebaseAuth } from "../../lib/firebase.mjs";
import {
  getOAuthClient,
  issueAuthorizationCode,
  validateOAuthRequest,
} from "../../lib/oauth-store.mjs";
import {
  MCP_RESOURCE,
  allowedEmailDomains,
  normalizeScope,
} from "../../lib/oauth-config.mjs";
import { jsonBody, sendJson } from "../../lib/request.mjs";

const CLASS_KEY = /^([1-3])-(10|[1-9])$/;

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

export default async function oauthAuthorizeComplete(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return sendJson(res, 405, { error: "method_not_allowed" });
  }

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

    return sendJson(res, 200, {
      redirect: redirectWithCode(redirectUri, code, state),
    });
  } catch (error) {
    return sendJson(res, 400, {
      error: "access_denied",
      error_description: error?.message || "Authorization failed.",
    });
  }
}
