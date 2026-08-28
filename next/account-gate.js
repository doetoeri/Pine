import { saveClassProfile } from "./core/data-gateway.js";
import {
  changeStudentPin,
  currentFirebaseUser,
  isStudentFirebaseUser,
  signInStudent,
  signOutStudent,
  studentSession,
} from "./core/student-auth.js";

await import("../material-official-loader.js");
await globalThis.PINCON_MATERIAL_READY;
await import("../pincon-guest-auth.js");

let resolveReady;
export const accountReady = new Promise((resolve) => { resolveReady = resolve; });
globalThis.PINCON_ACCOUNT_READY = accountReady;

let resolved = false;
let gate = null;

function complete(detail) {
  if (resolved) return;
  resolved = true;
  gate?.remove();
  gate = null;
  globalThis.PINCON_ACCOUNT = detail;
  window.dispatchEvent(new CustomEvent("pincon-account-ready", { detail }));
  resolveReady(detail);
}

function syncClass(account) {
  if (!account) return;
  saveClassProfile(Number(account.grade), Number(account.classNumber));
}

function maskName(value) {
  const name = String(value || "").trim();
  if (!name) return "학생";
  if (name.length === 1) return `${name}○`;
  return `${name[0]}${"○".repeat(Math.min(3, name.length - 1))}`;
}

function ensureGate() {
  if (gate) return gate;
  gate = document.createElement("section");
  gate.className = "pincon-account-gate";
  gate.setAttribute("role", "dialog");
  gate.setAttribute("aria-modal", "true");
  gate.setAttribute("aria-label", "PinCon 로그인");
  document.body.appendChild(gate);
  return gate;
}

function frame(content) {
  return `<div class="pincon-account-gate__frame">
    <header class="pincon-account-gate__brand">
      <div class="pincon-account-gate__mark" aria-hidden="true">P</div>
      <div><h1>PinCon</h1><p class="pincon-account-gate__tagline">우리 반을 더 쉽게.</p></div>
    </header>
    ${content}
  </div>`;
}

function fieldValue(root, selector) {
  return String(root.querySelector(selector)?.value || "").trim();
}

function setBusy(root, busy) {
  root.querySelectorAll("md-filled-button, md-filled-tonal-button, md-outlined-text-field, md-checkbox, md-text-button")
    .forEach((element) => { element.disabled = busy; });
}

async function signInLegacyAdmin(root, errorBox) {
  const auth = globalThis.PINCON_GUEST_AUTH;
  if (!auth?.signInWithGoogleAndSync) throw new Error("관리자 로그인을 준비하지 못했습니다.");
  setBusy(root, true);
  errorBox.textContent = "";
  try {
    await auth.signInWithGoogleAndSync();
  } catch (error) {
    errorBox.textContent = error?.message || "관리자 로그인을 완료하지 못했습니다.";
    setBusy(root, false);
  }
}

function loginScreen(message = "") {
  const root = ensureGate();
  root.innerHTML = frame(`<section class="pincon-account-card" aria-labelledby="pincon-login-title">
    <h2 id="pincon-login-title">로그인</h2>
    <p class="pincon-account-card__support">학번과 직접 설정한 PIN으로 내 시간표와 역할을 확인합니다.</p>
    <form class="pincon-account-form" id="pinconStudentLogin">
      <md-outlined-text-field id="pinconStudentNumber" label="학번" inputmode="numeric" autocomplete="username" maxlength="5" required></md-outlined-text-field>
      <md-outlined-text-field id="pinconStudentPin" label="PIN / 비밀번호" type="password" inputmode="numeric" autocomplete="current-password" minlength="6" maxlength="12" required></md-outlined-text-field>
      <label class="pincon-account-remember"><md-checkbox id="pinconRememberLogin" checked></md-checkbox><span>로그인 유지</span></label>
      <div class="pincon-account-error" id="pinconLoginError" role="alert" aria-live="polite">${message}</div>
      <md-filled-button id="pinconLoginButton" type="submit"><md-icon slot="icon">login</md-icon>로그인</md-filled-button>
    </form>
    <div class="pincon-account-admin-entry"><md-text-button id="pinconAdminLogin"><md-icon slot="icon">admin_panel_settings</md-icon>관리자 Google 로그인</md-text-button></div>
    <p class="pincon-account-security-note"><md-icon>shield_lock</md-icon><span>학번은 계정 식별에만 사용합니다. PIN은 이 기기의 localStorage나 PinCon 데이터베이스에 저장하지 않습니다.</span></p>
  </section>`);

  const form = root.querySelector("#pinconStudentLogin");
  const numberField = root.querySelector("#pinconStudentNumber");
  const pinField = root.querySelector("#pinconStudentPin");
  const errorBox = root.querySelector("#pinconLoginError");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.dataset.busy === "1") return;
    form.dataset.busy = "1";
    setBusy(root, true);
    errorBox.textContent = "";
    try {
      const result = await signInStudent({
        studentNumber: fieldValue(root, "#pinconStudentNumber"),
        pin: fieldValue(root, "#pinconStudentPin"),
        remember: root.querySelector("#pinconRememberLogin")?.checked !== false,
      });
      syncClass(result.account);
      if (result.account.mustChangePin) firstLoginScreen(result);
      else complete({ mode: "student", ...result });
    } catch {
      errorBox.textContent = "학번 또는 PIN을 다시 확인해주세요.";
      pinField.value = "";
      pinField.focus?.();
      form.dataset.busy = "0";
      setBusy(root, false);
    }
  });
  root.querySelector("#pinconAdminLogin")?.addEventListener("click", () => signInLegacyAdmin(root, errorBox));
  requestAnimationFrame(() => numberField?.focus?.());
}

