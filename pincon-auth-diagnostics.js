await globalThis.PINCON_MATERIAL_READY;

import { f as firebaseApi } from "./assets/firebase-IW9tbrMW.js";

const CONFIG = globalThis.PINCON_FIREBASE_CONFIG || {};
const SESSION_KEY = "pincon-auth-diagnostics-v1";
const ATTEMPT_KEY = "pincon-auth-attempt-v1";
const MAX_EVENTS = 40;
let latestAuth = { state: "checking", provider: "", anonymous: false };
let dialog = null;
let renderTimer = 0;

function nowLabel() {
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date());
}

function browserFamily() {
  const ua = navigator.userAgent || "";
  if (/SamsungBrowser/i.test(ua)) return "Samsung Internet";
  if (/Edg\//i.test(ua)) return "Microsoft Edge";
  if (/CriOS|Chrome\//i.test(ua)) return "Chrome";
  if (/FxiOS|Firefox\//i.test(ua)) return "Firefox";
  if (/Safari\//i.test(ua) && !/Chrome|CriOS|Android/i.test(ua)) return "Safari";
  return "기타 브라우저";
}

function isStandalone() {
  return Boolean(window.matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone);
}

function safeEvents() {
  try {
    const value = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "[]");
    return Array.isArray(value) ? value.slice(-MAX_EVENTS) : [];
  } catch {
    return [];
  }
}

function saveEvents(events) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(events.slice(-MAX_EVENTS))); } catch {}
}

function record(step, detail = "", level = "info") {
  const events = safeEvents();
  events.push({ time: nowLabel(), step: String(step).slice(0, 70), detail: String(detail || "").slice(0, 220), level });
  saveEvents(events);
  scheduleRender();
}

function authCodeFrom(value) {
  const text = String(value?.code || value?.message || value || "");
  const match = text.match(/auth\/[a-z0-9-]+/i);
  return match?.[0] || "";
}

function providerOf(user) {
  const ids = Array.isArray(user?.providerData) ? user.providerData.map((item) => item?.providerId).filter(Boolean) : [];
  if (ids.includes("google.com")) return "google.com";
  if (ids.includes("apple.com")) return "apple.com";
  return ids[0] || (user?.isAnonymous ? "anonymous" : "firebase");
}

function setAttempt(source) {
  try { sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify({ source, at: Date.now() })); } catch {}
}

function readAttempt() {
  try { return JSON.parse(sessionStorage.getItem(ATTEMPT_KEY) || "null"); } catch { return null; }
}

function clearAttempt() {
  try { sessionStorage.removeItem(ATTEMPT_KEY); } catch {}
}

function isGoogleLoginButton(event) {
  const path = event.composedPath?.() || [];
  const button = path.find((node) => ["MD-TEXT-BUTTON", "MD-FILLED-BUTTON", "BUTTON"].includes(node?.tagName)) || event.target?.closest?.("md-text-button,md-filled-button,button");
  if (!button || String(button.textContent || "").trim() !== "로그인") return false;
  const section = button.closest?.("section.editor-section, section.content-section");
  return Boolean(section && /Google 로그인|Google 계정으로 로그인/.test(section.textContent || ""));
}

function loginSection() {
  return [...document.querySelectorAll("section.editor-section, section.content-section")]
    .find((section) => /Google 로그인|Google 계정으로 로그인/.test(section.textContent || "")) || null;
}

async function indexedDbCheck() {
  if (!("indexedDB" in window)) return { ok: false, detail: "IndexedDB 미지원" };
  return new Promise((resolve) => {
    const name = "pincon-auth-diagnostic";
    let request;
    try { request = indexedDB.open(name, 1); }
    catch { resolve({ ok: false, detail: "IndexedDB 열기 실패" }); return; }
    request.onupgradeneeded = () => {};
    request.onsuccess = () => {
      request.result.close();
      try { indexedDB.deleteDatabase(name); } catch {}
      resolve({ ok: true, detail: "IndexedDB 사용 가능" });
    };
    request.onerror = () => resolve({ ok: false, detail: "IndexedDB 오류" });
    request.onblocked = () => resolve({ ok: false, detail: "IndexedDB 차단됨" });
  });
}

