export const PUBLIC_ORIGIN = String(
  process.env.PINCON_PUBLIC_ORIGIN || "https://pincon-ai.vercel.app",
).replace(/\/+$/, "");

export const MCP_RESOURCE = `${PUBLIC_ORIGIN}/api/mcp`;
export const OAUTH_ISSUER = PUBLIC_ORIGIN;
export const OAUTH_SCOPE = "pincon:read";
export const OAUTH_SCOPES = [OAUTH_SCOPE];
export const RESOURCE_METADATA_URL = `${PUBLIC_ORIGIN}/.well-known/oauth-protected-resource`;

export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const AUTH_CODE_TTL_MS = 5 * 60 * 1000;

export const FIREBASE_WEB_CONFIG = Object.freeze({
  apiKey: "AIzaSyClE6MPOCvqZQ_qRsZwLtml_x5TPR9PnGY",
  authDomain: "studio-2803086992-2d4cf.firebaseapp.com",
  projectId: "studio-2803086992-2d4cf",
  storageBucket: "studio-2803086992-2d4cf.firebasestorage.app",
  messagingSenderId: "747632916477",
  appId: "1:747632916477:web:60ad84854cc97deffb8b94",
});

export function normalizeScope(value) {
  const requested = String(value || OAUTH_SCOPE)
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const unique = [...new Set(requested)];
  if (!unique.length) return [OAUTH_SCOPE];
  if (unique.some((scope) => !OAUTH_SCOPES.includes(scope))) {
    throw new Error("Unsupported OAuth scope.");
  }
  return unique;
}

export function allowedEmailDomains() {
  return String(process.env.PINCON_ALLOWED_EMAIL_DOMAIN || "")
    .split(",")
    .map((item) => item.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}
