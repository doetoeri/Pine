import { NextDataGateway, readClassProfile } from "./core/data-gateway.js";
import {
  SCHOOL_LIFE_NOTIFICATION_DEFAULTS,
  buildBriefing,
  buildLessons,
  cleanText,
  kstDate,
  mergeLessonBundles,
  normalizeNotificationPreferences,
  subjectKey,
  validClock,
  validDate,
} from "./core/school-life.js";

const SCHOOL = globalThis.PINCON_SCHOOL_CONFIG || { id: "gochon-high", name: "학교" };
const PUSH_TOKEN_KEY = "pincon-class-ops-push-token-v1";
const STYLE_ID = "pincon-school-life-style";
const ROOT_ID = "schoolLifeAssistant";
const DIALOG_ID = "schoolLifeDialog";
const gateway = new NextDataGateway();

let snapshot = gateway.snapshot();
let firestore = null;
let listenerKey = "";
let unsubscribers = [];
let state = {
  classMaterials: [],
  personalMaterials: [],
  lessonOverrides: [],
  materialStates: {},
  assessmentStates: {},
  preferences: { ...SCHOOL_LIFE_NOTIFICATION_DEFAULTS },
  inbox: [],
};
let renderQueued = false;
let observer = null;

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function route() {
  return location.hash.replace(/^#/, "").split("/")[0] || "today";
}

function profile() {
  return snapshot.profile || readClassProfile();
}

function active(rows) {
  return (Array.isArray(rows) ? rows : []).filter((item) => item && item.deleted !== true);
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = "./school-life.css?v=20260907-schoollife1";
  document.head.appendChild(link);
}

function rows(snapshotValue) {
  return snapshotValue.docs.map((document) => ({ id: document.id, ...document.data() }));
}

function roleInClass() {
  const classKey = profile()?.classKey || "";
  const role = snapshot.role;
  if (!role?.enabled || !classKey) return false;
  if (["school", "admin", "system", "school-admin"].includes(role.level)) return true;
  return Array.isArray(role.classKeys) && role.classKeys.includes(classKey);
}

function accountProfile() {
  return globalThis.PINCON_ACCOUNT?.account || null;
}

function accountHasRole(roleName) {
  return Array.isArray(accountProfile()?.roles) && accountProfile().roles.includes(roleName);
}

function canManageClass() {
  if (snapshot.canManageContent || snapshot.canArchiveContent) return true;
  if (!roleInClass()) return false;
  if (["class", "grade", "president", "manager"].includes(snapshot.role?.level)) return true;
  return ["CLASS_PRESIDENT", "CLASS_VICE_PRESIDENT", "TEACHER", "ADMIN"].some(accountHasRole);
}

function roleSubjectKeys() {
  const role = snapshot.role || {};
  const values = Array.isArray(role.subjectKeys)
    ? role.subjectKeys
    : Array.isArray(role.subjects)
      ? role.subjects
      : [];
  const keys = new Set(values.map(subjectKey).filter(Boolean));
  for (const item of accountProfile()?.subjectRoles || []) {
    const key = subjectKey(item?.subject || "");
    if (key) keys.add(key);
  }
  return keys;
}

function canManageSubject(subject) {
  if (canManageClass()) return true;
  if (!roleInClass()) return false;
  const role = snapshot.role || {};
  const accountSubjectManager = accountHasRole("SUBJECT_MANAGER");
  const legacySubjectManager = ["staff", "editor", "subject", "subject-manager"].includes(role.level);
  if (!accountSubjectManager && !legacySubjectManager) return false;
  return roleSubjectKeys().has(subjectKey(subject));
}

function maskedActor() {
  const display = cleanText(snapshot.user?.displayName || snapshot.role?.displayName || "", 40);
  const masked = display ? `${display.slice(0, 1)}○○` : "학급 운영자";
  const label = canManageClass() ? "학급 운영" : "과목부장";
  return { masked, label };
}

function todayTimetable(date = kstDate()) {
  return active(snapshot.data?.neisTimetables).find((item) => item.date === date) || null;
}

function classSettings() {
  const classKey = profile()?.classKey || "";
  return active(snapshot.data?.classSettings).find((item) => item.id === classKey || item.classKey === classKey) || null;
}

function assignments() {
  return active(snapshot.data?.classAssignments);
}

function bundlesFor(date = kstDate()) {
  const timetable = todayTimetable(date);
  const lessons = buildLessons({
    timetable,
    lessonOverrides: state.lessonOverrides,
    classSettings: classSettings(),
  });
  return mergeLessonBundles({
    lessons,
    classMaterials: state.classMaterials,
    personalMaterials: state.personalMaterials,
    assignments: assignments(),
    ownerUid: snapshot.user?.uid || "",
    states: state.materialStates,
  });
}

function lessonSummary(bundle) {
  if (!bundle?.lesson) return "";
  const lesson = bundle.lesson;
  const bits = [];
  if (lesson.location) bits.push(lesson.location);
  if (lesson.isMovingClass) bits.push("이동수업");
  if (lesson.startTime && lesson.endTime) bits.push(`${lesson.startTime}–${lesson.endTime}`);
  return bits.join(" · ");
}

function nextBundle(bundles) {
  const now = Date.now();
  const withTime = bundles
    .map((bundle) => {
      const start = bundle.lesson?.startTime && validDate(bundle.lesson.date)
        ? Date.parse(`${bundle.lesson.date}T${bundle.lesson.startTime}:00+09:00`)
        : 0;
      return { bundle, start };
    })
    .filter((item) => item.start > now)
    .sort((a, b) => a.start - b.start);
  if (withTime.length) return withTime[0].bundle;
  return bundles[0] || null;
}

function materialMarkup(bundle) {
  if (!bundle.materials.length) return "";
  return `<div class="school-life__material-list" aria-label="준비물">
    ${bundle.materials.map((item) => {
      const creator = item.scope !== "personal" && item.authorDisplay
        ? `<small class="school-life__material-author">${esc(item.authorDisplay)} ${esc(item.authorRole || "")}</small>`
        : "";
      return `<label class="school-life__material" data-completed="${item.completed ? "true" : "false"}">
        <input type="checkbox" data-material-state="${esc(item.stateKey)}" ${item.completed ? "checked" : ""} />
        <span>${esc(item.title)}${creator}</span>
      </label>`;
    }).join("")}
  </div>`;
}

function assessmentMarkup(bundle) {
  if (!bundle.assessments.length) return "";
  return `<div class="school-life__assessment-list" aria-label="수행평가">
    ${bundle.assessments.map((item) => {
      const submitted = item.id && state.assessmentStates[item.id]?.submitted === true;
      return `<div class="school-life__assessment" data-submitted="${submitted ? "true" : "false"}">
        <div><strong>${esc(item.title || "수행평가")}</strong>${item.materials ? `<div class="school-life__meta">준비물 ${esc(item.materials)}</div>` : ""}</div>
        ${item.id ? `<label class="school-life__assessment-submit"><input type="checkbox" data-assessment-state="${esc(item.id)}" ${submitted ? "checked" : ""}><span>제출함</span></label>` : ""}
      </div>`;
    }).join("")}
  </div>`;
}

function changeMarkup(lesson) {
  const changes = [];
  if (lesson.previousSubject && lesson.previousSubject !== lesson.subject) changes.push(`${lesson.previousSubject} → ${lesson.subject}`);
  if (lesson.previousLocation && lesson.previousLocation !== lesson.location) changes.push(`${lesson.previousLocation} → ${lesson.location}`);
  return changes.length ? `<div class="school-life__change">변경됨 · ${esc(changes.join(" · "))}</div>` : "";
}

function lessonMarkup(bundle, { editable = false } = {}) {
  const lesson = bundle.lesson;
  return `<article class="school-life__lesson" data-lesson-period="${lesson.period}">
    <div class="school-life__lesson-head">
      <div class="school-life__lesson-title">
        <div class="school-life__eyebrow">${lesson.period}교시</div>
        <strong>${esc(lesson.subject)}</strong>
        ${lessonSummary(bundle) ? `<div class="school-life__meta">${esc(lessonSummary(bundle))}</div>` : ""}
      </div>
      <div class="school-life__actions">
        ${lesson.isMovingClass ? `<span class="school-life__status">이동</span>` : ""}
        ${lesson.changed ? `<span class="school-life__status school-life__status--changed">변경됨</span>` : ""}
        ${editable ? `<button type="button" class="school-life__button" data-edit-lesson="${lesson.period}">수업 설정</button>` : ""}
      </div>
    </div>
    ${changeMarkup(lesson)}
    ${materialMarkup(bundle)}
    ${assessmentMarkup(bundle)}
  </article>`;
}

function todayMarkup() {
  const date = kstDate();
  const bundles = bundlesFor(date);
  const next = nextBundle(bundles);
  const incomplete = bundles.flatMap((bundle) => bundle.materials.filter((item) => !item.completed));
  const inboxUnread = state.inbox.filter((item) => item.read !== true).length;
  return `<section class="school-life" id="${ROOT_ID}" data-school-life-route="today" aria-labelledby="school-life-title">
    <div class="school-life__surface">
      <div class="school-life__header">
        <div>
          <p class="school-life__eyebrow">오늘 먼저 챙길 것${inboxUnread ? ` · 새 알림 ${inboxUnread}` : ""}</p>
          <h2 id="school-life-title">${next ? `다음 수업 · ${next.lesson.period}교시 ${esc(next.lesson.subject)}` : "오늘 학교생활"}</h2>
          ${next && lessonSummary(next) ? `<div class="school-life__meta">${esc(lessonSummary(next))}</div>` : ""}
        </div>
        <div class="school-life__actions">
          <button type="button" class="school-life__button school-life__button--primary" data-add-material>준비물 추가</button>
          ${canManageClass() || roleInClass() ? `<button type="button" class="school-life__button" data-add-assessment>수행평가 추가</button>` : ""}
        </div>
      </div>
      ${next ? `<div class="school-life__lessons">${lessonMarkup(next)}</div>` : `<p class="school-life__empty">오늘 불러온 시간표가 없습니다.</p>`}
      ${incomplete.length > (next?.materials?.filter((item) => !item.completed).length || 0) ? `<p class="school-life__meta" style="margin:14px 0 0">오늘 미완료 준비물 ${incomplete.length}개</p>` : ""}
    </div>
  </section>`;
}

function timetableMarkup() {
  const bundles = bundlesFor(kstDate());
  return `<section class="school-life" id="${ROOT_ID}" data-school-life-route="timetable" aria-labelledby="school-life-title">
    <div class="school-life__surface">
      <div class="school-life__header">
        <div>
          <p class="school-life__eyebrow">교시 중심 학교생활</p>
          <h2 id="school-life-title">오늘 수업 준비</h2>
        </div>
        <div class="school-life__actions">
          <button type="button" class="school-life__button school-life__button--primary" data-add-material>준비물 추가</button>
          ${canManageClass() || roleInClass() ? `<button type="button" class="school-life__button" data-add-assessment>수행평가 추가</button>` : ""}
        </div>
      </div>
      ${bundles.length ? `<div class="school-life__lessons">${bundles.map((bundle) => lessonMarkup(bundle, { editable: canManageClass() })).join("")}</div>` : `<p class="school-life__empty">오늘 시간표가 아직 없습니다.</p>`}
    </div>
  </section>`;
}

function toggle(name, checked) {
  return `<input type="checkbox" data-school-life-pref="${esc(name)}" ${checked ? "checked" : ""} aria-label="${esc(name)}" />`;
}

function settingsMarkup() {
  const prefs = normalizeNotificationPreferences(state.preferences);
  return `<section class="school-life" id="${ROOT_ID}" data-school-life-route="more" aria-labelledby="school-life-title">
    <div class="school-life__surface">
      <div class="school-life__header">
        <div>
          <p class="school-life__eyebrow">학교생활 알림</p>
          <h2 id="school-life-title">알림 설정</h2>
        </div>
      </div>
      <div class="school-life__settings">
        <div class="school-life__setting-row"><label>오늘 브리핑</label><div class="school-life__setting-controls">${toggle("dailyBriefing", prefs.dailyBriefing)}<input type="time" data-school-life-pref="dailyBriefingTime" value="${esc(prefs.dailyBriefingTime)}" /></div></div>
        <div class="school-life__setting-row"><label>내일 준비물</label><div class="school-life__setting-controls">${toggle("nextDayMaterials", prefs.nextDayMaterials)}<input type="time" data-school-life-pref="nextDayMaterialsTime" value="${esc(prefs.nextDayMaterialsTime)}" /></div></div>
        <div class="school-life__setting-row"><label>이동수업</label><div class="school-life__setting-controls">${toggle("movingClass", prefs.movingClass)}<select data-school-life-pref="movingClassMinutes"><option value="3" ${prefs.movingClassMinutes === 3 ? "selected" : ""}>3분 전</option><option value="5" ${prefs.movingClassMinutes === 5 ? "selected" : ""}>5분 전</option><option value="10" ${prefs.movingClassMinutes === 10 ? "selected" : ""}>10분 전</option></select></div></div>
        <div class="school-life__setting-row"><label>시간표 변경</label>${toggle("timetableChange", prefs.timetableChange)}</div>
        <div class="school-life__setting-row"><label>교실 변경</label>${toggle("locationChange", prefs.locationChange)}</div>
        <div class="school-life__setting-row"><label>체육 장소 변경</label>${toggle("sportsLocationChange", prefs.sportsLocationChange)}</div>
        <div class="school-life__setting-row"><label>수행평가</label><div class="school-life__setting-controls">${toggle("assessmentReminder", prefs.assessmentReminder)}<select data-school-life-pref="assessmentReminderMinutes"><option value="10" ${prefs.assessmentReminderMinutes === 10 ? "selected" : ""}>10분 전</option><option value="30" ${prefs.assessmentReminderMinutes === 30 ? "selected" : ""}>30분 전</option><option value="60" ${prefs.assessmentReminderMinutes === 60 ? "selected" : ""}>1시간 전</option><option value="180" ${prefs.assessmentReminderMinutes === 180 ? "selected" : ""}>3시간 전</option><option value="1440" ${prefs.assessmentReminderMinutes === 1440 ? "selected" : ""}>1일 전</option></select></div></div>
      </div>
    </div>
  </section>`;
}

function markupForRoute(currentRoute) {
  if (currentRoute === "today") return todayMarkup();
  if (currentRoute === "timetable") return timetableMarkup();
  if (currentRoute === "more") return settingsMarkup();
  return "";
}

function mount() {
  renderQueued = false;
  if (!snapshot.ready || !profile()?.classKey) return;
  const main = document.querySelector("#mainContent");
  if (!main) return;
  const currentRoute = route();
  const markup = markupForRoute(currentRoute);
  const existing = document.getElementById(ROOT_ID);
  if (!markup) {
    existing?.remove();
    return;
  }
  const holder = document.createElement("div");
  holder.innerHTML = markup;
  const next = holder.firstElementChild;
  if (!next) return;
  // Avoid replacing an identical tree. That replacement would notify our own
  // MutationObserver and could keep the app rendering every animation frame.
  if (existing?.outerHTML === next.outerHTML) return;
  if (existing) existing.replaceWith(next);
  else main.prepend(next);
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(mount);
}

function toast(message) {
  document.querySelector(".school-life__toast")?.remove();
  const node = document.createElement("div");
  node.className = "school-life__toast";
  node.setAttribute("role", "status");
  node.textContent = cleanText(message, 180);
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2600);
}

