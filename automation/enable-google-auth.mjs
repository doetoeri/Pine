import { createSign } from "node:crypto";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "studio-2803086992-2d4cf";
const API = "https://identitytoolkit.googleapis.com/admin/v2";

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

async function responseBody(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}

async function main() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON secret이 없습니다.");
  const credentials = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const token = await accessToken(credentials);
  const resource = `${API}/projects/${PROJECT_ID}/defaultSupportedIdpConfigs/google.com`;

  const currentResponse = await fetch(resource, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const current = await responseBody(currentResponse);

  if (currentResponse.status === 404) {
    const clientId = String(process.env.FIREBASE_GOOGLE_CLIENT_ID || "").trim();
    const clientSecret = String(process.env.FIREBASE_GOOGLE_CLIENT_SECRET || "").trim();
    if (!clientId || !clientSecret) {
      throw new Error("Google 공급자 구성이 아직 없습니다. Firebase Console에서 Google 공급자를 한 번 생성하거나 FIREBASE_GOOGLE_CLIENT_ID/SECRET secrets를 설정해야 합니다.");
    }
    const createResponse = await fetch(`${API}/projects/${PROJECT_ID}/defaultSupportedIdpConfigs?idpId=google.com`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        name: `projects/${PROJECT_ID}/defaultSupportedIdpConfigs/google.com`,
        enabled: true,
        clientId,
        clientSecret,
      }),
    });
    const created = await responseBody(createResponse);
    if (!createResponse.ok) throw new Error(`Google 공급자 생성 실패: ${createResponse.status} ${JSON.stringify(created)}`);
    console.log(JSON.stringify({ ok: true, project: PROJECT_ID, provider: "google.com", enabled: created?.enabled === true, created: true }));
    return;
  }

  if (!currentResponse.ok) throw new Error(`Google 공급자 조회 실패: ${currentResponse.status} ${JSON.stringify(current)}`);
  if (current?.enabled === true) {
    console.log(JSON.stringify({ ok: true, project: PROJECT_ID, provider: "google.com", enabled: true, changed: false }));
    return;
  }

  const patchResponse = await fetch(`${resource}?updateMask=enabled`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ enabled: true }),
  });
  const patched = await responseBody(patchResponse);
  if (!patchResponse.ok) throw new Error(`Google 공급자 활성화 실패: ${patchResponse.status} ${JSON.stringify(patched)}`);
  console.log(JSON.stringify({ ok: true, project: PROJECT_ID, provider: "google.com", enabled: patched?.enabled === true, changed: true }));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
