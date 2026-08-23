export const NEXT_ROLE = Object.freeze({
  VIEWER: "viewer",
  EDITOR: "editor",
  MANAGER: "manager",
  SYSTEM_ADMIN: "system-admin",
});

export const PERMISSION = Object.freeze({
  READ: "read",
  CREATE: "create",
  UPDATE: "update",
  ARCHIVE: "archive",
  RESTORE: "restore",
  APPROVE: "approve",
  MANAGE_ROLES: "manage-roles",
});

const ROLE_PERMISSIONS = Object.freeze({
  [NEXT_ROLE.VIEWER]: new Set([PERMISSION.READ]),
  [NEXT_ROLE.EDITOR]: new Set([PERMISSION.READ, PERMISSION.CREATE, PERMISSION.UPDATE]),
  [NEXT_ROLE.MANAGER]: new Set([
    PERMISSION.READ,
    PERMISSION.CREATE,
    PERMISSION.UPDATE,
    PERMISSION.ARCHIVE,
    PERMISSION.RESTORE,
    PERMISSION.APPROVE,
  ]),
  [NEXT_ROLE.SYSTEM_ADMIN]: new Set(Object.values(PERMISSION)),
});

export const NEXT_WRITE_GATE = Object.freeze({
  enabled: true,
  reason: "인증된 학급 운영 계정만 서버 규칙이 허용하는 범위에서 편집할 수 있습니다.",
});

function classScopeIncludes(role, classKey) {
  if (!role?.enabled) return false;
  if (["school", "admin", "system", "school-admin"].includes(role.level)) return true;
  return Array.isArray(role.classKeys) && role.classKeys.includes(classKey);
}

export function mapLegacyRole(role, classKey = "") {
  if (!classScopeIncludes(role, classKey)) return NEXT_ROLE.VIEWER;
  if (["school", "admin", "system", "school-admin"].includes(role.level)) return NEXT_ROLE.SYSTEM_ADMIN;
  if (["president", "grade", "class", "manager"].includes(role.level)) return NEXT_ROLE.MANAGER;
  if (["editor", "staff"].includes(role.level)) return NEXT_ROLE.EDITOR;
  return NEXT_ROLE.VIEWER;
}

export function resolveNextAccess({ user = null, legacyRole = null, classKey = "" } = {}) {
  const role = mapLegacyRole(legacyRole, classKey);
  const configured = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS[NEXT_ROLE.VIEWER];
  const signedIn = Boolean(user?.uid);
  return Object.freeze({
    signedIn,
    role,
    displayName: user?.displayName || user?.email || "",
    configuredPermissions: [...configured],
    writeGateEnabled: NEXT_WRITE_GATE.enabled,
    canRead: configured.has(PERMISSION.READ),
    canWrite: signedIn && NEXT_WRITE_GATE.enabled && [...configured].some((permission) => permission !== PERMISSION.READ),
    reason: NEXT_WRITE_GATE.reason,
  });
}

export function canAccess(access, permission) {
  if (permission === PERMISSION.READ) return Boolean(access?.canRead);
  if (!access?.signedIn || !NEXT_WRITE_GATE.enabled) return false;
  return Boolean(access?.configuredPermissions?.includes(permission));
}

function auditValue(value) {
  if (value === undefined) return null;
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 2000);
  if (Array.isArray(value)) return value.slice(0, 60).map(auditValue);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [key, auditValue(item)]));
  }
  return String(value).slice(0, 500);
}

export function createAuditEvent({
  action,
  actorUid,
  actorRole,
  classKey,
  collection,
  recordId,
  before = null,
  after = null,
  reason = "",
  now = Date.now(),
} = {}) {
  if (!action || !actorUid || !classKey || !collection || !recordId) {
    throw new Error("감사 기록에 필요한 식별 정보가 부족합니다.");
  }
  return Object.freeze({
    schemaVersion: 1,
    action: String(action),
    actorUid: String(actorUid),
    actorRole: String(actorRole || NEXT_ROLE.VIEWER),
    classKey: String(classKey),
    collection: String(collection),
    recordId: String(recordId),
    reason: String(reason || "").slice(0, 500),
    before: auditValue(before),
    after: auditValue(after),
    occurredAtMs: Number(now),
  });
}

export function softDeletePatch({ actorUid, now = Date.now() } = {}) {
  if (!actorUid) throw new Error("삭제 기록에는 사용자 식별자가 필요합니다.");
  return Object.freeze({
    deleted: true,
    status: "archived",
    deletedAtMs: Number(now),
    deletedBy: String(actorUid),
    updatedAtMs: Number(now),
    updatedBy: String(actorUid),
  });
}

export function restorePatch({ actorUid, now = Date.now(), restoredStatus = "active" } = {}) {
  if (!actorUid) throw new Error("복원 기록에는 사용자 식별자가 필요합니다.");
  return Object.freeze({
    deleted: false,
    status: String(restoredStatus),
    deletedAtMs: null,
    deletedBy: null,
    restoredAtMs: Number(now),
    restoredBy: String(actorUid),
    updatedAtMs: Number(now),
    updatedBy: String(actorUid),
  });
}

export const TRUST_CONTRACT = Object.freeze({
  destructiveAction: "hard delete 금지. archive 후 change log를 같은 서버 batch에서 기록",
  restore: "학급 관리자 이상만 가능하며 restore 기록 필수",
  approval: "공개 전 승인 대상은 관리자 승인 기록 필수",
  production: "Next 편집은 기존 production Firestore의 classOperator 권한과 변경 기록을 재사용",
});
