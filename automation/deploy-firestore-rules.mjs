import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "studio-2803086992-2d4cf";
const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || "studio-2803086992-2d4cf.firebasestorage.app";
const OPEN_WRITE_CLASS = String(process.env.PINCON_OPEN_WRITE_CLASS || "").trim();
const OPEN_WRITE_UNTIL_MS = Number(process.env.PINCON_OPEN_WRITE_UNTIL_MS || 0);
const FIRESTORE_ONLY = String(process.env.FIREBASE_RULES_FIRESTORE_ONLY || "").toLowerCase() === "true";
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
      grant_type: "urn:ietf:params:oauth2.0:grant-type:jwt-bearer",
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
    const error = new Error(`Firebase Rules API ${response.status}: ${detail}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function patchMatchBlock(source, collection, transform) {
  const marker = `    match /schools/{schoolId}/${collection}/`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Firestore rules block not found: ${collection}`);
  const next = source.indexOf("\n    match /schools/", start + marker.length);
  const end = next < 0 ? source.length : next;
  const block = source.slice(start, end);
  const patched = transform(block);
  if (patched === block) throw new Error(`Firestore rules block was not patched: ${collection}`);
  return `${source.slice(0, start)}${patched}${source.slice(end)}`;
}

export function applyTemporaryOpenWrite(source) {
  if (!OPEN_WRITE_CLASS || !Number.isFinite(OPEN_WRITE_UNTIL_MS) || OPEN_WRITE_UNTIL_MS <= 0) return source;
  if (!/^\d-[1-9]$|^\d-10$/.test(OPEN_WRITE_CLASS)) throw new Error("PINCON_OPEN_WRITE_CLASS 형식이 올바르지 않습니다.");

  const helperNeedle = "    function validClassOpsBase(classKey) {";
  const helper = `    // Temporary live-class write window. Server time closes this automatically.\n    function temporaryClassEditor(classKey) {\n      return signedIn()\n        && classKey == '${OPEN_WRITE_CLASS}'\n        && request.time.toMillis() < ${Math.trunc(OPEN_WRITE_UNTIL_MS)};\n    }\n\n`;
  if (!source.includes(helperNeedle)) throw new Error("Firestore helper insertion point not found");
  let patched = source.replace(helperNeedle, `${helper}${helperNeedle}`);

  const operator = "classOperator(schoolId, request.resource.data.classKey)";
  const temporaryOperator = `(${operator} || temporaryClassEditor(request.resource.data.classKey))`;
  for (const collection of ["announcements", "classAssignments", "events"]) {
    patched = patchMatchBlock(patched, collection, (block) => block.replace(operator, temporaryOperator));
  }
  patched = patchMatchBlock(patched, "changeLogs", (block) => block.replace(operator, temporaryOperator));
  return patched;
}

async function rulesToDeploy(token) {
  if (FIRESTORE_ONLY) return RULES.filter((rule) => rule.fileName === "firestore.rules");
  const response = await api(token, `projects/${PROJECT_ID}/releases?pageSize=100`);
  const storagePrefix = `projects/${PROJECT_ID}/releases/firebase.storage/`;
  const existingStorageRelease = (response?.releases || []).find((release) =>
    String(release?.name || "").startsWith(storagePrefix));
  if (!existingStorageRelease) return RULES;
  return RULES.map((rule) => rule.fileName === "storage.rules"
    ? { ...rule, releaseName: existingStorageRelease.name }
    : rule);
}

async function deployRelease(token, rule) {
  const release = {
    name: rule.releaseName,
    rulesetName: rule.ruleset.name,
  };
  try {
    return await api(token, rule.releaseName, {
      method: "PATCH",
      body: JSON.stringify({ release, updateMask: "rulesetName" }),
    });
  } catch (error) {
    if (error?.status !== 404) throw error;
    try {
      return await api(token, `projects/${PROJECT_ID}/releases`, {
        method: "POST",
        body: JSON.stringify(release),
      });
    } catch (createError) {
      if (rule.fileName === "storage.rules" && createError?.status === 403) {
        const setupError = new Error("Firebase Storage가 아직 초기화되지 않았거나 서비스 계정에 firebaserules.releases.create 권한이 없습니다. Storage를 초기화한 뒤 Firebase Rules Admin 권한을 확인하세요.");
        setupError.cause = createError;
        throw setupError;
      }
      throw createError;
    }
  }
}

async function main() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON secret이 없습니다.");
  }
  const credentials = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const token = await accessToken(credentials);
  const rules = await rulesToDeploy(token);
  const compiled = [];
  for (const rule of rules) {
    let content = await readFile(rule.path, "utf8");
    if (rule.fileName === "firestore.rules") content = applyTemporaryOpenWrite(content);
    const ruleset = await api(token, `projects/${PROJECT_ID}/rulesets`, {
      method: "POST",
      body: JSON.stringify({ source: { files: [{ name: rule.fileName, content }] } }),
    });
    compiled.push({ ...rule, ruleset });
  }
  const deployed = [];
  for (const rule of compiled) {
    await deployRelease(token, rule);
    deployed.push({ file: rule.fileName, release: rule.releaseName, ruleset: rule.ruleset.name });
  }
  console.log(JSON.stringify({
    ok: true,
    project: PROJECT_ID,
    firestoreOnly: FIRESTORE_ONLY,
    temporaryOpenWrite: OPEN_WRITE_CLASS ? { classKey: OPEN_WRITE_CLASS, untilMs: OPEN_WRITE_UNTIL_MS } : null,
    deployed,
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
