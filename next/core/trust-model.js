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
  enabled: false,
  reason: "Next Beta의 서버 권한 규칙이 검증되기 전까지 공용 쓰기를 잠급니다.",
});

function classScopeIncludes(role, classKey) {
  if (!role?.enabled) return false;
  if (role.level === "school") return true;
  return Array.isArray(role.classKeys) && role.classKeys.includes(classKey);
}

export function mapLegacyRole(role, classKey = "") {
  if (!classScopeIncludes(role, classKey)) return NEXT_ROLE.VIEWER;
  if (["admin", "system", "school-admin"].includes(role.level)) return NEXT_ROLE.SYSTEM_ADMIN;
  if (["president", "grade", "class", "manager"].includes(role.level)) return NEXT_ROLE.MANAGER;
  if (["editor", "staff"].includes(role.level)) return NEXT_ROLE.EDITOR;
  return NEXT_ROLE.VIEWER;
}

export function resolveNextAccess({ user = null, legacyRole = null, classKey = "" } = {}) {
  const role = mapLegacyRole(legacyRole, classKey);
  const configured = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS[NEXT_ROLE.VIEWER];
  return Object.freeze({
    signedIn: Boolean(user?.uid),
    role,
    displayName: user?.displayName || user?.email || "",
    configuredPermissions: [...configured],
    writeGateEnabled: NEXT_WRITE_GATE.enabled,
    canRead: configured.has(PERMISSION.READ),
    canWrite: NEXT_WRITE_GATE.enabled && [...configured].some((permission) => permission !== PERMISSION.READ),
    reason: NEXT_WRITE_GATE.reason,
  });
}

export function canAccess(access, permission) {
  if (permission === PERMISSION.READ) return Boolean(access?.canRead);
  if (!NEXT_WRITE_GATE.enabled) return false;
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
  destructiveAction: "hard delete 금지. archive 후 audit event를 같은 서버 트랜잭션에서 기록",
  restore: "manager 이상만 가능하며 restore audit event 필수",
  approval: "공개 전 승인 대상은 manager 승인 기록 필수",
  beta: "이 계약은 현재 클라이언트 설계 계약이며 Firestore 규칙 적용 전에는 쓰기를 활성화하지 않음",
});
