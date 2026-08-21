import { createHash, randomBytes } from "node:crypto";
import { firestore } from "./firebase.mjs";
import {
  ACCESS_TOKEN_TTL_MS,
  AUTH_CODE_TTL_MS,
  MCP_RESOURCE,
  OAUTH_SCOPE,
  REFRESH_TOKEN_TTL_MS,
  normalizeScope,
} from "./oauth-config.mjs";

const CLIENTS = "pinconOAuthClients";
const CODES = "pinconOAuthCodes";
const ACCESS = "pinconOAuthAccessTokens";
const REFRESH = "pinconOAuthRefreshTokens";

function token(prefix, bytes = 32) {
  return `${prefix}${randomBytes(bytes).toString("base64url")}`;
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function now() {
  return Date.now();
}

function safeRedirectUri(value) {
  try {
    const url = new URL(String(value));
    const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return false;
    if (url.username || url.password || url.hash) return false;
    return true;
  } catch {
    return false;
  }
}

export async function registerOAuthClient(input = {}) {
  const redirectUris = Array.isArray(input.redirect_uris) ? input.redirect_uris.map(String) : [];
  if (!redirectUris.length || redirectUris.length > 10 || redirectUris.some((uri) => !safeRedirectUri(uri))) {
    throw new Error("redirect_uris must contain 1-10 safe HTTPS redirect URLs.");
  }

  const method = String(input.token_endpoint_auth_method || "none");
  if (method !== "none") throw new Error("Only token_endpoint_auth_method=none is supported.");

  const clientId = token("pcli_", 24);
  const record = {
    clientId,
    clientName: String(input.client_name || "PinCon OAuth client").slice(0, 120),
    redirectUris,
    tokenEndpointAuthMethod: "none",
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
    createdAtMs: now(),
  };

  await firestore().collection(CLIENTS).doc(clientId).set(record);
  return record;
}

export async function getOAuthClient(clientId) {
  const id = String(clientId || "").trim();
  if (!id) return null;
  const snap = await firestore().collection(CLIENTS).doc(id).get();
  return snap.exists ? snap.data() : null;
}

export function validateOAuthRequest({ client, redirectUri, resource, codeChallenge, codeChallengeMethod }) {
  if (!client) throw new Error("Unknown OAuth client.");
  if (!client.redirectUris?.includes(String(redirectUri || ""))) throw new Error("redirect_uri is not registered.");
  if (String(resource || "") !== MCP_RESOURCE) throw new Error("resource does not match the PinCon MCP server.");
  if (!codeChallenge || String(codeChallengeMethod || "") !== "S256") throw new Error("PKCE S256 is required.");
}

export async function issueAuthorizationCode({
  clientId,
  redirectUri,
  codeChallenge,
  resource,
  scope,
  uid,
  email,
  classKey,
}) {
  const code = token("pcode_", 32);
  const scopes = normalizeScope(scope);
  const record = {
    clientId,
    redirectUri,
    codeChallenge,
    resource,
    scope: scopes.join(" "),
    uid,
    email: email || null,
    classKey,
    createdAtMs: now(),
    expiresAtMs: now() + AUTH_CODE_TTL_MS,
    used: false,
  };
  await firestore().collection(CODES).doc(digest(code)).set(record);
  return code;
}

async function issueTokens(record) {
  const accessToken = token("pat_", 32);
  const refreshToken = token("prt_", 40);
  const issuedAtMs = now();
  const common = {
    clientId: record.clientId,
    uid: record.uid,
    email: record.email || null,
    classKey: record.classKey,
    resource: record.resource || MCP_RESOURCE,
    scope: record.scope || OAUTH_SCOPE,
    issuedAtMs,
  };

  await Promise.all([
    firestore().collection(ACCESS).doc(digest(accessToken)).set({
      ...common,
      expiresAtMs: issuedAtMs + ACCESS_TOKEN_TTL_MS,
      revoked: false,
    }),
    firestore().collection(REFRESH).doc(digest(refreshToken)).set({
      ...common,
      expiresAtMs: issuedAtMs + REFRESH_TOKEN_TTL_MS,
      revoked: false,
    }),
  ]);

  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: refreshToken,
    scope: common.scope,
  };
}

export async function exchangeAuthorizationCode({
  code,
  clientId,
  redirectUri,
  codeVerifier,
  resource,
}) {
  const ref = firestore().collection(CODES).doc(digest(code));
  let record;

  await firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("Invalid authorization code.");
    record = snap.data();
    if (record.used || record.expiresAtMs <= now()) throw new Error("Authorization code expired or already used.");
    if (record.clientId !== clientId) throw new Error("client_id does not match authorization code.");
    if (record.redirectUri !== redirectUri) throw new Error("redirect_uri does not match authorization code.");
    if (record.resource !== resource || resource !== MCP_RESOURCE) throw new Error("resource does not match authorization code.");

    const challenge = createHash("sha256").update(String(codeVerifier || "")).digest("base64url");
    if (!codeVerifier || challenge !== record.codeChallenge) throw new Error("PKCE verification failed.");
    tx.update(ref, { used: true, usedAtMs: now() });
  });

  return issueTokens(record);
}

export async function exchangeRefreshToken({ refreshToken, clientId, resource }) {
  const ref = firestore().collection(REFRESH).doc(digest(refreshToken));
  let record;

  await firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("Invalid refresh token.");
    record = snap.data();
    if (record.revoked || record.expiresAtMs <= now()) throw new Error("Refresh token expired or revoked.");
    if (record.clientId !== clientId) throw new Error("client_id does not match refresh token.");
    if (record.resource !== resource || resource !== MCP_RESOURCE) throw new Error("resource does not match refresh token.");
    tx.update(ref, { revoked: true, revokedAtMs: now() });
  });

  return issueTokens(record);
}

export async function verifyOAuthAccessToken(rawToken) {
  const value = String(rawToken || "");
  if (!value.startsWith("pat_")) return null;
  const snap = await firestore().collection(ACCESS).doc(digest(value)).get();
  if (!snap.exists) return null;
  const record = snap.data();
  if (record.revoked || record.expiresAtMs <= now() || record.resource !== MCP_RESOURCE) return null;
  const scopes = String(record.scope || "").split(/\s+/).filter(Boolean);
  if (!scopes.includes(OAUTH_SCOPE)) return null;
  return {
    type: "user",
    uid: record.uid,
    email: record.email || null,
    classKey: record.classKey,
    scopes,
    resource: record.resource,
  };
}
