import {
  CLASS_OPS_VERSION,
  NOTIFICATION_DEFAULTS,
  RIGHTS_BASES,
  WORKSHEET_TYPES,
  academicSchedulesForGrade,
  isOpenWindow,
  normalizedRecord,
  plainText,
  safeExternalUrl,
} from "./pincon-class-ops-core.js";

const FIREBASE = globalThis.PINCON_FIREBASE_CONFIG || {};
const SCHOOL = globalThis.PINCON_SCHOOL_CONFIG || { id: "gochon-high", name: "학교" };
const SDK = "12.16.0";
const CACHE_KEY = "pincon-class-ops-cache-v1";
const PREFS_KEY = "pincon-class-ops-notifications-v1";
const PUSH_TOKEN_KEY = "pincon-class-ops-push-token-v1";
const REPORT_KEY = "pincon-class-ops-supply-reports-v1";
const RESPONSE_KEY = "pincon-class-ops-event-responses-v1";

const PUBLIC_COLLECTIONS = Object.freeze([
  "announcements",
  "classAssignments",
  "events",
  "polls",
  "feedback",
  "supplies",
  "supplyLoans",
  "lostItems",
  "resources",
  "patchNotes",
  "academicSchedules",
  "neisTimetables",
  "meals",
  "content",
  "classSettings",
]);

const ADMIN_COLLECTIONS = new Set([
  "announcements",
  "classAssignments",
  "events",
  "polls",
  "feedback",
  "supplies",
  "supplyLoans",
  "lostItems",
  "resources",
  "patchNotes",
  "patchNoteDrafts",
  "classSettings",
]);

let apiPromise;

function safeJsonParse(value, fallback) {
  try { return JSON.parse(value) ?? fallback; } catch { return fallback; }
}

function localMap(key) {
  return safeJsonParse(localStorage.getItem(key) || "{}", {});
}

function setLocalMap(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

async function anonymousResponseId(eventId, userUid) {
  const source = new TextEncoder().encode(`${SCHOOL.id}:${eventId}:${userUid}`);
  const digest = await crypto.subtle.digest("SHA-256", source);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

function classProfile() {
  const profile = safeJsonParse(localStorage.getItem("pincon-profile-v2") || "null", null);
  const grade = Number(profile?.grade);
  const classNumber = Number(profile?.classNumber);
  if (!Number.isInteger(grade) || grade < 1 || grade > 3 || !Number.isInteger(classNumber) || classNumber < 1 || classNumber > 10) return null;
  return { grade, classNumber, classKey: `${grade}-${classNumber}` };
}

function isPresidentRole(role, classKey) {
  if (!role?.enabled) return false;
  if (role.level === "school") return true;
  return Array.isArray(role.classKeys) && role.classKeys.includes(classKey) && ["class", "grade", "president"].includes(role.level);
}

function docData(snapshot) {
  if (!snapshot?.exists?.()) return null;
  return normalizedRecord({ id: snapshot.id, ...snapshot.data() });
}

function rowsFromSnapshot(snapshot) {
  return snapshot.docs.map((item) => normalizedRecord({ id: item.id, ...item.data() }));
}

function publicCacheCopy(state) {
  const data = {};
  for (const name of PUBLIC_COLLECTIONS) {
    let rows = (state.data[name] || []).filter((item) => !item.__private);
    if (name === "resources") rows = rows.filter((item) => item.moderationStatus === "approved");
    if (name === "events") rows = rows.filter((item) => item.status !== "draft");
    data[name] = rows.slice(0, 250).map((item) => {
      const copy = { ...item };
      delete copy.createdAt;
      delete copy.updatedAt;
      delete copy.deletedAt;
      return copy;
    });
  }
  return { version: CLASS_OPS_VERSION, classKey: state.classKey, savedAtMs: Date.now(), data };
}

function auditSnapshot(value = {}) {
  const allowed = [
    "classKey", "title", "name", "body", "description", "category", "subject", "type", "priority",
    "date", "dueDate", "dueAtMs", "startsAtMs", "endsAtMs", "closesAtMs", "status", "quantity", "unit",
    "location", "loanable", "important", "pinned", "url", "fileName", "fileUrl", "photoUrl", "month",
    "version", "unit", "materialType", "schoolYear", "semester", "pageCount", "sourceAttribution", "rightsBasis", "rightsConfirmed",
    "personalDataRemoved", "added", "improved", "fixed", "reviewing", "feedbackSummary", "officialReply", "resultSummary",
    "publishedResults", "options", "multiple", "resultVisibility", "deleted", "deletedAtMs", "moderationStatus",
  ];
  const result = {};
  for (const key of allowed) {
    const item = value[key];
    if (item === undefined) continue;
    if (typeof item === "string") result[key] = item.slice(0, 2000);
    else if (typeof item === "number" || typeof item === "boolean" || item === null) result[key] = item;
    else if (Array.isArray(item)) result[key] = item.slice(0, 60).map((row) => typeof row === "object" ? auditSnapshot(row) : String(row).slice(0, 220));
    else if (typeof item === "object") result[key] = Object.fromEntries(Object.entries(item).slice(0, 30).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 500) : v]));
  }
  return result;
}

