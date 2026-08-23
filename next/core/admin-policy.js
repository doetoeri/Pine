import { NEXT_ROLE, NEXT_WRITE_GATE } from "./trust-model.js";

const ADMIN_ROLES = new Set([NEXT_ROLE.MANAGER, NEXT_ROLE.SYSTEM_ADMIN]);

export function canEnterAdmin(access) {
  return Boolean(access?.signedIn && ADMIN_ROLES.has(access?.role));
}

export function adminAccessState(access) {
  if (!access?.signedIn) {
    return Object.freeze({
      allowed: false,
      mode: "signed-out",
      title: "로그인이 필요합니다",
      message: "관리 영역은 인증된 학급 관리자만 열 수 있습니다.",
    });
  }

  if (!ADMIN_ROLES.has(access?.role)) {
    return Object.freeze({
      allowed: false,
      mode: "forbidden",
      title: "관리 권한이 없습니다",
      message: "현재 계정에는 PinCon Next 관리 영역을 볼 권한이 없습니다.",
    });
  }

  return Object.freeze({
    allowed: true,
    mode: NEXT_WRITE_GATE.enabled ? "write-enabled" : "read-only-beta",
    title: NEXT_WRITE_GATE.enabled ? "관리 모드" : "읽기 전용 관리 Beta",
    message: NEXT_WRITE_GATE.enabled
      ? "서버 권한 규칙에 따라 허용된 작업만 수행할 수 있습니다."
      : "공용 쓰기는 아직 잠겨 있습니다. 현황·감사 기록·복구 대상을 검토할 수 있습니다.",
  });
}

export function normalizedAuditLogs(data = {}) {
  const candidates = [data.auditLogs, data.auditLog, data.auditEvents];
  const rows = candidates.find(Array.isArray) || [];
  return [...rows].sort((a, b) => Number(b?.occurredAtMs || b?.createdAtMs || 0) - Number(a?.occurredAtMs || a?.createdAtMs || 0));
}

export function archivedRecords(data = {}) {
  const rows = [];
  for (const [collection, value] of Object.entries(data || {})) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      if (item.deleted === true || item.status === "archived") {
        rows.push({ collection, item });
      }
    }
  }
  return rows.sort((a, b) => Number(b.item?.deletedAtMs || b.item?.updatedAtMs || 0) - Number(a.item?.deletedAtMs || a.item?.updatedAtMs || 0));
}
