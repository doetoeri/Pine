import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "studio-2803086992-2d4cf";
const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || "studio-2803086992-2d4cf.firebasestorage.app";
const RULES = [
  {
    path: new URL("../firestore.rules", import.meta.url),
    fileName: "firestore.rules",
    releaseName: `projects/${PROJECT_ID}/releases/cloud.firestore`,
  },
  {
    path: new URL("../storage.rules", import.meta.url),
    fileName: "storage.rules",
    releaseName: `projects/${PROJECT_ID}/releases/firebase.storage/${STORAGE_BUCKET}`,
  },
];

function base64url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
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
  const signature = signer.sign(credentials.private_key)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return `${unsigned}.${signature}`;
}

async function accessToken(credentials) {
  const tokenUri = credentials.token_uri || "https://oauth2.googleapis.com/token";
  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signJwt(credentials),
    }),
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) {
    throw new Error(`OAuth 토큰 발급 실패: ${response.status} ${JSON.stringify(body)}`);
  }
  return body.access_token;
}

async function api(token, path, options = {}) {
  const response = await fetch(`https://firebaserules.googleapis.com/v1/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const detail = body?.error?.message || JSON.stringify(body);
    throw new Error(`Firebase Rules API ${response.status}: ${detail}`);
  }
  return body;
}

async function main() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON secret이 없습니다.");
  }
  const credentials = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const token = await accessToken(credentials);
  const compiled = [];
  for (const rule of RULES) {
    const content = await readFile(rule.path, "utf8");
    const ruleset = await api(token, `projects/${PROJECT_ID}/rulesets`, {
      method: "POST",
      body: JSON.stringify({ source: { files: [{ name: rule.fileName, content }] } }),
    });
    compiled.push({ ...rule, ruleset });
  }
  const deployed = [];
  for (const rule of compiled) {
    await api(token, rule.releaseName, {
      method: "PATCH",
      body: JSON.stringify({
        release: { name: rule.releaseName, rulesetName: rule.ruleset.name },
        updateMask: "rulesetName",
      }),
    });
    deployed.push({ file: rule.fileName, release: rule.releaseName, ruleset: rule.ruleset.name });
  }
  console.log(JSON.stringify({ ok: true, project: PROJECT_ID, deployed }));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