function localStorageCheck() {
  try {
    const key = "__pincon_auth_test__";
    localStorage.setItem(key, "1");
    localStorage.removeItem(key);
    return true;
  } catch { return false; }
}

async function runDiagnostics() {
  record("진단 시작", `${browserFamily()} · ${isStandalone() ? "설치형 PWA" : "브라우저"}`);
  const protocolOk = location.protocol === "https:" || location.hostname === "localhost";
  record("HTTPS", protocolOk ? "정상" : `비보안 연결: ${location.protocol}`, protocolOk ? "success" : "error");
  record("네트워크", navigator.onLine ? "온라인" : "오프라인", navigator.onLine ? "success" : "error");
  record("쿠키", navigator.cookieEnabled ? "사용 가능" : "차단됨", navigator.cookieEnabled ? "success" : "warn");
  const ls = localStorageCheck();
  record("localStorage", ls ? "사용 가능" : "차단됨", ls ? "success" : "error");
  const idb = await indexedDbCheck();
  record("IndexedDB", idb.detail, idb.ok ? "success" : "error");
  record("Service Worker", navigator.serviceWorker?.controller ? "현재 페이지 제어 중" : "제어 중인 서비스워커 없음", navigator.serviceWorker?.controller ? "success" : "warn");

  const required = ["apiKey", "authDomain", "projectId", "appId"];
  const missing = required.filter((key) => !CONFIG[key]);
  record("Firebase 설정", missing.length ? `누락: ${missing.join(", ")}` : "필수 설정 존재", missing.length ? "error" : "success");

  const authHost = String(CONFIG.authDomain || "").toLowerCase();
  const appHost = location.hostname.toLowerCase();
  record("앱 도메인", appHost || "확인 불가");
  record("Firebase authDomain", authHost || "설정 없음", authHost ? "info" : "error");
  if (authHost && authHost !== appHost && /firebaseapp\.com$/.test(authHost)) {
    record("Redirect 위험", `${appHost}에서 ${authHost}를 인증 도메인으로 사용 중. 현대 브라우저의 서드파티 스토리지 제한 영향 가능`, "warn");
  }
  record("Authorized domains", "클라이언트 코드에서는 목록을 읽을 수 없음. Firebase Console 확인 필요", "warn");
  record("현재 인증 상태", `${latestAuth.state}${latestAuth.provider ? ` · ${latestAuth.provider}` : ""}`, latestAuth.state === "google" ? "success" : "info");
  return safeEvents();
}

function popupTest() {
  record("팝업 테스트", "window.open 호출");
  let popup = null;
  try { popup = window.open("about:blank", "pincon_auth_popup_test", "width=180,height=140"); } catch {}
  if (!popup) {
    record("팝업 결과", "브라우저가 팝업을 차단함", "error");
    return false;
  }
  try { popup.close(); } catch {}
  record("팝업 결과", "팝업 생성 가능", "success");
  return true;
}

async function googleLoginTest() {
  setAttempt("diagnostic");
  record("Google 테스트", "메인 앱과 같은 Firebase 로그인 함수 호출");
  try {
    const result = await firebaseApi.signInManager();
    if (result?.user) {
      record("Google 테스트 결과", "팝업 로그인 성공", "success");
      clearAttempt();
    } else {
      record("Google 테스트 결과", "redirect 로그인 시작 또는 결과 대기", "warn");
    }
  } catch (error) {
    const code = authCodeFrom(error);
    record("Google 테스트 오류", code || String(error?.message || error), "error");
    clearAttempt();
  }
}

function levelIcon(level) {
  return level === "error" ? "error" : level === "warn" ? "warning" : level === "success" ? "check_circle" : "info";
}

