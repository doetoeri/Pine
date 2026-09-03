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
} from "./core/student-auth.js?v=20260903-identity2";

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
  if (!account) return;
  saveClassProfile(Number(account.grade), Number(account.classNumber));
}

function ensureGate() {
  if (gate) return gate;
  gate = document.createElement("section");
  gate.className = "pincon-account-gate";
  gate.setAttribute("role", "dialog");
  gate.setAttribute("aria-modal", "true");
  gate.setAttribute("aria-label", "PinCon 계정");
  document.body.appendChild(gate);
  return gate;
}

function shell(content, { step = "signin", title = "내 PinCon으로 들어가기", support = "학번과 PIN으로 내 시간표, 역할, 학급 정보를 불러옵니다." } = {}) {
  const stepLabel = step === "setup" ? "처음 한 번만" : "학생 계정";
  return `<div class="pincon-account-shell" data-account-step="${step}">
    <aside class="pincon-account-story" aria-label="PinCon 계정 안내">
      <div class="pincon-account-brand"><span class="pincon-account-brand__mark" aria-hidden="true">P</span><div><strong>PinCon</strong><span>${escapeHtml(SCHOOL.name || "학교")}</span></div></div>
      <div class="pincon-account-story__copy">
        <span class="pincon-account-kicker">${stepLabel}</span>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(support)}</p>
      </div>
      <div class="pincon-account-story__trust">
        <div><md-icon>person</md-icon><span>한 계정으로 내 학급 정보</span></div>
        <div><md-icon>verified_user</md-icon><span>역할에 맞는 기능만 표시</span></div>
        <div><md-icon>lock</md-icon><span>활성화 코드는 한 번만 사용</span></div>
      </div>
    </aside>
    <main class="pincon-account-workspace">${content}</main>
  </div>`;
}

function fieldValue(root, selector) {
  return String(root.querySelector(selector)?.value || "").trim();
}

function setBusy(root, busy, label = "") {
  root.dataset.busy = busy ? "true" : "false";
  root.querySelectorAll("md-filled-button, md-filled-tonal-button, md-outlined-text-field, md-checkbox, md-text-button")
    .forEach((element) => { element.disabled = busy; });
  const progress = root.querySelector("#pinconAccountProgress");
  if (progress) progress.hidden = !busy;
  const status = root.querySelector("#pinconAccountBusyText");
  if (status && label) status.textContent = label;
}

function setError(root, message = "") {
  const box = root.querySelector("[data-account-error]");
  if (!box) return;
  box.textContent = message;
  box.hidden = !message;
}

function releaseLoaderWhenGateIsReady() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => globalThis.PinConRevealLoader?.finish?.());
  });
}

async function signInLegacyAdmin(root) {
  const auth = globalThis.PINCON_GUEST_AUTH;
  if (!auth?.signInWithGoogleAndSync) {
    setError(root, "관리자 로그인을 준비하지 못했습니다.");
    return;
  }
  setBusy(root, true, "Google 계정을 확인하는 중");
  setError(root, "");
  try {
    await auth.signInWithGoogleAndSync();
  } catch (error) {
    setError(root, error?.message || "관리자 로그인을 완료하지 못했습니다.");
    setBusy(root, false);
  }
}

