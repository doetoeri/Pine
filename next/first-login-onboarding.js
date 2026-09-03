const ONBOARDING_VERSION = 2;
const STATE_PREFIX = "pincon-first-login-onboarding-v2";
const PUSH_TOKEN_KEY = "pincon-class-ops-push-token-v1";
const APP_VERSION = "next-20260903-onboarding1";
const SCHOOL = globalThis.PINCON_SCHOOL_CONFIG || { id: "gochon-high", name: "고촌고등학교" };
const FIREBASE = globalThis.PINCON_FIREBASE_CONFIG || {};
const NOTIFICATION_DEFAULTS = Object.freeze({
  assessmentTomorrow: true,
  assessmentToday: true,
  importantPreparation: true,
  timetableChange: true,
  eventStart: true,
  pollClosing: true,
  urgentAnnouncement: true,
});

let deferredInstallPrompt = null;
let activeOverlay = null;
let installPromptWaiters = [];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isStandalone() {
  return Boolean(
    globalThis.matchMedia?.("(display-mode: standalone)")?.matches
    || globalThis.matchMedia?.("(display-mode: fullscreen)")?.matches
    || globalThis.navigator?.standalone === true
  );
}

function isIOSLike() {
  const ua = String(globalThis.navigator?.userAgent || "");
  return /iPad|iPhone|iPod/i.test(ua)
    || (/Macintosh/i.test(ua) && Number(globalThis.navigator?.maxTouchPoints || 0) > 1);
}

function accountIdentity(detail) {
  return String(detail?.account?.studentNumber || detail?.user?.uid || "student");
}

function stateKey(detail) {
  return `${STATE_PREFIX}:${accountIdentity(detail)}`;
}

function readState(detail) {
  try {
    return { version: ONBOARDING_VERSION, ...JSON.parse(localStorage.getItem(stateKey(detail)) || "{}") };
  } catch {
    return { version: ONBOARDING_VERSION };
  }
}

function writeState(detail, patch) {
  const next = { ...readState(detail), ...patch, version: ONBOARDING_VERSION, updatedAtMs: Date.now() };
  try { localStorage.setItem(stateKey(detail), JSON.stringify(next)); } catch {}
  return next;
}

function classKey(detail) {
  const grade = Number(detail?.account?.grade || 0);
  const classNumber = Number(detail?.account?.classNumber || 0);
  if (grade < 1 || grade > 3 || classNumber < 1 || classNumber > 10) return "";
  return `${grade}-${classNumber}`;
}

function resolveInstallWaiters(event) {
  const waiters = installPromptWaiters;
  installPromptWaiters = [];
  waiters.forEach((resolve) => resolve(event));
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  resolveInstallWaiters(event);
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  resolveInstallWaiters(null);
  activeOverlay?.querySelector("[data-onboarding-status]")?.replaceChildren(document.createTextNode("PinCon 앱 설치가 완료됐어요."));
});

function waitForInstallPrompt(timeoutMs = 2400) {
  if (deferredInstallPrompt) return Promise.resolve(deferredInstallPrompt);
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    installPromptWaiters.push(done);
  });
}

async function ensureServiceWorker() {
  if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return null;
  const scope = new URL("../", location.href).href;
  let registration = await navigator.serviceWorker.getRegistration(scope).catch(() => null);
  if (!registration) {
    registration = await navigator.serviceWorker.register("../sw.js?v=20260903-onboarding1", {
      scope: "../",
      updateViaCache: "none",
    });
  }
  registration.update().catch(() => {});
  if (!registration.active) {
    await navigator.serviceWorker.ready.catch(() => null);
    registration = await navigator.serviceWorker.getRegistration(scope).catch(() => registration);
  }
  return registration;
}

async function registerPushSubscription(detail) {
  if (globalThis.Notification?.permission !== "granted") return { ok: false, reason: "permission" };
  const key = classKey(detail);
  if (!key) return { ok: false, reason: "class" };
  if (!FIREBASE.apiKey || !FIREBASE.vapidKey) return { ok: false, reason: "config" };

  const registration = await ensureServiceWorker();
  if (!registration) return { ok: false, reason: "service-worker" };

  const SDK = "12.16.0";
  const [appApi, authApi, firestoreApi, messagingApi] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-firestore.js`),
    import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-messaging.js`),
  ]);

  const app = appApi.getApps().length ? appApi.getApp() : appApi.initializeApp(FIREBASE);
  const auth = authApi.getAuth(app);
  await auth.authStateReady?.();
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return { ok: false, reason: "auth" };

  const messaging = messagingApi.getMessaging(app);
  const token = await messagingApi.getToken(messaging, {
    vapidKey: FIREBASE.vapidKey,
    serviceWorkerRegistration: registration,
  });
  if (!token) return { ok: false, reason: "token" };

  const db = firestoreApi.getFirestore(app);
  const subscriptionRef = firestoreApi.doc(db, "schools", SCHOOL.id || "gochon-high", "pushSubscriptions", token);
  const nowMs = Date.now();
  await firestoreApi.setDoc(subscriptionRef, {
    token,
    classKey: key,
    enabled: true,
    ownerUid: user.uid,
    preferences: NOTIFICATION_DEFAULTS,
    appVersion: APP_VERSION,
    createdAt: firestoreApi.serverTimestamp(),
    updatedAt: firestoreApi.serverTimestamp(),
    updatedAtMs: nowMs,
  }, { merge: true });
  try { localStorage.setItem(PUSH_TOKEN_KEY, token); } catch {}
  return { ok: true, token };
}

