import { readClassProfile } from "../core/data-gateway.js";

const FIREBASE = globalThis.PINCON_FIREBASE_CONFIG || {};
const SCHOOL = globalThis.PINCON_SCHOOL_CONFIG || { id: "gochon-high", name: "학교" };
const SDK = "12.16.0";
const root = document.querySelector("#adminApp");
let apiPromise = null;
let queued = false;

async function firebaseApi() {
  if (!apiPromise) {
    apiPromise = Promise.all([
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-firestore.js`),
    ]).then(([appApi, authApi, firestoreApi]) => {
      const app = appApi.getApps().length ? appApi.getApp() : appApi.initializeApp(FIREBASE);
      return {
        auth: authApi.getAuth(app),
        db: firestoreApi.getFirestore(app),
        ...authApi,
        ...firestoreApi,
      };
    });
  }
  return apiPromise;
}

function parseUids(value) {
  return [...new Set(String(value || "")
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean))];
}

function validUid(uid) {
  return uid.length >= 6 && uid.length <= 128 && !/[\/\s]/.test(uid);
}

async function currentSchoolAdmin(api) {
  await api.auth.authStateReady?.();
  const user = api.auth.currentUser;
  if (!user) return { allowed: false, user: null };
  const ref = api.doc(api.db, "schools", SCHOOL.id, "roles", user.uid);
  const snapshot = await api.getDoc(ref).catch(() => null);
  const role = snapshot?.exists?.() ? snapshot.data() : null;
  return {
    allowed: Boolean(role?.enabled === true && role?.level === "school"),
    user,
    role,
  };
}

function cardMarkup(classKey) {
  return `<section class="admin-card admin-card--wide admin-role-manager" id="adminRoleManager" aria-labelledby="role-manager-title">
    <div class="admin-card__header">
      <h2 id="role-manager-title">관리자 계정 관리</h2>
      <span class="beta-badge">SCHOOL ADMIN ONLY</span>
    </div>
    <p class="admin-role-manager__copy">Firebase Auth UID를 입력하면 <strong>${classKey}</strong> 학급 관리자로 등록합니다. 여러 UID는 줄바꿈·쉼표·공백으로 구분할 수 있습니다.</p>
    <div class="admin-role-manager__form">
      <md-outlined-text-field id="classAdminUids" label="Firebase Auth UID" maxlength="600" supporting-text="GitHub에는 저장하지 않고 Firestore 역할 문서에만 기록합니다."></md-outlined-text-field>
      <md-filled-button id="grantClassAdmins"><md-icon slot="icon">person_add</md-icon>${classKey} 관리자 추가</md-filled-button>
    </div>
    <div id="roleManagerStatus" class="admin-role-manager__status" role="status" aria-live="polite"></div>
  </section>`;
}

async function grant() {
  const api = await firebaseApi();
  const authState = await currentSchoolAdmin(api);
  if (!authState.allowed) throw new Error("학교 관리자 계정에서만 관리자 역할을 추가할 수 있습니다.");

  const profile = readClassProfile();
  const classKey = profile?.classKey || "";
  if (!/^([1-3])-([1-9]|10)$/.test(classKey)) throw new Error("먼저 관리할 학급을 선택해 주세요.");

  const field = document.querySelector("#classAdminUids");
  const uids = parseUids(field?.value);
  if (!uids.length) throw new Error("추가할 Firebase UID를 입력해 주세요.");
  if (uids.length > 10) throw new Error("한 번에 최대 10명까지 추가할 수 있습니다.");
  const invalid = uids.find((uid) => !validUid(uid));
  if (invalid) throw new Error("UID 형식을 다시 확인해 주세요.");
  if (uids.includes(authState.user.uid)) throw new Error("현재 학교 관리자 자신의 역할은 이 화면에서 변경하지 않습니다.");

  const batch = api.writeBatch(api.db);
  const now = Date.now();
  for (const uid of uids) {
    const ref = api.doc(api.db, "schools", SCHOOL.id, "roles", uid);
    batch.set(ref, {
      enabled: true,
      level: "class",
      classKeys: [classKey],
      updatedAtMs: now,
      updatedByUid: authState.user.uid,
    }, { merge: true });
  }
  await batch.commit();
  return { count: uids.length, classKey };
}

async function bind(card) {
  const button = card.querySelector("#grantClassAdmins");
  const status = card.querySelector("#roleManagerStatus");
  button?.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    status.textContent = "관리자 역할을 저장하는 중…";
    try {
      const result = await grant();
      status.textContent = `${result.classKey} 관리자 ${result.count}명을 추가했습니다. 해당 사용자는 다시 로그인하거나 새로고침하면 권한이 적용됩니다.`;
      const field = card.querySelector("#classAdminUids");
      if (field) field.value = "";
    } catch (error) {
      status.textContent = error?.message || "관리자 역할을 저장하지 못했습니다.";
    } finally {
      button.disabled = false;
    }
  });
}

async function mount() {
  queued = false;
  if (!root || root.querySelector("#adminRoleManager")) return;
  const grid = root.querySelector("#adminMain .admin-grid");
  if (!grid) return;
  const api = await firebaseApi();
  const authState = await currentSchoolAdmin(api);
  if (!authState.allowed) return;
  const profile = readClassProfile();
  const classKey = profile?.classKey || "학급 미선택";
  grid.insertAdjacentHTML("beforeend", cardMarkup(classKey));
  await bind(root.querySelector("#adminRoleManager"));
}

function queueMount() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => mount().catch(() => { queued = false; }));
}

const observer = new MutationObserver(queueMount);
if (root) observer.observe(root, { childList: true, subtree: true });
queueMount();
