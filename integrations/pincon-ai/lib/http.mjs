import { enforceAuth } from "./auth.mjs";
import { runWithAuth } from "./auth-context.mjs";

export function queryParams(req) {
  const url = new URL(req.url || "/", "https://pincon.invalid");
  return url.searchParams;
}

export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

export function readOnly(handler) {
  return async function pinconReadOnlyEndpoint(req, res) {
    const principal = await enforceAuth(req, res);
    if (!principal) return;
    if (req.method !== "GET") {
      res.setHeader("allow", "GET");
      return json(res, 405, { ok: false, error: "Method not allowed" });
    }

    try {
      return await runWithAuth(principal, async () => {
        const data = await handler(queryParams(req), principal);
        return json(res, 200, { ok: true, data });
      });
    } catch (error) {
      const message = error?.message || "PinCon request failed.";
      const badRequest = /classKey|YYYY-MM-DD|date must|not allowed/i.test(message);
      return json(res, badRequest ? 400 : 500, { ok: false, error: message });
    }
  };
}
