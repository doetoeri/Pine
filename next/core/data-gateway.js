import { PinconClassOpsRepository } from "../../pincon-class-ops-data.js";
import { classBrandSettings, validateBrandTagline } from "./brand-settings.js";
import { PERMISSION, canAccess, resolveNextAccess } from "./trust-model.js";
import { TODAY_OPEN_WRITE_CLASS_KEY, TODAY_OPEN_WRITE_UNTIL_MS, todayOpenWriteEligible } from "./today-open-write.js";

const PROFILE_KEY = "pincon-profile-v2";
const GATEWAY_SINGLETON_KEY = Symbol.for("pincon.next.data-gateway");
const MANAGED_COLLECTIONS = new Set(["announcements", "classAssignments", "events"]);

function parseJson(value, fallback = null) {
  try {
    return JSON.parse(value) ?? fallback;
  } catch {
    return fallback;
  }
}

function validProfile(profile) {
  const grade = Number(profile?.grade);
  const classNumber = Number(profile?.classNumber);
  return Number.isInteger(grade)
    && grade >= 1
    && grade <= 3
    && Number.isInteger(classNumber)
    && classNumber >= 1
    && classNumber <= 10;
}

export function readClassProfile() {
  const profile = parseJson(localStorage.getItem(PROFILE_KEY), null);
  if (!validProfile(profile)) return null;
  const grade = Number(profile.grade);
  const classNumber = Number(profile.classNumber);
  return {
    ...profile,
    grade,
    classNumber,
    classKey: `${grade}-${classNumber}`,
  };
}

export function saveClassProfile(grade, classNumber) {
  const next = {
    ...(parseJson(localStorage.getItem(PROFILE_KEY), {}) || {}),
    grade: Number(grade),
    classNumber: Number(classNumber),
    updatedAt: new Date().toISOString(),
  };
  if (!validProfile(next)) throw new Error("학년과 반을 다시 확인해 주세요.");
  localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
  return readClassProfile();
}

function temporaryManagerRole({ user = null, profile = null, now = Date.now() } = {}) {
  if (!todayOpenWriteEligible({ user, profile, now })) return null;
  return {
    enabled: true,
    level: "class",
    classKeys: [profile.classKey],
    temporary: true,
  };
}

function accessFor({ user = null, role = null, profile = null } = {}) {
  const effectiveRole = role?.enabled ? role : (temporaryManagerRole({ user, profile }) || role);
  return resolveNextAccess({
    user,
    legacyRole: effectiveRole,
    classKey: profile?.classKey || "",
  });
}

function serverCompatibleClassOperator({ user = null, role = null, profile = null } = {}) {
  const classKey = profile?.classKey || "";
  if (!user?.uid || !role?.enabled || !classKey) return false;
  if (role.level === "school") return true;
  return ["class", "grade", "president"].includes(role.level)
    && Array.isArray(role.classKeys)
    && role.classKeys.includes(classKey);
}

function cleanString(value, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}

function auditCopy(value = {}) {
  const result = {};
  for (const [key, item] of Object.entries(value || {}).slice(0, 50)) {
    if (key === "id" || key.startsWith("__")) continue;
    if (typeof item === "string") result[key] = item.slice(0, 2000);
    else if (typeof item === "number" || typeof item === "boolean" || item === null) result[key] = item;
    else if (Array.isArray(item)) result[key] = item.slice(0, 40);
  }
  return result;
}

