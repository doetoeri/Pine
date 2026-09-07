import { createSign } from "node:crypto";

const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
if (!raw) throw new Error("service-account-secret-missing");
const credentials = JSON.parse(raw);

function b64url(value) {
  return Buffer.from(typeof value === "string" ? value : JSON.stringify(value))
    .toString("base64url");
}

const now = Math.floor(Date.now() / 1000);
const header = { alg: "RS256", typ: "JWT" };
const claim = {
  iss: credentials.client_email,
  scope: "https://www.googleapis.com/auth/datastore",
  aud: "https://oauth2.googleapis.com/token",
  iat: now,
  exp: now + 600,
};
const unsigned = `${b64url(header)}.${b64url(claim)}`;
const signer = createSign("RSA-SHA256");
signer.update(unsigned);
signer.end();
const assertion = `${unsigned}.${signer.sign(credentials.private_key).toString("base64url")}`;

const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  }),
  signal: AbortSignal.timeout(15_000),
});
const tokenBody = await tokenResponse.json().catch(() => ({}));
if (!tokenResponse.ok || !tokenBody.access_token) {
  console.error(`AUTH_HEALTH_ERROR status=${tokenResponse.status} error=${String(tokenBody.error || "unknown").slice(0, 120)}`);
  process.exit(1);
}

const startedAt = Date.now();
const documentUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(credentials.project_id)}/databases/(default)/documents/schools/gochon-high`;
const response = await fetch(documentUrl, {
  headers: { authorization: `Bearer ${tokenBody.access_token}` },
  signal: AbortSignal.timeout(15_000),
});
const body = await response.json().catch(() => ({}));
if (response.ok || response.status === 404) {
  console.log(`FIRESTORE_HEALTH_OK status=${response.status} latencyMs=${Date.now() - startedAt}`);
} else {
  const status = String(body?.error?.status || "unknown").slice(0, 120);
  const message = String(body?.error?.message || "unknown").replace(/\s+/g, " ").slice(0, 500);
  console.error(`FIRESTORE_HEALTH_ERROR http=${response.status} status=${status} message=${message}`);
  process.exitCode = 1;
}
