import {
  accountRequest,
  claimStudentAccount,
  currentFirebaseUser,
  isStudentFirebaseUser,
  normalizeActivationCode,
  signOutStudent,
  studentEmail,
  studentSession,
  validStudentNumber,
} from "./student-auth.js?v=20260903-pinreauth1";

export {
  accountRequest,
  claimStudentAccount,
  currentFirebaseUser,
  isStudentFirebaseUser,
  normalizeActivationCode,
  signOutStudent,
  studentEmail,
  studentSession,
  validStudentNumber,
};

const FIREBASE = globalThis.PINCON_FIREBASE_CONFIG || {};
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
      return { auth, ...authApi };
    });
  }
  return apiPromise;
}

async function readResponse(response) {
  try { return await response.json(); } catch { return {}; }
}

async function publicAccountFetch(path, options = {}) {
  let lastNetworkError = null;
  let lastMissingRouteResponse = null;
  for (let index = 0; index < API_BASES.length; index += 1) {
    const base = API_BASES[index];
    try {
      const response = await fetch(`${base}${path}`, {
        ...options,
        headers: {
          "content-type": "application/json",
          ...(options.headers || {}),
        },
        cache: "no-store",
      });
      if (response.status === 404 && index < API_BASES.length - 1) {
        lastMissingRouteResponse = response;
        continue;
      }
      return response;
    } catch (error) {
      lastNetworkError = error;
    }
  }
  if (lastMissingRouteResponse) return lastMissingRouteResponse;
  const error = new Error("account-api-unreachable");
  error.code = "account-api-unreachable";
  error.cause = lastNetworkError;
  throw error;
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
    const response = await publicAccountFetch("/api/accounts/login", {
      method: "POST",
      body: JSON.stringify({ studentNumber: number, pin: secret }),
    });
    const data = await readResponse(response);
    if (!response.ok || !data?.customToken) {
      const error = new Error(data?.error || "student-login-failed");
      error.status = response.status;
      throw error;
    }
    const credential = await authApi.signInWithCustomToken(authApi.auth, data.customToken);
    const session = await studentSession();
    if (!session?.account || session.account.status !== "ACTIVE") throw new Error("invalid-account");
    return { user: credential.user, account: session.account };
  } catch (error) {
    await authApi.signOut(authApi.auth).catch(() => {});
    const wrapped = new Error(error?.status === 429
      ? "PIN 입력 횟수가 많습니다. 잠시 후 다시 시도해주세요."
      : "학번 또는 PIN을 다시 확인해주세요.");
    wrapped.code = error?.code || error?.message || "student-login-failed";
    wrapped.status = error?.status;
    throw wrapped;
  }
}

export async function changeStudentPin(newPin) {
  const pin = String(newPin || "");
  if (!/^\d{6,12}$/.test(pin) || /^(\d)\1+$/.test(pin)) {
    throw new Error("PIN은 같은 숫자 반복을 제외한 6~12자리 숫자로 설정해주세요.");
  }

  const result = await accountRequest("/api/accounts/change-pin", {
    method: "POST",
    body: { newPin: pin },
    networkRetries: 0,
  });
  if (!result?.customToken) throw new Error("새 로그인 방식을 아직 서버에서 사용할 수 없습니다.");

  const authApi = await api();
  await authApi.signOut(authApi.auth).catch(() => {});
  const credential = await authApi.signInWithCustomToken(authApi.auth, result.customToken);
  const session = await studentSession();
  if (!session?.account || session.account.status !== "ACTIVE") throw new Error("로그인 상태를 갱신하지 못했습니다.");
  return { user: credential.user, account: session.account };
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
