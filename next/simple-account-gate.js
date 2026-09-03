import { saveClassProfile } from "./core/data-gateway.js";
import {
  changeStudentPin,
  claimStudentAccount,
  currentFirebaseUser,
  isStudentFirebaseUser,
  normalizeActivationCode,
  signInStudent,
  signOutStudent,
  studentSession,
} from "./core/student-auth.js?v=20260903-pinreauth1";

await import("../material-official-loader.js");
await globalThis.PINCON_MATERIAL_READY;
await import("../pincon-guest-auth.js");

const SCHOOL = globalThis.PINCON_SCHOOL_CONFIG || { name: "고촌고등학교" };
let resolveReady;
export const accountReady = new Promise((resolve) => { resolveReady = resolve; });
globalThis.PINCON_ACCOUNT_READY = accountReady;

let resolved = false;
let gate = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

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
  if (account) saveClassProfile(Number(account.grade), Number(account.classNumber));
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

function shell(content, { title = "PinCon 로그인", support = "학번과 PIN만 입력하면 됩니다." } = {}) {
  return `<div class="pincon-account-shell" data-account-step="signin">
    <aside class="pincon-account-story" aria-label="PinCon 계정 안내">
      <div class="pincon-account-brand"><span class="pincon-account-brand__mark" aria-hidden="true">P</span><div><strong>PinCon</strong><span>${escapeHtml(SCHOOL.name || "학교")}</span></div></div>
      <div class="pincon-account-story__copy">
        <span class="pincon-account-kicker">학생 계정</span>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(support)}</p>
      </div>
    </aside>
    <main class="pincon-account-workspace">${content}</main>
  </div>`;
}

function value(root, selector) {
  return String(root.querySelector(selector)?.value || "").trim();
}

function setBusy(root, busy, text = "") {
  root.dataset.busy = busy ? "true" : "false";
  root.querySelectorAll("md-filled-button, md-filled-tonal-button, md-outlined-text-field, md-text-button")
    .forEach((element) => { element.disabled = busy; });
  const progress = root.querySelector("#pinconAccountProgress");
  if (progress) progress.hidden = !busy;
  const status = root.querySelector("#pinconAccountBusyText");
  if (status) status.textContent = text;
}

function setError(root, message = "") {
  const box = root.querySelector("[data-account-error]");
  if (!box) return;
  box.textContent = message;
  box.hidden = !message;
}

function releaseLoader() {
  requestAnimationFrame(() => requestAnimationFrame(() => globalThis.PinConRevealLoader?.finish?.()));
}

async function adminLogin(root) {
  const auth = globalThis.PINCON_GUEST_AUTH;
  if (!auth?.signInWithGoogleAndSync) {
    setError(root, "관리자 로그인을 준비하지 못했습니다.");
    return;
  }
  setBusy(root, true, "관리자 계정을 확인하는 중");
  setError(root, "");
  try {
    await auth.signInWithGoogleAndSync();
    const user = await currentFirebaseUser();
    if (user && !isStudentFirebaseUser(user)) complete({ mode: "legacy", user, account: null });
    else location.reload();
  } catch (error) {
    setError(root, error?.message || "관리자 로그인을 완료하지 못했습니다.");
    setBusy(root, false);
  }
}

function pinSetupScreen(session) {
  const account = session.account;
  const root = ensureGate();
  root.innerHTML = shell(`<section class="pincon-account-panel" aria-labelledby="pincon-simple-setup-title">
    <div class="pincon-account-panel__heading">
      <span>처음 한 번만</span>
      <h2 id="pincon-simple-setup-title">사용할 PIN을 정하세요</h2>
      <p>${escapeHtml(account?.name || "학생")} 계정이 확인됐습니다. 다음부터는 학번과 이 PIN만 입력합니다.</p>
    </div>
    <form class="pincon-account-form" id="pinconSimplePinSetup" novalidate>
      <md-outlined-text-field id="pinconSimpleNewPin" label="새 PIN" type="password" inputmode="numeric" autocomplete="new-password" minlength="6" maxlength="12" supporting-text="6~12자리 숫자" required></md-outlined-text-field>
      <md-outlined-text-field id="pinconSimpleConfirmPin" label="PIN 한 번 더" type="password" inputmode="numeric" autocomplete="new-password" minlength="6" maxlength="12" required></md-outlined-text-field>
      <div class="pincon-account-error" data-account-error role="alert" aria-live="polite" hidden></div>
      <md-linear-progress id="pinconAccountProgress" indeterminate hidden></md-linear-progress>
      <span id="pinconAccountBusyText" class="pincon-account-sr" aria-live="polite"></span>
      <md-filled-button type="submit"><md-icon slot="icon">check</md-icon>완료</md-filled-button>
    </form>
  </section>`, {
    title: "마지막 단계",
    support: "활성화 코드는 여기서 끝입니다. 이후에는 학번과 PIN만 사용합니다.",
  });

  const form = root.querySelector("#pinconSimplePinSetup");
  form.addEventListener("input", () => setError(root, ""));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.dataset.busy === "1") return;
    const pin = value(root, "#pinconSimpleNewPin");
    const confirm = value(root, "#pinconSimpleConfirmPin");
    if (!/^\d{6,12}$/.test(pin) || /^(\d)\1+$/.test(pin)) {
      setError(root, "PIN은 6~12자리 숫자로 입력하고 같은 숫자만 반복하지 마세요.");
      return;
    }
    if (pin !== confirm) {
      setError(root, "두 PIN이 일치하지 않습니다.");
      return;
    }

    form.dataset.busy = "1";
    setBusy(root, true, "PIN을 저장하는 중");
    try {
      const updated = await changeStudentPin(pin);
      if (!updated?.account) throw new Error("pin-change-failed");
      syncClass(updated.account);
      complete({ mode: "student", ...updated });
    } catch (error) {
      setError(root, error?.message || "PIN을 저장하지 못했습니다.");
      form.dataset.busy = "0";
      setBusy(root, false);
    }
  });
  requestAnimationFrame(() => root.querySelector("#pinconSimpleNewPin")?.focus?.());
  releaseLoader();
}

