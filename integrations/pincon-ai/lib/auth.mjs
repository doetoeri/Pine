import { timingSafeEqual } from "node:crypto";

function bearerToken(req) {
  const value = req?.headers?.authorization || req?.headers?.Authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(String(value));
  return match?.[1]?.trim() || "";
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (!left.length || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function authorizeRequest(req) {
  const configured = String(process.env.PINCON_API_KEY || "").trim();
  if (!configured) {
    return { ok: false, status: 503, error: "PINCON_API_KEY is not configured." };
  }

  const supplied = bearerToken(req);
  if (!safeEqual(supplied, configured)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return { ok: true };
}

export function enforceAuth(req, res) {
  const result = authorizeRequest(req);
  if (result.ok) return true;

  res.statusCode = result.status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  if (result.status === 401) res.setHeader("www-authenticate", "Bearer realm=\"PinCon\"");
  res.end(JSON.stringify({ ok: false, error: result.error }));
  return false;
}
