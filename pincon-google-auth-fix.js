await globalThis.PINCON_MATERIAL_READY;

const FIREBASE = globalThis.PINCON_FIREBASE_CONFIG || {};
const SDK = "12.16.0";
let apiPromise = null;
let busy = false;

function isStandalone() {
  return Boolean(window.matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone);
}

function isMobileLike() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "") || Math.min(screen.width || innerWidth, innerWidth) < 820;
}

async function authApi() {
  if (!apiPromise) {
    apiPromise = Promise.all([
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-auth.js`),
    ]).then(([appApi, auth]) => {
      const app = appApi.getApps().length ? appApi.getApp() : appApi.initializeApp(FIREBASE);
      const instance = auth.getAuth(app);
      instance.useDeviceLanguage();
      return { app, auth: instance, ...auth };
    });
  }
  return apiPromise;
}

function loginSection() {
  return [...document.querySelectorAll("section.editor-section, section.content-section")]
    .find((section) => /Google 로그인|Google 계정으로 로그인/.test(section.textContent || "")) || null;
}

function setStatus(message, tone = "info") {
  const section = loginSection();
  if (!section) return;
  let row = section.querySelector("[data-pincon-google-auth-status]");
  if (!message) {
    row?.remove();
    return;
  }
  if (!row) {
    row = document.createElement("md-list");
    row.setAttribute("data-pincon-google-auth-status", "");
    section.appendChild(row);
  }
  const icon = tone === "error" ? "error" : tone === "success" ? "check_circle" : "sync";
  row.innerHTML = `<md-list-item><md-icon slot="start">${icon}</md-icon><span slot="headline">${message}</span></md-list-item>`;
}

function friendlyError(error) {
  switch (error?.code) {
    case "auth/unauthorized-domain": return "현재 도메인이 Firebase 로그인 허용 도메인에 등록되지 않았습니다.";
    case "auth/popup-blocked": return "팝업이 차단되어 리디렉션 로그인으로 전환합니다.";
    case "auth/popup-closed-by-user": return "Google 로그인 창이 닫혔습니다.";
    case "auth/network-request-failed": return "네트워크 연결을 확인한 뒤 다시 로그인해 주세요.";
    case "auth/operation-not-allowed": return "Firebase에서 Google 로그인이 활성화되지 않았습니다.";
    case "auth/cancelled-popup-request": return "이전 로그인 요청을 정리한 뒤 다시 시도해 주세요.";
    default: return error?.message || "Google 로그인에 실패했습니다.";
  }
}

async function prepareAuth() {
  const api = await authApi();
  await api.setPersistence(api.auth, api.browserLocalPersistence);
  await api.auth.authStateReady?.();
  if (api.auth.currentUser?.isAnonymous) {
    await api.signOut(api.auth);
  }
  return api;
}

async function googleLogin() {
  if (busy) return;
  busy = true;
  setStatus("Google 로그인을 준비하고 있습니다.");
  try {
    const api = await prepareAuth();
    const provider = new api.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    // Installed PWAs and mobile browsers are substantially more reliable with redirect auth.
    if (isStandalone() || isMobileLike()) {
      setStatus("Google 로그인 화면으로 이동합니다.");
      await api.signInWithRedirect(api.auth, provider);
      return;
    }

    try {
      const result = await api.signInWithPopup(api.auth, provider);
      if (result?.user) {
        setStatus(`${result.user.displayName || result.user.email || "Google 사용자"} 계정으로 로그인했습니다.`, "success");
        setTimeout(() => location.reload(), 250);
      }
    } catch (error) {
      if (["auth/popup-blocked", "auth/cancelled-popup-request"].includes(error?.code)) {
        setStatus("팝업 대신 Google 로그인 화면으로 이동합니다.");
        await api.signInWithRedirect(api.auth, provider);
        return;
      }
      throw error;
    }
  } catch (error) {
    console.warn("[PinCon Google auth]", error);
    setStatus(friendlyError(error), "error");
  } finally {
    busy = false;
  }
}

function loginButtonFromEvent(event) {
  const path = event.composedPath?.() || [];
  const button = path.find((node) => node?.localName === "md-text-button" || node?.localName === "md-filled-button") || event.target?.closest?.("md-text-button,md-filled-button");
  if (!button || String(button.textContent || "").trim() !== "로그인") return null;
  const section = button.closest?.("section.editor-section, section.content-section");
  return section && /Google 로그인|Google 계정으로 로그인/.test(section.textContent || "") ? button : null;
}

document.addEventListener("click", (event) => {
  if (!loginButtonFromEvent(event)) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  googleLogin();
}, { capture: true });

// Surface redirect errors/success without creating another auth observer.
try {
  const api = await authApi();
  const result = await api.getRedirectResult(api.auth);
  if (result?.user) {
    setStatus(`${result.user.displayName || result.user.email || "Google 사용자"} 계정으로 로그인했습니다.`, "success");
  }
} catch (error) {
  setStatus(friendlyError(error), "error");
}

globalThis.PINCON_GOOGLE_LOGIN = googleLogin;
