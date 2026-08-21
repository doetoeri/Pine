import { timingSafeEqual } from "node:crypto";
import { MCP_RESOURCE, OAUTH_SCOPE, RESOURCE_METADATA_URL } from "./oauth-config.mjs";
import { verifyOAuthAccessToken } from "./oauth-store.mjs";

function bearerToken(req) {
  const value = req?.headers?.authorization || req?.headers?.Authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(String(value));
  return match?.[1]?.trim() || "";
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (!left.length || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function challenge(error = "invalid_token", description = "Connect PinCon to continue.") {
  const clean = String(description).replace(/["\\]/g, "");
  return `Bearer resource_metadata="${RESOURCE_METADATA_URL}", scope="${OAUTH_SCOPE}", error="${error}", error_description="${clean}"`;
}

export async function authorizeRequest(req) {
  const supplied = bearerToken(req);
  const configured = String(process.env.PINCON_API_KEY || "").trim();

  if (configured && safeEqual(supplied, configured)) {
    return {
      ok: true,
      principal: {
        type: "service",
        scopes: [OAUTH_SCOPE],
        resource: MCP_RESOURCE,
        classKey: null,
      },
    };
  }

  const oauth = await verifyOAuthAccessToken(supplied);
  if (oauth) return { ok: true, principal: oauth };

  return {
    ok: false,
    status: 401,
    error: "Unauthorized",
    challenge: challenge(),
  };
}

export async function enforceAuth(req, res) {
  const result = await authorizeRequest(req);
  if (result.ok) return result.principal;

  res.statusCode = result.status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("www-authenticate", result.challenge || challenge());
  res.end(JSON.stringify({ ok: false, error: result.error }));
  return null;
}

export function oauthChallenge(error, description) {
  return challenge(error, description);
}
