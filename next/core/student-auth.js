const FIREBASE = globalThis.PINCON_FIREBASE_CONFIG || {};
const SCHOOL = globalThis.PINCON_SCHOOL_CONFIG || { id: "gochon-high", name: "학교" };
const CONFIGURED_API_BASE = String(globalThis.PINCON_ACCOUNT_API_BASE || "").trim().replace(/\/$/, "");
const API_BASES = Object.freeze(CONFIGURED_API_BASE
  ? [CONFIGURED_API_BASE]
  : ["https://pincon-ai.vercel.app"]);
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

async function authorizedFetch(path, options = {}) {
  const authApi = await api();
  await authApi.auth.authStateReady?.();
  const user = authApi.auth.currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");

  const request = async (forceRefresh = false) => {
    const idToken = await user.getIdToken(forceRefresh);
    let lastNetworkError = null;

    // The public project alias is the only default account endpoint. Team aliases may
    // be protected by Vercel Authentication and can turn a valid API call into a
    // cross-origin SSO redirect, which browsers surface as TypeError: Failed to fetch.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      for (const base of API_BASES) {
        try {
          return await fetch(`${base}${path}`, {
            ...options,
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${idToken}`,
              ...(options.headers || {}),
            },
            cache: "no-store",
          });
        } catch (error) {
          lastNetworkError = error;
        }
      }
      if (attempt === 0) await wait(350);
    }

    const error = new Error("account-api-unreachable");
    error.code = "account-api-unreachable";
    error.cause = lastNetworkError;
    throw error;
  };

  // Firebase already refreshes an expired token when getIdToken(false) is used.
  // Only force-refresh after a real 401 response.
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

export async function changeStudentPin(newPin) {
  const pin = String(newPin || "");
  if (!/^\d{6,12}$/.test(pin) || /^(\d)\1+$/.test(pin)) {
    throw new Error("PIN은 같은 숫자 반복을 제외한 6~12자리 숫자로 설정해주세요.");
  }
  await authorizedFetch("/api/accounts/change-pin", {
    method: "POST",
    body: JSON.stringify({ newPin: pin }),
  });
  return studentSession();
}

export async function signOutStudent() {
  const authApi = await api();
  await authApi.signOut(authApi.auth);
}

export async function accountRequest(path, { method = "GET", body = undefined } = {}) {
  return authorizedFetch(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const STUDENT_AUTH = Object.freeze({
  validStudentNumber,
  studentEmail,
  currentFirebaseUser,
  isStudentFirebaseUser,
  studentSession,
  signInStudent,
  changeStudentPin,
  signOutStudent,
  accountRequest,
});