async function quietlyRepairPush(detail) {
  if (globalThis.Notification?.permission !== "granted") return;
  try { await registerPushSubscription(detail); } catch {}
}

function installCopy() {
  if (isStandalone()) {
    return {
      title: "PinCon 앱이 설치되어 있어요",
      body: "브라우저 탭 대신 앱처럼 바로 열 수 있는 상태입니다.",
      icon: "check_circle",
    };
  }
  if (isIOSLike()) {
    return {
      title: "PinCon을 홈 화면에 추가하세요",
      body: "Safari의 공유 버튼을 누른 뒤 ‘홈 화면에 추가’를 선택하면 됩니다. 알림은 홈 화면 앱에서 가장 안정적으로 동작합니다.",
      icon: "ios_share",
    };
  }
  return {
    title: "PinCon을 앱으로 설치하세요",
    body: "홈 화면이나 작업표시줄에서 바로 열리고, 학교 알림도 더 안정적으로 받을 수 있습니다.",
    icon: "install_mobile",
  };
}

function renderShell(detail) {
  const account = detail.account || {};
  const overlay = document.createElement("section");
  overlay.className = "pincon-first-onboarding";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "pincon-onboarding-title");
  overlay.innerHTML = `
    <div class="pincon-first-onboarding__scrim" aria-hidden="true"></div>
    <div class="pincon-first-onboarding__card">
      <div class="pincon-first-onboarding__brand"><span>P</span><div><strong>PinCon</strong><small>${escapeHtml(SCHOOL.name || "학교")}</small></div></div>
      <div class="pincon-first-onboarding__progress" aria-label="처음 설정 진행 상황">
        <span data-step-dot="install">1</span><i></i><span data-step-dot="notify">2</span>
      </div>
      <div class="pincon-first-onboarding__body" data-onboarding-body></div>
      <div class="pincon-first-onboarding__status" data-onboarding-status role="status" aria-live="polite"></div>
      <div class="pincon-first-onboarding__identity">${escapeHtml(account.name || "학생")} · ${escapeHtml(account.grade || "")}학년 ${escapeHtml(account.classNumber || "")}반</div>
    </div>`;
  document.body.appendChild(overlay);
  activeOverlay = overlay;
  return overlay;
}

function setStep(overlay, step) {
  overlay.dataset.step = step;
  overlay.querySelectorAll("[data-step-dot]").forEach((dot) => {
    const target = dot.getAttribute("data-step-dot");
    dot.classList.toggle("is-current", target === step);
    dot.classList.toggle("is-done", step === "notify" && target === "install");
  });
  const status = overlay.querySelector("[data-onboarding-status]");
  if (status) status.textContent = "";
}

function closeOverlay() {
  const overlay = activeOverlay;
  activeOverlay = null;
  if (!overlay) return;
  overlay.classList.add("is-closing");
  setTimeout(() => overlay.remove(), 180);
}

function finishOnboarding(detail, patch = {}) {
  writeState(detail, { completedAtMs: Date.now(), deferUntilMs: 0, ...patch });
  closeOverlay();
}

function deferOnboarding(detail, days, patch = {}) {
  writeState(detail, { deferUntilMs: Date.now() + days * 86_400_000, ...patch });
  closeOverlay();
}

