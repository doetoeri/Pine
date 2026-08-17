const CONFIG = globalThis.PINCON_FIREBASE_CONFIG || {};
const SDK = "12.16.0";
const DIAG_KEY = "pincon-auth-diagnostics-v1";
let apiPromise = null;
let busy = false;

function nowLabel() {
  try {
    return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date());
  } catch {
    return new Date().toISOString().slice(11, 19);
  }
}

function record(step, detail = "", level = "info") {
  try {
    const items = JSON.parse(sessionStorage.getItem(DIAG_KEY) || "[]");
    const events = Array.isArray(items) ? items : [];
    events.push({ time: nowLabel(), step: String(step).slice(0, 70), detail: String(detail || "").slice(0, 220), level });
    sessionStorage.setItem(DIAG_KEY, JSON.stringify(events.slice(-40)));
  } catch {}
  window.dispatchEvent(new CustomEvent("pincon-auth-bridge-log", { detail: { step, detail, level } }));
}

function loginSection() {
  return [...document.querySelectorAll("section.editor-section, section.content-section")]
    .find((section) => /Google 로그인|Google 계정으로 로그인/.test(section.textContent || "")) || null;
}

function showStatus(message, level = "info") {
  const section = loginSection();
  if (!section) return;
  let status = section.querySelector("[data-pincon-auth-bridge-status]");
  if (!status) {
    status = document.createElement("p");
    status.setAttribute("data-pincon-auth-bridge-status", "");
    status.style.margin = "10px 20px 0";
    status.style.fontSize = "14px";
    status.style.lineHeight = "1.45";
    section.appendChild(status);
  }
  status.textContent = message;
  status.setAttribute("role", level === "error" ? "alert" : "status");
  status.style.color = level === "error" ? "var(--md-sys-color-error, #ba1a1a)" : "var(--md-sys-color-on-surface-variant, #49454f)";
}

function authCode(error) {
  const text = String(error?.code || error?.message || error || "");
  return text.match(/auth\/[a-z0-9-]+/i)?.[0] || "";
}

function friendly(error) {
  const code = authCode(error);
  if (code === "auth/unauthorized-domain") return "pincon.app이 Firebase 로그인 허용 도메인에 등록되지 않았습니다.";
  if (code === "auth/popup-blocked") return "Chrome이 Google 로그인 팝업을 차단했습니다.";
  if (code === "auth/popup-closed-by-user") return "Google 로그인 창이 닫혔습니다.";
  if (code === "auth/network-request-failed") return "Google 로그인 네트워크 요청에 실패했습니다.";
  if (code === "auth/operation-not-allowed") return "Firebase에서 Google 로그인이 활성화되지 않았습니다.";
  return code || String(error?.message || error || "Google 로그인에 실패했습니다.");
}

async function authApi() {
  if (!apiPromise) {
    apiPromise = Promise.all([
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-auth.js`),
    ]).then(([appApi, auth]) => {
      // Auth-only path: deliberately do not import Firestore. The main bundle's
      // persistent Firestore cache can close when an installed PWA is hidden by
      // an OAuth popup, which was surfacing as "Database is closing/hidden".
      const app = appApi.getApps().length ? appApi.getApp() : appApi.initializeApp(CONFIG);
      const instance = auth.getAuth(app);
      instance.useDeviceLanguage();
      return { app, auth: instance, ...auth };
    });
  }
  return apiPromise;
}

async function login() {
  if (busy) return null;
  busy = true;
  record("Auth-only 로그인", "Firestore와 분리된 Firebase Auth 경로 시작");
  showStatus("Google 로그인 창을 여는 중입니다…");
  try {
    const api = await authApi();
    await api.setPersistence(api.auth, api.browserLocalPersistence);
    await api.auth.authStateReady?.();

    const provider = new api.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    record("Auth-only popup", `현재 상태: ${api.auth.currentUser?.isAnonymous ? "anonymous" : api.auth.currentUser ? "signed-in" : "signed-out"}`);

    const result = await api.signInWithPopup(api.auth, provider);
    if (!result?.user) throw new Error("Google 로그인 결과에 사용자가 없습니다.");

    await result.user.getIdToken(true);
    record("Auth-only 로그인 성공", "provider=google.com", "success");
    showStatus("Google 로그인이 완료되었습니다. 앱에 반영하는 중입니다.");
    sessionStorage.setItem("pincon-google-auth-bridge-success", "1");
    setTimeout(() => location.reload(), 300);
    return result.user;
  } catch (error) {
    const message = friendly(error);
    record("Auth-only 로그인 오류", message, "error");
    showStatus(message, "error");
    throw error;
  } finally {
    busy = false;
  }
}

function buttonFromPath(event) {
  const path = event.composedPath?.() || [];
  return path.find((node) => ["BUTTON", "MD-TEXT-BUTTON", "MD-FILLED-BUTTON", "MD-FILLED-TONAL-BUTTON", "MD-OUTLINED-BUTTON"].includes(node?.tagName)) || event.target?.closest?.("button,md-text-button,md-filled-button,md-filled-tonal-button,md-outlined-button");
}

function isMainLogin(button) {
  if (!button || String(button.textContent || "").trim() !== "로그인") return false;
  const section = button.closest?.("section.editor-section, section.content-section");
  return Boolean(section && /Google 로그인|Google 계정으로 로그인/.test(section.textContent || ""));
}

function isDiagnosticGoogle(button) {
  return Boolean(button?.matches?.("[data-auth-google]") || button?.closest?.("[data-auth-google]"));
}

document.addEventListener("click", (event) => {
  const button = buttonFromPath(event);
  if (!isMainLogin(button) && !isDiagnosticGoogle(button)) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  login().catch(() => {});
}, { capture: true });

window.addEventListener("pageshow", () => {
  try {
    if (sessionStorage.getItem("pincon-google-auth-bridge-success") === "1") {
      sessionStorage.removeItem("pincon-google-auth-bridge-success");
      record("Auth-only 복귀", "Google 로그인 후 앱 재로딩 완료", "success");
    }
  } catch {}
});

globalThis.PINCON_GOOGLE_AUTH_BRIDGE = Object.freeze({ login });