function claimScreen() {
  const root = ensureGate();
  root.innerHTML = shell(`<section class="pincon-account-panel" aria-labelledby="pincon-claim-title">
    <div class="pincon-account-panel__heading"><span>첫 로그인</span><h2 id="pincon-claim-title">활성화 코드로 내 계정을 시작해요.</h2><p>관리자가 발급한 1회용 코드와 학번을 확인한 뒤, 앞으로 사용할 PIN은 직접 정합니다.</p></div>
    <form class="pincon-account-form" id="pinconStudentClaim" novalidate>
      <md-outlined-text-field id="pinconClaimStudentNumber" label="학번" inputmode="numeric" autocomplete="username" maxlength="5" supporting-text="예: 10804" required></md-outlined-text-field>
      <md-outlined-text-field id="pinconClaimActivationCode" label="활성화 코드" autocomplete="one-time-code" maxlength="9" supporting-text="예: K7P4-M2Q8" required></md-outlined-text-field>
      <label class="pincon-account-remember"><md-checkbox id="pinconClaimRemember"></md-checkbox><span><strong>이 기기에서 로그인 유지</strong><small>개인 기기에서만 선택하세요.</small></span></label>
      <div class="pincon-account-error" data-account-error role="alert" aria-live="polite" hidden></div>
      <md-linear-progress id="pinconAccountProgress" indeterminate hidden></md-linear-progress>
      <span id="pinconAccountBusyText" class="pincon-account-sr" aria-live="polite"></span>
      <md-filled-button id="pinconClaimButton" type="submit" disabled aria-disabled="true"><md-icon slot="icon">key</md-icon>계정 활성화</md-filled-button>
    </form>
    <div class="pincon-account-help"><button type="button" id="pinconBackToLogin"><md-icon>arrow_back</md-icon><span><strong>이미 PIN을 만들었나요?</strong><small>학번과 PIN으로 로그인하세요.</small></span><md-icon aria-hidden="true">chevron_right</md-icon></button></div>
  </section>`, {
    step: "signin",
    title: "처음 한 번만, 내 계정을 활성화합니다.",
    support: "활성화 코드는 사용 즉시 폐기됩니다. 그 뒤에는 학번과 내가 정한 PIN만 사용합니다.",
  });

  const form = root.querySelector("#pinconStudentClaim");
  const numberField = root.querySelector("#pinconClaimStudentNumber");
  const codeField = root.querySelector("#pinconClaimActivationCode");
  const claimButton = root.querySelector("#pinconClaimButton");

  const syncButton = () => {
    const ready = /^\d{5}$/.test(fieldValue(root, "#pinconClaimStudentNumber"))
      && /^[A-Z0-9]{8}$/.test(normalizeActivationCode(fieldValue(root, "#pinconClaimActivationCode")));
    claimButton.disabled = !ready;
    claimButton.setAttribute("aria-disabled", String(!ready));
  };

  codeField?.addEventListener("input", () => {
    const normalized = normalizeActivationCode(codeField.value);
    if (normalized.length > 4) codeField.value = `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
  });
  form.addEventListener("input", () => { setError(root, ""); syncButton(); });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.dataset.busy === "1") return;
    const studentNumber = fieldValue(root, "#pinconClaimStudentNumber");
    const activationCode = normalizeActivationCode(fieldValue(root, "#pinconClaimActivationCode"));
    if (!/^\d{5}$/.test(studentNumber) || !/^[A-Z0-9]{8}$/.test(activationCode)) {
      setError(root, "학번 5자리와 활성화 코드를 다시 확인해주세요.");
      (!/^\d{5}$/.test(studentNumber) ? numberField : codeField).focus?.();
      return;
    }

    form.dataset.busy = "1";
    setBusy(root, true, "활성화 코드를 확인하는 중");
    setError(root, "");
    try {
      const result = await claimStudentAccount({
        studentNumber,
        activationCode,
        remember: root.querySelector("#pinconClaimRemember")?.checked !== false,
      });
      syncClass(result.account);
      firstLoginScreen(result);
    } catch {
      setError(root, "학번 또는 활성화 코드를 확인하지 못했습니다. 관리자에게 새 코드를 요청해주세요.");
      form.dataset.busy = "0";
      setBusy(root, false);
    }
  });
  root.querySelector("#pinconBackToLogin")?.addEventListener("click", () => loginScreen());
  requestAnimationFrame(() => numberField?.focus?.());
  syncButton();
  releaseLoaderWhenGateIsReady();
}

function loginScreen(message = "") {
  const root = ensureGate();
  root.innerHTML = shell(`<section class="pincon-account-panel" aria-labelledby="pincon-login-title">
    <div class="pincon-account-panel__heading"><span>계정 로그인</span><h2 id="pincon-login-title">내 PinCon으로 들어가기</h2><p>학번 5자리와 직접 설정한 PIN을 입력하세요.</p></div>
    <form class="pincon-account-form" id="pinconStudentLogin" novalidate>
      <md-outlined-text-field id="pinconStudentNumber" label="학번" inputmode="numeric" autocomplete="username" maxlength="5" supporting-text="예: 10804" required></md-outlined-text-field>
      <md-outlined-text-field id="pinconStudentPin" label="PIN" type="password" inputmode="numeric" autocomplete="current-password" minlength="6" maxlength="12" supporting-text="6~12자리 숫자" required></md-outlined-text-field>
      <label class="pincon-account-remember"><md-checkbox id="pinconRememberLogin"></md-checkbox><span><strong>이 기기에서 로그인 유지</strong><small>개인 기기에서만 선택하세요.</small></span></label>
      <div class="pincon-account-error" data-account-error role="alert" aria-live="polite" ${message ? "" : "hidden"}>${escapeHtml(message)}</div>
      <md-linear-progress id="pinconAccountProgress" indeterminate hidden></md-linear-progress>
      <span id="pinconAccountBusyText" class="pincon-account-sr" aria-live="polite"></span>
      <md-filled-button id="pinconLoginButton" type="submit" disabled aria-disabled="true"><md-icon slot="icon">login</md-icon>내 PinCon 열기</md-filled-button>
    </form>
    <div class="pincon-account-help">
      <button type="button" id="pinconFirstClaim"><md-icon>key</md-icon><span><strong>첫 로그인 · 활성화 코드 사용</strong><small>관리자가 발급한 1회용 코드로 계정을 시작하세요.</small></span><md-icon aria-hidden="true">chevron_right</md-icon></button>
      <button type="button" id="pinconForgotPin"><md-icon>help</md-icon><span><strong>PIN을 잊었나요?</strong><small>관리자에게 PIN 초기화를 요청하세요.</small></span><md-icon aria-hidden="true">chevron_right</md-icon></button>
    </div>
    <div class="pincon-account-divider"><span>관리자</span></div>
    <md-filled-tonal-button id="pinconAdminLogin" class="pincon-account-admin"><md-icon slot="icon">admin_panel_settings</md-icon>관리자 Google 계정으로 계속</md-filled-tonal-button>
  </section>`, { step: "signin" });

  const form = root.querySelector("#pinconStudentLogin");
  const numberField = root.querySelector("#pinconStudentNumber");
  const pinField = root.querySelector("#pinconStudentPin");
  const loginButton = root.querySelector("#pinconLoginButton");

  function syncLoginButton() {
    const ready = /^\d{5}$/.test(fieldValue(root, "#pinconStudentNumber"))
      && /^\d{6,12}$/.test(fieldValue(root, "#pinconStudentPin"));
    loginButton.disabled = !ready;
    loginButton.setAttribute("aria-disabled", String(!ready));
  }

  form.addEventListener("input", () => {
    setError(root, "");
    syncLoginButton();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.dataset.busy === "1") return;
    const studentNumber = fieldValue(root, "#pinconStudentNumber");
    const pin = fieldValue(root, "#pinconStudentPin");
    const invalidNumber = !/^\d{5}$/.test(studentNumber);
    const invalidPin = !/^\d{6,12}$/.test(pin);
    if (invalidNumber || invalidPin) {
      setError(root, [
        invalidNumber ? "학번은 5자리 숫자로 입력해주세요." : "",
        invalidPin ? "PIN은 6~12자리 숫자로 입력해주세요." : "",
      ].filter(Boolean).join(" "));
      (invalidNumber ? numberField : pinField).focus?.();
      return;
    }

    form.dataset.busy = "1";
    setBusy(root, true, "내 계정을 확인하는 중");
    setError(root, "");
    try {
      const result = await signInStudent({
        studentNumber,
        pin,
        remember: root.querySelector("#pinconRememberLogin")?.checked !== false,
      });
      syncClass(result.account);
      if (result.account.mustChangePin) firstLoginScreen(result);
      else complete({ mode: "student", ...result });
    } catch {
      setError(root, "학번 또는 PIN이 맞지 않습니다. 다시 확인해주세요.");
      pinField.value = "";
      pinField.focus?.();
      form.dataset.busy = "0";
      setBusy(root, false);
    }
  });

  root.querySelector("#pinconForgotPin")?.addEventListener("click", () => {
    setError(root, "관리자에게 학번을 알려 PIN 초기화를 요청해주세요. 새 활성화 코드로 다시 본인 확인하게 됩니다.");
  });
  root.querySelector("#pinconFirstClaim")?.addEventListener("click", claimScreen);
  root.querySelector("#pinconAdminLogin")?.addEventListener("click", () => signInLegacyAdmin(root));
  requestAnimationFrame(() => numberField?.focus?.());
  syncLoginButton();
  releaseLoaderWhenGateIsReady();
}

function firstLoginScreen(session) {
  const account = session.account;
  const root = ensureGate();
  root.innerHTML = shell(`<section class="pincon-account-panel" aria-labelledby="pincon-start-title">
    <div class="pincon-account-panel__heading"><span>보안 설정</span><h2 id="pincon-start-title">이제 내 PIN을 정하세요.</h2><p>활성화가 끝났습니다. 앞으로 사용할 숫자 PIN을 새로 만듭니다.</p></div>
    <div class="pincon-account-person">
      <span class="pincon-account-person__avatar">${escapeHtml(String(account.name || "학").slice(0, 1))}</span>
      <div><strong>${escapeHtml(account.name || "학생")}</strong><span>${account.grade}학년 ${account.classNumber}반 ${account.number}번</span><small>학번 ${escapeHtml(account.studentNumber)}</small></div>
      <md-icon>verified</md-icon>
    </div>
    <div class="pincon-account-step"><span class="is-done"><md-icon>check</md-icon>계정 활성화</span><i></i><span class="is-current">2. PIN 설정</span></div>
    <form class="pincon-account-form" id="pinconFirstLoginForm" novalidate>
      <md-outlined-text-field id="pinconNewPin" label="새 PIN" type="password" inputmode="numeric" autocomplete="new-password" minlength="6" maxlength="12" supporting-text="6~12자리 숫자 · 한 숫자만 반복할 수 없음" required></md-outlined-text-field>
      <md-outlined-text-field id="pinconConfirmPin" label="새 PIN 다시 입력" type="password" inputmode="numeric" autocomplete="new-password" minlength="6" maxlength="12" required></md-outlined-text-field>
      <div class="pincon-account-error" data-account-error role="alert" aria-live="polite" hidden></div>
      <md-linear-progress id="pinconAccountProgress" indeterminate hidden></md-linear-progress>
      <span id="pinconAccountBusyText" class="pincon-account-sr" aria-live="polite"></span>
      <md-filled-button type="submit"><md-icon slot="icon">arrow_forward</md-icon>설정 완료하고 시작</md-filled-button>
    </form>
    <p class="pincon-account-footnote"><md-icon>lock</md-icon>새 PIN은 Firebase Authentication에서만 처리되며 PinCon 학급 데이터에는 원문으로 저장되지 않습니다.</p>
  </section>`, {
    step: "setup",
    title: "내 계정을 완성하는 마지막 단계.",
    support: "활성화 코드는 이미 폐기되었습니다. 이제 나만 아는 PIN을 만들면 개인화된 PinCon이 열립니다.",
  });

  const form = root.querySelector("#pinconFirstLoginForm");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const nextPin = fieldValue(root, "#pinconNewPin");
    const confirm = fieldValue(root, "#pinconConfirmPin");
    if (!/^\d{6,12}$/.test(nextPin) || /^(\d)\1+$/.test(nextPin)) {
      setError(root, "6~12자리 숫자를 사용하고, 같은 숫자만 반복하지 마세요.");
      return;
    }
    if (nextPin !== confirm) {
      setError(root, "두 PIN이 일치하지 않습니다.");
      return;
    }

    form.dataset.busy = "1";
    setBusy(root, true, "새 PIN을 안전하게 저장하는 중");
    setError(root, "");
    try {
      const updated = await changeStudentPin(nextPin);
      if (!updated?.account) throw new Error("pin-change-failed");
      syncClass(updated.account);
      complete({ mode: "student", ...updated });
    } catch (error) {
      setError(root, error?.message?.startsWith("PIN은") ? error.message : "PIN을 저장하지 못했습니다. 다시 시도해주세요.");
      form.dataset.busy = "0";
      setBusy(root, false);
    }
  });
  requestAnimationFrame(() => root.querySelector("#pinconNewPin")?.focus?.());
  releaseLoaderWhenGateIsReady();
}

function localE2eBypassEnabled() {
  const local = ["127.0.0.1", "localhost"].includes(location.hostname);
  return local && new URLSearchParams(location.search).get("auth") !== "1";
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
    loginScreen("로그인 상태를 확인하지 못했습니다. 다시 로그인해주세요.");
  }
}

boot();