async function showNotificationStep(detail, overlay) {
  setStep(overlay, "notify");
  const body = overlay.querySelector("[data-onboarding-body]");
  const permission = globalThis.Notification?.permission || "unsupported";

  if (permission === "granted") {
    body.innerHTML = `
      <div class="pincon-first-onboarding__hero-icon"><span class="material-symbols-rounded">notifications_active</span></div>
      <p class="pincon-first-onboarding__eyebrow">2 · 알림 설정</p>
      <h2 id="pincon-onboarding-title">알림이 이미 켜져 있어요</h2>
      <p>수행평가, 중요한 준비물, 시간표 변경, 행사와 긴급 공지를 놓치지 않도록 이 기기를 연결합니다.</p>
      <div class="pincon-first-onboarding__actions"><button class="is-primary" data-enable-notifications>연결 확인하고 시작</button></div>`;
    body.querySelector("[data-enable-notifications]").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      overlay.querySelector("[data-onboarding-status]").textContent = "알림 기기를 연결하는 중…";
      try {
        const result = await registerPushSubscription(detail);
        if (!result.ok) throw new Error(result.reason);
        finishOnboarding(detail, { notification: "granted" });
      } catch {
        overlay.querySelector("[data-onboarding-status]").textContent = "알림 권한은 켜져 있지만 기기 연결을 완료하지 못했습니다. PinCon은 계속 사용할 수 있어요.";
        button.disabled = false;
        button.textContent = "다시 연결";
      }
    });
    return;
  }

  if (permission === "denied") {
    body.innerHTML = `
      <div class="pincon-first-onboarding__hero-icon"><span class="material-symbols-rounded">notifications_off</span></div>
      <p class="pincon-first-onboarding__eyebrow">2 · 알림 설정</p>
      <h2 id="pincon-onboarding-title">브라우저에서 알림이 차단되어 있어요</h2>
      <p>주소창의 사이트 설정에서 PinCon 알림을 ‘허용’으로 바꾸면 수행평가와 긴급 공지를 받을 수 있습니다.</p>
      <div class="pincon-first-onboarding__actions"><button class="is-primary" data-notification-done>확인했어요</button></div>`;
    body.querySelector("[data-notification-done]").addEventListener("click", () => finishOnboarding(detail, { notification: "denied" }));
    return;
  }

  if (!("Notification" in window)) {
    const iosNeedsApp = isIOSLike() && !isStandalone();
    body.innerHTML = `
      <div class="pincon-first-onboarding__hero-icon"><span class="material-symbols-rounded">notifications</span></div>
      <p class="pincon-first-onboarding__eyebrow">2 · 알림 설정</p>
      <h2 id="pincon-onboarding-title">${iosNeedsApp ? "홈 화면의 PinCon 앱에서 알림을 켜세요" : "이 브라우저는 웹 알림을 지원하지 않아요"}</h2>
      <p>${iosNeedsApp ? "홈 화면에 추가한 PinCon을 한 번 열면 알림 허용 단계가 다시 나타납니다." : "PinCon 내부 알림은 계속 확인할 수 있지만 기기 푸시 알림은 사용할 수 없습니다."}</p>
      <div class="pincon-first-onboarding__actions"><button class="is-primary" data-notification-later>${iosNeedsApp ? "앱에서 이어서 설정" : "PinCon 시작"}</button></div>`;
    body.querySelector("[data-notification-later]").addEventListener("click", () => {
      if (iosNeedsApp) deferOnboarding(detail, 0.01, { notification: "pending-app" });
      else finishOnboarding(detail, { notification: "unsupported" });
    });
    return;
  }

  body.innerHTML = `
    <div class="pincon-first-onboarding__hero-icon"><span class="material-symbols-rounded">notifications_active</span></div>
    <p class="pincon-first-onboarding__eyebrow">2 · 알림 설정</p>
    <h2 id="pincon-onboarding-title">중요한 학교 정보를 바로 받아보세요</h2>
    <p>수행평가와 시험, 중요한 준비물, 시간표 변경, 행사 시작, 투표 마감과 긴급 공지만 골라서 알려드립니다.</p>
    <ul class="pincon-first-onboarding__benefits">
      <li><span class="material-symbols-rounded">assignment</span>수행평가 · 시험 전날과 당일</li>
      <li><span class="material-symbols-rounded">schedule</span>시간표 변경 · 행사 시작</li>
      <li><span class="material-symbols-rounded">campaign</span>긴급 공지</li>
    </ul>
    <div class="pincon-first-onboarding__actions">
      <button class="is-primary" data-enable-notifications>알림 켜기</button>
      <button class="is-secondary" data-notification-later>나중에</button>
    </div>`;

  body.querySelector("[data-enable-notifications]").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    overlay.querySelector("[data-onboarding-status]").textContent = "브라우저 알림 허용 창을 확인해주세요.";
    try {
      const permissionResult = await Notification.requestPermission();
      if (permissionResult !== "granted") {
        if (permissionResult === "denied") {
          finishOnboarding(detail, { notification: "denied" });
          return;
        }
        overlay.querySelector("[data-onboarding-status]").textContent = "알림을 아직 켜지 않았어요. 나중에 다시 설정할 수 있습니다.";
        button.disabled = false;
        return;
      }
      overlay.querySelector("[data-onboarding-status]").textContent = "이 기기를 PinCon 알림에 연결하는 중…";
      const result = await registerPushSubscription(detail);
      if (!result.ok) throw new Error(result.reason);
      finishOnboarding(detail, { notification: "granted" });
    } catch {
      overlay.querySelector("[data-onboarding-status]").textContent = "알림 권한은 허용됐지만 기기 연결에 실패했습니다. 다시 시도해주세요.";
      button.disabled = false;
      button.textContent = "다시 연결";
    }
  });
  body.querySelector("[data-notification-later]").addEventListener("click", () => deferOnboarding(detail, 7, { notification: "later" }));
}