function stopSchoolLifeListeners() {
  unsubscribers.splice(0).forEach((stop) => {
    try { stop(); } catch {}
  });
  listenerKey = "";
  state = {
    classMaterials: [],
    personalMaterials: [],
    lessonOverrides: [],
    materialStates: {},
    assessmentStates: {},
    preferences: { ...SCHOOL_LIFE_NOTIFICATION_DEFAULTS },
    inbox: [],
  };
}

function materialStateMap(items) {
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

async function startSchoolLifeListeners() {
  const p = profile();
  const user = snapshot.user;
  if (!p?.classKey || !user?.uid || !gateway.repository?.api) return;
  const key = `${p.classKey}:${user.uid}`;
  if (listenerKey === key) return;
  stopSchoolLifeListeners();
  listenerKey = key;
  firestore = gateway.repository.api;
  const schoolRoot = ["schools", SCHOOL.id];
  const listen = (ref, assign) => {
    unsubscribers.push(firestore.onSnapshot(ref, (value) => {
      assign(value);
      queueRender();
    }, () => {}));
  };

  listen(
    firestore.query(firestore.collection(firestore.db, ...schoolRoot, "lessonMaterials"), firestore.where("classKey", "==", p.classKey), firestore.limit(300)),
    (value) => { state.classMaterials = rows(value); },
  );
  listen(
    firestore.query(firestore.collection(firestore.db, ...schoolRoot, "lessonOverrides"), firestore.where("classKey", "==", p.classKey), firestore.where("date", ">=", kstDate(Date.now(), -1)), firestore.limit(120)),
    (value) => { state.lessonOverrides = rows(value); },
  );
  listen(
    firestore.collection(firestore.db, ...schoolRoot, "schoolLifeUsers", user.uid, "materials"),
    (value) => { state.personalMaterials = rows(value); },
  );
  listen(
    firestore.collection(firestore.db, ...schoolRoot, "schoolLifeUsers", user.uid, "materialStates"),
    (value) => { state.materialStates = materialStateMap(rows(value)); },
  );
  listen(
    firestore.collection(firestore.db, ...schoolRoot, "schoolLifeUsers", user.uid, "assessmentStates"),
    (value) => { state.assessmentStates = materialStateMap(rows(value)); },
  );
  const preferencesRef = firestore.doc(firestore.db, ...schoolRoot, "schoolLifeUsers", user.uid, "settings", "notifications");
  unsubscribers.push(firestore.onSnapshot(preferencesRef, (value) => {
    state.preferences = normalizeNotificationPreferences(value.exists() ? value.data() : {});
    queueRender();
  }, () => {}));
  listen(
    firestore.query(firestore.collection(firestore.db, ...schoolRoot, "schoolLifeUsers", user.uid, "notificationInbox"), firestore.orderBy("createdAtMs", "desc"), firestore.limit(30)),
    (value) => { state.inbox = rows(value); },
  );
}

async function ensureConnected() {
  if (!snapshot.ready) snapshot = await gateway.start();
  if (!snapshot.user?.uid) throw new Error("로그인 후 사용할 수 있습니다.");
  if (!gateway.repository?.api) throw new Error("데이터 연결을 준비하는 중입니다.");
  firestore = gateway.repository.api;
  return { p: profile(), user: snapshot.user, api: firestore };
}

function auditFields(value = {}) {
  const output = {};
  for (const key of ["title", "subject", "subjectKey", "date", "period", "recurrence", "scope", "location", "previousLocation", "previousSubject", "isMovingClass", "startTime", "endTime", "deleted"]) {
    if (value[key] !== undefined) output[key] = value[key];
  }
  return output;
}

async function writeAudit(batch, { api, p, user, collection, documentId, action, before = null, after = null, label = "" }) {
  const ref = api.doc(api.collection(api.db, "schools", SCHOOL.id, "changeLogs"));
  batch.set(ref, {
    classKey: p.classKey,
    collection,
    documentId,
    action,
    label: cleanText(label, 120),
    before: before ? auditFields(before) : null,
    after: after ? auditFields(after) : null,
    actorUid: user.uid,
    actorName: maskedActor().masked,
    createdAtMs: Date.now(),
    createdAt: api.serverTimestamp(),
  });
}

async function queueNotificationEvent(batch, { api, p, user, type, date, period, title, body, relatedId }) {
  const ref = api.doc(api.collection(api.db, "schools", SCHOOL.id, "notificationEvents"));
  batch.set(ref, {
    type,
    classKey: p.classKey,
    audience: "class",
    targetUserIds: [],
    date: validDate(date) ? date : "",
    period: Number(period || 0),
    title: cleanText(title, 120),
    body: cleanText(body, 600),
    relatedId: cleanText(relatedId, 160),
    status: "pending",
    createdBy: user.uid,
    createdAtMs: Date.now(),
    createdAt: api.serverTimestamp(),
    sentAtMs: 0,
  });
}

function formDialog(inner) {
  document.getElementById(DIALOG_ID)?.remove();
  const dialog = document.createElement("dialog");
  dialog.id = DIALOG_ID;
  dialog.className = "school-life__dialog";
  dialog.innerHTML = inner;
  document.body.appendChild(dialog);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
  return dialog;
}

function todaySubjectOptions() {
  const bundles = bundlesFor(kstDate());
  const options = bundles.map((bundle) => `<option value="${esc(bundle.lesson.subject)}" data-period="${bundle.lesson.period}">${bundle.lesson.period}교시 · ${esc(bundle.lesson.subject)}</option>`).join("");
  return options || `<option value="">과목을 직접 입력하세요</option>`;
}

function openMaterialDialog() {
  const date = kstDate();
  const dialog = formDialog(`<form method="dialog" class="school-life__dialog-form" id="schoolLifeMaterialForm">
    <h2>준비물 추가</h2>
    <label class="school-life__field"><span>과목</span><select name="subject">${todaySubjectOptions()}</select></label>
    <label class="school-life__field"><span>적용 범위</span><select name="recurrence"><option value="once-period">오늘 이 교시</option><option value="once-date">오늘 이 과목</option><option value="subject-default">모든 해당 과목 수업</option></select></label>
    <label class="school-life__field"><span>준비물</span><input name="title" maxlength="80" required autocomplete="off" placeholder="예: 이어폰" /></label>
    <label class="school-life__field"><span>대상</span><select name="audience"><option value="personal">나만</option><option value="class">학급 공통</option><option value="subject">특정 과목</option></select></label>
    <input type="hidden" name="date" value="${date}" />
    <div class="school-life__dialog-actions"><button type="button" class="school-life__button" data-dialog-cancel>취소</button><button type="submit" class="school-life__button school-life__button--primary">저장</button></div>
  </form>`);
  dialog.querySelector("[data-dialog-cancel]")?.addEventListener("click", () => dialog.close());
  dialog.querySelector("form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = dialog.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      await saveMaterial(values);
      dialog.close();
      toast("준비물을 저장했습니다.");
    } catch (error) {
      toast(error?.message || "준비물을 저장하지 못했습니다.");
      submit.disabled = false;
    }
  });
}

