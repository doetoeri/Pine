import { randomInt } from "node:crypto";
import { firebaseAuth, firestore } from "../../lib/firebase.mjs";
import {
  SCHOOL_ID,
  appendAccountAudit,
  assertSameClass,
  corsHeaders,
  isAccountAdmin,
  normalizeProfile,
  publicProfile,
  requireProfileOrLegacy,
  studentEmail,
  syncCompatibilityRole,
} from "../../lib/class-accounts.mjs";
import { jsonBody, sendJson } from "../../lib/request.mjs";

const ACCOUNT_LIMIT = 60;
const BULK_CONCURRENCY = 4;
const usersCollection = () => firestore().collection(`schools/${SCHOOL_ID}/users`);
const userDocument = (uid) => firestore().doc(`schools/${SCHOOL_ID}/users/${uid}`);

function assertCreator(actor) {
  if (!isAccountAdmin(actor)) throw Object.assign(new Error("account-admin-required"), { status: 403 });
}

async function findByStudentNumber(studentNumber) {
  const snapshot = await usersCollection()
    .where("studentNumber", "==", String(studentNumber || ""))
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, ...doc.data() };
}

function temporaryPin() {
  return String(randomInt(100000, 1000000));
}

function normalizeCandidate(actor, input) {
  const candidate = normalizeProfile({
    ...(input || {}),
    roles: ["STUDENT"],
    subjectRoles: [],
    status: "ACTIVE",
    mustChangePin: true,
  });
  assertSameClass(actor, candidate);
  return candidate;
}

async function createStudent(actor, input) {
  const candidate = normalizeCandidate(actor, input);
  const duplicate = await findByStudentNumber(candidate.studentNumber);
  if (duplicate) throw Object.assign(new Error("student-number-exists"), { status: 409 });

  const pin = temporaryPin();
  let authUser = null;
  try {
    authUser = await firebaseAuth().createUser({
      email: studentEmail(candidate.studentNumber),
      password: pin,
      displayName: candidate.name || candidate.studentNumber,
      disabled: false,
      emailVerified: false,
    });
  } catch (error) {
    if (error?.code === "auth/email-already-exists") {
      throw Object.assign(new Error("student-number-exists"), { status: 409 });
    }
    throw error;
  }

  const account = normalizeProfile(candidate, { uid: authUser.uid });
  const now = Date.now();
  try {
    await userDocument(authUser.uid).create({
      ...account,
      createdAtMs: now,
      updatedAtMs: now,
      createdByUid: actor.uid,
      updatedByUid: actor.uid,
    });
  } catch (error) {
    await firebaseAuth().deleteUser(authUser.uid).catch(() => {});
    throw error;
  }

  await syncCompatibilityRole(account, actor.uid);
  await appendAccountAudit({
    actor,
    action: "ACCOUNT_CREATE_V2",
    targetUid: account.uid,
    after: account,
    metadata: { secretStored: "false", endpoint: "account-create" },
  });

  return { account: publicProfile(account), temporaryPin: pin };
}

function publicBulkError(error) {
  const message = String(error?.message || "account-create-failed");
  if ([
    "student-number-exists",
    "invalid-student-number",
    "invalid-seat-number",
    "invalid-class",
    "class-scope-denied",
  ].includes(message)) return message;
  return "account-create-failed";
}

async function createRoster(actor, input) {
  if (!Array.isArray(input) || !input.length) {
    throw Object.assign(new Error("bulk-accounts-required"), { status: 400 });
  }
  if (input.length > ACCOUNT_LIMIT) {
    throw Object.assign(new Error("bulk-account-limit-exceeded"), { status: 400 });
  }

  const prepared = input.map((raw, index) => ({ index, raw, candidate: null, error: "" }));
  const seen = new Set();
  for (const row of prepared) {
    try {
      row.candidate = normalizeCandidate(actor, row.raw);
      if (seen.has(row.candidate.studentNumber)) row.error = "duplicate-student-number-in-request";
      else seen.add(row.candidate.studentNumber);
    } catch (error) {
      row.error = publicBulkError(error);
    }
  }

  const output = new Array(prepared.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const position = cursor++;
      if (position >= prepared.length) return;
      const row = prepared[position];
      const studentNumber = String(row.candidate?.studentNumber || row.raw?.studentNumber || "");
      const name = String(row.candidate?.name || row.raw?.name || "");
      if (row.error) {
        output[position] = { ok: false, studentNumber, name, error: row.error };
        continue;
      }
      try {
        const created = await createStudent(actor, row.candidate);
        output[position] = { ok: true, ...created };
      } catch (error) {
        output[position] = { ok: false, studentNumber, name, error: publicBulkError(error) };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(BULK_CONCURRENCY, prepared.length) }, () => worker()));
  const created = output.filter((row) => row?.ok).map(({ ok, ...row }) => row);
  const failed = output.filter((row) => row && !row.ok).map(({ ok, ...row }) => row);

  await appendAccountAudit({
    actor,
    action: "ACCOUNT_BULK_CREATE_V2",
    targetUid: actor.uid,
    metadata: {
      requested: String(prepared.length),
      created: String(created.length),
      failed: String(failed.length),
      secretsStored: "false",
      endpoint: "account-create",
    },
  });

  return { requested: prepared.length, created, failed };
}

export default async function createAccounts(req, res) {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return sendJson(res, 204, {}, headers);
  if (req.method !== "POST") return sendJson(res, 405, { error: "method-not-allowed" }, headers);

  try {
    const { profile: actor } = await requireProfileOrLegacy(req, {
      legacyLevels: ["school", "president", "class", "grade"],
    });
    assertCreator(actor);
    const body = await jsonBody(req);
    const mode = String(body.mode || "single").toLowerCase();

    if (mode === "single") {
      return sendJson(res, 200, await createStudent(actor, body.account || {}), headers);
    }
    if (mode === "bulk") {
      return sendJson(res, 200, await createRoster(actor, body.accounts || []), headers);
    }
    return sendJson(res, 400, { error: "unsupported-create-mode" }, headers);
  } catch (error) {
    return sendJson(res, error?.status || 500, { error: error?.message || "account-create-failed" }, headers);
  }
}
