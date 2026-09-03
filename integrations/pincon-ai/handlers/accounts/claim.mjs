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
import { jsonBody, sendJson } from "../../lib/request.mjs";

const CLAIM_LEASE_MS = 2 * 60 * 1000;
const registrationDocument = (studentNumber) => firestore().doc(`schools/${SCHOOL_ID}/accountRegistrationRoster/${studentNumber}`);
const userDocument = (uid) => firestore().doc(`schools/${SCHOOL_ID}/users/${uid}`);

export function normalizeClaimName(value) {
  return String(value || "").normalize("NFKC").trim().replace(/\s+/g, "").toLocaleLowerCase("ko");
}

async function reserveRegistration(studentNumber, name) {
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
    if (!registration.normalizedName || registration.normalizedName !== normalizeClaimName(name)) {
      throw Object.assign(new Error("registration-identity-mismatch"), { status: 403 });
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

async function claimAccount(body) {
  const studentNumber = String(body.studentNumber || "").trim();
  const name = String(body.name || "").trim();
  if (!validStudentNumber(studentNumber) || !normalizeClaimName(name)) {
    throw Object.assign(new Error("invalid-registration-identity"), { status: 400 });
  }

  const { ref, nonce, registration } = await reserveRegistration(studentNumber, name);
  let authUser = null;
  try {
    authUser = await firebaseAuth().createUser({
      email: studentEmail(studentNumber),
      password: randomBytes(24).toString("base64url"),
      displayName: String(registration.profile?.name || name).slice(0, 30),
      disabled: false,
      emailVerified: false,
    });
    const profile = normalizeProfile({
      ...(registration.profile || {}),
      studentNumber,
      name: registration.profile?.name || name,
      status: "ACTIVE",
      mustChangePin: true,
    }, { uid: authUser.uid });
    const now = Date.now();
    await userDocument(authUser.uid).create({
      ...profile,
      createdAtMs: now,
      updatedAtMs: now,
      createdByUid: authUser.uid,
      updatedByUid: authUser.uid,
      registrationSource: "PINLESS_ROSTER_CLAIM",
      sourceBackupId: registration.sourceBackupId || "",
    });
    await syncCompatibilityRole(profile, authUser.uid);
    await firestore().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists || snapshot.data()?.claimNonce !== nonce) {
        throw new Error("registration-claim-lost");
      }
      transaction.set(ref, {
        claimStatus: "CLAIMED",
        claimedUid: authUser.uid,
        claimedAtMs: now,
        claimNonce: "",
        claimLeaseUntilMs: 0,
        updatedAtMs: now,
      }, { merge: true });
    });
    await appendAccountAudit({
      actor: profile,
      action: "PINLESS_FIRST_LOGIN_CLAIM",
      targetUid: profile.uid,
      after: profile,
      metadata: { sourceBackupId: registration.sourceBackupId || "", secretStored: "false" },
    });
    const customToken = await firebaseAuth().createCustomToken(authUser.uid, { pinconFirstLogin: true });
    return { customToken, account: publicProfile(profile) };
  } catch (error) {
    if (authUser?.uid) {
      await Promise.all([
        firebaseAuth().deleteUser(authUser.uid).catch(() => {}),
        userDocument(authUser.uid).delete().catch(() => {}),
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
