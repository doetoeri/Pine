import { firebaseAuth, firestore } from "../../lib/firebase.mjs";
import {
  SCHOOL_ID,
  corsHeaders,
  publicProfile,
  validStudentNumber,
} from "../../lib/class-accounts.mjs";
import { validPin, verifyPin } from "../../lib/account-pin.mjs";
import { jsonBody, sendJson } from "../../lib/request.mjs";

const MAX_FAILURES = 8;
const WINDOW_MS = 5 * 60 * 1000;
const LOCK_MS = 2 * 60 * 1000;

const usersCollection = () => firestore().collection(`schools/${SCHOOL_ID}/users`);
const credentialDocument = (uid) => firestore().doc(`schools/${SCHOOL_ID}/accountCredentials/${uid}`);
const attemptDocument = (studentNumber) => firestore().doc(`schools/${SCHOOL_ID}/accountLoginAttempts/${studentNumber}`);

async function findProfile(studentNumber) {
  const snapshot = await usersCollection().where("studentNumber", "==", studentNumber).limit(2).get();
  if (snapshot.size !== 1) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function assertNotLocked(studentNumber) {
  const snapshot = await attemptDocument(studentNumber).get();
  const data = snapshot.exists ? snapshot.data() : null;
  if (Number(data?.lockedUntilMs || 0) > Date.now()) {
    throw Object.assign(new Error("login-rate-limited"), { status: 429 });
  }
}

async function recordFailure(studentNumber) {
  const ref = attemptDocument(studentNumber);
  const now = Date.now();
  await firestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? snapshot.data() : {};
    const inWindow = Number(current?.windowStartedAtMs || 0) > now - WINDOW_MS;
    const failures = inWindow ? Number(current?.failures || 0) + 1 : 1;
    transaction.set(ref, {
      failures,
      windowStartedAtMs: inWindow ? Number(current.windowStartedAtMs) : now,
      lockedUntilMs: failures >= MAX_FAILURES ? now + LOCK_MS : 0,
      updatedAtMs: now,
    }, { merge: false });
  });
}

async function clearFailures(studentNumber) {
  await attemptDocument(studentNumber).delete().catch(() => {});
}

async function loginWithPin(body) {
  const studentNumber = String(body.studentNumber || "").trim();
  const pin = String(body.pin || "");
  if (!validStudentNumber(studentNumber) || !validPin(pin)) {
    throw Object.assign(new Error("invalid-login"), { status: 401 });
  }

  await assertNotLocked(studentNumber);
  const profile = await findProfile(studentNumber);
  const credentialSnapshot = profile?.uid ? await credentialDocument(profile.uid).get() : null;
  const credential = credentialSnapshot?.exists ? credentialSnapshot.data() : null;
  const valid = Boolean(
    profile?.uid
    && profile.status === "ACTIVE"
    && profile.mustChangePin !== true
    && credential
    && verifyPin(pin, credential.pinSalt, credential.pinDigest, credential.pinVersion),
  );

  if (!valid) {
    await recordFailure(studentNumber);
    throw Object.assign(new Error("invalid-login"), { status: 401 });
  }

  await clearFailures(studentNumber);
  const customToken = await firebaseAuth().createCustomToken(profile.uid, {
    pinconPinLogin: true,
    pinconIdentityV2: true,
  });
  return { customToken, account: publicProfile(profile) };
}

export default async function accountLogin(req, res) {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return sendJson(res, 204, {}, headers);
  if (req.method !== "POST") return sendJson(res, 405, { error: "method-not-allowed" }, headers);

  try {
    return sendJson(res, 200, await loginWithPin(await jsonBody(req)), headers);
  } catch (error) {
    const status = error?.status || 500;
    const publicError = status === 429 ? "login-rate-limited" : status < 500 ? "invalid-login" : "account-login-failed";
    return sendJson(res, status, { error: publicError }, headers);
  }
}
