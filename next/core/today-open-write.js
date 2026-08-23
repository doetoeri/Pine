export const TODAY_OPEN_WRITE_CLASS_KEY = "1-8";
export const TODAY_OPEN_WRITE_UNTIL_MS = 1787583599000;

export function todayOpenWriteEligible({ user = null, profile = null, now = Date.now() } = {}) {
  return Boolean(
    user?.uid
    && profile?.classKey === TODAY_OPEN_WRITE_CLASS_KEY
    && Number(now) < TODAY_OPEN_WRITE_UNTIL_MS,
  );
}

export function todayOpenWriteRemaining(now = Date.now()) {
  return Math.max(0, TODAY_OPEN_WRITE_UNTIL_MS - Number(now));
}
