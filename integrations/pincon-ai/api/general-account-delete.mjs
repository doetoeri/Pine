import { firebaseAuth, firestore } from "../lib/firebase.mjs";
import {
  SCHOOL_ID,
  appendAccountAudit,
  corsHeaders,
  hasRole,
  isAccountAdmin,
  publicProfile,
  requireProfileOrLegacy,
  ROLE,
  studentEmail,
} from "../lib/class-accounts.mjs";
import { jsonBody, sendJson } from "../lib/request.mjs";

const CONFIRMATION = "DELETE_GENERAL_ACCOUNTS";
const PRIVILEGED = new Set([ROLE.ADMIN, ROLE.TEACHER, ROLE.CLASS_PRESIDENT]);
const PRIVILEGED_LEGACY_LEVELS = new Set(["school", "president", "class", "grade"]);
const users = () => firestore().collection(`schools/${SCHOOL_ID}/users`);
const userRef = (uid) => firestore().doc(`schools/${SCHOOL_ID}/users/${uid}`);
const students = () => firestore().collection(`schools/${SCHOOL_ID}/students`);
const studentRef = (studentNumber) => firestore().doc(`schools/${SCHOOL_ID}/students/${studentNumber}`);
const roleRef = (uid) => firestore().doc(`schools/${SCHOOL_ID}/roles/${uid}`);
const registrationRef = (studentNumber) => firestore().doc(`schools/${SCHOOL_ID}/accountRegistrationRoster/${studentNumber}`);
const backupRef = (backupId) => firestore().doc(`schools/${SCHOOL_ID}/accountDeletionBackups/${backupId}`);

function validClassKey(value) { return /^[1-3]-(?:[1-9]|10)$/.test(String(value || "")); }
function isPrivileged(profile) { return Array.isArray(profile?.roles) && profile.roles.some((role) => PRIVILEGED.has(role)); }
function isPrivilegedLegacy(role) { return role?.enabled === true && PRIVILEGED_LEGACY_LEVELS.has(String(role.level || "").toLowerCase()); }

async function canonicalUser(studentNumber) {
  const snap = await users().where("studentNumber", "==", studentNumber).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { uid: doc.id, ...doc.data() };
}
async function safeAuthUser(uid) {
  if (!uid) return null;
  try { return await firebaseAuth().getUser(uid); }
  catch (error) { if (error?.code === "auth/user-not-found") return null; throw error; }
}
async function safeAuthByEmail(email) {
  try { return await firebaseAuth().getUserByEmail(email); }
  catch (error) { if (error?.code === "auth/user-not-found") return null; throw error; }
}
async function privilegedUid(uid) {
  if (!uid) return false;
  const [profileSnap, legacySnap] = await Promise.all([userRef(uid).get(), roleRef(uid).get()]);
  return (profileSnap.exists && isPrivileged(profileSnap.data())) || (legacySnap.exists && isPrivilegedLegacy(legacySnap.data()));
}
function resetStudentPatch(actorUid, now) {
  return {
    activated: false, uid: "", existingUid: "", accountStatus: "PENDING", claimState: "READY",
    claimNonce: "", claimAttemptId: "", claimLeaseUntilMs: 0, lastActivationAttemptId: "",
    activatedAtMs: 0, updatedAtMs: now, updatedByUid: actorUid,
  };
}

async function deleteCandidate(actor, profile, manifestRef, now) {
  const backupUser = manifestRef.collection("users").doc(profile.uid);
  await backupUser.set({ profile: publicProfile(profile), sourceUid: profile.uid, deletionStatus: "BACKED_UP", createdAtMs: now });
  const legacySnap = await roleRef(profile.uid).get();
  if (legacySnap.exists && isPrivilegedLegacy(legacySnap.data())) {
    await backupUser.set({ deletionStatus: "PRESERVED_PRIVILEGED", updatedAtMs: Date.now() }, { merge: true });
    return { preserved: true };
  }
  const authUser = await safeAuthUser(profile.uid);
  if (authUser) await firebaseAuth().deleteUser(profile.uid);
  const batch = firestore().batch();
  batch.delete(userRef(profile.uid));
  if (legacySnap.exists && legacySnap.data()?.managedByAccountSystem === true) batch.delete(roleRef(profile.uid));
  batch.set(studentRef(profile.studentNumber), resetStudentPatch(actor.uid, Date.now()), { merge: true });
  batch.set(registrationRef(profile.studentNumber), { claimStatus: "READY", deletedAtMs: Date.now(), updatedAtMs: Date.now() }, { merge: true });
  batch.set(backupUser, { deletionStatus: "DELETED", deletedAtMs: Date.now() }, { merge: true });
  await batch.commit();
  return { deleted: true };
}

