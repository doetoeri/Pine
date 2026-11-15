import { accountRequest, currentFirebaseUser } from "../next/core/student-auth.js";

const path = "/api/class-ops/vision-lab";
const accessDenied = error => [401, 403].includes(error?.status);

export async function readVisionLab(view, { signal } = {}) {
  const route = view ? `${path}?view=${encodeURIComponent(view)}` : path;
  const base = globalThis.PINCON_ACCOUNT_API_BASE || location.origin;
  const response = await fetch(new URL(route, base), { cache: "no-store", signal });
  if (!response.ok && response.status !== 403) {
    throw Object.assign(new Error("vision-lab-unavailable"), { status: response.status });
  }
  const anonymous = await response.json();
  if (response.ok && (view !== "status" || anonymous.available)) return anonymous;
  const user = await currentFirebaseUser().catch(() => null);
  if (!user || signal?.aborted) return { available: false };
  try { return await accountRequest(route, { networkRetries: 0 }); }
  catch (error) {
    if (accessDenied(error)) return { available: false };
    throw error;
  }
}

export function visionLabSettings(visibility) {
  return accountRequest(`${path}?view=settings`, visibility === undefined ? { networkRetries: 0 }
    : { method: "POST", body: { public: visibility }, networkRetries: 0 });
}
