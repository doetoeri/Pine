import { firestore } from "../../lib/firebase.mjs";
import { sendJson } from "../../lib/request.mjs";

function safeCode(error) {
  return String(error?.code || error?.status || "unknown").slice(0, 80);
}

export default async function firestoreHealth(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { error: "method-not-allowed" });
  try {
    const startedAt = Date.now();
    await firestore().doc("schools/gochon-high").get();
    return sendJson(res, 200, { ok: true, latencyMs: Date.now() - startedAt });
  } catch (error) {
    return sendJson(res, 503, {
      ok: false,
      code: safeCode(error),
      category: /quota|resource[-_ ]?exhausted/i.test(String(error?.message || "")) ? "quota" :
        /permission|credential|unauth|invalid_grant/i.test(String(error?.message || "")) ? "credential-or-iam" :
        /deadline|unavailable|timeout/i.test(String(error?.message || "")) ? "transient" : "firestore",
    });
  }
}