function summaryText() {
  if (latestAuth.state === "google") return "Google 인증 정상";
  if (latestAuth.state === "anonymous") return "이름 편집용 익명 세션 사용 중";
  if (latestAuth.state === "signed-out") return "Google 로그인 전";
  return "인증 상태 확인 중";
}

function cardMarkup() {
  const events = safeEvents();
  const lastProblem = [...events].reverse().find((item) => item.level === "error" || item.level === "warn");
  return `<md-divider></md-divider>
    <md-list>
      <md-list-item>
        <md-icon slot="start">troubleshoot</md-icon>
        <span slot="headline">인증 진단</span>
        <span slot="supporting-text">${summaryText()}${lastProblem ? ` · 최근: ${lastProblem.step}` : ""}</span>
        <md-assist-chip slot="end" label="로컬 진단"></md-assist-chip>
      </md-list-item>
    </md-list>
    <div class="section-actions action-grid" data-pincon-auth-actions>
      <md-filled-tonal-button type="button" data-auth-run><md-icon slot="icon">diagnosis</md-icon>진단 실행</md-filled-tonal-button>
      <md-outlined-button type="button" data-auth-popup><md-icon slot="icon">open_in_new</md-icon>팝업 테스트</md-outlined-button>
      <md-outlined-button type="button" data-auth-google><md-icon slot="icon">login</md-icon>Google 로그인 테스트</md-outlined-button>
      <md-text-button type="button" data-auth-view><md-icon slot="icon">receipt_long</md-icon>결과 보기</md-text-button>
    </div>`;
}

function ensureCard() {
  const section = loginSection();
  if (!section) return;
  let host = section.querySelector("[data-pincon-auth-diagnostics]");
  if (!host) {
    host = document.createElement("div");
    host.setAttribute("data-pincon-auth-diagnostics", "");
    section.appendChild(host);
  }
  host.innerHTML = cardMarkup();
  host.querySelector("[data-auth-run]")?.addEventListener("click", async () => { await runDiagnostics(); openDialog(); });
  host.querySelector("[data-auth-popup]")?.addEventListener("click", () => { popupTest(); openDialog(); });
  host.querySelector("[data-auth-google]")?.addEventListener("click", () => googleLoginTest());
  host.querySelector("[data-auth-view]")?.addEventListener("click", () => openDialog());
}

function diagnosticText() {
  const header = [
    "PinCon Auth Diagnostics",
    `time=${new Date().toISOString()}`,
    `browser=${browserFamily()}`,
    `standalone=${isStandalone()}`,
    `origin=${location.origin}`,
    `authDomain=${CONFIG.authDomain || "missing"}`,
    "personalData=not-collected",
    "",
  ];
  const lines = safeEvents().map((item) => `[${item.time}] ${item.level.toUpperCase()} ${item.step}${item.detail ? ` | ${item.detail}` : ""}`);
  return [...header, ...lines].join("\n");
}

function ensureDialog() {
  if (dialog?.isConnected) return dialog;
  dialog = document.createElement("md-dialog");
  dialog.id = "pincon-auth-diagnostics-dialog";
  dialog.setAttribute("aria-label", "PinCon 인증 진단 결과");
  document.body.appendChild(dialog);
  return dialog;
}

