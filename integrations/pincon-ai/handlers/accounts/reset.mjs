import { firebaseAuth, firestore } from "../../lib/firebase.mjs";
import {
  SCHOOL_ID,
  appendAccountAudit,
  assertSameClass,
  corsHeaders,
  hasRole,
  isAccountAdmin,
  profileForUid,
  publicProfile,
  requireProfileOrLegacy,
  ROLE,
  syncCompatibilityRole,
} from "../../lib/class-accounts.mjs";
import { generateActivationCode, hashActivationCode } from "../../lib/account-activation.mjs";
import { jsonBody, sendJson } from "../../lib/request.mjs";

const BULK_LIMIT = 1500;
const RESET_CONFIRMATION = "RESET_NON_ADMIN_ACCOUNTS";
const PRIVILEGED_ROLES = new Set([ROLE.ADMIN, ROLE.TEACHER, ROLE.CLASS_PRESIDENT]);
const usersCollection = () => firestore().collection(`schools/${SCHOOL_ID}/users`);
const userDocument = (uid) => firestore().doc(`schools/${SCHOOL_ID}/users/${uid}`);
const registrationDocument = (studentNumber) => firestore().doc(`schools/${SCHOOL_ID}/accountRegistrationRoster/${studentNumber}`);

function assertAdmin(actor) {
  if (!isAccountAdmin(actor)) throw Object.assign(new Error("account-admin-required"), { status: 403 });
}

function isPrivileged(profile) {
  return Array.isArray(profile?.roles) && profile.roles.some((role) => PRIVILEGED_ROLES.has(role));
}

async function findByStudentNumber(studentNumber) {
  const snapshot = await usersCollection().where("studentNumber", "==", String(studentNumber || "")).limit(1).get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function resolveTarget(body) {
  if (body.uid) return profileForUid(String(body.uid));
  if (body.studentNumber) return findByStudentNumber(body.studentNumber);
  return null;
}

async function stageReactivation(actor, before) {
  if (!before?.uid || !before?.studentNumber) throw Object.assign(new Error("account-not-found"), { status: 404 });
  assertSameClass(actor, before);
  if (before.uid === actor.uid) throw Object.assign(new Error("cannot-reset-self"), { status: 400 });

  const activationCode = generateActivationCode();
  const activation = hashActivationCode(activationCode);
  const now = Date.now();
  const after = {
    ...before,
    status: "DISABLED",
    mustChangePin: true,
    updatedAtMs: now,
    updatedByUid: actor.uid,
  };
  const safeProfile = publicProfile(before);

  await firebaseAuth().updateUser(before.uid, { disabled: true });
  await firebaseAuth().revokeRefreshTokens(before.uid);
  await userDocument(before.uid).set({
    status: "DISABLED",
    mustChangePin: true,
    updatedAtMs: now,
    updatedByUid: actor.uid,
  }, { merge: true });
  await registrationDocument(before.studentNumber).set({
    schemaVersion: 2,
    schoolId: SCHOOL_ID,
    studentNumber: before.studentNumber,
    normalizedName: String(before.name || "").normalize("NFKC").trim().replace(/\s+/g, "").toLocaleLowerCase("ko"),
    profile: {
      ...safeProfile,
      uid: "",
      status: "ACTIVE",
      mustChangePin: true,
      createdAtMs: Number(before.createdAtMs || now),
    },
    existingUid: before.uid,
    claimStatus: "READY",
    activationSalt: activation.salt,
    activationDigest: activation.digest,
    activationVersion: 1,
    claimNonce: "",
    claimLeaseUntilMs: 0,
    createdAtMs: now,
    createdByUid: actor.uid,
    updatedAtMs: now,
    updatedByUid: actor.uid,
  }, { merge: false });

  await syncCompatibilityRole(after, actor.uid);
  await appendAccountAudit({
    actor,
    action: "ACCOUNT_REACTIVATION_ISSUED_V2",
    targetUid: before.uid,
    before,
    after,
    metadata: { secretStored: "hashed", method: "activation-code" },
  });

  return { account: publicProfile(after), activationCode };
}

async function resetOne(actor, body) {
  const target = await resolveTarget(body);
  if (!target) throw Object.assign(new Error("account-not-found"), { status: 404 });
  return stageReactivation(actor, target);
}

async function scopedResetTargets(actor) {
  const query = hasRole(actor, ROLE.ADMIN)
    ? usersCollection().limit(BULK_LIMIT)
    : usersCollection().where("classKey", "==", actor.classKey).limit(80);
  const snapshot = await query.get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((profile) => profile.uid && profile.uid !== actor.uid && profile.studentNumber && !isPrivileged(profile));
}

async function resetNonAdmins(actor, body) {
  if (body.confirmation !== RESET_CONFIRMATION) {
    throw Object.assign(new Error("account-reset-confirmation-required"), { status: 400 });
  }
  const targets = await scopedResetTargets(actor);
  const output = new Array(targets.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= targets.length) return;
      const target = targets[index];
      try {
        output[index] = { ok: true, ...(await stageReactivation(actor, target)) };
      } catch (error) {
        output[index] = {
          ok: false,
          studentNumber: target.studentNumber,
          name: target.name,
          error: String(error?.message || error?.code || "account-reset-failed"),
        };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(4, Math.max(1, targets.length)) }, () => worker()));
  const reset = output.filter((item) => item?.ok).map(({ ok, ...item }) => item);
  const failed = output.filter((item) => item && !item.ok).map(({ ok, ...item }) => item);

  await appendAccountAudit({
    actor,
    action: "NON_ADMIN_ACCOUNTS_REACTIVATION_V2",
    targetUid: actor.uid,
    metadata: {
      requested: String(targets.length),
      reset: String(reset.length),
      failed: String(failed.length),
      secretStored: "hashed",
    },
  });

  return { requested: targets.length, reset, failed };
}

export default async function resetAccounts(req, res) {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return sendJson(res, 204, {}, headers);
  if (req.method !== "POST") return sendJson(res, 405, { error: "method-not-allowed" }, headers);

  try {
    const { profile: actor } = await requireProfileOrLegacy(req, {
      legacyLevels: ["school", "president", "class", "grade"],
    });
    assertAdmin(actor);
    const body = await jsonBody(req);
    const mode = String(body.mode || "single").toLowerCase();
    if (mode === "single") return sendJson(res, 200, await resetOne(actor, body), headers);
    if (mode === "non-admins") return sendJson(res, 200, await resetNonAdmins(actor, body), headers);
    return sendJson(res, 400, { error: "unsupported-reset-mode" }, headers);
  } catch (error) {
    return sendJson(res, error?.status || 500, { error: error?.message || "account-reset-failed" }, headers);
  }
}
