await globalThis.PINCON_MATERIAL_READY;

const FIREBASE = globalThis.PINCON_FIREBASE_CONFIG || {};
const SDK = "12.16.0";
const NAME_KEY = "pincon-guest-name-v1";
let authApiPromise = null;
let nameDialog = null;

async function authApi() {
  if (!authApiPromise) {
    authApiPromise = Promise.all([
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-auth.js`),
    ]).then(([appApi, authApi]) => {
      const app = appApi.getApps().length ? appApi.getApp() : appApi.initializeApp(FIREBASE);
      const auth = authApi.getAuth(app);
      return { app, auth, ...authApi };
    });
  }
  return authApiPromise;
}

function savedName() {
  return String(localStorage.getItem(NAME_KEY) || "").trim();
}

function validName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 20) return "";
  if (/[<>\n\r]/.test(name)) return "";
  return name;
}

function ensureNameDialog() {
  if (nameDialog) return nameDialog;
  nameDialog = document.createElement("md-dialog");
  nameDialog.id = "pincon-guest-name-dialog";
  nameDialog.innerHTML = `
    <div slot="headline">로그인 없이 편집</div>
    <div slot="content" class="pincon-material-fields">
      <p class="md-typescale-body-medium" style="margin:0;color:var(--md-sys-color-on-surface-variant)">변경 기록에 표시할 이름을 입력하세요. 계정 로그인은 필요하지 않습니다.</p>
      <md-outlined-text-field data-guest-name label="이름" maxlength="20" required></md-outlined-text-field>
      <div data-guest-error class="pincon-material-empty" hidden></div>
    </div>
    <div slot="actions">
      <md-text-button data-guest-cancel>취소</md-text-button>
      <md-filled-button data-guest-continue>이름으로 편집</md-filled-button>
    </div>`;
  document.body.appendChild(nameDialog);
  nameDialog.querySelector("[data-guest-cancel]").addEventListener("click", () => nameDialog.close());
  return nameDialog;
}

async function askName() {
  const dialog = ensureNameDialog();
  const field = dialog.querySelector("[data-guest-name]");
  const error = dialog.querySelector("[data-guest-error]");
  field.value = savedName();
  error.hidden = true;
  await dialog.show();
  setTimeout(() => field.focus?.(), 120);
  return new Promise((resolve) => {
    const done = (value) => {
      dialog.removeEventListener("closed", closed);
      resolve(value);
    };
    const closed = () => done("");
    dialog.addEventListener("closed", closed, { once: true });
    dialog.querySelector("[data-guest-continue]").onclick = async () => {
      const name = validName(field.value);
      if (!name) {
        error.textContent = "이름은 2~20자로 입력해 주세요.";
        error.hidden = false;
        return;
      }
      dialog.removeEventListener("closed", closed);
      await dialog.close();
      done(name);
    };
  });
}

async function ensureNamedUser() {
  const api = await authApi();
  await api.setPersistence(api.auth, api.browserLocalPersistence);
  await api.auth.authStateReady?.();
  let user = api.auth.currentUser;

  if (user && !user.isAnonymous) return { user, guest: false, name: user.displayName || user.email || "사용자" };

  let name = validName(user?.displayName) || validName(savedName());
  if (!name) name = await askName();
  if (!name) return null;

  try {
    if (!user) {
      const credential = await api.signInAnonymously(api.auth);
      user = credential.user;
    }
    if (user.displayName !== name) await api.updateProfile(user, { displayName: name });
    localStorage.setItem(NAME_KEY, name);
    await user.getIdToken(true);
    return { user, guest: true, name };
  } catch (error) {
    const dialog = ensureNameDialog();
    const box = dialog.querySelector("[data-guest-error]");
    box.textContent = error?.code === "auth/operation-not-allowed"
      ? "익명 편집이 아직 서버에서 활성화되지 않았습니다. 잠시 후 다시 시도해 주세요."
      : (error?.message || "로그인 없이 편집을 시작하지 못했습니다.");
    box.hidden = false;
    if (!dialog.open) await dialog.show();
    throw error;
  }
}

async function ensureNamedUserAndSync() {
  const result = await ensureNamedUser();
  if (!result) return null;
  // The main app bundles its own Firebase SDK. Reload once so that SDK restores
  // the anonymous Firebase session from browser persistence too.
  if (result.guest) {
    sessionStorage.setItem("pincon-guest-auth-ready", "1");
    location.reload();
    await new Promise(() => {});
  }
  return result;
}

globalThis.PINCON_GUEST_AUTH = Object.freeze({
  ensureNamedUser,
  ensureNamedUserAndSync,
  displayName: savedName,
  clearName: () => localStorage.removeItem(NAME_KEY),
});