async function repairGhosts(actor, classKey, manifestRef) {
  const snap = await students().where("classKey", "==", classKey).limit(80).get();
  let repaired = 0; let relinked = 0; let preserved = 0; const failed = [];
  for (const doc of snap.docs) {
    const studentNumber = doc.id;
    const student = doc.data() || {};
    try {
      const current = await canonicalUser(studentNumber);
      if (current) {
        await studentRef(studentNumber).set({
          activated: current.status !== "DISABLED", uid: current.uid, existingUid: current.uid,
          accountStatus: current.status || "ACTIVE", claimState: current.status === "DISABLED" ? "READY" : "CLAIMED",
          claimNonce: "", claimAttemptId: "", claimLeaseUntilMs: 0, updatedAtMs: Date.now(), updatedByUid: actor.uid,
        }, { merge: true });
        relinked += 1;
        continue;
      }
      await manifestRef.collection("roster").doc(studentNumber).set({
        before: { activated: student.activated === true, uid: String(student.uid || ""), existingUid: String(student.existingUid || ""), accountStatus: String(student.accountStatus || "") },
        createdAtMs: Date.now(),
      });
      const orphanUids = new Set([String(student.uid || ""), String(student.existingUid || "")].filter(Boolean));
      const expectedAuth = await safeAuthByEmail(studentEmail(studentNumber));
      if (expectedAuth?.uid) orphanUids.add(expectedAuth.uid);
      for (const uid of orphanUids) {
        if (await privilegedUid(uid)) { preserved += 1; continue; }
        const authUser = await safeAuthUser(uid);
        if (authUser) await firebaseAuth().deleteUser(uid);
        await userRef(uid).delete().catch(() => {});
        const legacySnap = await roleRef(uid).get().catch(() => null);
        if (legacySnap?.exists && legacySnap.data()?.managedByAccountSystem === true) await roleRef(uid).delete().catch(() => {});
      }
      await Promise.all([
        studentRef(studentNumber).set(resetStudentPatch(actor.uid, Date.now()), { merge: true }),
        registrationRef(studentNumber).set({ claimStatus: "READY", updatedAtMs: Date.now() }, { merge: true }),
      ]);
      repaired += 1;
    } catch (error) {
      failed.push({ studentNumber, error: String(error?.code || error?.message || "repair-failed") });
    }
  }
  return { repaired, relinked, preserved, failed };
}

export default async function generalAccountDelete(req, res) {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return sendJson(res, 204, {}, headers);
  if (req.method !== "POST") return sendJson(res, 405, { error: "method-not-allowed" }, headers);
  try {
    const { profile: actor } = await requireProfileOrLegacy(req, { legacyLevels: ["school", "president", "class", "grade"] });
    if (!isAccountAdmin(actor)) throw Object.assign(new Error("account-admin-required"), { status: 403 });
    const body = await jsonBody(req);
    if (body.confirmation !== CONFIRMATION) throw Object.assign(new Error("account-delete-confirmation-required"), { status: 400 });
    const classKey = String(body.classKey || actor.classKey || "").trim();
    if (!validClassKey(classKey)) throw Object.assign(new Error("class-key-required"), { status: 400 });
    if (!hasRole(actor, ROLE.ADMIN) && actor.classKey !== classKey) throw Object.assign(new Error("class-scope-denied"), { status: 403 });
    const requested = [...new Set((Array.isArray(body.studentNumbers) ? body.studentNumbers : []).map((value) => String(value || "").trim()).filter((value) => /^\d{5}$/.test(value)))].slice(0, 80);
    const backupId = `${Date.now()}-${classKey}`;
    const manifestRef = backupRef(backupId);
    const startedAt = Date.now();
    await manifestRef.set({ schemaVersion: 2, schoolId: SCHOOL_ID, classKey, scope: "CLASS", status: "IN_PROGRESS", actorUid: actor.uid, actorName: actor.name || "", requestedCount: requested.length, createdAtMs: startedAt, updatedAtMs: startedAt });
    const deleted = []; const preserved = []; const failed = [];
    for (const studentNumber of requested) {
      try {
        const profile = await canonicalUser(studentNumber);
        if (!profile || profile.classKey !== classKey) continue;
        if (profile.uid === actor.uid || isPrivileged(profile)) { preserved.push(studentNumber); continue; }
        const result = await deleteCandidate(actor, profile, manifestRef, startedAt);
        if (result.deleted) deleted.push(studentNumber);
        if (result.preserved) preserved.push(studentNumber);
      } catch (error) {
        failed.push({ studentNumber, error: String(error?.code || error?.message || "account-delete-failed") });
      }
    }
    const repair = await repairGhosts(actor, classKey, manifestRef);
    failed.push(...repair.failed);
    await manifestRef.set({ status: failed.length ? "PARTIAL" : "COMPLETED", deletedCount: deleted.length, repairedCount: repair.repaired, relinkedCount: repair.relinked, preservedCount: preserved.length + repair.preserved, failedCount: failed.length, updatedAtMs: Date.now(), completedAtMs: Date.now() }, { merge: true });
    await appendAccountAudit({ actor, action: "GENERAL_ACCOUNTS_DELETE_AND_ENROLLMENT_REPAIR", targetUid: actor.uid, metadata: { classKey, backupId, requested: String(requested.length), deleted: String(deleted.length), repaired: String(repair.repaired), relinked: String(repair.relinked), preserved: String(preserved.length + repair.preserved), failed: String(failed.length) } });
    return sendJson(res, 200, { backupId, classKey, requested: requested.length, deleted: deleted.length, repaired: repair.repaired, relinked: repair.relinked, preserved: preserved.length + repair.preserved, failed }, headers);
  } catch (error) {
    const status = Number(error?.status || 500);
    return sendJson(res, status, { error: status >= 500 ? "general-account-delete-failed" : String(error?.message || "general-account-delete-failed") }, headers);
  }
}
