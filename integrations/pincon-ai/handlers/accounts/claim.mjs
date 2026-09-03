import { randomBytes, randomUUID } from "node:crypto";
import { firebaseAuth, firestore } from "../../lib/firebase.mjs";
import {
  SCHOOL_ID,
  appendAccountAudit,
  corsHeaders,
  normalizeProfile,
  publicProfile,
  studentEmail,
  syncCompatibilityRole,
  validStudentNumber,
} from "../../lib/class-accounts.mjs";
import { normalizeActivationCode, verifyActivationCode } from "../../lib/account-activation.mjs";
import { jsonBody, sendJson } from "../../lib/request.mjs";

const CLAIM_LEASE_MS = 2 * 60 * 1000;
const registrationDocument = (studentNumber) => firestore().doc(`schools/${SCHOOL_ID}/accountRegistrationRoster/${studentNumber}`);
const userDocument = (uid) => firestore().doc(`schools/${SCHOOL_ID}/users/${uid}`);

async function reserveRegistration(studentNumber, activationCode) {
  const ref = registrationDocument(studentNumber);
  const nonce = randomUUID();
  const now = Date.now();
  let reserved = null;

  await firestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const registration = snapshot.exists ? snapshot.data() : null;
    const leaseExpired = registration?.claimStatus === "CLAIMING"
      && Number(registration?.claimLeaseUntilMs || 0) < now;

    if (!registration || !["READY", "CLAIMING"].includes(registration.claimStatus) || (registration.claimStatus === "CLAIMING" && !leaseExpired)) {
      throw Object.assign(new Error("registration-not-available"), { status: 409 });
    }
    if (!verifyActivationCode(activationCode, registration.activationSalt, registration.activationDigest)) {
      throw Object.assign(new Error("activation-code-mismatch"), { status: 403 });
    }

    reserved = registration;
    transaction.set(ref, {
      claimStatus: "CLAIMING",
      claimNonce: nonce,
      claimLeaseUntilMs: now + CLAIM_LEASE_MS,
      updatedAtMs: now,
    }, { merge: true });
  });

  return { ref, nonce, registration: reserved };
}

async function releaseRegistration(ref, nonce) {
  await firestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.data()?.claimNonce !== nonce) return;
    transaction.set(ref, {
      claimStatus: "READY",
      claimNonce: "",
      claimLeaseUntilMs: 0,
      updatedAtMs: Date.now(),
    }, { merge: true });
  }).catch(() => {});
}

async function provisionFirebaseUser(registration, studentNumber) {
  const existingUid = String(registration?.existingUid || "");
  const displayName = String(registration?.profile?.name || studentNumber).slice(0, 30);
  const randomPassword = randomBytes(32).toString("base64url");

  if (existingUid) {
    await firebaseAuth().updateUser(existingUid, {
      password: randomPassword,
      displayName,
      disabled: false,
    });
    await firebaseAuth().revokeRefreshTokens(existingUid).catch(() => {});
    return { uid: existingUid, created: false };
  }

  const authUser = await firebaseAuth().createUser({
    email: studentEmail(studentNumber),
    password: randomPassword,
    displayName,
    disabled: false,
    emailVerified: false,
  });
  return { uid: authUser.uid, created: true };
}

async function claimAccount(body) {
  const studentNumber = String(body.studentNumber || "").trim();
  const activationCode = normalizeActivationCode(body.activationCode);
  if (!validStudentNumber(studentNumber) || activationCode.length !== 8) {
    throw Object.assign(new Error("invalid-registration-identity"), { status: 400 });
  }

  const { ref, nonce, registration } = await reserveRegistration(studentNumber, activationCode);
  let provisioned = null;
  try {
    provisioned = await provisionFirebaseUser(registration, studentNumber);
    const profile = normalizeProfile({
      ...(registration.profile || {}),
      studentNumber,
      status: "ACTIVE",
      mustChangePin: true,
    }, { uid: provisioned.uid });
    const now = Date.now();

    await userDocument(provisioned.uid).set({
      ...profile,
      createdAtMs: Number(registration?.profile?.createdAtMs || now),
      updatedAtMs: now,
      createdByUid: String(registration?.createdByUid || provisioned.uid),
      updatedByUid: provisioned.uid,
      registrationSource: registration?.existingUid ? "ACTIVATION_RESET_V2" : "ACTIVATION_CODE_V2",
    }, { merge: registration?.existingUid ? true : false });

    await syncCompatibilityRole(profile, provisioned.uid);
    await firestore().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists || snapshot.data()?.claimNonce !== nonce) {
        throw new Error("registration-claim-lost");
      }
      transaction.set(ref, {
        claimStatus: "CLAIMED",
        claimedUid: provisioned.uid,
        claimedAtMs: now,
        claimNonce: "",
        claimLeaseUntilMs: 0,
        activationSalt: "",
        activationDigest: "",
        updatedAtMs: now,
      }, { merge: true });
    });

    await appendAccountAudit({
      actor: profile,
      action: registration?.existingUid ? "ACCOUNT_REACTIVATED_V2" : "ACCOUNT_ACTIVATED_V2",
      targetUid: profile.uid,
      after: profile,
      metadata: { secretStored: "false", method: "activation-code" },
    });

    const customToken = await firebaseAuth().createCustomToken(provisioned.uid, { pinconFirstLogin: true, pinconIdentityV2: true });
    return { customToken, account: publicProfile(profile) };
  } catch (error) {
    if (provisioned?.created && provisioned?.uid) {
      await Promise.all([
        firebaseAuth().deleteUser(provisioned.uid).catch(() => {}),
        userDocument(provisioned.uid).delete().catch(() => {}),
      ]);
    }
    await releaseRegistration(ref, nonce);
    if (error?.code === "auth/email-already-exists") {
      throw Object.assign(new Error("registration-already-claimed"), { status: 409 });
    }
    throw error;
  }
}

export default async function claimStudentAccount(req, res) {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return sendJson(res, 204, {}, headers);
  if (req.method !== "POST") return sendJson(res, 405, { error: "method-not-allowed" }, headers);

  try {
    return sendJson(res, 200, await claimAccount(await jsonBody(req)), headers);
  } catch (error) {
    const status = error?.status || 500;
    const publicError = status >= 500 ? "account-claim-failed" : "registration-not-available";
    return sendJson(res, status, { error: publicError }, headers);
  }
}