function syncDialog() {
  const target = ensureDialog();
  const events = safeEvents();
  target.innerHTML = `<div slot="headline">Google 로그인 진단</div>
    <div slot="content" style="min-width:min(680px,82vw);max-height:62vh;overflow:auto">
      <md-list>${events.length ? events.map((item) => `<md-list-item><md-icon slot="start">${levelIcon(item.level)}</md-icon><span slot="headline">${item.step}</span><span slot="supporting-text">${item.time}${item.detail ? ` · ${item.detail}` : ""}</span></md-list-item>`).join("") : `<md-list-item><md-icon slot="start">info</md-icon><span slot="headline">아직 진단 기록이 없습니다</span><span slot="supporting-text">진단 실행을 눌러 확인합니다.</span></md-list-item>`}</md-list>
      <md-assist-chip label="이름·이메일·UID·토큰은 기록하지 않음"></md-assist-chip>
    </div>
    <div slot="actions">
      <md-text-button type="button" data-auth-clear>기록 지우기</md-text-button>
      <md-text-button type="button" data-auth-copy>결과 복사</md-text-button>
      <md-filled-button type="button" data-auth-close>닫기</md-filled-button>
    </div>`;
  target.querySelector("[data-auth-clear]")?.addEventListener("click", () => { saveEvents([]); syncDialog(); scheduleRender(); });
  target.querySelector("[data-auth-copy]")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(diagnosticText()); record("결과 복사", "클립보드에 복사됨", "success"); }
    catch { record("결과 복사", "클립보드 복사 실패", "error"); }
    syncDialog();
  });
  target.querySelector("[data-auth-close]")?.addEventListener("click", () => { target.open = false; });
}

function openDialog() {
  syncDialog();
  ensureDialog().open = true;
}

function scheduleRender() {
  if (renderTimer) return;
  renderTimer = window.setTimeout(() => {
    renderTimer = 0;
    ensureCard();
    if (dialog?.open) syncDialog();
  }, 80);
}

firebaseApi.observeAuth((user) => {
  if (!user) latestAuth = { state: "signed-out", provider: "", anonymous: false };
  else if (user.isAnonymous) latestAuth = { state: "anonymous", provider: "anonymous", anonymous: true };
  else latestAuth = { state: providerOf(user) === "google.com" ? "google" : "signed-in", provider: providerOf(user), anonymous: false };

  record("Auth 상태", `${latestAuth.state}${latestAuth.provider ? ` · ${latestAuth.provider}` : ""}`, latestAuth.state === "google" ? "success" : "info");
  const attempt = readAttempt();
  if (attempt && latestAuth.state === "google") {
    record("로그인 완료", `이전 ${attempt.source || "unknown"} 시도 후 Google 인증 확인`, "success");
    clearAttempt();
  }
});

document.addEventListener("click", (event) => {
  if (!isGoogleLoginButton(event)) return;
  setAttempt("main-button");
  record("STEP 1 · 로그인 버튼", "클릭 이벤트가 앱까지 전달됨", "success");
  window.setTimeout(() => {
    const attempt = readAttempt();
    if (attempt && latestAuth.state !== "google") record("STEP 2 · 인증 대기", `현재 상태: ${latestAuth.state}`, "warn");
  }, 1800);
}, { capture: true, passive: true });

window.addEventListener("unhandledrejection", (event) => {
  const code = authCodeFrom(event.reason);
  if (code) record("Unhandled Auth 오류", code, "error");
});

window.addEventListener("error", (event) => {
  const code = authCodeFrom(event.error || event.message);
  if (code) record("Window Auth 오류", code, "error");
});

window.addEventListener("online", () => record("네트워크 변경", "온라인", "success"), { passive: true });
window.addEventListener("offline", () => record("네트워크 변경", "오프라인", "error"), { passive: true });
window.addEventListener("pageshow", scheduleRender, { passive: true });

document.addEventListener("click", (event) => {
  const path = event.composedPath?.() || [];
  if (path.some((node) => String(node?.textContent || "").trim() === "더보기")) window.setTimeout(scheduleRender, 120);
}, { passive: true });

window.setInterval(() => {
  if (document.visibilityState === "visible" && document.getElementById("more-title")) scheduleRender();
}, 2500);

const priorAttempt = readAttempt();
if (priorAttempt && Date.now() - Number(priorAttempt.at || 0) < 10 * 60 * 1000) {
  record("로그인 복귀 감지", `${priorAttempt.source || "unknown"} 시도 후 앱으로 돌아옴`);
}

scheduleRender();

globalThis.PINCON_AUTH_DIAGNOSTICS = Object.freeze({
  run: runDiagnostics,
  open: openDialog,
  popupTest,
  googleLoginTest,
  exportText: diagnosticText,
});