async function saveMaterial(values) {
  const { p, user, api } = await ensureConnected();
  const title = cleanText(values.title, 80);
  const subject = cleanText(values.subject, 60);
  if (!title) throw new Error("준비물을 입력해 주세요.");
  if (!subject) throw new Error("과목을 선택해 주세요.");
  const bundle = bundlesFor(kstDate()).find((item) => item.lesson.subject === subject) || null;
  const recurrenceValue = values.recurrence || "once-period";
  const audience = values.audience || "personal";
  const date = validDate(values.date) ? values.date : kstDate();
  const period = recurrenceValue === "once-period" ? Number(bundle?.lesson.period || 0) : 0;
  const recurrence = recurrenceValue === "subject-default" ? "subject-default" : "once";
  const now = Date.now();
  const common = audience !== "personal";
  if (common && !canManageSubject(subject)) throw new Error("이 과목의 공통 준비물을 등록할 권한이 없습니다.");
  const actor = maskedActor();
  const payload = {
    classKey: p.classKey,
    title,
    subject,
    subjectKey: subjectKey(subject),
    date: recurrence === "subject-default" ? "" : date,
    period,
    recurrence,
    scope: common ? (audience === "subject" ? "subject" : "class") : "personal",
    ownerUid: common ? "" : user.uid,
    authorUid: user.uid,
    authorDisplay: common ? actor.masked : "나",
    authorRole: common ? actor.label : "개인",
    deleted: false,
    createdAtMs: now,
    updatedAtMs: now,
    createdAt: api.serverTimestamp(),
    updatedAt: api.serverTimestamp(),
  };
  if (!common) {
    const ref = api.doc(api.collection(api.db, "schools", SCHOOL.id, "schoolLifeUsers", user.uid, "materials"));
    await api.setDoc(ref, payload);
    return ref.id;
  }
  const ref = api.doc(api.collection(api.db, "schools", SCHOOL.id, "lessonMaterials"));
  const batch = api.writeBatch(api.db);
  batch.set(ref, payload);
  await writeAudit(batch, { api, p, user, collection: "lessonMaterials", documentId: ref.id, action: "create", after: payload, label: `${subject} · ${title}` });
  await batch.commit();
  return ref.id;
}