function normalizeManagedValues(collection, values = {}) {
  if (collection === "announcements") {
    const title = cleanString(values.title, 100);
    if (!title) throw new Error("공지 제목을 입력해 주세요.");
    const priority = ["normal", "important", "urgent"].includes(values.priority) ? values.priority : "normal";
    return {
      title,
      body: cleanString(values.body, 1800),
      priority,
      important: priority !== "normal",
    };
  }

  if (collection === "classAssignments") {
    const title = cleanString(values.title, 120);
    const dueDate = cleanString(values.dueDate, 10);
    if (!title) throw new Error("수행·숙제 제목을 입력해 주세요.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error("마감 날짜를 확인해 주세요.");
    const dueAtMs = new Date(`${dueDate}T23:59:00`).getTime();
    if (!Number.isFinite(dueAtMs)) throw new Error("마감 날짜를 확인해 주세요.");
    return {
      type: ["assessment", "exam", "preparation"].includes(values.type) ? values.type : "assessment",
      title,
      subject: cleanString(values.subject, 40),
      dueDate,
      dueAtMs,
      description: cleanString(values.description, 1200),
    };
  }

  if (collection === "events") {
    const title = cleanString(values.title, 120);
    const question = cleanString(values.question, 500);
    if (!title) throw new Error("행사 제목을 입력해 주세요.");
    if (!question) throw new Error("행사 질문 또는 설명을 입력해 주세요.");
    const status = ["draft", "open", "closed"].includes(values.status) ? values.status : "draft";
    return {
      kind: ["survey34", "family-arcade", "quiz", "balance", "class-vote", "survey", "mini-game"].includes(values.kind)
        ? values.kind
        : "survey34",
      title,
      question,
      date: /^\d{4}-\d{2}-\d{2}$/.test(cleanString(values.date, 10)) ? cleanString(values.date, 10) : "",
      status,
      acceptingResponses: status === "open",
      startsAtMs: status === "open" ? Number(values.startsAtMs || Date.now()) : Number(values.startsAtMs || 0),
      resultsVisible: values.resultsVisible === true,
      publishedResults: Array.isArray(values.publishedResults) ? values.publishedResults.slice(0, 40) : [],
    };
  }

  throw new Error("이 데이터 종류는 Next에서 직접 편집할 수 없습니다.");
}

export class NextDataGateway extends EventTarget {
  constructor() {
    super();

    const existing = globalThis[GATEWAY_SINGLETON_KEY];
    if (existing instanceof NextDataGateway) return existing;

    const profile = readClassProfile();
    this.repository = null;
    this.repositoryListener = null;
    this.startPromise = null;
    this.state = {
      ready: false,
      syncing: false,
      online: navigator.onLine,
      profile,
      error: "",
      data: Object.create(null),
      user: null,
      role: null,
      access: accessFor({ profile }),
      isManager: false,
      canEditBrandSettings: false,
      canManageContent: false,
      canArchiveContent: false,
      temporaryOpenWrite: false,
      temporaryOpenWriteClassKey: TODAY_OPEN_WRITE_CLASS_KEY,
      temporaryOpenWriteUntilMs: TODAY_OPEN_WRITE_UNTIL_MS,
      readonly: true,
    };

    globalThis[GATEWAY_SINGLETON_KEY] = this;
  }

  snapshot() {
    return {
      ...this.state,
      data: Object.fromEntries(
        Object.entries(this.state.data || {}).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]),
      ),
    };
  }

  emit() {
    this.dispatchEvent(new CustomEvent("change", { detail: this.snapshot() }));
  }

  applyRepositorySnapshot(snapshot) {
    const profile = snapshot?.profile || readClassProfile();
    const user = snapshot?.user || null;
    const role = snapshot?.role || null;
    const serverClassOperator = serverCompatibleClassOperator({ user, role, profile });
    const temporaryOpenWrite = todayOpenWriteEligible({ user, profile });
    const access = accessFor({ user, role, profile });
    const canManageContent = (serverClassOperator || temporaryOpenWrite)
      && canAccess(access, PERMISSION.CREATE)
      && canAccess(access, PERMISSION.UPDATE);
    this.state = {
      ...this.state,
      ready: Boolean(snapshot?.ready),
      syncing: Boolean(snapshot?.syncing),
      online: snapshot?.online ?? navigator.onLine,
      profile,
      error: snapshot?.lastError || "",
      data: snapshot?.data || Object.create(null),
      user,
      role,
      access,
      isManager: access.role === "manager" || access.role === "system-admin",
      canEditBrandSettings: serverClassOperator,
      canManageContent,
      canArchiveContent: serverClassOperator,
      temporaryOpenWrite,
      readonly: !canManageContent,
    };
    this.emit();
  }

  async start() {
    this.state.profile = readClassProfile();
    this.state.access = accessFor({ profile: this.state.profile });
    if (!this.state.profile) {
      this.state.ready = false;
      this.state.syncing = false;
      this.emit();
      return this.snapshot();
    }

    if (this.repository) return this.startPromise || this.snapshot();

    this.repository = new PinconClassOpsRepository();
    this.repositoryListener = (event) => this.applyRepositorySnapshot(event.detail);
    this.repository.addEventListener("change", this.repositoryListener);

    this.state.syncing = true;
    this.state.error = "";
    this.emit();

    this.startPromise = (async () => {
      try {
        const initial = await this.repository.start();
        this.applyRepositorySnapshot(initial);
      } catch (error) {
        this.state.syncing = false;
        this.state.error = error?.message || "PinCon 데이터를 불러오지 못했습니다.";
        this.emit();
      } finally {
        this.startPromise = null;
      }
      return this.snapshot();
    })();

    return this.startPromise;
  }

  requireManagedWrite(permission = PERMISSION.UPDATE) {
    const temporaryAllowed = this.state.temporaryOpenWrite
      && [PERMISSION.CREATE, PERMISSION.UPDATE].includes(permission);
    const serverAllowed = this.state.canArchiveContent && canAccess(this.state.access, permission);
    if (!this.state.canManageContent || (!temporaryAllowed && !serverAllowed)) {
      throw new Error("이 학급의 공용 데이터를 편집할 권한이 없습니다.");
    }
    if (!this.repository) throw new Error("데이터 연결이 아직 준비되지 않았습니다.");
  }

  async temporaryWriteRecord(collection, values, { id = "", action = "", label = "" } = {}) {
    if (!this.repository) await this.start();
    const user = await this.repository.ensureUser();
    const api = this.repository.api;
    if (!api || !user || !todayOpenWriteEligible({ user, profile: this.state.profile })) {
      throw new Error("오늘 편집 세션이 만료되었거나 인증되지 않았습니다.");
    }

    const now = Date.now();
    const collectionRef = this.repository.collectionRef(collection);
    const targetRef = id ? this.repository.documentRef(collection, id) : api.doc(collectionRef);
    const beforeSnapshot = id ? await api.getDoc(targetRef) : null;
    const before = beforeSnapshot?.exists?.() ? beforeSnapshot.data() : null;
    const next = {
      ...(before || {}),
      ...values,
      classKey: this.state.profile.classKey,
      deleted: values.deleted === true,
      updatedAtMs: now,
      updatedAt: api.serverTimestamp(),
    };
    delete next.id;
    for (const key of Object.keys(next)) if (key.startsWith("__")) delete next[key];
    if (!before) {
      next.createdAtMs = now;
      next.createdAt = api.serverTimestamp();
    }

    const changeRef = api.doc(this.repository.collectionRef("changeLogs"));
    const batch = api.writeBatch(api.db);
    batch.set(targetRef, next, { merge: false });
    batch.set(changeRef, {
      classKey: this.state.profile.classKey,
      collection,
      documentId: targetRef.id,
      action: action || (before ? "update" : "create"),
      label: cleanString(label || next.title || next.name || collection, 120),
      before: before ? auditCopy(before) : null,
      after: auditCopy(next),
      actorUid: user.uid,
      actorName: cleanString(user.displayName || "익명 편집자", 40),
      createdAtMs: now,
      createdAt: api.serverTimestamp(),
    });
    await batch.commit();
    return targetRef.id;
  }

  async managedWrite(collection, values, options = {}) {
    if (this.state.temporaryOpenWrite && !this.state.canArchiveContent) {
      return this.temporaryWriteRecord(collection, values, options);
    }
    return this.repository.adminWrite(collection, values, options);
  }

  async saveManagedRecord(collection, values, { id = "" } = {}) {
    if (!this.repository) await this.start();
    if (!MANAGED_COLLECTIONS.has(collection)) throw new Error("이 데이터 종류는 직접 편집할 수 없습니다.");
    this.requireManagedWrite(id ? PERMISSION.UPDATE : PERMISSION.CREATE);
    const normalized = normalizeManagedValues(collection, values);
    const current = id ? (this.state.data?.[collection] || []).find((item) => item.id === id) : null;
    const label = normalized.title || current?.title || collection;
    return this.managedWrite(
      collection,
      { ...(current || {}), ...normalized, deleted: false, deletedAtMs: null },
      { id, action: current ? "update" : "create", label },
    );
  }

  async archiveManagedRecord(collection, id) {
    if (!this.repository) await this.start();
    if (!MANAGED_COLLECTIONS.has(collection)) throw new Error("이 데이터 종류는 보관할 수 없습니다.");
    if (!this.state.canArchiveContent) throw new Error("오늘 임시 편집에서는 보관·복원은 회장 계정에서만 가능합니다.");
    this.requireManagedWrite(PERMISSION.ARCHIVE);
    const current = (this.state.data?.[collection] || []).find((item) => item.id === id && !item.deleted);
    if (!current) throw new Error("보관할 항목을 찾지 못했습니다.");
    return this.repository.softDelete(collection, id, `${current.title || current.name || collection} 보관`);
  }

  async restoreManagedRecord(collection, id) {
    if (!this.repository) await this.start();
    if (!MANAGED_COLLECTIONS.has(collection)) throw new Error("이 데이터 종류는 복원할 수 없습니다.");
    if (!this.state.canArchiveContent) throw new Error("오늘 임시 편집에서는 보관·복원은 회장 계정에서만 가능합니다.");
    this.requireManagedWrite(PERMISSION.RESTORE);
    const current = (this.state.data?.[collection] || []).find((item) => item.id === id && item.deleted === true);
    if (!current) throw new Error("복원할 항목을 찾지 못했습니다.");
    return this.repository.adminWrite(
      collection,
      { ...current, deleted: false, deletedAtMs: null },
      { id, action: "restore", label: `${current.title || current.name || collection} 복원` },
    );
  }

  async updateBrandTagline(value) {
    const tagline = validateBrandTagline(value);
    if (!this.repository) await this.start();

    const profile = this.state.profile || readClassProfile();
    if (!profile?.classKey || !this.state.canEditBrandSettings) {
      throw new Error("이 학급의 PinCon 문구를 수정할 권한이 없습니다.");
    }

    const current = classBrandSettings(this.state.data, profile.classKey);
    await this.repository.adminWrite(
      "classSettings",
      {
        ...(current || {}),
        brandTagline: tagline,
        deleted: false,
      },
      {
        id: profile.classKey,
        action: current ? "update" : "create",
        label: `PinCon 작은 문구 · ${tagline || "숨김"}`,
      },
    );
    return tagline;
  }

  dispose() {
    if (this.repository && this.repositoryListener) {
      this.repository.removeEventListener("change", this.repositoryListener);
    }
    this.repository = null;
    this.repositoryListener = null;
    this.startPromise = null;
  }
}