function firstLoginScreen(session) {
  const account = session.account;
  const root = ensureGate();
  root.innerHTML = frame(`<section class="pincon-account-card" aria-labelledby="pincon-start-title">
    <h2 id="pincon-start-title">PinCon 시작하기</h2>
    <p class="pincon-account-card__support">초기 PIN은 이번 로그인까지만 사용하고, 본인만 아는 새 PIN으로 바꿉니다.</p>
    <div class="pincon-account-identity">
      <md-icon>account_circle</md-icon>
      <div><strong>${maskName(account.name)}</strong><span>${account.grade}학년 ${account.classNumber}반 ${account.number}번 · ${account.studentNumber}</span></div>
    </div>
    <form class="pincon-account-form" id="pinconFirstLoginForm">
      <md-outlined-text-field id="pinconNewPin" label="새로운 PIN" type="password" inputmode="numeric" autocomplete="new-password" minlength="6" maxlength="12" supporting-text="6~12자리 숫자, 같은 숫자만 반복한 PIN은 사용할 수 없습니다." required></md-outlined-text-field>
      <md-outlined-text-field id="pinconConfirmPin" label="PIN 확인" type="password" inputmode="numeric" autocomplete="new-password" minlength="6" maxlength="12" required></md-outlined-text-field>
      <div class="pincon-account-error" id="pinconFirstLoginError" role="alert" aria-live="polite"></div>
      <md-filled-button type="submit"><md-icon slot="icon">arrow_forward</md-icon>시작하기</md-filled-button>
    </form>
  </section>`);

  const form = root.querySelector("#pinconFirstLoginForm");
  const errorBox = root.querySelector("#pinconFirstLoginError");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const nextPin = fieldValue(root, "#pinconNewPin");
    const confirm = fieldValue(root, "#pinconConfirmPin");
    if (nextPin !== confirm) {
      errorBox.textContent = "PIN 확인 값이 일치하지 않습니다.";
      return;
    }
    form.dataset.busy = "1";
    setBusy(root, true);
    errorBox.textContent = "";
    try {
      const updated = await changeStudentPin(nextPin);
      if (!updated?.account) throw new Error("pin-change-failed");
      syncClass(updated.account);
      complete({ mode: "student", ...updated });
    } catch (error) {
      errorBox.textContent = error?.message?.startsWith("PIN은")
        ? error.message
        : "새 PIN을 저장하지 못했습니다. 다시 시도해주세요.";
      form.dataset.busy = "0";
      setBusy(root, false);
    }
  });
  requestAnimationFrame(() => root.querySelector("#pinconNewPin")?.focus?.());
}

function localE2eBypassEnabled() {
  const local = ["127.0.0.1", "localhost"].includes(location.hostname);
  return local && new URLSearchParams(location.search).get("auth") !== "1";
}

async function boot() {
  try {
    // 기존 Playwright 회귀 테스트는 로컬 정적 서버에서 실행된다. 실서비스 호스트에서는 절대 우회되지 않는다.
    if (localE2eBypassEnabled()) {
      complete({ mode: "e2e", user: null, account: null });
      return;
    }

    let user = await currentFirebaseUser();
    if (user?.isAnonymous) {
      await signOutStudent();
      user = null;
    }

    if (user && !isStudentFirebaseUser(user)) {
      // 기존 Google 기반 학교 관리자 계정은 마이그레이션 기간 동안 그대로 유지한다.
      complete({ mode: "legacy", user, account: null });
      return;
    }

    if (user) {
      try {
        const session = await studentSession();
        if (session?.account) {
          syncClass(session.account);
          if (session.account.mustChangePin) firstLoginScreen(session);
          else complete({ mode: "student", ...session });
          return;
        }
      } catch {
        await signOutStudent().catch(() => {});
      }
    }
    loginScreen();
  } catch {
    loginScreen("로그인 정보를 확인하지 못했습니다. 다시 로그인해주세요.");
  }
}

boot();
