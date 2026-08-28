import { corsHeaders, isClassOperator, publicProfile, requireProfile } from "../../lib/class-accounts.mjs";
import { canManagePhone, dateKey } from "../../lib/class-operations.mjs";
import {
  classSettings,
  collection,
  onePersonRoleFor,
  ownPhoneState,
} from "../../lib/class-ops-store.mjs";
import { sendJson } from "../../lib/request.mjs";

async function rows(name, classKey, limit = 250) {
  const snapshot = await collection(name).where("classKey", "==", classKey).limit(limit).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

function pendingForActor(actor, data) {
  const departmentId = actor.departmentId || "";
  const subjects = new Set((actor.subjectRoles || []).map((item) => item.subject));
  const classOperator = isClassOperator(actor);
  return {
    cleaningRequests: data.cleaningRequests.filter((item) => item.status === "PENDING" && (classOperator || item.departmentId === departmentId)).length,
    subjectReviews: data.subjectEntries.filter((item) => item.status === "PENDING_REVIEW" && (classOperator || subjects.has(item.subject))).length,
    phoneChecks: data.phoneStates.filter((item) => item.date === data.date && item.status === "CHECK_REQUIRED").length,
  };
}

export default async function classOpsHome(req, res) {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return sendJson(res, 204, {}, headers);
  if (req.method !== "GET") return sendJson(res, 405, { error: "method-not-allowed" }, headers);

  try {
    const { profile } = await requireProfile(req);
    const date = dateKey();
    const [settings, onePersonRole, phone, cleaningAssignments, cleaningRequests, subjectEntries, phoneStates] = await Promise.all([
      classSettings(profile.classKey),
      onePersonRoleFor(profile),
      ownPhoneState(profile, date),
      rows("cleaningAssignments", profile.classKey),
      rows("cleaningRequests", profile.classKey),
      rows("subjectEntries", profile.classKey),
      rows("phoneStates", profile.classKey, 100),
    ]);

    const todayCleaning = cleaningAssignments.find((item) => item.date === date && item.assigneeUid === profile.uid && item.status !== "EXEMPTED") || null;
    const ownRequests = cleaningRequests.filter((item) => item.requesterUid === profile.uid || item.targetUid === profile.uid).slice(-20);
    const subjectRoles = new Set((profile.subjectRoles || []).map((item) => item.subject));
    const subjectQueue = subjectEntries.filter((item) => subjectRoles.has(item.subject) && item.status === "PENDING_REVIEW").slice(0, 20);
    const phoneManager = await canManagePhone(profile);
    const pending = pendingForActor(profile, { cleaningRequests, subjectEntries, phoneStates, date });
    if (!phoneManager) pending.phoneChecks = 0;

    return sendJson(res, 200, {
      date,
      account: publicProfile(profile),
      settings: {
        phoneMovementPolicy: settings.phoneMovementPolicy,
        cleaningAutoAssignEnabled: settings.cleaningAutoAssignEnabled !== false,
      },
      today: {
        cleaning: todayCleaning,
        onePersonRole,
        phone,
        subjectRoles: profile.subjectRoles || [],
      },
      requests: ownRequests,
      management: {
        canManagePhone: phoneManager,
        canManageClass: isClassOperator(profile),
        departmentId: profile.departmentId || "",
        subjectQueue,
        pending,
      },
    }, headers);
  } catch (error) {
    return sendJson(res, error?.status || 500, { error: error?.message || "class-ops-home-failed" }, headers);
  }
}
