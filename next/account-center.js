import { changeStudentPin, signOutStudent } from "./core/student-auth.js";

const context = globalThis.PINCON_ACCOUNT;
if (context?.mode === "student" && context.account) {
  const ROLE_LABELS = Object.freeze({
    STUDENT: "학생",
    DEPARTMENT_HEAD: "학급자치회 부장",
    SUBJECT_MANAGER: "과목 관리자",
    CLASS_PRESIDENT: "학급 회장",
    TEACHER: "교사",
    ADMIN: "관리자",
  });

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function roleMarkup(account) {
    const roles = Array.isArray(account.roles) ? account.roles : ["STUDENT"];
    return roles.map((role) => `<span class="pincon-account-center__role"><md-icon>${role === "ADMIN" ? "admin_panel_settings" : role === "TEACHER" ? "school" : role === "CLASS_PRESIDENT" ? "campaign" : role === "SUBJECT_MANAGER" ? "menu_book" : role === "DEPARTMENT_HEAD" ? "groups" : "person"}</md-icon>${escapeHtml(ROLE_LABELS[role] || role)}</span>`).join("");
  }

  function createDialog() {
    document.querySelector("#pinconAccountCenter")?.remove();
    const account = context.account;
    const dialog = document.createElement("md-dialog");
    dialog.id = "pinconAccountCenter";
    dialog.className = "pincon-account-center";
    dialog.innerHTML = `<div slot="headline" class="pincon-account-center__headline"><span>내 계정</span><strong>${escapeHtml(account.name || "학생")}</strong></div>
      <div slot="content" class="pincon-account-center__content">
        <section class="pincon-account-center__hero">
          <span class="pincon-account-center__avatar">${escapeHtml(String(account.name || "학").slice(0, 1))}</span>
          <div><strong>${escapeHtml(account.name || "학생")}</strong><span>${account.grade}학년 ${account.classNumber}반 ${account.number}번</span><small>학번 ${escapeHtml(account.studentNumber)}</small></div>
          <span class="pincon-account-center__state"><md-icon>verified</md-icon>활성</span>
        </section>

        <section class="pincon-account-center__section">
          <div class="pincon-account-center__section-head"><div><span>권한</span><h3>내 역할</h3></div><md-icon>badge</md-icon></div>
          <div class="pincon-account-center__roles">${roleMarkup(account)}</div>
          <p>표시되는 기능은 이 역할을 기준으로 자동 결정됩니다. 역할 변경은 학교 관리자에게 요청해야 합니다.</p>
        </section>

        <section class="pincon-account-center__section pincon-account-center__security">
          <div class="pincon-account-center__section-head"><div><span>보안</span><h3>PIN 변경</h3></div><md-icon>shield_lock</md-icon></div>
          <form id="pinconAccountCenterPinForm" class="pincon-account-center__form" novalidate>
            <md-outlined-text-field id="pinconAccountCenterPin" label="새 PIN" type="password" inputmode="numeric" autocomplete="new-password" minlength="6" maxlength="12" supporting-text="6~12자리 숫자 · 같은 숫자 반복 제외"></md-outlined-text-field>
            <md-outlined-text-field id="pinconAccountCenterPinConfirm" label="새 PIN 다시 입력" type="password" inputmode="numeric" autocomplete="new-password" minlength="6" maxlength="12"></md-outlined-text-field>
            <div id="pinconAccountCenterStatus" class="pincon-account-center__status" role="status" aria-live="polite"></div>
            <md-filled-tonal-button type="submit"><md-icon slot="icon">password</md-icon>PIN 변경</md-filled-tonal-button>
          </form>
        </section>

        <section class="pincon-account-center__section pincon-account-center__session">
          <div><md-icon>devices</md-icon><div><strong>현재 기기</strong><span>이 기기에서 PinCon 계정으로 로그인되어 있습니다.</span></div></div>
          <md-outlined-button id="pinconAccountCenterLogout"><md-icon slot="icon">logout</md-icon>로그아웃</md-outlined-button>
        </section>
      </div>
      <div slot="actions"><md-text-button id="pinconAccountCenterClose">닫기</md-text-button></div>`;
    document.body.appendChild(dialog);

    const form = dialog.querySelector("#pinconAccountCenterPinForm");
    const status = dialog.querySelector("#pinconAccountCenterStatus");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const pin = String(dialog.querySelector("#pinconAccountCenterPin")?.value || "");
      const confirm = String(dialog.querySelector("#pinconAccountCenterPinConfirm")?.value || "");
      status.dataset.error = "false";
      if (!/^\d{6,12}$/.test(pin) || /^(\d)\1+$/.test(pin)) {
        status.textContent = "6~12자리 숫자를 사용하고 같은 숫자만 반복하지 마세요.";
        status.dataset.error = "true";
        return;
      }
      if (pin !== confirm) {
        status.textContent = "두 PIN이 일치하지 않습니다.";
        status.dataset.error = "true";
        return;
      }
      form.querySelectorAll("md-outlined-text-field, md-filled-tonal-button").forEach((element) => { element.disabled = true; });
      status.textContent = "PIN을 변경하는 중…";
      try {
        await changeStudentPin(pin);
        status.textContent = "PIN을 변경했습니다.";
        dialog.querySelector("#pinconAccountCenterPin").value = "";
        dialog.querySelector("#pinconAccountCenterPinConfirm").value = "";
      } catch (error) {
        status.textContent = error?.message || "PIN을 변경하지 못했습니다.";
        status.dataset.error = "true";
      } finally {
        form.querySelectorAll("md-outlined-text-field, md-filled-tonal-button").forEach((element) => { element.disabled = false; });
      }
    });

    dialog.querySelector("#pinconAccountCenterLogout")?.addEventListener("click", async () => {
      dialog.querySelector("#pinconAccountCenterLogout").disabled = true;
      await signOutStudent().catch(() => {});
      location.reload();
    });
    dialog.querySelector("#pinconAccountCenterClose")?.addEventListener("click", () => dialog.close?.());
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    dialog.show?.();
  }

  document.addEventListener("click", (event) => {
    const trigger = event.composedPath?.().find((node) => node instanceof HTMLElement && node.getAttribute?.("data-personal-action") === "profile");
    if (!trigger) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    createDialog();
  }, true);

  globalThis.PinConAccountCenter = Object.freeze({ open: createDialog });
}
