const PROFILE_KEY = "pincon-profile-v2";
const PUBLIC_CACHE_KEY = "pincon-class-ops-cache-v1";

function parseJson(value, fallback = null) {
  try { return JSON.parse(value) ?? fallback; } catch { return fallback; }
}

export function normalizedClassProfile(value) {
  const grade = Number(value?.grade);
  const classNumber = Number(value?.classNumber);
  if (!Number.isInteger(grade) || grade < 1 || grade > 3) return null;
  if (!Number.isInteger(classNumber) || classNumber < 1 || classNumber > 10) return null;
  return { grade, classNumber, classKey: `${grade}-${classNumber}` };
}

export function savedClassProfile(storage = globalThis.localStorage) {
  if (!storage?.getItem) return null;
  return normalizedClassProfile(parseJson(storage.getItem(PROFILE_KEY), null));
}

export function hasMatchingPublicCache(profile = savedClassProfile(), storage = globalThis.localStorage) {
  const normalized = normalizedClassProfile(profile);
  if (!normalized || !storage?.getItem) return false;
  const cached = parseJson(storage.getItem(PUBLIC_CACHE_KEY), null);
  if (!cached || cached.classKey !== normalized.classKey || !cached.data || typeof cached.data !== "object") return false;
  const collections = Object.values(cached.data).filter(Array.isArray);
  return collections.length > 0 && Number(cached.savedAtMs || 0) > 0;
}

export function isTransientAuthFailure(error) {
  const status = Number(error?.status || 0);
  if ([401, 403].includes(status)) return false;
  if (status === 408 || status === 429 || status >= 500) return true;

  const code = String(error?.code || "").toLowerCase();
  if ([
    "account-api-unreachable",
    "auth/network-request-failed",
    "unavailable",
    "deadline-exceeded",
    "network-request-failed",
  ].includes(code)) return true;

  const message = String(error?.message || error || "").toLowerCase();
  return /account-api-unreachable|failed to fetch|network(?:error| request)?|load failed|timeout|timed out|offline|importing a module script failed/.test(message);
}

export function canEnterDegradedReadonly(error, storage = globalThis.localStorage) {
  const profile = savedClassProfile(storage);
  return Boolean(profile && hasMatchingPublicCache(profile, storage) && isTransientAuthFailure(error));
}

export function enableForcedReadonly(mode = "degraded-readonly") {
  globalThis.PINCON_FORCE_READONLY = true;
  globalThis.PINCON_READONLY_MODE = mode;
  if (mode === "offline-readonly") globalThis.PINCON_OFFLINE_READONLY = true;
  return mode;
}

export function forcedReadonlyMode() {
  if (globalThis.PINCON_FORCE_READONLY !== true) return "";
  return String(globalThis.PINCON_READONLY_MODE || "degraded-readonly");
}

export const DEGRADED_READONLY = Object.freeze({
  normalizedClassProfile,
  savedClassProfile,
  hasMatchingPublicCache,
  isTransientAuthFailure,
  canEnterDegradedReadonly,
  enableForcedReadonly,
  forcedReadonlyMode,
});
