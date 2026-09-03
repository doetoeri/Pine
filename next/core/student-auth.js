const FIREBASE = globalThis.PINCON_FIREBASE_CONFIG || {};
const SCHOOL = globalThis.PINCON_SCHOOL_CONFIG || { id: "gochon-high", name: "학교" };
const normalizeApiBase = (value) => String(value || "").trim().replace(/\/$/, "");
const CONFIGURED_API_BASE = normalizeApiBase(globalThis.PINCON_ACCOUNT_API_BASE);
const CONFIGURED_API_FALLBACKS = Array.isArray(globalThis.PINCON_ACCOUNT_API_FALLBACKS)
  ? globalThis.PINCON_ACCOUNT_API_FALLBACKS.map(normalizeApiBase).filter(Boolean)
  : [];
const DEFAULT_API_BASE = "https://pincon-ai-git-main-doeyoungkims-projects.vercel.app";
const API_BASES = Object.freeze([...new Set([
  CONFIGURED_API_BASE || DEFAULT_API_BASE,
  ...CONFIGURED_API_FALLBACKS,
])]);
const SDK = "12.16.0";
let apiPromise;

async function api() {
  if (!apiPromise) {
    apiPromise = Promise.all([
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-auth.js`),
    ]).then(([appApi, authApi]) => {
      const app = appApi.getApps().length ? appApi.getApp() : appApi.initializeApp(FIREBASE);
      const auth = authApi.getAuth(app);
      auth.useDeviceLanguage();
      return { app, auth, ...authApi };
    });
  }
  return apiPromise;
}

export function validStudentNumber(value) {
  return /^\d{5}$/.test(String(value || "").trim());
}

export function normalizeActivationCode(value) {
  return String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

export function studentEmail(studentNumber) {
  const value = String(studentNumber || "").trim();
  if (!validStudentNumber(value)) throw new Error("학번을 다시 확인해주세요.");
  const safeSchool = String(SCHOOL.id).toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 50);
  return `${safeSchool}.${value}@students.pincon.invalid`;
}

async function readResponse(response) {
  let data = {};
  try { data = await response.json(); } catch {}
  return data;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function accountFetch(path, options = {}) {
  const {
    pinconNetworkRetries = 1,
    ...fetchOptions
  } = options;
  const networkRetries = Math.max(0, Math.min(2, Number(pinconNetworkRetries) || 0));
  let lastNetworkError = null;
  let lastMissingRouteResponse = null;
  for (let attempt = 0; attempt <= networkRetries; attempt += 1) {
    for (let index = 0; index < API_BASES.length; index += 1) {
      const base = API_BASES[index];
      try {
        const response = await fetch(`${base}${path}`, {
          ...fetchOptions,
          headers: {
            "content-type": "application/json",
            ...(fetchOptions.headers || {}),
          },
          cache: "no-store",
        });
        const hasFallback = index < API_BASES.length - 1;
        // A Vercel 404 here means the deployment alias exists but this server route does not.
        // Falling through only on 404 avoids replaying successful/ambiguous mutations on 5xx responses.
        if (response.status === 404 && hasFallback) {
          lastMissingRouteResponse = response;
          continue;
        }
        return response;
      } catch (error) {
        lastNetworkError = error;
      }
    }
    if (attempt < networkRetries) await wait(350);
  }
  if (lastMissingRouteResponse) return lastMissingRouteResponse;
  const error = new Error("account-api-unreachable");
  error.code = "account-api-unreachable";
  error.cause = lastNetworkError;
  throw error;
}

async function authorizedFetch(path, options = {}) {
  const {
    pinconNetworkRetries = 1,
    ...fetchOptions
  } = options;
  const networkRetries = Math.max(0, Math.min(2, Number(pinconNetworkRetries) || 0));

  const authApi = await api();
  await authApi.auth.authStateReady?.();
  const user = authApi.auth.currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");

  const request = async (forceRefresh = false) => {
    const idToken = await user.getIdToken(forceRefresh);
    return accountFetch(path, {
      ...fetchOptions,
      pinconNetworkRetries: networkRetries,
      headers: {
        authorization: `Bearer ${idToken}`,
        ...(fetchOptions.headers || {}),
      },
    });
  };

  let response = await request(false);
  if (response.status === 401) response = await request(true);

  const data = await readResponse(response);
  if (!response.ok) {
    const error = new Error(data?.error || "request-failed");
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function currentFirebaseUser() {
  const authApi = await api();
  await authApi.auth.authStateReady?.();
  return authApi.auth.currentUser || null;
}

export function isStudentFirebaseUser(user) {
  return Boolean(user?.email && /@students\.pincon\.invalid$/i.test(user.email));
}

export async function studentSession() {
  const user = await currentFirebaseUser();
  if (!isStudentFirebaseUser(user)) return null;
  const result = await authorizedFetch("/api/accounts/session", { method: "GET" });
  return { user, account: result.account };
}

export async function signInStudent({ studentNumber, pin, remember = true } = {}) {
  const number = String(studentNumber || "").trim();
  const secret = String(pin || "");
  if (!validStudentNumber(number) || !/^\d{6,12}$/.test(secret)) {
    throw new Error("학번 또는 PIN을 다시 확인해주세요.");
  }
  const authApi = await api();
  await authApi.setPersistence(authApi.auth, remember ? authApi.browserLocalPersistence : authApi.browserSessionPersistence);
  try {
    const credential = await authApi.signInWithEmailAndPassword(authApi.auth, studentEmail(number), secret);
    const result = await authorizedFetch("/api/accounts/session", { method: "GET" });
    if (!result?.account || result.account.status !== "ACTIVE") throw new Error("invalid-account");
    return { user: credential.user, account: result.account };
  } catch (error) {
    await authApi.signOut(authApi.auth).catch(() => {});
    const wrapped = new Error("학번 또는 PIN을 다시 확인해주세요.");
    wrapped.code = error?.code || error?.message || "student-login-failed";
    throw wrapped;
  }
}

export async function claimStudentAccount({ studentNumber, activationCode, remember = true } = {}) {
  const number = String(studentNumber || "").trim();
  const code = normalizeActivationCode(activationCode);
  if (!validStudentNumber(number) || !/^[A-Z0-9]{8}$/.test(code)) {
    throw new Error("학번과 활성화 코드를 다시 확인해주세요.");
  }
  const authApi = await api();
  await authApi.setPersistence(authApi.auth, remember ? authApi.browserLocalPersistence : authApi.browserSessionPersistence);
  try {
    const response = await accountFetch("/api/accounts/claim", {
      method: "POST",
      body: JSON.stringify({ studentNumber: number, activationCode: code }),
      pinconNetworkRetries: 0,
    });
    const data = await readResponse(response);
    if (!response.ok || !data?.customToken) throw Object.assign(new Error(data?.error || "account-claim-failed"), { status: response.status });
    const credential = await authApi.signInWithCustomToken(authApi.auth, data.customToken);
    const result = await authorizedFetch("/api/accounts/session", { method: "GET" });
    if (!result?.account || result.account.status !== "ACTIVE" || result.account.mustChangePin !== true) {
      throw new Error("invalid-account");
    }
    return { user: credential.user, account: result.account };
  } catch (error) {
    await authApi.signOut(authApi.auth).catch(() => {});
    const wrapped = new Error("학번 또는 활성화 코드를 확인하지 못했습니다.");
    wrapped.code = error?.code || error?.message || "student-claim-failed";
    throw wrapped;
  }
}

export async function changeStudentPin(newPin) {
  const pin = String(newPin || "");
  if (!/^\d{6,12}$/.test(pin) || /^(\d)\1+$/.test(pin)) {
    throw new Error("PIN은 같은 숫자 반복을 제외한 6~12자리 숫자로 설정해주세요.");
  }

  const authApi = await api();
  await authApi.auth.authStateReady?.();
  const currentUser = authApi.auth.currentUser;
  const email = String(currentUser?.email || "");
  if (!isStudentFirebaseUser(currentUser) || !email) throw new Error("학생 로그인이 필요합니다.");

  let pinSaved = false;
  try {
    await authorizedFetch("/api/accounts/change-pin", {
      method: "POST",
      body: JSON.stringify({ newPin: pin }),
    });
    pinSaved = true;

    // Firebase invalidates the existing credential after an Admin SDK password change.
    // Reauthenticate immediately with the new PIN before requesting the refreshed profile.
    await authApi.signOut(authApi.auth).catch(() => {});
    const credential = await authApi.signInWithEmailAndPassword(authApi.auth, email, pin);
    const result = await authorizedFetch("/api/accounts/session", { method: "GET" });
    if (!result?.account || result.account.status !== "ACTIVE") throw new Error("invalid-account");
    return { user: credential.user, account: result.account };
  } catch (error) {
    if (pinSaved) {
      const wrapped = new Error("PIN은 저장됐지만 로그인 갱신에 실패했습니다. 새 PIN으로 다시 로그인해주세요.");
      wrapped.code = error?.code || error?.message || "pin-reauth-failed";
      throw wrapped;
    }
    throw error;
  }
}

export async function signOutStudent() {
  const authApi = await api();
  await authApi.signOut(authApi.auth);
}

export async function accountRequest(path, { method = "GET", body = undefined, networkRetries = 1 } = {}) {
  return authorizedFetch(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    pinconNetworkRetries: networkRetries,
  });
}

export const STUDENT_AUTH = Object.freeze({
  validStudentNumber,
  normalizeActivationCode,
  studentEmail,
  currentFirebaseUser,
  isStudentFirebaseUser,
  studentSession,
  signInStudent,
  claimStudentAccount,
  changeStudentPin,
  signOutStudent,
  accountRequest,
});