function openAssessmentDialog() {
  if (!(canManageClass() || roleInClass())) {
    toast("공통 수행평가를 등록할 권한이 없습니다.");
    return;
  }
  const dialog = formDialog(`<form method="dialog" class="school-life__dialog-form" id="schoolLifeAssessmentForm">
    <h2>수행평가 추가</h2>
    <label class="school-life__field"><span>교시 · 과목</span><select name="subject">${todaySubjectOptions()}</select></label>
    <label class="school-life__field"><span>날짜</span><input type="date" name="date" value="${kstDate()}" required /></label>
    <label class="school-life__field"><span>제목</span><input name="title" maxlength="120" required placeholder="예: 공통수학2 수행평가" /></label>
    <label class="school-life__field"><span>준비물</span><input name="materials" maxlength="500" placeholder="예: 계산기, 보고서" /></label>
    <label class="school-life__field"><span>설명</span><textarea name="description" maxlength="1200"></textarea></label>
    <div class="school-life__dialog-actions"><button type="button" class="school-life__button" data-dialog-cancel>취소</button><button type="submit" class="school-life__button school-life__button--primary">저장</button></div>
  </form>`);
  dialog.querySelector("[data-dialog-cancel]")?.addEventListener("click", () => dialog.close());
  dialog.querySelector("form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = dialog.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await saveAssessment(Object.fromEntries(new FormData(event.currentTarget)));
      dialog.close();
      toast("수행평가를 저장했습니다.");
    } catch (error) {
      toast(error?.message || "수행평가를 저장하지 못했습니다.");
      submit.disabled = false;
    }
  });
}

