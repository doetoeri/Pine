const root = document.querySelector("#joinApp");
const FIREBASE = globalThis.PINCON_FIREBASE_CONFIG || {};
const SCHOOL = globalThis.PINCON_SCHOOL_CONFIG || { name: "고촌고등학교" };
const sessionId = new URLSearchParams(location.search).get("session") || "";
const PREVIEW_API = "https://pincon-ai-git-feature-class-enrollment-doeyoungkims-projects.vercel.app";
const configured = String(globalThis.PINCON_ACCOUNT_API_BASE || "").replace(/\/$/, "");
const fallbacks = Array.isArray(globalThis.PINCON_ACCOUNT_API_FALLBACKS) ? globalThis.PINCON_ACCOUNT_API_FALLBACKS : [];
const apiBases = [...new Set([
  ...(location.hostname.includes("feature-class-enrollment") ? [PREVIEW_API] : []),
  configured,
  ...fallbacks.map((x) => String(x || "").replace(/\/$/, "")),
  "https://pincon-ai-git-main-doeyoungkims-projects.vercel.app",
].filter(Boolean))];

let currentStudent = null;
let firebaseApiPromise = null;

function esc(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function clientId() {
  const key = "pincon-enrollment-client-v1";
  try {
    let value = localStorage.getItem(key);
    if (!value) {
      value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      localStorage.setItem(key, value);
    }
    return value;
  } catch {
    return `${navigator.userAgent.slice(0, 40)}-${screen.width}x${screen.height}`;
  }
}
function attemptId(studentNumber) {
  const key = `pincon-enrollment-attempt:${sessionId}:${studentNumber}`;
  try {
    let value = sessionStorage.getItem(key);
    if (!value) {
      value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      sessionStorage.setItem(key, value);
    }
    return value;
  } catch {
    return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  }
}
async function request(body) {
  let lastError = null;
  for (const base of apiBases) {
    try {
      const response = await fetch(`${base}/api/accounts/enrollment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ ...body, clientId: clientId() }),
      });
      let data = {};
      try { data = await response.json(); } catch {}
      if (response.status === 404 && data?.error === "route-not-found") continue;
      if (!response.ok) {
        const error = new Error(data?.error || "request-failed");
        error.status = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      if (error?.status) throw error;
      lastError = error;
    }
  }
  const error = new Error("network-unavailable");
  error.cause = lastError;
  throw error;
}
async function firebaseApi() {
  if (!firebaseApiPromise) {
    firebaseApiPromise = Promise.all([
      import("https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js"),
    ]).then(([appApi, authApi]) => {
      const app = appApi.getApps().length ? appApi.getApp() : appApi.initializeApp(FIREBASE);
      return { ...authApi, auth: authApi.getAuth(app) };
    });
  }
  return firebaseApiPromise;
}
function shell(body) {
  root.innerHTML = `<section class="join-card"><div class="brand"><div class="brand__mark">P</div><div><strong>PinCon</strong><small>${esc(SCHOOL.name || "학교")}</small></div></div>${body}</section>`;
}
function busy(on, message = "") {
  root.querySelectorAll("button,input").forEach((el) => { el.disabled = on; });
  const progress = root.querySelector(".progress");
  if (progress) progress.hidden = !on;
  const status = root.querySelector("#status");
  if (status && message) { status.textContent = message; status.className = "status"; }
}
function errorMessage(error) {
  const code = String(error?.message || "");
  if (code === "student-not-found") return "등록된 학생을 찾을 수 없습니다. 학번을 다시 확인해주세요.";
  if (code === "session-unavailable") return "현재 계정 개통 시간이 아닙니다. 담임 또는 PinCon 관리자에게 문의해주세요.";
  if (code === "already-activated") return "이미 PinCon 계정이 개통된 학생입니다. 기존 학번과 PIN으로 로그인해주세요.";
  if (code === "activation-in-progress") return "이 학번의 계정 개통이 이미 진행 중입니다. 본인이 진행 중이라면 잠시 뒤 다시 시도해주세요.";
  if (code === "too-many-attempts") return "입력 시도가 너무 많습니다. 학번을 확인한 뒤 잠시 후 다시 시도해주세요.";
  if (code === "network-unavailable") return "인터넷 연결이 불안정합니다. 연결을 확인한 뒤 다시 시도해주세요.";
  return "계정 정보를 확인하지 못했습니다. 다시 시도해주세요.";
}
function showError(message) {
  const status = root.querySelector("#status");
  if (status) { status.textContent = message; status.className = "status error"; }
}
function renderClosed(message = "현재 계정 개통 시간이 아닙니다.") {
  shell(`<span class="eyebrow">계정 개통</span><h1>${esc(message)}</h1><p>담임 또는 PinCon 관리자에게 문의해주세요.</p><div class="actions"><button class="btn btn--tonal" id="login">기존 계정으로 로그인</button></div>`);
  root.querySelector("#login")?.addEventListener("click", () => { location.href = "../"; });
}
function renderLookup() {
  shell(`<span class="eyebrow">PinCon 계정 개통</span><h1>학번을 입력하세요</h1><p>등록된 학생 명단에서 내 정보를 확인합니다.</p><form id="lookupForm"><div class="field"><label for="studentNumber">학번</label><input id="studentNumber" inputmode="numeric" autocomplete="off" maxlength="5" placeholder="10804" aria-describedby="status" /></div><div class="progress" hidden></div><div id="status" class="status" role="alert"></div><div class="actions"><button class="btn btn--primary" type="submit">계속</button></div></form>`);
  const form = root.querySelector("#lookupForm");
  const input = root.querySelector("#studentNumber");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const studentNumber = String(input.value || "").trim();
    if (!/^\d{5}$/.test(studentNumber)) return showError("학번 5자리를 입력해주세요.");
    busy(true, "학생 정보를 확인하는 중…");
    try {
      const result = await request({ action: "lookup", sessionId, studentNumber });
      currentStudent = result.student;
      renderConfirm();
    } catch (error) {
      busy(false);
      if (error?.message === "session-unavailable") return renderClosed();
      showError(errorMessage(error));
    }
  });
  requestAnimationFrame(() => input.focus());
}
function renderConfirm() {
  const s = currentStudent;
  shell(`<span class="eyebrow">학생 정보 확인</span><h1>본인이 맞나요?</h1><p>학생 정보는 직접 수정할 수 없습니다.</p><div class="student-box"><strong>${esc(s.name)}</strong><span>${esc(s.grade)}학년 ${esc(s.classNumber)}반 ${esc(s.number)}번 · ${esc(s.studentNumber)}</span></div>${s.activated ? `<div id="status" class="status error">이미 계정이 개통되어 있습니다.</div><div class="actions"><button class="btn btn--tonal" id="login">로그인으로 이동</button></div>` : `<div id="status" class="status"></div><div class="actions"><button class="btn btn--text" id="back">아니에요</button><button class="btn btn--primary" id="yes">맞아요</button></div>`}`);
  root.querySelector("#back")?.addEventListener("click", renderLookup);
  root.querySelector("#yes")?.addEventListener("click", renderPin);
  root.querySelector("#login")?.addEventListener("click", () => { location.href = "../"; });
}
function renderPin() {
  shell(`<span class="eyebrow">마지막 단계</span><h1>사용할 PIN을 정하세요</h1><p>다음부터는 학번과 이 PIN으로 로그인합니다. 다른 사람이 쉽게 맞힐 수 있는 숫자는 피해주세요.</p><form id="pinForm"><div class="field"><label for="pin">PIN</label><input id="pin" type="password" inputmode="numeric" autocomplete="new-password" minlength="6" maxlength="12" placeholder="6~12자리 숫자" /></div><div class="field"><label for="pin2">PIN 한 번 더</label><input id="pin2" type="password" inputmode="numeric" autocomplete="new-password" minlength="6" maxlength="12" /></div><div class="progress" hidden></div><div id="status" class="status" role="alert"></div><div class="actions"><button class="btn btn--text" type="button" id="back">이전</button><button class="btn btn--primary" type="submit">계정 개통</button></div></form>`);
  const form = root.querySelector("#pinForm");
  root.querySelector("#back").addEventListener("click", renderConfirm);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const pin = String(root.querySelector("#pin").value || "");
    const confirm = String(root.querySelector("#pin2").value || "");
    if (!/^\d{6,12}$/.test(pin)) return showError("PIN은 6~12자리 숫자로 입력해주세요.");
    if (/^(\d)\1+$/.test(pin) || ["123456","654321","012345","987654"].includes(pin) || pin === currentStudent.studentNumber || pin.includes(currentStudent.studentNumber)) return showError("너무 쉽게 추측할 수 있는 PIN입니다. 다른 숫자를 사용해주세요.");
    if (pin !== confirm) return showError("두 PIN이 일치하지 않습니다.");
    busy(true, "계정을 안전하게 개통하는 중…");
    try {
      const result = await request({ action: "activate", sessionId, studentNumber: currentStudent.studentNumber, pin, attemptId: attemptId(currentStudent.studentNumber) });
      const api = await firebaseApi();
      await api.setPersistence(api.auth, api.browserLocalPersistence);
      await api.signInWithCustomToken(api.auth, result.customToken);
      renderSuccess();
    } catch (error) {
      busy(false);
      if (error?.message === "session-unavailable") return renderClosed();
      showError(errorMessage(error));
    }
  });
}
function renderSuccess() {
  shell(`<div class="success-icon"><span class="material-symbols-rounded">check</span></div><span class="eyebrow">계정 개통 완료</span><h1>PinCon을 시작할 준비가 됐어요</h1><p>이어서 앱 설치와 알림 설정을 간단히 안내합니다.</p><div class="actions"><button class="btn btn--primary" id="continue">계속</button></div>`);
  root.querySelector("#continue").addEventListener("click", () => { location.href = "../"; });
}
if (!sessionId) renderClosed("가입 링크가 올바르지 않습니다.");
else renderLookup();
