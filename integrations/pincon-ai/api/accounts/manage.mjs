import { firebaseAuth, firestore } from "../../lib/firebase.mjs";
import {
  SCHOOL_ID,
  appendAccountAudit,
  assertSameClass,
  corsHeaders,
  generateTemporaryPin,
  isAccountAdmin,
  normalizeProfile,
  profileForUid,
  publicProfile,
  requireProfile,
  studentEmail,
  syncCompatibilityRole,
} from "../../lib/class-accounts.mjs";
import { jsonBody, sendJson } from "../../lib/request.mjs";

const usersCollection = () => firestore().collection(`schools/${SCHOOL_ID}/users`);
const userDocument = (uid) => firestore().doc(`schools/${SCHOOL_ID}/users/${uid}`);

async function findByStudentNumber(studentNumber) {
  const snapshot = await usersCollection()
    .where("studentNumber", "==", String(studentNumber || ""))
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function resolveTarget(body) {
  if (body.uid) return profileForUid(String(body.uid));
  if (body.studentNumber) return findByStudentNumber(body.studentNumber);
  return null;
}

function assertAdmin(actor) {
  if (!isAccountAdmin(actor)) throw Object.assign(new Error("account-admin-required"), { status: 403 });
}

async function createAccount(actor, body) {
  const pin = generateTemporaryPin();
  const candidate = normalizeProfile({ ...body, status: "ACTIVE", mustChangePin: true });
  assertSameClass(actor, candidate);
  const existing = await findByStudentNumber(candidate.studentNumber);
  if (existing) throw Object.assign(new Error("student-number-exists"), { status: 409 });

  let authUser;
  try {
    authUser = await firebaseAuth().createUser({
      email: studentEmail(candidate.studentNumber),
      password: pin,
      displayName: candidate.name || candidate.studentNumber,
      disabled: false,
      emailVerified: false,
    });
  } catch (error) {
    if (error?.code === "auth/email-already-exists") throw Object.assign(new Error("student-number-exists"), { status: 409 });
    throw error;
  }

  const profile = normalizeProfile(candidate, { uid: authUser.uid });
  try {
    await firestore().runTransaction(async (transaction) => {
      transaction.create(userDocument(authUser.uid), {
        ...profile,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
        createdByUid: actor.uid,
        updatedByUid: actor.uid,
      });
    });
  } catch (error) {
    await firebaseAuth().deleteUser(authUser.uid).catch(() => {});
    throw error;
  }
  await syncCompatibilityRole(profile, actor.uid);
  await appendAccountAudit({ actor, action: "ACCOUNT_CREATE", targetUid: profile.uid, after: profile });
  return { account: publicProfile(profile), temporaryPin: pin };
}

async function updateAccount(actor, body) {
  const before = await resolveTarget(body);
  if (!before) throw Object.assign(new Error("account-not-found"), { status: 404 });
  assertSameClass(actor, before);

  const next = normalizeProfile({ ...before, ...(body.patch || {}) }, { uid: before.uid, existing: before });
  assertSameClass(actor, next);
  if (next.studentNumber !== before.studentNumber) {
    const duplicate = await findByStudentNumber(next.studentNumber);
    if (duplicate && duplicate.uid !== before.uid) throw Object.assign(new Error("student-number-exists"), { status: 409 });
    await firebaseAuth().updateUser(before.uid, { email: studentEmail(next.studentNumber) });
  }
  if (next.name !== before.name) await firebaseAuth().updateUser(before.uid, { displayName: next.name || next.studentNumber });
  if (next.status !== before.status) await firebaseAuth().updateUser(before.uid, { disabled: next.status === "DISABLED" });

  await userDocument(before.uid).set({
    ...next,
    updatedAtMs: Date.now(),
    updatedByUid: actor.uid,
  }, { merge: true });
  await syncCompatibilityRole(next, actor.uid);
  await appendAccountAudit({ actor, action: "ACCOUNT_UPDATE", targetUid: before.uid, before, after: next });
  return { account: publicProfile(next) };
}

async function disableAccount(actor, body) {
  const before = await resolveTarget(body);
  if (!before) throw Object.assign(new Error("account-not-found"), { status: 404 });
  assertSameClass(actor, before);
  if (before.uid === actor.uid) throw Object.assign(new Error("cannot-disable-self"), { status: 400 });
  const after = { ...before, status: "DISABLED", updatedAtMs: Date.now(), updatedByUid: actor.uid };
  await firebaseAuth().updateUser(before.uid, { disabled: true });
  await userDocument(before.uid).set(after, { merge: true });
  await syncCompatibilityRole(after, actor.uid);
  await appendAccountAudit({ actor, action: "ACCOUNT_DISABLE", targetUid: before.uid, before, after });
  return { account: publicProfile(after) };
}

async function resetPin(actor, body) {
  const before = await resolveTarget(body);
  if (!before) throw Object.assign(new Error("account-not-found"), { status: 404 });
  assertSameClass(actor, before);
  const temporaryPin = generateTemporaryPin();
  await firebaseAuth().updateUser(before.uid, { password: temporaryPin, disabled: false });
  const after = { ...before, status: "ACTIVE", mustChangePin: true, updatedAtMs: Date.now(), updatedByUid: actor.uid };
  await userDocument(before.uid).set({
    status: "ACTIVE",
    mustChangePin: true,
    updatedAtMs: after.updatedAtMs,
    updatedByUid: actor.uid,
  }, { merge: true });
  await syncCompatibilityRole(after, actor.uid);
  await appendAccountAudit({ actor, action: "PIN_RESET", targetUid: before.uid, before, after, metadata: { secretStored: "false" } });
  return { account: publicProfile(after), temporaryPin };
}

async function listAccounts(actor) {
  let query = usersCollection().orderBy("number", "asc").limit(80);
  if (!actor.roles?.includes("ADMIN")) query = usersCollection().where("classKey", "==", actor.classKey).orderBy("number", "asc").limit(80);
  const snapshot = await query.get();
  return snapshot.docs.map((doc) => publicProfile({ id: doc.id, ...doc.data() }));
}

export default async function manageAccounts(req, res) {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return sendJson(res, 204, {}, headers);

  try {
    const { profile: actor } = await requireProfile(req);
    assertAdmin(actor);

    if (req.method === "GET") return sendJson(res, 200, { accounts: await listAccounts(actor) }, headers);
    if (req.method !== "POST") return sendJson(res, 405, { error: "method-not-allowed" }, headers);

    const body = await jsonBody(req);
    const action = String(body.action || "").toUpperCase();
    let result;
    if (action === "CREATE") result = await createAccount(actor, body.account || {});
    else if (action === "UPDATE") result = await updateAccount(actor, body);
    else if (action === "DISABLE") result = await disableAccount(actor, body);
    else if (action === "RESET_PIN") result = await resetPin(actor, body);
    else throw Object.assign(new Error("unsupported-action"), { status: 400 });

    return sendJson(res, 200, result, headers);
  } catch (error) {
    return sendJson(res, error?.status || 500, { error: error?.message || "account-management-failed" }, headers);
  }
}