async function saveAssessment(values) {
  const { p, user, api } = await ensureConnected();
  const subject = cleanText(values.subject, 60);
  const title = cleanText(values.title, 120);
  const date = validDate(values.date) ? values.date : "";
  if (!subject || !title || !date) throw new Error("과목, 날짜, 제목을 확인해 주세요.");
  if (!canManageSubject(subject)) throw new Error("이 과목의 수행평가를 등록할 권한이 없습니다.");
  const lesson = bundlesFor(date).find((item) => item.lesson.subject === subject)?.lesson
    || bundlesFor(kstDate()).find((item) => item.lesson.subject === subject)?.lesson;
  const materialItems = String(values.materials || "").split(/[,\n·]+/).map((item) => cleanText(item, 80)).filter(Boolean).slice(0, 12);
  const now = Date.now();
  const ref = api.doc(api.collection(api.db, "schools", SCHOOL.id, "classAssignments"));
  const payload = {
    classKey: p.classKey,
    type: "assessment",
    title,
    subject,
    subjectKey: subjectKey(subject),
    period: Number(lesson?.period || 0),
    dueDate: date,
    dueAtMs: Date.parse(`${date}T23:59:00+09:00`),
    description: cleanText(values.description, 1200),
    dateType: "exact",
    evaluationRange: "",
    evaluationMethod: "",
    materials: materialItems.join(", "),
    materialItems,
    points: "",
    evaluationPlanId: "",
    pageReferences: "",
    verificationStatus: "verified",
    confirmed: true,
    changed: false,
    published: true,
    announcedDate: kstDate(),
    recoveryRelevant: true,
    createdBy: user.uid,
    deleted: false,
    createdAtMs: now,
    updatedAtMs: now,
    createdAt: api.serverTimestamp(),
    updatedAt: api.serverTimestamp(),
  };
  const batch = api.writeBatch(api.db);
  batch.set(ref, payload);
  await writeAudit(batch, { api, p, user, collection: "classAssignments", documentId: ref.id, action: "create", after: payload, label: `${subject} · ${title}` });
  await batch.commit();
}