function loginScreen(message = "") {
  const root = ensureGate();
  root.innerHTML = shell(`<section class="pincon-account-panel" aria-labelledby="pincon-simple-login-title">
    <div class="pincon-account-panel__heading">
      <span>로그인</span>
      <h2 id="pincon-simple-login-title">학번으로 바로 들어가기</h2>
      <p>평소에는 PIN을, 처음 로그인할 때만 활성화 코드를 입력하세요.</p>
    </div>
    <form class="pincon-account-form" id="pinconSimpleLogin" novalidate>
      <md-outlined-text-field id="pinconSimpleStudentNumber" label="학번" inputmode="numeric" autocomplete="username" maxlength="5" supporting-text="예: 10804" required></md-outlined-text-field>
      <md-outlined-text-field id="pinconSimpleCredential" label="PIN 또는 활성화 코드" type="password" autocomplete="current-password" maxlength="12" supporting-text="PIN 6~12자리 · 처음이면 XXXX-XXXX" required></md-outlined-text-field>
      <div class="pincon-account-error" data-account-error role="alert" aria-live="polite" ${message ? "" : "hidden"}>${escapeHtml(message)}</div>
      <md-linear-progress id="pinconAccountProgress" indeterminate hidden></md-linear-progress>
      <span id="pinconAccountBusyText" class="pincon-account-sr" aria-live="polite"></span>
      <md-filled-button id="pinconSimpleLoginButton" type="submit"><md-icon slot="icon">login</md-icon>계속</md-filled-button>
    </form>
    <div class="pincon-account-help">
      <button type="button" id="pinconSimpleForgot"><md-icon>help</md-icon><span><strong>PIN을 잊었어요</strong><small>관리자에게 새 활성화 코드를 요청합니다.</small></span><md-icon aria-hidden="true">chevron_right</md-icon></button>
    </div>
    <div class="pincon-account-divider"><span>관리자</span></div>
    <md-filled-tonal-button id="pinconSimpleAdmin" class="pincon-account-admin"><md-icon slot="icon">admin_panel_settings</md-icon>Google로 관리자 로그인</md-filled-tonal-button>
    <p class="pincon-account-footnote"><md-icon>lock</md-icon>개인 기기에서는 로그인 상태가 유지됩니다. 공용 기기에서는 사용 후 로그아웃하세요.</p>
  </section>`);

  const form = root.querySelector("#pinconSimpleLogin");
  const numberField = root.querySelector("#pinconSimpleStudentNumber");
  const credentialField = root.querySelector("#pinconSimpleCredential");

  form.addEventListener("input", () => setError(root, ""));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.dataset.busy === "1") return;

    const studentNumber = value(root, "#pinconSimpleStudentNumber");
    const credential = value(root, "#pinconSimpleCredential");
    const activationCode = normalizeActivationCode(credential);
    const isPin = /^\d{6,12}$/.test(credential);
    const isActivation = /[A-Za-z-]/.test(credential) && /^[A-Z0-9]{8}$/.test(activationCode);

    if (!/^\d{5}$/.test(studentNumber)) {
      setError(root, "학번 5자리를 입력해주세요.");
      numberField.focus?.();
      return;
    }
    if (!isPin && !isActivation) {
      setError(root, "PIN 6~12자리 또는 활성화 코드 XXXX-XXXX를 입력해주세요.");
      credentialField.focus?.();
      return;
    }

    form.dataset.busy = "1";
    setBusy(root, true, isActivation ? "계정을 활성화하는 중" : "로그인하는 중");
    setError(root, "");
    try {
      if (isActivation) {
        const result = await claimStudentAccount({ studentNumber, activationCode, remember: true });
        syncClass(result.account);
        pinSetupScreen(result);
        return;
      }

      const result = await signInStudent({ studentNumber, pin: credential, remember: true });
      syncClass(result.account);
      if (result.account.mustChangePin) pinSetupScreen(result);
      else complete({ mode: "student", ...result });
    } catch {
      setError(root, "학번과 PIN 또는 활성화 코드를 다시 확인해주세요.");
      credentialField.value = "";
      credentialField.focus?.();
      form.dataset.busy = "0";
      setBusy(root, false);
    }
  });

  root.querySelector("#pinconSimpleForgot")?.addEventListener("click", () => {
    setError(root, "관리자에게 학번을 알려 새 활성화 코드를 요청하세요. 받은 코드를 같은 칸에 입력하면 됩니다.");
  });
  root.querySelector("#pinconSimpleAdmin")?.addEventListener("click", () => adminLogin(root));
  requestAnimationFrame(() => numberField?.focus?.());
  releaseLoader();
}

function localE2eBypassEnabled() {
  return ["127.0.0.1", "localhost"].includes(location.hostname)
    && new URLSearchParams(location.search).get("auth") !== "1";
}

async function boot() {
  try {
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
      complete({ mode: "legacy", user, account: null });
      return;
    }
    if (user) {
      try {
        const session = await studentSession();
        if (session?.account) {
          syncClass(session.account);
          if (session.account.mustChangePin) pinSetupScreen(session);
          else complete({ mode: "student", ...session });
          return;
        }
      } catch {
        await signOutStudent().catch(() => {});
      }
    }
    loginScreen();
  } catch {
    loginScreen("로그인 상태를 확인하지 못했습니다. 다시 입력해주세요.");
  }
}

boot();