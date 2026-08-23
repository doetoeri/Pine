import { PinconClassOpsRepository } from "../../pincon-class-ops-data.js";
import { classBrandSettings, validateBrandTagline } from "./brand-settings.js";
import { resolveNextAccess } from "./trust-model.js";

const PROFILE_KEY = "pincon-profile-v2";
const GATEWAY_SINGLETON_KEY = Symbol.for("pincon.next.data-gateway");

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

function accessFor({ user = null, role = null, profile = null } = {}) {
  return resolveNextAccess({
    user,
    legacyRole: role,
    classKey: profile?.classKey || "",
  });
}

function canEditExistingClassSettings({ user = null, role = null, profile = null } = {}) {
  const classKey = profile?.classKey || "";
  if (!user?.uid || !role?.enabled || !classKey) return false;
  if (role.level === "school") return true;
  return ["class", "grade", "president"].includes(role.level)
    && Array.isArray(role.classKeys)
    && role.classKeys.includes(classKey);
}

export class NextDataGateway extends EventTarget {
  constructor() {
    super();

    // PinCon Next must have exactly one live repository subscription per page.
    // app.js and enhancement modules may request a gateway independently, but they
    // all receive this same instance instead of creating duplicate Firestore listeners.
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
    const access = accessFor({ user, role, profile });
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
      canEditBrandSettings: canEditExistingClassSettings({ user, role, profile }),
      readonly: true,
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