function openLessonDialog(period) {
  const bundle = bundlesFor(kstDate()).find((item) => item.lesson.period === Number(period));
  if (!bundle || !canManageClass()) {
    toast("시간표와 장소 변경은 학급 운영 권한이 필요합니다.");
    return;
  }
  const lesson = bundle.lesson;
  const dialog = formDialog(`<form method="dialog" class="school-life__dialog-form" id="schoolLifeLessonForm">
    <h2>${lesson.period}교시 수업 설정</h2>
    <label class="school-life__field"><span>과목</span><input name="subject" value="${esc(lesson.subject)}" maxlength="60" required /></label>
    <label class="school-life__field"><span>장소</span><input name="location" value="${esc(lesson.location)}" maxlength="80" placeholder="예: 과학실" /></label>
    <label class="school-life__field"><span>수업 시작</span><input type="time" name="startTime" value="${esc(lesson.startTime)}" /></label>
    <label class="school-life__field"><span>수업 종료</span><input type="time" name="endTime" value="${esc(lesson.endTime)}" /></label>
    <label class="school-life__material"><input type="checkbox" name="isMovingClass" value="true" ${lesson.isMovingClass ? "checked" : ""} /><span>이동수업</span></label>
    <div class="school-life__dialog-actions"><button type="button" class="school-life__button" data-dialog-cancel>취소</button><button type="submit" class="school-life__button school-life__button--primary">저장</button></div>
  </form>`);
  dialog.querySelector("[data-dialog-cancel]")?.addEventListener("click", () => dialog.close());
  dialog.querySelector("form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = dialog.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      values.isMovingClass = event.currentTarget.elements.isMovingClass.checked;
      await saveLessonOverride(lesson, values);
      dialog.close();
      toast("수업 설정을 저장했습니다.");
    } catch (error) {
      toast(error?.message || "수업 설정을 저장하지 못했습니다.");
      submit.disabled = false;
    }
  });
}

