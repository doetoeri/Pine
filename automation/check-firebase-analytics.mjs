import { createSign } from "node:crypto";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "studio-2803086992-2d4cf";
const APP_ID = process.env.FIREBASE_WEB_APP_ID || "1:747632916477:web:60ad84854cc97deffb8b94";

function base64url(value) {
  return Buffer.from(value).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function signJwt(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform.read-only",
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

async function token(credentials) {
  const response = await fetch(credentials.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signJwt(credentials) }),
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error(`OAuth 실패: ${response.status} ${JSON.stringify(body)}`);
  return body.access_token;
}

async function getJson(accessToken, path) {
  const response = await fetch(`https://firebase.googleapis.com/v1beta1/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(`Firebase Management API ${response.status}: ${body?.error?.message || JSON.stringify(body)}`);
  return body;
}

async function main() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON secret이 없습니다.");
  const credentials = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const accessToken = await token(credentials);
  const encodedAppId = encodeURIComponent(APP_ID);
  const config = await getJson(accessToken, `projects/-/webApps/${encodedAppId}/config`);
  let analyticsDetails = null;
  try { analyticsDetails = await getJson(accessToken, `projects/${PROJECT_ID}/analyticsDetails`); } catch (error) { analyticsDetails = { error: error.message }; }
  console.log(JSON.stringify({
    ok: true,
    projectId: PROJECT_ID,
    appId: APP_ID,
    measurementId: config?.measurementId || null,
    analyticsProperty: analyticsDetails?.analyticsProperty || null,
    streamMappings: analyticsDetails?.streamMappings || [],
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
