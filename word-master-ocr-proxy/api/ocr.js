import { GoogleAuth } from "google-auth-library";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://doetoeri.github.io",
  "https://pincon.app",
  "https://www.pincon.app",
];
const MAX_IMAGE_LENGTH = 4_000_000;
const VISION_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";

function setCors(response, allowedOrigin) {
  response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Vary", "Origin");
}

function readCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;

  const credentials = JSON.parse(raw);
  if (
    credentials?.type !== "service_account" ||
    typeof credentials.client_email !== "string" ||
    typeof credentials.private_key !== "string" ||
    typeof credentials.project_id !== "string"
  ) {
    throw new Error("INVALID_SERVICE_ACCOUNT_JSON");
  }
  return credentials;
}

function parseBody(body) {
  if (typeof body === "string") return JSON.parse(body);
  return body || {};
}

export default async function handler(request, response) {
  const configuredOrigins = [
    process.env.OCR_ALLOWED_ORIGIN,
    process.env.OCR_ALLOWED_ORIGINS,
  ]
    .filter(Boolean)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  const allowedOrigins = new Set([...DEFAULT_ALLOWED_ORIGINS, ...configuredOrigins]);
  const requestOrigin = request.headers.origin;
  const responseOrigin =
    requestOrigin && allowedOrigins.has(requestOrigin)
      ? requestOrigin
      : DEFAULT_ALLOWED_ORIGINS[0];

  setCors(response, responseOrigin);

  if (requestOrigin && !allowedOrigins.has(requestOrigin)) {
    return response.status(403).json({ error: "ORIGIN_NOT_ALLOWED" });
  }

  if (request.method === "OPTIONS") return response.status(204).end();

  const requestUrl = new URL(request.url, "https://ocr.local");
  const healthRequested =
    request.query?.health === "1" || requestUrl.searchParams.get("health") === "1";

  if (request.method === "GET" && healthRequested) {
    return response.status(200).json({
      ok: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      provider: "google-cloud-vision",
    });
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST, OPTIONS");
    return response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }

  let credentials;
  let image;
  try {
    credentials = readCredentials();
    image = parseBody(request.body).image;
  } catch (_error) {
    return response.status(503).json({ error: "OCR_CONFIGURATION_INVALID" });
  }

  if (!credentials) {
    return response.status(503).json({ error: "OCR_NOT_CONFIGURED" });
  }

  if (
    typeof image !== "string" ||
    !image.startsWith("data:image/") ||
    image.length > MAX_IMAGE_LENGTH
  ) {
    return response.status(400).json({ error: "INVALID_IMAGE" });
  }

  const imageBase64 = image.replace(/^data:image\/[^;]+;base64,/, "");
  if (!imageBase64 || !/^[A-Za-z0-9+/=]+$/.test(imageBase64)) {
    return response.status(400).json({ error: "INVALID_IMAGE_ENCODING" });
  }

  try {
    const auth = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    const client = await auth.getClient();
    const accessTokenResult = await client.getAccessToken();
    const accessToken =
      typeof accessTokenResult === "string" ? accessTokenResult : accessTokenResult?.token;

    if (!accessToken) throw new Error("GOOGLE_ACCESS_TOKEN_MISSING");

    const providerResponse = await fetch(VISION_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=utf-8",
        "X-Goog-User-Project": credentials.project_id,
      },
      body: JSON.stringify({
        requests: [
          {
            image: { content: imageBase64 },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
            imageContext: { languageHints: ["ko"] },
          },
        ],
      }),
    });

    const payload = await providerResponse.json();
    const result = payload.responses?.[0];
    if (!providerResponse.ok || result?.error) {
      return response.status(502).json({ error: "OCR_PROVIDER_ERROR" });
    }

    const text =
      result?.fullTextAnnotation?.text ||
      result?.textAnnotations?.[0]?.description ||
      "";

    return response.status(200).json({ text: String(text).trim() });
  } catch (_error) {
    return response.status(502).json({ error: "OCR_REQUEST_FAILED" });
  }
}