async function showInstallStep(detail, overlay) {
  setStep(overlay, "install");
  if (isStandalone()) {
    writeState(detail, { install: "installed" });
    await showNotificationStep(detail, overlay);
    return;
  }

  const copy = installCopy();
  const body = overlay.querySelector("[data-onboarding-body]");
  const ios = isIOSLike();
  body.innerHTML = `
    <div class="pincon-first-onboarding__hero-icon"><span class="material-symbols-rounded">${copy.icon}</span></div>
    <p class="pincon-first-onboarding__eyebrow">1 · 앱 설치</p>
    <h2 id="pincon-onboarding-title">${escapeHtml(copy.title)}</h2>
    <p>${escapeHtml(copy.body)}</p>
    ${ios ? `<div class="pincon-first-onboarding__ios-guide"><span><b>1</b> Safari 아래/위의 <strong>공유</strong> 버튼</span><span><b>2</b> <strong>홈 화면에 추가</strong></span><span><b>3</b> 추가된 <strong>PinCon</strong> 열기</span></div>` : ""}
    <div class="pincon-first-onboarding__actions">
      <button class="is-primary" data-install>${ios ? "홈 화면에 추가할게요" : "PinCon 앱 설치"}</button>
      <button class="is-secondary" data-install-later>지금은 웹으로 사용</button>
    </div>`;

  body.querySelector("[data-install]").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const status = overlay.querySelector("[data-onboarding-status]");
    if (ios) {
      writeState(detail, { install: "manual-guided" });
      status.textContent = "홈 화면에 추가한 뒤 PinCon 앱을 열어주세요. 알림 설정은 그 앱에서 이어집니다.";
      button.textContent = "추가했어요 · 다음";
      button.onclick = null;
      button.addEventListener("click", () => showNotificationStep(detail, overlay), { once: true });
      return;
    }

    button.disabled = true;
    status.textContent = "앱 설치 창을 준비하는 중…";
    try {
      const prompt = deferredInstallPrompt || await waitForInstallPrompt();
      if (!prompt) {
        status.textContent = "설치 버튼을 바로 열 수 없어요. 브라우저 메뉴의 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 선택해주세요.";
        button.disabled = false;
        button.textContent = "설치 옵션 다시 확인";
        return;
      }
      await prompt.prompt();
      const choice = await prompt.userChoice;
      deferredInstallPrompt = null;
      if (choice?.outcome === "accepted") {
        writeState(detail, { install: "accepted" });
        status.textContent = "설치 요청을 완료했어요.";
        await showNotificationStep(detail, overlay);
      } else {
        writeState(detail, { install: "dismissed" });
        status.textContent = "설치를 취소했어요. PinCon은 앱으로 설치하면 더 빠르게 열 수 있습니다.";
        button.disabled = false;
        button.textContent = "다시 설치";
      }
    } catch {
      status.textContent = "설치 창을 열지 못했습니다. 브라우저 메뉴에서 PinCon 설치를 선택해주세요.";
      button.disabled = false;
    }
  });

  body.querySelector("[data-install-later]").addEventListener("click", async () => {
    writeState(detail, { install: "later" });
    await showNotificationStep(detail, overlay);
  });
}

async function waitForAppReady(timeoutMs = 3600) {
  const start = performance.now();
  while (!globalThis.PinConNext && performance.now() - start < timeoutMs) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

async function beginForAccount(detail) {
  if (!detail || detail.mode !== "student" || !detail.account) return;
  quietlyRepairPush(detail);
  const state = readState(detail);
  const notificationPermission = globalThis.Notification?.permission || "unsupported";
  const installReady = isStandalone() || state.install === "accepted" || state.install === "installed";
  const notificationSettled = notificationPermission === "granted" || notificationPermission === "denied" || notificationPermission === "unsupported";

  if (state.completedAtMs && installReady && notificationSettled) return;
  if (Number(state.deferUntilMs || 0) > Date.now()) return;

  await waitForAppReady();
  if (activeOverlay) return;
  const overlay = renderShell(detail);
  await showInstallStep(detail, overlay);
}

window.addEventListener("pincon-account-ready", (event) => {
  beginForAccount(event.detail).catch((error) => console.warn("[PinCon onboarding]", error));
});

if (globalThis.PINCON_ACCOUNT) {
  beginForAccount(globalThis.PINCON_ACCOUNT).catch((error) => console.warn("[PinCon onboarding]", error));
}

export { beginForAccount, ensureServiceWorker, registerPushSubscription };