async function saveLessonOverride(previousLesson, values) {
  const { p, user, api } = await ensureConnected();
  if (!canManageClass()) throw new Error("시간표와 장소 변경은 학급 운영 권한이 필요합니다.");
  const subject = cleanText(values.subject, 60);
  const location = cleanText(values.location, 80);
  const startTime = validClock(values.startTime) ? values.startTime : "";
  const endTime = validClock(values.endTime) ? values.endTime : "";
  const isMovingClass = values.isMovingClass === true;
  if (!subject) throw new Error("과목을 입력해 주세요.");
  const existing = state.lessonOverrides.find((item) => item.date === previousLesson.date && Number(item.period) === previousLesson.period && item.deleted !== true) || null;
  const ref = existing
    ? api.doc(api.db, "schools", SCHOOL.id, "lessonOverrides", existing.id)
    : api.doc(api.collection(api.db, "schools", SCHOOL.id, "lessonOverrides"));
  const now = Date.now();
  const payload = {
    classKey: p.classKey,
    date: previousLesson.date,
    period: previousLesson.period,
    subject,
    subjectKey: subjectKey(subject),
    previousSubject: subject !== previousLesson.originalSubject ? previousLesson.originalSubject : "",
    location,
    previousLocation: location !== previousLesson.originalLocation ? previousLesson.originalLocation : "",
    startTime,
    endTime,
    isMovingClass,
    changed: subject !== previousLesson.originalSubject || location !== previousLesson.originalLocation,
    createdBy: existing?.createdBy || user.uid,
    updatedBy: user.uid,
    deleted: false,
    createdAtMs: Number(existing?.createdAtMs || now),
    updatedAtMs: now,
    createdAt: existing?.createdAt || api.serverTimestamp(),
    updatedAt: api.serverTimestamp(),
  };
  const batch = api.writeBatch(api.db);
  batch.set(ref, payload, { merge: false });
  await writeAudit(batch, { api, p, user, collection: "lessonOverrides", documentId: ref.id, action: existing ? "update" : "create", before: existing, after: payload, label: `${previousLesson.period}교시 ${subject}` });

  if (subject !== previousLesson.subject) {
    await queueNotificationEvent(batch, {
      api, p, user, type: "CLASS_CHANGED", date: previousLesson.date, period: previousLesson.period,
      title: "시간표가 변경됐어요",
      body: `${previousLesson.period}교시 ${previousLesson.subject} → ${subject}`,
      relatedId: ref.id,
    });
  }
  if (location !== previousLesson.location) {
    const sports = /체육/.test(subject) && /^(운동장|체육관)$/.test(location || previousLesson.location);
    await queueNotificationEvent(batch, {
      api, p, user, type: sports ? "SPORTS_LOCATION_CHANGED" : "LOCATION_CHANGED", date: previousLesson.date, period: previousLesson.period,
      title: sports ? "체육 수업 장소가 변경됐어요" : "수업 장소가 변경됐어요",
      body: `${previousLesson.period}교시 ${subject} · ${previousLesson.location || "기존 장소"} → ${location || "장소 미정"}`,
      relatedId: ref.id,
    });
  }
  await batch.commit();
}

async function setMaterialCompleted(stateKey, completed) {
  const { user, api } = await ensureConnected();
  const ref = api.doc(api.db, "schools", SCHOOL.id, "schoolLifeUsers", user.uid, "materialStates", stateKey);
  await api.setDoc(ref, {
    ownerUid: user.uid,
    completed: Boolean(completed),
    updatedAtMs: Date.now(),
    updatedAt: api.serverTimestamp(),
  }, { merge: true });
}

