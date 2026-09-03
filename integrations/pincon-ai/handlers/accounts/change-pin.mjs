import { firebaseAuth, firestore } from "../../lib/firebase.mjs";
import { appendAccountAudit, corsHeaders, publicProfile, requireProfile } from "../../lib/class-accounts.mjs";
import { hashPin, validPin } from "../../lib/account-pin.mjs";
import { jsonBody, sendJson } from "../../lib/request.mjs";

export default async function changePin(req, res) {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return sendJson(res, 204, {}, headers);
  if (req.method !== "POST") return sendJson(res, 405, { error: "method-not-allowed" }, headers);

  try {
    const { profile } = await requireProfile(req);
    const body = await jsonBody(req);
    const newPin = String(body.newPin || "");
    if (!validPin(newPin)) return sendJson(res, 400, { error: "pin-must-be-6-to-12-digits" }, headers);

    const hashed = hashPin(newPin);
    const now = Date.now();
    const after = { ...profile, mustChangePin: false };
    const customToken = await firebaseAuth().createCustomToken(profile.uid, {
      pinconPinLogin: true,
      pinconIdentityV2: true,
    });

    const batch = firestore().batch();
    batch.set(firestore().doc(`schools/${profile.schoolId}/accountCredentials/${profile.uid}`), {
      schemaVersion: 1,
      pinVersion: hashed.version,
      pinSalt: hashed.salt,
      pinDigest: hashed.digest,
      updatedAtMs: now,
      updatedByUid: profile.uid,
    }, { merge: false });
    batch.set(firestore().doc(`schools/${profile.schoolId}/users/${profile.uid}`), {
      mustChangePin: false,
      pinChangedAtMs: now,
      updatedAtMs: now,
      updatedByUid: profile.uid,
    }, { merge: true });
    await batch.commit();

    await appendAccountAudit({
      actor: profile,
      action: "PIN_CHANGE",
      targetUid: profile.uid,
      before: profile,
      after,
      metadata: { secretStored: "scrypt-hash", credentialVersion: String(hashed.version) },
    });

    return sendJson(res, 200, { ok: true, customToken, account: publicProfile(after) }, headers);
  } catch (error) {
    return sendJson(res, error?.status || 500, { error: error?.message || "pin-change-failed" }, headers);
  }
}
