export async function rawBody(req, maxBytes = 1024 * 1024) {
  if (typeof req?.body === "string") return req.body;
  if (Buffer.isBuffer(req?.body)) return req.body.toString("utf8");
  if (req?.body && typeof req.body === "object") return JSON.stringify(req.body);

  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function jsonBody(req) {
  if (req?.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  const raw = await rawBody(req);
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

export async function formBody(req) {
  if (req?.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return new URLSearchParams(Object.entries(req.body).map(([key, value]) => [key, String(value)]));
  }
  return new URLSearchParams(await rawBody(req));
}

export function sendJson(res, status, body, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  for (const [key, value] of Object.entries(extraHeaders)) res.setHeader(key, value);
  res.end(JSON.stringify(body));
}

export function sendHtml(res, status, html) {
  res.statusCode = status;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-security-policy", "default-src 'self'; script-src 'self' https://www.gstatic.com 'unsafe-inline'; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://securetoken.googleapis.com; frame-src https://accounts.google.com https://*.firebaseapp.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:;");
  res.end(html);
}