async function firebaseApi() {
  if (!apiPromise) {
    apiPromise = Promise.all([
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-firestore.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-storage.js`),
    ]).then(([appApi, authApi, firestoreApi, storageApi]) => {
      const app = appApi.getApps().length ? appApi.getApp() : appApi.initializeApp(FIREBASE);
      const auth = authApi.getAuth(app);
      let db;
      try {
        db = firestoreApi.initializeFirestore(app, {
          localCache: firestoreApi.persistentLocalCache({ tabManager: firestoreApi.persistentMultipleTabManager() }),
        });
      } catch {
        db = firestoreApi.getFirestore(app);
      }
      const storage = storageApi.getStorage(app);
      return { app, auth, db, storage, ...authApi, ...firestoreApi, ...storageApi };
    });
  }
  return apiPromise;
}

function listenQuery(api, queryRef, receive, fail) {
  return api.onSnapshot(queryRef, { includeMetadataChanges: true }, receive, fail);
}

function queryFor(api, name, classKey, president) {
  const collectionRef = api.collection(api.db, "schools", SCHOOL.id, name);
  if (name === "content") return api.query(collectionRef, api.where("targets", "array-contains", classKey), api.limit(250));
  if (name === "polls" && !president) return api.query(collectionRef, api.where("classKey", "==", classKey), api.where("official", "==", true), api.limit(250));
  if (name === "resources" && !president) return api.query(collectionRef, api.where("classKey", "==", classKey), api.where("moderationStatus", "==", "approved"), api.limit(250));
  if (name === "meals") return api.query(collectionRef, api.where("date", ">=", new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)), api.limit(40));
  if (name === "academicSchedules") return api.query(collectionRef, api.where("date", ">=", new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)), api.limit(120));
  if (name === "patchNoteDrafts" || name === "changeLogs" || name === "supplyReports") {
    if (!president) return null;
  }
  return api.query(collectionRef, api.where("classKey", "==", classKey), api.limit(250));
}

function rowsForProfile(name, rows, profile) {
  if (name !== "academicSchedules" || !profile?.grade) return rows;
  return academicSchedulesForGrade(rows, profile.grade);
}

export class PinconClassOpsRepository extends EventTarget {
  constructor() {
    super();
    const profile = classProfile();
    this.state = {
      ready: false,
      online: navigator.onLine,
      profile,
      classKey: profile?.classKey || "",
      user: null,
      role: null,
      isPresident: false,
      syncing: false,
      lastError: "",
      data: Object.fromEntries([...PUBLIC_COLLECTIONS, "patchNoteDrafts", "changeLogs", "supplyReports"].map((name) => [name, []])),
    };
    this.unsubscribers = [];
    this.privateUnsubscribers = [];
    this.api = null;
    this.authUnsubscribe = null;
    window.addEventListener("online", () => this.setOnline(true));
    window.addEventListener("offline", () => this.setOnline(false));
  }

  snapshot() {
    return {
      ...this.state,
      data: Object.fromEntries(Object.entries(this.state.data).map(([key, value]) => [key, [...value]])),
      notificationPreferences: this.notificationPreferences(),
    };
  }

  emit() {
    this.dispatchEvent(new CustomEvent("change", { detail: this.snapshot() }));
  }

  setOnline(online) {
    this.state.online = online;
    this.emit();
  }

  loadCache() {
    const cached = safeJsonParse(localStorage.getItem(CACHE_KEY) || "null", null);
    if (!cached || cached.classKey !== this.state.classKey || !cached.data) return;
    for (const name of PUBLIC_COLLECTIONS) {
      if (Array.isArray(cached.data[name])) this.state.data[name] = rowsForProfile(name, cached.data[name].map(normalizedRecord), this.state.profile);
    }
  }

  saveCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(publicCacheCopy(this.state))); } catch {}
  }

  async start() {
    if (this.state.ready || this.state.syncing) return this.snapshot();
    if (!this.state.classKey) throw new Error("먼저 PinCon에서 학년과 반을 선택해 주세요.");
    this.loadCache();
    this.state.syncing = true;
    this.emit();
    this.api = await firebaseApi();
    await this.api.auth.authStateReady?.();
    this.state.user = this.api.auth.currentUser;
    this.authUnsubscribe = this.api.onAuthStateChanged(this.api.auth, (user) => {
      const changed = this.state.user?.uid !== user?.uid;
      this.state.user = user;
      if (changed) this.listenRole().catch((error) => this.recordError(error));
      this.emit();
    });
    await this.listenRole();
    this.listenPublic();
    this.state.ready = true;
    this.state.syncing = false;
    this.emit();
    return this.snapshot();
  }

  recordError(error) {
    const message = error?.code === "permission-denied"
      ? "이 기능의 서버 권한 규칙이 아직 반영되지 않았습니다. 잠시 후 다시 시도해 주세요."
      : (error?.message || "학급 데이터를 불러오지 못했습니다.");
    this.state.lastError = message;
    this.state.syncing = false;
    this.emit();
  }

  clearError() {
    this.state.lastError = "";
    this.emit();
  }

  async listenRole() {
    this.privateUnsubscribers.splice(0).forEach((stop) => stop());
    for (const name of ["patchNoteDrafts", "changeLogs", "supplyReports"]) this.state.data[name] = [];
    this.state.role = null;
    this.state.isPresident = false;
    if (!this.api || !this.state.user) {
      if (this.state.ready) this.listenPublic();
      return;
    }
    const roleRef = this.api.doc(this.api.db, "schools", SCHOOL.id, "roles", this.state.user.uid);
    const roleSnapshot = await this.api.getDoc(roleRef).catch(() => null);
    const role = docData(roleSnapshot);
    this.state.role = role;
    this.state.isPresident = isPresidentRole(role, this.state.classKey);
    if (this.state.isPresident) this.listenPrivate();
    if (this.state.ready) this.listenPublic();
  }

  listenPublic() {
    this.unsubscribers.splice(0).forEach((stop) => stop());
    for (const name of PUBLIC_COLLECTIONS) {
      const queryRef = queryFor(this.api, name, this.state.classKey, this.state.isPresident);
      if (!queryRef) continue;
      const unsubscribe = listenQuery(this.api, queryRef, (snapshot) => {
        this.state.data[name] = rowsForProfile(name, rowsFromSnapshot(snapshot), this.state.profile);
        this.state.lastError = "";
        this.saveCache();
        this.emit();
      }, (error) => {
        if (name !== "polls" || this.state.user) this.recordError(error);
      });
      this.unsubscribers.push(unsubscribe);
    }
  }

  listenPrivate() {
    for (const name of ["patchNoteDrafts", "changeLogs", "supplyReports"]) {
      const queryRef = queryFor(this.api, name, this.state.classKey, true);
      const unsubscribe = listenQuery(this.api, queryRef, (snapshot) => {
        this.state.data[name] = rowsFromSnapshot(snapshot).map((item) => ({ ...item, __private: true }));
        this.emit();
      }, (error) => this.recordError(error));
      this.privateUnsubscribers.push(unsubscribe);
    }
  }

  async ensureUser() {
    if (!this.api) await this.start();
    await this.api.auth.authStateReady?.();
    if (this.api.auth.currentUser) return this.api.auth.currentUser;
    if (globalThis.PINCON_GUEST_AUTH?.ensureNamedUser) {
      const result = await globalThis.PINCON_GUEST_AUTH.ensureNamedUser();
      if (result?.user) {
        this.state.user = result.user;
        await this.listenRole();
        this.emit();
        return result.user;
      }
    }
    throw new Error("참여하려면 Google 로그인 또는 이름 설정이 필요합니다.");
  }

  requirePresident() {
    if (!this.state.user || !this.state.isPresident) throw new Error("학급 회장 계정에서만 사용할 수 있습니다.");
  }

  collectionRef(name) {
    return this.api.collection(this.api.db, "schools", SCHOOL.id, name);
  }

  documentRef(name, id) {
    return this.api.doc(this.api.db, "schools", SCHOOL.id, name, id);
  }

  async adminWrite(name, values, { id = "", action = "", label = "" } = {}) {
    this.requirePresident();
    if (!ADMIN_COLLECTIONS.has(name)) throw new Error("관리할 수 없는 데이터 종류입니다.");
    const now = Date.now();
    const targetRef = id ? this.documentRef(name, id) : this.api.doc(this.collectionRef(name));
    const beforeSnapshot = id ? await this.api.getDoc(targetRef) : null;
    const before = docData(beforeSnapshot);
    const next = {
      ...(before || {}),
      ...values,
      classKey: this.state.classKey,
      updatedAtMs: now,
      updatedAt: this.api.serverTimestamp(),
      deleted: values.deleted === true,
    };
    delete next.id;
    for (const key of Object.keys(next)) if (key.startsWith("__")) delete next[key];
    if (!before) {
      next.createdAtMs = now;
      next.createdAt = this.api.serverTimestamp();
    }
    const changeRef = this.api.doc(this.collectionRef("changeLogs"));
    const resolvedAction = action || (before ? "update" : "create");
    const batch = this.api.writeBatch(this.api.db);
    batch.set(targetRef, next, { merge: false });
    batch.set(changeRef, {
      classKey: this.state.classKey,
      collection: name,
      documentId: targetRef.id,
      action: resolvedAction,
      label: plainText(label || next.title || next.name || name, 120),
      before: before ? auditSnapshot(before) : null,
      after: auditSnapshot(next),
      actorUid: this.state.user.uid,
      actorName: plainText(this.state.user.displayName || "회장", 40),
      createdAtMs: now,
      createdAt: this.api.serverTimestamp(),
    });
    await batch.commit();
    return targetRef.id;
  }

  async softDelete(name, id, label = "") {
    const current = (this.state.data[name] || []).find((item) => item.id === id);
    if (!current) throw new Error("삭제할 항목을 찾지 못했습니다.");
    return this.adminWrite(name, { ...current, deleted: true, deletedAtMs: Date.now() }, { id, action: "delete", label });
  }

  async restoreFromLog(logId) {
    this.requirePresident();
    const log = this.state.data.changeLogs.find((item) => item.id === logId);
    if (!log || !ADMIN_COLLECTIONS.has(log.collection)) throw new Error("복구할 변경 기록을 찾지 못했습니다.");
    if (log.action === "create") {
      const current = (this.state.data[log.collection] || []).find((item) => item.id === log.documentId) || log.after;
      return this.adminWrite(log.collection, { ...current, deleted: true, deletedAtMs: Date.now() }, { id: log.documentId, action: "restore", label: `${log.label} 생성 취소` });
    }
    if (!log.before) throw new Error("이 기록에는 복구 가능한 이전 내용이 없습니다.");
    return this.adminWrite(log.collection, { ...log.before, deleted: false, deletedAtMs: null }, { id: log.documentId, action: "restore", label: `${log.label} 복구` });
  }

  async submitFeedback(values) {
    await this.ensureUser();
    const now = Date.now();
    const targetRef = this.api.doc(this.collectionRef("feedback"));
    await this.api.setDoc(targetRef, {
      classKey: this.state.classKey,
      category: plainText(values.category, 30),
      title: plainText(values.title, 100),
      body: plainText(values.body, 1600),
      status: "received",
      officialReply: "",
      anonymous: true,
      deleted: false,
      createdAtMs: now,
      updatedAtMs: now,
      createdAt: this.api.serverTimestamp(),
      updatedAt: this.api.serverTimestamp(),
    });
    return targetRef.id;
  }

  async respondToEvent(eventId, answers) {
    const user = await this.ensureUser();
    const event = this.state.data.events.find((item) => item.id === eventId);
    if (!event || !isOpenWindow(event) || Number(event.startsAtMs || 0) > Date.now() || event.acceptingResponses !== true) throw new Error("이 행사는 아직 시작하지 않았거나 응답 접수가 마감되었습니다.");
    const local = localMap(RESPONSE_KEY);
    if (local[eventId]) throw new Error("이 행사에는 이미 답변했습니다.");
    const targetRef = this.documentRef("eventResponses", await anonymousResponseId(eventId, user.uid));
    const cleanAnswers = (Array.isArray(answers) ? answers : [answers]).map((item) => plainText(item, 120)).filter(Boolean).slice(0, 12);
    await this.api.setDoc(targetRef, {
      classKey: this.state.classKey,
      eventId,
      answers: cleanAnswers,
      createdAtMs: Date.now(),
      createdAt: this.api.serverTimestamp(),
    });
    local[eventId] = targetRef.id;
    setLocalMap(RESPONSE_KEY, local);
    return targetRef.id;
  }

  hasRespondedToEvent(eventId) {
    return Boolean(localMap(RESPONSE_KEY)[eventId]);
  }

  async getEventResponses(eventId) {
    this.requirePresident();
    const ref = this.api.query(this.collectionRef("eventResponses"), this.api.where("eventId", "==", eventId), this.api.where("classKey", "==", this.state.classKey), this.api.limit(250));
    return rowsFromSnapshot(await this.api.getDocs(ref));
  }

  async votePoll(pollId, selected) {
    const user = await this.ensureUser();
    const poll = this.state.data.polls.find((item) => item.id === pollId);
    if (!poll || !isOpenWindow(poll)) throw new Error("이 투표는 마감되었습니다.");
    const values = (Array.isArray(selected) ? selected : [selected]).map((item) => Number(item)).filter(Number.isInteger).slice(0, 8);
    if (!values.length) throw new Error("한 개 이상 선택해 주세요.");
    if (values.some((item) => item < 0 || item >= (poll.options || []).length)) throw new Error("올바른 선택지를 골라 주세요.");
    if (!poll.multiple && values.length !== 1) throw new Error("한 가지만 선택해 주세요.");
    const voteRef = this.api.doc(this.api.db, "schools", SCHOOL.id, "polls", pollId, "votes", user.uid);
    await this.api.setDoc(voteRef, {
      voterUid: user.uid,
      selected: values,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
    }, { merge: true });
  }

  async getPollVotes(pollId) {
    await this.ensureUser();
    const ref = this.api.collection(this.api.db, "schools", SCHOOL.id, "polls", pollId, "votes");
    return rowsFromSnapshot(await this.api.getDocs(ref));
  }

  async reportSupply(supplyId) {
    const user = await this.ensureUser();
    const reports = localMap(REPORT_KEY);
    if (this.hasReportedSupply(supplyId)) throw new Error("이미 부족하다고 알려주었습니다.");
    const now = Date.now();
    const targetRef = this.api.doc(this.api.db, "schools", SCHOOL.id, "supplyReports", `${supplyId}_${user.uid}`);
    await this.api.setDoc(targetRef, {
      classKey: this.state.classKey,
      supplyId,
      reporterUid: user.uid,
      createdAtMs: now,
      updatedAtMs: now,
    });
    reports[supplyId] = now;
    setLocalMap(REPORT_KEY, reports);
  }

  hasReportedSupply(supplyId) {
    const reportedAtMs = Number(localMap(REPORT_KEY)[supplyId] || 0);
    const supply = this.state.data.supplies.find((item) => item.id === supplyId);
    return reportedAtMs > 0 && reportedAtMs >= Number(supply?.updatedAtMs || 0);
  }

  async borrowSupply(supplyId) {
    await this.ensureUser();
    const supply = this.state.data.supplies.find((item) => item.id === supplyId && !item.deleted);
    if (!supply?.loanable) throw new Error("대여 가능한 공용 물품을 찾지 못했습니다.");
    const active = this.state.data.supplyLoans.find((item) => item.supplyId === supplyId && item.status === "loaned" && !item.deleted);
    if (active) throw new Error("현재 대여 중인 물품입니다.");
    const targetRef = this.api.doc(this.collectionRef("supplyLoans"));
    await this.api.setDoc(targetRef, {
      classKey: this.state.classKey,
      supplyId,
      status: "loaned",
      borrowedAtMs: Date.now(),
      deleted: false,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
      createdAt: this.api.serverTimestamp(),
      updatedAt: this.api.serverTimestamp(),
    });
    return targetRef.id;
  }

  async uploadFile(folder, recordId, file) {
    await this.ensureUser();
    if (!(file instanceof File) || !file.size) return null;
    if (file.size > 10 * 1024 * 1024) throw new Error("파일은 10MB 이하만 올릴 수 있습니다.");
    const extensionTypes = {
      ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
      ".pdf": "application/pdf", ".txt": "text/plain", ".doc": "application/msword",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".ppt": "application/vnd.ms-powerpoint", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
    const extension = String(file.name || "").toLowerCase().match(/\.[^.]+$/)?.[0] || "";
    const contentType = file.type || extensionTypes[extension] || "application/octet-stream";
    const allowed = /^(image\/(jpeg|png|webp|gif)|application\/pdf|text\/plain|application\/msword|application\/vnd\.ms-(powerpoint|excel)|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|presentationml\.presentation|spreadsheetml\.sheet))$/i;
    if (!allowed.test(contentType)) throw new Error("이미지, PDF, 문서 파일만 올릴 수 있습니다.");
    if (folder === "lost-items" && !contentType.startsWith("image/")) throw new Error("분실물 사진은 이미지 파일만 올릴 수 있습니다.");
    const safeName = String(file.name || "file").replace(/[^0-9A-Za-z가-힣._-]+/g, "-").slice(-120);
    const storageRef = this.api.ref(this.api.storage, `class-${folder}/${SCHOOL.id}/${this.state.classKey}/${recordId}/${Date.now()}-${safeName}`);
    const result = await this.api.uploadBytes(storageRef, file, {
      contentType,
      contentDisposition: folder === "resources" ? `attachment; filename="${safeName.replaceAll('"', "")}"` : "inline",
      customMetadata: { classKey: this.state.classKey },
    });
    const fileUrl = folder === "lost-items" ? await this.api.getDownloadURL(result.ref) : "";
    return { fileName: safeName, fileUrl, storagePath: result.ref.fullPath };
  }

  async createResource(values, file = null) {
    await this.ensureUser();
    if (values.rightsConfirmed !== true || values.personalDataRemoved !== true) {
      throw new Error("공유 권한과 개인정보 제거 여부를 모두 확인해 주세요.");
    }
    const targetRef = this.api.doc(this.collectionRef("resources"));
    const upload = file ? await this.uploadFile("resources", targetRef.id, file) : null;
    const url = upload?.storagePath
      ? `${location.origin}${location.pathname}?class-ops=1&class-tab=resources&resource=${encodeURIComponent(targetRef.id)}`
      : safeExternalUrl(values.url);
    if (!url) throw new Error("파일을 선택하거나 올바른 링크를 입력해 주세요.");
    const isPresident = this.state.isPresident;
    const now = Date.now();
    const materialTypes = new Set(WORKSHEET_TYPES.map(([value]) => value));
    const rightsBases = new Set(RIGHTS_BASES.map(([value]) => value));
    if (!materialTypes.has(values.materialType)) throw new Error("자료 유형을 선택해 주세요.");
    if (!rightsBases.has(values.rightsBasis)) throw new Error("자료를 공유할 수 있는 근거를 선택해 주세요.");
    if (["open-license", "official-public"].includes(values.rightsBasis) && !plainText(values.sourceAttribution, 300)) {
      throw new Error("공개 자료의 출처와 라이선스 정보를 입력해 주세요.");
    }
    const schoolYear = Math.max(2000, Math.min(2100, Math.trunc(Number(values.schoolYear || new Date().getFullYear()))));
    const semester = Number(values.semester) === 2 ? 2 : 1;
    const pageCount = Math.max(0, Math.min(999, Math.trunc(Number(values.pageCount || 0))));
    await this.api.setDoc(targetRef, {
      classKey: this.state.classKey,
      category: plainText(values.category, 40),
      subject: plainText(values.subject, 40),
      title: plainText(values.title, 120),
      unit: plainText(values.unit, 80),
      materialType: values.materialType,
      schoolYear,
      semester,
      version: plainText(values.version, 20),
      pageCount,
      sourceAttribution: plainText(values.sourceAttribution, 300),
      description: plainText(values.description, 1200),
      url,
      fileName: upload?.fileName || "",
      storagePath: upload?.storagePath || "",
      rightsBasis: values.rightsBasis,
      rightsConfirmed: true,
      personalDataRemoved: true,
      pinned: isPresident && values.pinned === true,
      moderationStatus: isPresident ? "approved" : "pending",
      deleted: false,
      createdAtMs: now,
      updatedAtMs: now,
      createdAt: this.api.serverTimestamp(),
      updatedAt: this.api.serverTimestamp(),
    });
    return targetRef.id;
  }

  async openResourceFile(storagePath, fileName = "학습지") {
    await this.ensureUser();
    const path = plainText(storagePath, 500);
    if (!path.startsWith(`class-resources/${SCHOOL.id}/${this.state.classKey}/`)) throw new Error("현재 학급의 자료 파일이 아닙니다.");
    const blob = await this.api.getBlob(this.api.ref(this.api.storage, path));
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = plainText(fileName, 120) || "학습지";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  }

  async createLostItem(values, file = null) {
    await this.ensureUser();
    const targetRef = this.api.doc(this.collectionRef("lostItems"));
    const upload = file ? await this.uploadFile("lost-items", targetRef.id, file) : null;
    const now = Date.now();
    await this.api.setDoc(targetRef, {
      classKey: this.state.classKey,
      name: plainText(values.name, 100),
      foundLocation: plainText(values.foundLocation, 120),
      foundDate: plainText(values.foundDate, 10),
      photoUrl: upload?.fileUrl || "",
      storagePath: upload?.storagePath || "",
      status: "stored",
      deleted: false,
      createdAtMs: now,
      updatedAtMs: now,
      createdAt: this.api.serverTimestamp(),
      updatedAt: this.api.serverTimestamp(),
    });
    return targetRef.id;
  }

  async publishPatchNote(draftId, values) {
    this.requirePresident();
    const id = `${this.state.classKey}-${values.month}`;
    await this.adminWrite("patchNotes", {
      ...values,
      status: "published",
      publishedAtMs: Date.now(),
      deleted: false,
    }, { id, action: "publish", label: `${values.month} 학급 패치노트 발행` });
    if (draftId) await this.softDelete("patchNoteDrafts", draftId, `${values.month} 패치노트 초안 정리`);
    return id;
  }

  notificationPreferences() {
    return { ...NOTIFICATION_DEFAULTS, ...safeJsonParse(localStorage.getItem(PREFS_KEY) || "{}", {}) };
  }

  setNotificationPreferences(preferences) {
    const next = { ...NOTIFICATION_DEFAULTS, ...preferences };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch {}
    this.emit();
    return next;
  }

  async updateNotificationPreferences(preferences) {
    const next = this.setNotificationPreferences(preferences);
    const token = localStorage.getItem(PUSH_TOKEN_KEY) || "";
    if (token && this.api && this.state.user) {
      await this.api.setDoc(this.documentRef("pushSubscriptions", token), {
        ownerUid: this.state.user.uid,
        preferences: next,
        appVersion: CLASS_OPS_VERSION,
        updatedAtMs: Date.now(),
      }, { merge: true });
    }
    return next;
  }

  async enableNotifications(preferences = this.notificationPreferences()) {
    const user = await this.ensureUser();
    const storedTokenId = localStorage.getItem(PUSH_TOKEN_KEY) || "";
    if (storedTokenId && globalThis.Notification?.permission === "granted") {
      try {
        await this.api.setDoc(this.documentRef("pushSubscriptions", storedTokenId), {
          ownerUid: user.uid,
          enabled: true,
          preferences: this.setNotificationPreferences(preferences),
          appVersion: CLASS_OPS_VERSION,
          updatedAtMs: Date.now(),
          updatedAt: this.api.serverTimestamp(),
        }, { merge: true });
        return { permission: "granted", token: storedTokenId, reused: true };
      } catch {
        localStorage.removeItem(PUSH_TOKEN_KEY);
      }
    }
    const bundle = await import("./assets/firebase-IW9tbrMW.js");
    const result = await bundle.f.requestPushPermission(this.state.classKey);
    if (!result?.token) throw new Error("알림 기기 등록 결과를 확인하지 못했습니다.");
    localStorage.setItem(PUSH_TOKEN_KEY, result.token);
    await this.api.setDoc(this.documentRef("pushSubscriptions", result.token), {
      ownerUid: user.uid,
      preferences: this.setNotificationPreferences(preferences),
      appVersion: CLASS_OPS_VERSION,
      updatedAtMs: Date.now(),
    }, { merge: true });
    return result;
  }

  close() {
    this.unsubscribers.splice(0).forEach((stop) => stop());
    this.privateUnsubscribers.splice(0).forEach((stop) => stop());
    this.authUnsubscribe?.();
    this.authUnsubscribe = null;
  }
}

export const classOpsRepository = new PinconClassOpsRepository();
export { SCHOOL, classProfile, isPresidentRole };
