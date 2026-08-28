import { firebaseAuth, firestore } from "../../lib/firebase.mjs";
import { appendAccountAudit, corsHeaders, requireProfile } from "../../lib/class-accounts.mjs";
import { jsonBody, sendJson } from "../../lib/request.mjs";

function validPin(value) {
  const pin = String(value || "");
  return /^\d{6,12}$/.test(pin) && !/^(\d)\1+$/.test(pin);
}

export default async function changePin(req, res) {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return sendJson(res, 204, {}, headers);
  if (req.method !== "POST") return sendJson(res, 405, { error: "method-not-allowed" }, headers);

  try {
    const { profile } = await requireProfile(req);
    const body = await jsonBody(req);
    const newPin = String(body.newPin || "");
    if (!validPin(newPin)) return sendJson(res, 400, { error: "pin-must-be-6-to-12-digits" }, headers);

    await firebaseAuth().updateUser(profile.uid, { password: newPin });
    await firestore().doc(`schools/${profile.schoolId}/users/${profile.uid}`).set({
      mustChangePin: false,
      pinChangedAtMs: Date.now(),
      updatedAtMs: Date.now(),
      updatedByUid: profile.uid,
    }, { merge: true });
    await appendAccountAudit({
      actor: profile,
      action: "PIN_CHANGE",
      targetUid: profile.uid,
      before: profile,
      after: { ...profile, mustChangePin: false },
      metadata: { secretStored: "false" },
    });

    return sendJson(res, 200, { ok: true }, headers);
  } catch (error) {
    return sendJson(res, error?.status || 500, { error: error?.message || "pin-change-failed" }, headers);
  }
}
