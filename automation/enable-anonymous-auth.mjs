import { createSign } from "node:crypto";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "studio-2803086992-2d4cf";

function base64url(value) {
  return Buffer.from(value).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function signJwt(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: credentials.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(credentials.private_key).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `${unsigned}.${signature}`;
}

async function accessToken(credentials) {
  const response = await fetch(credentials.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signJwt(credentials),
    }),
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error(`OAuth 토큰 발급 실패: ${response.status} ${JSON.stringify(body)}`);
  return body.access_token;
}

async function main() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON secret이 없습니다.");
  const credentials = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const token = await accessToken(credentials);
  const url = `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT_ID}/config?updateMask=signIn.anonymous.enabled`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ signIn: { anonymous: { enabled: true } } }),
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(`Identity Toolkit API ${response.status}: ${body?.error?.message || JSON.stringify(body)}`);
  console.log(JSON.stringify({ ok: true, project: PROJECT_ID, anonymousEnabled: body?.signIn?.anonymous?.enabled === true }));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
