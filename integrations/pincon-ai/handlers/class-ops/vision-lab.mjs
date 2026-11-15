import { readFile } from "node:fs/promises";
import { ROLE, corsHeaders, hasRole, requireProfileOrLegacy } from "../../lib/class-accounts.mjs";
import { document } from "../../lib/class-ops-store.mjs";
import { jsonBody, sendJson } from "../../lib/request.mjs";

const setting = () => document("sitePreferences", "visionLab");

async function readComparison() {
  const [before, after, highContrast] = await Promise.all([
    readFile(new URL("./_vision-lab/before.webp", import.meta.url)),
    readFile(new URL("./_vision-lab/after.webp", import.meta.url)),
    readFile(new URL("./_vision-lab/high-contrast.webp", import.meta.url)),
  ]);
  return {
    width: 383,
    height: 790,
    before: before.toString("base64"),
    after: after.toString("base64"),
    highContrast: highContrast.toString("base64"),
  };
}

export function createVisionLabHandler({
  identify = requireProfileOrLegacy,
  readSetting = async () => (await setting().get()).data()?.public === true,
  writeSetting = (visibility, uid) => setting().set({ public: visibility, updatedByUid: uid, updatedAtMs: Date.now() }, { merge: true }),
  compare = readComparison,
} = {}) {
  return async function visionLab(req, res) {
    const headers = { ...corsHeaders(req), vary: "Origin, Authorization", "x-content-type-options": "nosniff" };
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
      return res.end();
    }
    if (req.method !== "GET" && req.method !== "POST") {
      return sendJson(res, 405, { error: "method-not-allowed" }, { ...headers, allow: "GET, POST, OPTIONS" });
    }

    const url = new URL(req.url || "/", "https://pincon.invalid");
    const config = url.searchParams.get("view") === "settings" || req.method === "POST";
    const status = url.searchParams.get("view") === "status";
    try {
      const actor = config || req.headers?.authorization ? (await identify(req, { legacyLevels: ["school"] })).profile : null;
      const admin = hasRole(actor, ROLE.ADMIN);
      if (config && !admin) return sendJson(res, actor ? 403 : 401, { error: "school-admin-required" }, headers);
      if (req.method === "POST") {
        let body;
        try { body = await jsonBody(req); }
        catch { return sendJson(res, 400, { error: "invalid-json" }, headers); }
        if (typeof body?.public !== "boolean") return sendJson(res, 400, { error: "invalid-visibility" }, headers);
        await writeSetting(body.public, actor.uid);
        return sendJson(res, 200, { public: body.public }, headers);
      }

      const visibility = await readSetting();
      const available = visibility || admin;
      if (config) return sendJson(res, 200, { public: visibility }, headers);
      if (status) return sendJson(res, 200, { available }, headers);
      if (!available) return sendJson(res, 403, { error: "vision-lab-private" }, headers);
      return sendJson(res, 200, { comparison: await compare() }, headers);
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) return sendJson(res, error.status, { error: "school-admin-required" }, headers);
      console.error("[vision-lab] request failed", error?.code || error?.name || "unknown");
      return sendJson(res, 503, { error: "vision-lab-unavailable" }, headers);
    }
  };
}

export default createVisionLabHandler();
