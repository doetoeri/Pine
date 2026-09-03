import { firestore } from "../../lib/firebase.mjs";
import {
  SCHOOL_ID,
  appendAccountAudit,
  assertSameClass,
  corsHeaders,
  isAccountAdmin,
  normalizeProfile,
  publicProfile,
  requireProfileOrLegacy,
} from "../../lib/class-accounts.mjs";
import { generateActivationCode, hashActivationCode } from "../../lib/account-activation.mjs";
import { jsonBody, sendJson } from "../../lib/request.mjs";

const ACCOUNT_LIMIT = 60;
const BULK_CONCURRENCY = 4;
const usersCollection = () => firestore().collection(`schools/${SCHOOL_ID}/users`);
const registrationDocument = (studentNumber) => firestore().doc(`schools/${SCHOOL_ID}/accountRegistrationRoster/${studentNumber}`);

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

async function stageStudent(actor, input) {
  const candidate = normalizeCandidate(actor, input);
  const existingUser = await findByStudentNumber(candidate.studentNumber);
  if (existingUser) throw Object.assign(new Error("student-number-exists"), { status: 409 });

  const ref = registrationDocument(candidate.studentNumber);
  const current = await ref.get();
  if (current.exists && current.data()?.claimStatus === "CLAIMED") {
    throw Object.assign(new Error("student-number-exists"), { status: 409 });
  }

  const activationCode = generateActivationCode();
  const activation = hashActivationCode(activationCode);
  const now = Date.now();
  await ref.set({
    schemaVersion: 2,
    schoolId: SCHOOL_ID,
    studentNumber: candidate.studentNumber,
    normalizedName: String(candidate.name || "").normalize("NFKC").trim().replace(/\s+/g, "").toLocaleLowerCase("ko"),
    profile: candidate,
    claimStatus: "READY",
    activationSalt: activation.salt,
    activationDigest: activation.digest,
    activationVersion: 1,
    claimNonce: "",
    claimLeaseUntilMs: 0,
    existingUid: "",
    createdAtMs: current.exists ? Number(current.data()?.createdAtMs || now) : now,
    createdByUid: current.exists ? String(current.data()?.createdByUid || actor.uid) : actor.uid,
    updatedAtMs: now,
    updatedByUid: actor.uid,
  }, { merge: false });

  await appendAccountAudit({
    actor,
    action: current.exists ? "ACCOUNT_ACTIVATION_REISSUE_V2" : "ACCOUNT_REGISTRATION_CREATE_V2",
    targetUid: candidate.studentNumber,
    after: candidate,
    metadata: { secretStored: "hashed", endpoint: "account-create", state: "READY" },
  });

  return { account: publicProfile(candidate), activationCode };
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

async function stageRoster(actor, input) {
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
        const created = await stageStudent(actor, row.candidate);
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
    action: "ACCOUNT_BULK_REGISTRATION_V2",
    targetUid: actor.uid,
    metadata: {
      requested: String(prepared.length),
      created: String(created.length),
      failed: String(failed.length),
      secretsStored: "hashed",
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
      return sendJson(res, 200, await stageStudent(actor, body.account || {}), headers);
    }
    if (mode === "bulk") {
      return sendJson(res, 200, await stageRoster(actor, body.accounts || []), headers);
    }
    return sendJson(res, 400, { error: "unsupported-create-mode" }, headers);
  } catch (error) {
    return sendJson(res, error?.status || 500, { error: error?.message || "account-create-failed" }, headers);
  }
}