async function setAssessmentSubmitted(assessmentId, submitted) {
  const { user, api } = await ensureConnected();
  const id = cleanText(assessmentId, 160);
  if (!id) throw new Error("수행평가를 찾지 못했습니다.");
  const ref = api.doc(api.db, "schools", SCHOOL.id, "schoolLifeUsers", user.uid, "assessmentStates", id);
  await api.setDoc(ref, { ownerUid: user.uid, submitted: Boolean(submitted), updatedAtMs: Date.now(), updatedAt: api.serverTimestamp() }, { merge: true });
}

async function savePreferences(next) {
  const { user, api } = await ensureConnected();
  const prefs = normalizeNotificationPreferences(next);
  const ref = api.doc(api.db, "schools", SCHOOL.id, "schoolLifeUsers", user.uid, "settings", "notifications");
  await api.setDoc(ref, {
    ownerUid: user.uid,
    ...prefs,
    updatedAtMs: Date.now(),
    updatedAt: api.serverTimestamp(),
  }, { merge: true });
  const token = localStorage.getItem(PUSH_TOKEN_KEY) || "";
  if (token) {
    const pushRef = api.doc(api.db, "schools", SCHOOL.id, "pushSubscriptions", token);
    await api.setDoc(pushRef, {
      token,
      classKey: profile()?.classKey || "",
      enabled: true,
      ownerUid: user.uid,
      preferences: { ...(gateway.repository.notificationPreferences?.() || {}), ...prefs },
      appVersion: "next-school-life-1",
      updatedAtMs: Date.now(),
      updatedAt: api.serverTimestamp(),
    }, { merge: true }).catch(() => {});
  }
  state.preferences = prefs;
  queueRender();
}

async function onPreferenceChange(target) {
  const name = target.dataset.schoolLifePref;
  if (!name) return;
  const current = normalizeNotificationPreferences(state.preferences);
  let value;
  if (target.type === "checkbox") value = target.checked;
  else if (["movingClassMinutes", "assessmentReminderMinutes"].includes(name)) value = Number(target.value);
  else value = target.value;
  await savePreferences({ ...current, [name]: value });
  toast("알림 설정을 저장했습니다.");
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const addMaterial = event.target.closest?.("[data-add-material]");
    if (addMaterial) {
      openMaterialDialog();
      return;
    }
    const addAssessment = event.target.closest?.("[data-add-assessment]");
    if (addAssessment) {
      openAssessmentDialog();
      return;
    }
    const editLesson = event.target.closest?.("[data-edit-lesson]");
    if (editLesson) openLessonDialog(Number(editLesson.dataset.editLesson));
  });

  document.addEventListener("change", (event) => {
    const checkbox = event.target.closest?.("[data-material-state]");
    if (checkbox) {
      setMaterialCompleted(checkbox.dataset.materialState, checkbox.checked)
        .then(() => toast(checkbox.checked ? "챙김으로 표시했습니다." : "미완료로 되돌렸습니다."))
        .catch((error) => toast(error?.message || "상태를 저장하지 못했습니다."));
      return;
    }
    const assessment = event.target.closest?.("[data-assessment-state]");
    if (assessment) {
      setAssessmentSubmitted(assessment.dataset.assessmentState, assessment.checked)
        .then(() => toast(assessment.checked ? "제출함으로 표시했습니다." : "미제출로 되돌렸습니다."))
        .catch((error) => toast(error?.message || "제출 상태를 저장하지 못했습니다."));
      return;
    }
    const pref = event.target.closest?.("[data-school-life-pref]");
    if (pref) onPreferenceChange(pref).catch((error) => toast(error?.message || "설정을 저장하지 못했습니다."));
  });
}

function latestBriefForDebug() {
  const date = kstDate();
  const bundles = bundlesFor(date);
  const meal = active(snapshot.data?.meals).find((item) => item.date === date) || null;
  return buildBriefing({
    date,
    bundles,
    meal,
    changes: state.lessonOverrides,
    academicSchedules: snapshot.data?.academicSchedules || [],
  });
}

async function bootstrap() {
  ensureStyle();
  bindEvents();
  gateway.addEventListener("change", (event) => {
    snapshot = event.detail;
    startSchoolLifeListeners().catch(() => {});
    queueRender();
  });
  await gateway.start().catch(() => null);
  snapshot = gateway.snapshot();
  await startSchoolLifeListeners().catch(() => {});
  observer = new MutationObserver(() => {
  const schoolLifeRoute = ["today", "timetable", "more"].includes(route());
  if (!schoolLifeRoute) return;
  if (document.getElementById(ROOT_ID)) return;
  if (!document.querySelector("#mainContent")) return;
  queueRender();
});
const app = document.querySelector("#app");
if (app) observer.observe(app, { childList: true, subtree: true });
  window.addEventListener("hashchange", queueRender);
  window.addEventListener("popstate", queueRender);
  queueRender();
  globalThis.PinConSchoolLife = Object.freeze({
    snapshot: () => ({ ...state, briefing: latestBriefForDebug() }),
    refresh: queueRender,
  });
}

bootstrap();
