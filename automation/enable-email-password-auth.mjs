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
  if (!response.ok || !body.access_token) throw new Error(`OAuth token failed: ${response.status} ${JSON.stringify(body)}`);
  return body.access_token;
}

async function body(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}

async function main() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON secret is missing.");
  const credentials = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const token = await accessToken(credentials);
  const resource = `${API}/projects/${PROJECT_ID}/config`;

  const currentResponse = await fetch(resource, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const current = await body(currentResponse);
  if (!currentResponse.ok) throw new Error(`Firebase auth config read failed: ${currentResponse.status} ${JSON.stringify(current)}`);

  const enabled = current?.signIn?.email?.enabled === true;
  const passwordRequired = current?.signIn?.email?.passwordRequired === true;
  if (enabled && passwordRequired) {
    console.log(JSON.stringify({ ok: true, project: PROJECT_ID, enabled: true, passwordRequired: true, changed: false }));
    return;
  }

  const patchResponse = await fetch(`${resource}?updateMask=signIn.email.enabled,signIn.email.passwordRequired`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      signIn: {
        email: {
          enabled: true,
          passwordRequired: true,
        },
      },
    }),
  });
  const patched = await body(patchResponse);
  if (!patchResponse.ok) throw new Error(`Firebase email/password enable failed: ${patchResponse.status} ${JSON.stringify(patched)}`);

  if (patched?.signIn?.email?.enabled !== true || patched?.signIn?.email?.passwordRequired !== true) {
    throw new Error(`Firebase email/password config did not stick: ${JSON.stringify(patched?.signIn?.email || {})}`);
  }

  console.log(JSON.stringify({ ok: true, project: PROJECT_ID, enabled: true, passwordRequired: true, changed: true }));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
