import {
  EXPERIMENT_SCHEMA_VERSION,
  EXPERIMENT_STATUS,
  NOTIFICATION_EXPERIMENT_ID,
  NOTIFICATION_FLAG_ID,
  STABLE_UI_VARIANT,
  UI_EXPERIMENT_ID,
  UI_FLAG_ID,
  experimentIsRunning,
} from "./constants.js";
import {
  crossoverSequenceFor,
  deterministicBucket,
  notificationConditionFor,
  resolveUiVariant,
} from "./assignment-service.js";
import { ExperimentAnalytics } from "./analytics.js";
import { addDays, balancedSequences, dateKey, isCareerStudy, validateStudyConfig } from "./notification-study.js";
import { studyAccess } from "./study-access.js";

const FIREBASE = globalThis.PINCON_FIREBASE_CONFIG || {};
const SCHOOL = globalThis.PINCON_SCHOOL_CONFIG || { id: "gochon-high", name: "학교" };
const SDK = "12.16.0";
const CACHE_PREFIX = "pincon-experiment-context-v1";
const PARTICIPANT_PREFIX = "pincon-experiment-participant-v1";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let apiPromise = null;

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

function randomParticipant() {
  const token = crypto.randomUUID
    ? crypto.randomUUID().replaceAll("-", "")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `participant_${token.slice(0, 24)}`;
}

function contextCacheKey(uid) {
  return `${CACHE_PREFIX}:${uid || "signed-out"}`;
}

function participantCacheKey(uid) {
  return `${PARTICIPANT_PREFIX}:${uid}`;
}

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}

function safeCachedContext(uid) {
  const cached = readJson(contextCacheKey(uid));
  if (!cached || Date.now() - Number(cached.cachedAtMs || 0) > CACHE_MAX_AGE_MS) return null;
  return cached.context || null;
}

async function ownParticipant(api, user) {
  const local = localStorage.getItem(participantCacheKey(user.uid));
  const ref = api.doc(api.db, "schools", SCHOOL.id, "experimentParticipants", user.uid);
  try {
    const snap = await api.getDoc(ref);
    if (snap.exists()) {
      const participant = String(snap.data()?.anonymousParticipant || "");
      if (participant.startsWith("participant_")) {
        localStorage.setItem(participantCacheKey(user.uid), participant);
        return participant;
      }
    }
  } catch {
    if (local?.startsWith("participant_")) return local;
    throw new Error("participant lookup failed");
  }

  const participant = local?.startsWith("participant_") ? local : randomParticipant();
  try {
    await api.setDoc(ref, {
      schemaVersion: EXPERIMENT_SCHEMA_VERSION,
      anonymousParticipant: participant,
      createdAtMs: Date.now(),
    }, { merge: false });
    localStorage.setItem(participantCacheKey(user.uid), participant);
    return participant;
  } catch {
    const retry = await api.getDoc(ref).catch(() => null);
    const existing = retry?.exists?.() ? String(retry.data()?.anonymousParticipant || "") : "";
    if (existing.startsWith("participant_")) {
      localStorage.setItem(participantCacheKey(user.uid), existing);
      return existing;
    }
    throw new Error("participant creation failed");
  }
}

function uiCohort(source = "", status = "") {
  const value = String(source || "");
  if (value === "public-beta") return "public-beta";
  if (value === "target:canary") return "canary";
  if (value === "rollout") return "rollout";
  if (String(status || "") === EXPERIMENT_STATUS.ACTIVE || value === "sticky" || value === "sticky-race" || value === "deterministic") return "controlled";
  return "stable";
}

async function readOptional(api, ...segments) {
  try {
    const snap = await api.getDoc(api.doc(api.db, ...segments));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch {
    return null;
  }
}

export class ExperimentPlatform {
  constructor() {
    this.api = null;
    this.user = null;
    this.context = null;
    this.uiContext = null;
    this.notificationContext = null;
    this.analytics = new ExperimentAnalytics({
      contextProvider: () => this.context,
      transport: (rows) => this.writeEventBatch(rows),
    });
  }

  async start() {
    this.api = await firebaseApi();
    await this.api.auth.authStateReady?.();
    this.user = this.api.auth.currentUser;
    if (!this.user || this.user.isAnonymous) {
      this.notificationContext = null;
      this.uiContext = null;
      this.context = {
        experimentId: UI_EXPERIMENT_ID,
        experimentVersion: 0,
        variant: STABLE_UI_VARIANT,
        anonymousParticipant: "",
        status: EXPERIMENT_STATUS.DRAFT,
        source: "signed-out",
      };
      return this.context;
    }

    try {
      const participant = await ownParticipant(this.api, this.user);
      const uiContext = await this.loadUiContext(participant);
      const notificationContext = await this.loadNotificationContext(participant);
      this.uiContext = uiContext;
      this.notificationContext = notificationContext;

      this.context = experimentIsRunning(uiContext.status)
        ? uiContext
        : experimentIsRunning(notificationContext.status)
          ? notificationContext
          : uiContext;

      localStorage.setItem(contextCacheKey(this.user.uid), JSON.stringify({
        cachedAtMs: Date.now(),
        context: this.context,
      }));
    } catch {
      this.context = safeCachedContext(this.user.uid) || {
        experimentId: UI_EXPERIMENT_ID,
        experimentVersion: 0,
        variant: STABLE_UI_VARIANT,
        anonymousParticipant: localStorage.getItem(participantCacheKey(this.user.uid)) || "",
        status: EXPERIMENT_STATUS.PAUSED,
        source: "failsafe",
      };
    }

    return this.context;
  }

  async loadUiContext(participant) {
    const api = this.api;
    const uid = this.user.uid;
    const [config, flag, target, assignment, betaEnrollment] = await Promise.all([
      readOptional(api, "schools", SCHOOL.id, "experiments", UI_EXPERIMENT_ID),
      readOptional(api, "schools", SCHOOL.id, "experimentFlags", UI_FLAG_ID),
      readOptional(api, "schools", SCHOOL.id, "experiments", UI_EXPERIMENT_ID, "targets", uid),
      readOptional(api, "schools", SCHOOL.id, "experiments", UI_EXPERIMENT_ID, "assignments", uid),
      readOptional(api, "schools", SCHOOL.id, "experiments", UI_EXPERIMENT_ID, "betaEnrollments", uid),
    ]);

    if (!config) {
      return {
        experimentId: UI_EXPERIMENT_ID,
        experimentVersion: 0,
        variant: STABLE_UI_VARIANT,
        anonymousParticipant: participant,
        status: EXPERIMENT_STATUS.DRAFT,
        source: "no-config",
      };
    }

    const resolved = resolveUiVariant({ config, flag, target, assignment, betaEnrollment, uid });
    if (resolved.needsAssignment) {
      const assignmentRef = api.doc(
        api.db,
        "schools", SCHOOL.id,
        "experiments", UI_EXPERIMENT_ID,
        "assignments", uid,
      );
      try {
        await api.setDoc(assignmentRef, {
          schemaVersion: EXPERIMENT_SCHEMA_VERSION,
          variant: resolved.variant,
          bucket: resolved.bucket,
          assignedAtMs: Date.now(),
          experimentVersion: Number(config.version || 1),
          anonymousParticipant: participant,
          assignmentSource: "controlled",
        }, { merge: false });
      } catch {
        const sticky = await readOptional(
          api,
          "schools", SCHOOL.id,
          "experiments", UI_EXPERIMENT_ID,
          "assignments", uid,
        );
        if (!sticky?.variant) {
          return {
            experimentId: UI_EXPERIMENT_ID,
            experimentVersion: Number(config.version || 1),
            variant: config.stableVariant || STABLE_UI_VARIANT,
            anonymousParticipant: participant,
            status: config.status,
            source: "assignment-failsafe",
          };
        }
        resolved.variant = sticky.variant;
        resolved.source = "sticky-race";
      }
    }

    return {
      experimentId: UI_EXPERIMENT_ID,
      experimentVersion: Number(config.version || 1),
      variant: resolved.variant,
      anonymousParticipant: participant,
      status: String(config.status || EXPERIMENT_STATUS.DRAFT),
      source: resolved.source,
      cohort: uiCohort(resolved.source, config.status),
      rolloutPercent: Number(config.rolloutPercent || 0),
      publicBetaAvailable: String(config.status || "") === EXPERIMENT_STATUS.CANARY && config.publicBetaEnabled === true,
      publicBetaJoined: betaEnrollment?.enabled === true,
    };
  }

  async loadNotificationContext(participant) {
    const api = this.api;
    const uid = this.user.uid;
    const [config, flag, assignment, preference] = await Promise.all([
      readOptional(api, "schools", SCHOOL.id, "experiments", NOTIFICATION_EXPERIMENT_ID),
      readOptional(api, "schools", SCHOOL.id, "experimentFlags", NOTIFICATION_FLAG_ID),
      readOptional(api, "schools", SCHOOL.id, "experiments", NOTIFICATION_EXPERIMENT_ID, "assignments", uid),
      readOptional(api, "schools", SCHOOL.id, "notificationExperimentPreferences", uid),
    ]);

    // v3 membership is the immutable administrator/server-created assignment.
    // Account profiles remain behind the existing authenticated account API.
    const inScope = !isCareerStudy(config) || Number(assignment?.experimentVersion) === Number(config?.version);
    if (!config || !inScope || (!isCareerStudy(config) && flag?.enabled !== true && config.status !== "COMPLETED")) {
      return {
        experimentId: NOTIFICATION_EXPERIMENT_ID,
        experimentVersion: Number(config?.version || 0),
        variant: "",
        anonymousParticipant: participant,
        status: EXPERIMENT_STATUS.DRAFT,
        source: "inactive",
      };
    }

    let effectiveAssignment = assignment;
    const matchingAssignment = Number(assignment?.experimentVersion) === Number(config.version);
    if (isCareerStudy(config) && !matchingAssignment) {
      return { experimentId: NOTIFICATION_EXPERIMENT_ID, experimentVersion: Number(config.version),
        anonymousParticipant: participant, status: "DRAFT", variant: "", source: "awaiting-roster" };
    }
    if (experimentIsRunning(config.status) && !assignment && !isCareerStudy(config)) {
      const generated = crossoverSequenceFor(uid, NOTIFICATION_EXPERIMENT_ID, Number(config.version || 1));
      const ref = api.doc(
        api.db,
        "schools", SCHOOL.id,
        "experiments", NOTIFICATION_EXPERIMENT_ID,
        "assignments", uid,
      );
      const record = {
        schemaVersion: EXPERIMENT_SCHEMA_VERSION,
        sequence: generated.sequence,
        sequenceIndex: generated.index,
        assignedAtMs: Date.now(),
        experimentVersion: Number(config.version || 1),
        anonymousParticipant: participant,
        assignmentSource: "crossover",
      };
      try {
        await api.setDoc(ref, record, { merge: false });
        effectiveAssignment = record;
      } catch {
        effectiveAssignment = await readOptional(
          api,
          "schools", SCHOOL.id,
          "experiments", NOTIFICATION_EXPERIMENT_ID,
          "assignments", uid,
        );
      }
    }

    const period = notificationConditionFor({
      assignment: effectiveAssignment,
      config,
      now: new Date(),
    });

    return {
      experimentId: NOTIFICATION_EXPERIMENT_ID,
      experimentVersion: Number(config.version || 1),
      variant: period.condition || period.phase,
      condition: period.condition,
      period: period.period,
      periodDay: period.periodDay,
      periodDays: Math.max(1, Number(config.periodDays || 4)),
      phase: period.phase,
      anonymousParticipant: participant,
      status: preference?.enabled === false ? "PAUSED"
        : flag?.enabled !== true && config.status === "ACTIVE" ? "PAUSED" : String(config.status || EXPERIMENT_STATUS.DRAFT),
      source: "crossover",
      cohort: "notification",
      studyMode: config.studyMode || "",
      sequence: effectiveAssignment?.sequence || [],
      config,
    };
  }

  log(eventType, properties = {}, options = {}) {
    return this.analytics.log(eventType, properties, options);
  }

  async writeEventBatch(rows) {
    if (!this.api || !this.user || !rows.length) return;
    const batch = this.api.writeBatch(this.api.db);
    for (const row of rows) {
      const ref = this.api.doc(
        this.api.db,
        "schools", SCHOOL.id,
        "experimentEvents", row.eventId,
      );
      batch.set(ref, row, { merge: false });
    }
    await batch.commit();
  }

  async setPublicBetaEnrollment(enabled) {
    if (!this.user) throw new Error("로그인이 필요합니다.");
    const config = await readOptional(this.api, "schools", SCHOOL.id, "experiments", UI_EXPERIMENT_ID);
    if (enabled && (
      !config
      || String(config.status || "") !== EXPERIMENT_STATUS.CANARY
      || config.publicBetaEnabled !== true
    )) {
      throw new Error("현재 공개 베타 참여를 받고 있지 않습니다.");
    }
    const ref = this.api.doc(
      this.api.db,
      "schools", SCHOOL.id,
      "experiments", UI_EXPERIMENT_ID,
      "betaEnrollments", this.user.uid,
    );
    const previous = await this.api.getDoc(ref).catch(() => null);
    const previousData = previous?.exists?.() ? previous.data() : null;
    await this.api.setDoc(ref, {
      schemaVersion: EXPERIMENT_SCHEMA_VERSION,
      enabled: Boolean(enabled),
      experimentVersion: Number(config?.version || previousData?.experimentVersion || 1),
      joinedAtMs: Number(previousData?.joinedAtMs || Date.now()),
      updatedAtMs: Date.now(),
    }, { merge: false });
    localStorage.removeItem(contextCacheKey(this.user.uid));
    return { enabled: Boolean(enabled) };
  }

  async saveNotificationSurvey({
    period,
    condition,
    usefulnessScore,
    annoyanceScore,
    increasedUseScore,
    continueScore,
    preferredDailyCount,
    experimentVersion,
  }) {
    if (!this.user || !this.notificationContext?.anonymousParticipant) {
      throw new Error("알림 실험이 활성화되어 있지 않습니다.");
    }
    const ctx = this.notificationContext;
    const version = Number(experimentVersion || ctx.experimentVersion);
    if (version !== Number(ctx.experimentVersion) || ![1, 2, 3].includes(Number(period))) throw new Error("설문 기간을 다시 확인해 주세요.");
    if (ctx.studyMode && ctx.sequence?.[Number(period) - 1] !== condition) throw new Error("배정 조건과 설문이 일치하지 않습니다.");
    if (![usefulnessScore, annoyanceScore, increasedUseScore, continueScore].every((n) => Number.isInteger(Number(n)) && Number(n) >= 1 && Number(n) <= 5)
      || !["0", "1", "2", "3", "4", "5+"].includes(String(preferredDailyCount))) throw new Error("설문의 모든 항목을 선택해 주세요.");
    const surveyId = ctx.studyMode ? `v${version}-period-${Number(period)}` : `period-${Number(period)}`;
    const ref = this.api.doc(
      this.api.db,
      "schools", SCHOOL.id,
      "experiments", NOTIFICATION_EXPERIMENT_ID,
      "participants", this.user.uid,
      "surveyResponses", surveyId,
    );
    await this.api.setDoc(ref, {
      schemaVersion: EXPERIMENT_SCHEMA_VERSION,
      anonymousParticipant: ctx.anonymousParticipant,
      ...(ctx.studyMode ? { experimentVersion: version } : {}),
      period: Number(period),
      condition: String(condition || ""),
      usefulnessScore: Number(usefulnessScore),
      annoyanceScore: Number(annoyanceScore),
      increasedUseScore: Number(increasedUseScore),
      continueScore: Number(continueScore),
      preferredDailyCount: String(preferredDailyCount),
      submittedAtMs: Date.now(),
    }, { merge: false });
  }

  async ownNotificationSurveys() {
    if (!this.user || this.user.isAnonymous) return [];
    const snapshot = await this.api.getDocs(this.api.collection(this.api.db, "schools", SCHOOL.id,
      "experiments", NOTIFICATION_EXPERIMENT_ID, "participants", this.user.uid, "surveyResponses"));
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  async adminStudyRoster() {
    const request = this.accountTransport || (await import("../core/student-auth.js")).accountRequest;
    const result = await request("/api/accounts/manage");
    return (result.accounts || []).filter((account) => account.uid && account.status === "ACTIVE");
  }

  async notificationStudyAccess() {
    if (!this.user || this.user.isAnonymous) return studyAccess(this.user);
    const [role, config] = await Promise.all([
      this.api.getDoc(this.api.doc(this.api.db, "schools", SCHOOL.id, "roles", this.user.uid)),
      this.api.getDoc(this.api.doc(this.api.db, "schools", SCHOOL.id, "experiments", NOTIFICATION_EXPERIMENT_ID)),
    ]);
    return studyAccess(this.user, role.exists() ? role.data() : null, config.exists() ? config.data() : null);
  }

  async adminReadNotificationStudy(access = { schoolAdmin: true }) {
    const api = this.api, base = ["schools", SCHOOL.id], experiment = [...base, "experiments", NOTIFICATION_EXPERIMENT_ID];
    const configSnap = await api.getDoc(api.doc(api.db, ...experiment));
    const config = configSnap.exists() ? { id: configSnap.id, ...configSnap.data() } : null;
    let truncated = false;
    const collect = async (path, constraints = []) => {
      const rows = []; let cursor = null;
      for (let page = 0; page < 40; page++) {
        const snap = await api.getDocs(api.query(api.collection(api.db, ...path), ...constraints,
          ...(cursor ? [api.startAfter(cursor)] : []), api.limit(500)));
        rows.push(...snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
        if (snap.size < 500) return rows;
        cursor = snap.docs.at(-1);
      }
      truncated = true;
      return rows;
    };
    const versionFilter = [api.where("experimentVersion", "==", Number(config?.version || 0))];
    const eventFilter = [...versionFilter, api.where("experimentId", "==", NOTIFICATION_EXPERIMENT_ID)];
    const deviceFilter = access.schoolAdmin ? [] : [api.where("classKey", "in", access.classKeys)];
    const [assignments, events, receipts, devices, runtimeSnap, flagSnap, uiSnap, history, notesSnap] = await Promise.all([
      collect([...experiment, "assignments"], versionFilter), collect([...base, "experimentEvents"], eventFilter),
      collect([...base, "notificationExperimentReceipts"], eventFilter), collect([...base, "notificationStudyDevices"], deviceFilter),
      api.getDoc(api.doc(api.db, ...base, "experimentRuntime", NOTIFICATION_EXPERIMENT_ID)),
      api.getDoc(api.doc(api.db, ...base, "experimentFlags", NOTIFICATION_FLAG_ID)),
      api.getDoc(api.doc(api.db, ...base, "experiments", UI_EXPERIMENT_ID)),
      access.schoolAdmin ? collect([...experiment, "runs"]) : Promise.resolve([]),
      api.getDoc(api.doc(api.db, ...experiment, "researchNotes", `v${config?.version || 0}`)),
    ]);
    const surveys = (await Promise.all(assignments.filter((row) => row.experimentVersion === config?.version).map((assignment) =>
      collect([...experiment, "participants", assignment.id, "surveyResponses"], versionFilter)))).flat();
    return { config, assignments, events: events.filter((row) => row.experimentId === NOTIFICATION_EXPERIMENT_ID), receipts,
      surveys, devices, runtime: runtimeSnap.exists() ? runtimeSnap.data() : null,
      flag: flagSnap.exists() ? flagSnap.data() : null, ui: uiSnap.exists() ? uiSnap.data() : null,
      history, notes: notesSnap.exists() ? notesSnap.data() : {}, truncated, loadedAtMs: Date.now() };
  }

  async adminSaveStudyNotes(values, expectedVersion) {
    const notes = {};
    for (const key of ["hypothesis", "sources", "observations", "recommendation", "limitations"]) notes[key] = String(values[key] || "").slice(0, 6000);
    const api = this.api;
    return api.runTransaction(api.db, async (tx) => {
      const ref = api.doc(api.db, "schools", SCHOOL.id, "experiments", NOTIFICATION_EXPERIMENT_ID);
      const snap = await tx.get(ref);
      if (snap.data()?.version !== Number(expectedVersion)) throw new Error("실험 버전이 바뀌었습니다. 새로고침해 주세요.");
      tx.set(api.doc(api.db, "schools", SCHOOL.id, "experiments", NOTIFICATION_EXPERIMENT_ID,
        "researchNotes", `v${expectedVersion}`), { ...notes, updatedAtMs: Date.now(), updatedBy: this.user.uid });
      return notes;
    });
  }

  async adminPrepareNotificationStudy(draft, roster, expectedVersion) {
    validateStudyConfig(draft);
    const api = this.api, base = ["schools", SCHOOL.id], path = [...base, "experiments", NOTIFICATION_EXPERIMENT_ID];
    const ref = api.doc(api.db, ...path);
    const currentSnap = await api.getDoc(ref), current = currentSnap.exists() ? currentSnap.data() : null;
    if (Number(current?.version || 0) !== Number(expectedVersion || 0)) throw new Error("다른 창에서 설정이 바뀌었습니다. 새로고침해 주세요.");
    if (current?.status === "ACTIVE") throw new Error("먼저 진행 중인 실험을 일시정지해 주세요.");
    const accounts = roster.filter((row) => row.uid && row.status === "ACTIVE" && draft.targetClassKeys.includes(row.classKey));
    if (!accounts.length || accounts.length > 400) throw new Error("대상 학급의 활성 계정이 1~400개여야 합니다.");
    const version = Math.max(3, Number(current?.version || 0) + 1), seed = crypto.randomUUID();
    const proposals = balancedSequences(accounts.map((row) => row.uid), seed);
    const participants = new Map();
    // Create-only participant transactions also handle a student opening PinCon
    // at the same time. Existing anonymous identities are never replaced.
    for (let i = 0; i < accounts.length; i += 8) {
      await Promise.all(accounts.slice(i, i + 8).map(async ({ uid }) => {
        const participantRef = api.doc(api.db, ...base, "experimentParticipants", uid);
        const anonymousParticipant = await api.runTransaction(api.db, async (tx) => {
          const snap = await tx.get(participantRef);
          if (snap.exists()) return snap.data().anonymousParticipant;
          const participant = randomParticipant();
          tx.set(participantRef, { schemaVersion: 1, anonymousParticipant: participant, createdAtMs: Date.now() });
          return participant;
        });
        participants.set(uid, anonymousParticipant);
      }));
    }
    const previousAssignments = await api.getDocs(api.query(api.collection(api.db, ...path, "assignments"),
      api.where("experimentVersion", "==", Number(current?.version || 0))));
    const config = { ...draft, version, status: "DRAFT", assignmentSeed: seed, activeStartedAtMs: 0,
      enrollmentReady: false, createdAtMs: Date.now(), updatedAtMs: Date.now(), updatedBy: this.user.uid, participantCount: accounts.length };
    await api.runTransaction(api.db, async (tx) => {
      const latest = await tx.get(ref);
      if (Number(latest.data()?.version || 0) !== Number(expectedVersion || 0) || latest.data()?.status === "ACTIVE") throw new Error("다른 창에서 실험 설정이 바뀌었습니다. 새로고침해 주세요.");
      if (current) tx.set(api.doc(api.db, ...path, "runs", `v${current.version}`), {
        config: current, assignments: previousAssignments.docs.map((doc) => ({ id: doc.id, ...doc.data() })), archivedAtMs: Date.now() });
      tx.set(ref, config);
      tx.set(api.doc(api.db, ...base, "experimentFlags", NOTIFICATION_FLAG_ID), {
        enabled: false, rolloutPercent: 0, experimentId: NOTIFICATION_EXPERIMENT_ID, stableVariant: "next", updatedAtMs: Date.now(), updatedBy: this.user.uid });
    });
    // Scoped roles require more rule evaluation than school roles. Small
    // transactions stay within Firestore's rule budget. A draft cannot start
    // until every assignment has committed and the final readiness flag is set.
    for (const account of accounts) {
      await api.runTransaction(api.db, async (tx) => {
        const latest = await tx.get(ref);
        if (latest.data()?.version !== version || latest.data()?.status !== "DRAFT") throw new Error("배정 중 설계가 바뀌었습니다. 새로고침해 주세요.");
        const proposal = proposals.get(account.uid);
        tx.set(api.doc(api.db, ...path, "assignments", account.uid), { schemaVersion: 1, sequence: proposal.sequence,
          sequenceIndex: proposal.index, assignedAtMs: Date.now(), experimentVersion: version,
          anonymousParticipant: participants.get(account.uid), assignmentSource: "crossover" });
      });
    }
    await api.runTransaction(api.db, async (tx) => {
      const latest = await tx.get(ref);
      if (latest.data()?.version !== version || latest.data()?.status !== "DRAFT") throw new Error("배정 중 설계가 바뀌었습니다. 새로고침해 주세요.");
      tx.set(ref, { enrollmentReady: true }, { merge: true });
    });
    return { ...config, enrollmentReady: true };
  }

  async adminSetNotificationStudyState(status, expectedVersion) {
    if (!["ACTIVE", "PAUSED", "COMPLETED"].includes(status)) throw new Error("지원하지 않는 상태입니다.");
    const api = this.api, base = ["schools", SCHOOL.id];
    const ref = api.doc(api.db, ...base, "experiments", NOTIFICATION_EXPERIMENT_ID);
    return api.runTransaction(api.db, async (tx) => {
      const [snap, uiSnap] = await Promise.all([tx.get(ref), tx.get(api.doc(api.db, ...base, "experiments", UI_EXPERIMENT_ID))]);
      const config = snap.data();
      if (!isCareerStudy(config) || config.version !== Number(expectedVersion)) throw new Error("설계를 먼저 저장하거나 새로고침해 주세요.");
      if (config.status === "COMPLETED") throw new Error("종료된 실험입니다. 새 버전으로 설계를 저장해 주세요.");
      if (status === "ACTIVE" && config.enrollmentReady === false) throw new Error("참여자 배정이 완료되지 않았어요. 설계를 다시 저장해 주세요.");
      if (status === "ACTIVE" && ["CANARY", "ACTIVE", "ROLLOUT"].includes(uiSnap.data()?.status)) throw new Error("기존 UI 실험을 먼저 일시정지해 주세요.");
      if (status === config.status) return config;
      const now = Date.now(), today = dateKey(new Date(now));
      const patch = { status, updatedAtMs: now, updatedBy: this.user.uid };
      if (status === "PAUSED") patch.pausedAtMs = now;
      if (status === "COMPLETED") patch.endedAtMs = now;
      if (status === "ACTIVE") {
        patch.excludedDates = [...(config.excludedDates || [])];
        if (!config.activeStartedAtMs) {
          patch.activeStartedAtMs = now;
          patch.startDate = config.startDate < today ? today : config.startDate;
          // Starting after the morning slot cannot produce a full 3-dose day.
          if (config.baselineDays === 0 && patch.startDate === today && new Date(now + 9 * 3_600_000).getUTCHours() >= 8) patch.excludedDates.push(today);
        } else if (config.pausedAtMs) {
          for (let date = dateKey(new Date(config.pausedAtMs)), n = 0; date <= today && n < 730; date = addDays(date, 1), n++) patch.excludedDates.push(date);
        }
        patch.excludedDates = [...new Set(patch.excludedDates)].sort();
        patch.pausedAtMs = 0;
      }
      tx.set(ref, patch, { merge: true });
      tx.set(api.doc(api.db, ...base, "experimentFlags", NOTIFICATION_FLAG_ID), {
        enabled: status === "ACTIVE", rolloutPercent: status === "ACTIVE" ? 100 : 0,
        experimentId: NOTIFICATION_EXPERIMENT_ID, stableVariant: "next", updatedAtMs: now, updatedBy: this.user.uid });
      return { ...config, ...patch };
    });
  }

  async adminReadExperiment(experimentId) {
    const uiExperiment = experimentId === UI_EXPERIMENT_ID;
    const [configSnap, assignmentsSnap, eventsSnap, participantsSnap, betaSnap, receiptsSnap] = await Promise.all([
      this.api.getDoc(this.api.doc(this.api.db, "schools", SCHOOL.id, "experiments", experimentId)),
      this.api.getDocs(this.api.collection(this.api.db, "schools", SCHOOL.id, "experiments", experimentId, "assignments")),
      this.api.getDocs(this.api.query(
        this.api.collection(this.api.db, "schools", SCHOOL.id, "experimentEvents"),
        this.api.orderBy("timestampMs", "desc"),
        this.api.limit(5000),
      )),
      uiExperiment
        ? this.api.getDocs(this.api.collection(this.api.db, "schools", SCHOOL.id, "experimentParticipants"))
        : Promise.resolve(null),
      uiExperiment
        ? this.api.getDocs(this.api.collection(this.api.db, "schools", SCHOOL.id, "experiments", UI_EXPERIMENT_ID, "betaEnrollments"))
        : Promise.resolve(null),
      experimentId === NOTIFICATION_EXPERIMENT_ID
        ? this.api.getDocs(this.api.query(
          this.api.collection(this.api.db, "schools", SCHOOL.id, "notificationExperimentReceipts"),
          this.api.orderBy("scheduledAtMs", "desc"),
          this.api.limit(1200),
        ))
        : Promise.resolve(null),
    ]);
    const assignments = assignmentsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const events = eventsSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((row) => row.experimentId === experimentId)
      .slice(0, 3000);
    const participants = participantsSnap?.docs?.map((doc) => ({ uid: doc.id, ...doc.data() })) || [];
    const betaEnrollments = betaSnap?.docs?.map((doc) => ({ uid: doc.id, ...doc.data() })) || [];
    const surveys = [];
    if (experimentId === NOTIFICATION_EXPERIMENT_ID) {
      await Promise.all(assignments.map(async (assignment) => {
        const snap = await this.api.getDocs(this.api.collection(
          this.api.db,
          "schools", SCHOOL.id,
          "experiments", NOTIFICATION_EXPERIMENT_ID,
          "participants", assignment.id,
          "surveyResponses",
        )).catch(() => null);
        snap?.docs?.forEach((doc) => surveys.push({ id: doc.id, ...doc.data() }));
      }));
    }
    return {
      config: configSnap.exists() ? { id: configSnap.id, ...configSnap.data() } : null,
      assignments,
      events,
      participants,
      betaEnrollments,
      surveys,
      receipts: receiptsSnap?.docs?.map((doc) => ({ id: doc.id, ...doc.data() })) || [],
    };
  }

  async adminBalanceUiAssignments(rosterUids = []) {
    const experimentId = UI_EXPERIMENT_ID;
    const configSnap = await this.api.getDoc(
      this.api.doc(this.api.db, "schools", SCHOOL.id, "experiments", experimentId),
    );
    if (!configSnap.exists()) throw new Error("UI 실험 설정을 먼저 생성해야 합니다.");
    const config = { id: configSnap.id, ...configSnap.data() };
    if ([EXPERIMENT_STATUS.ACTIVE, EXPERIMENT_STATUS.ROLLOUT, EXPERIMENT_STATUS.COMPLETED].includes(String(config.status || ""))) {
      throw new Error("정식 A/B 시작 후에는 배정을 다시 섞을 수 없습니다.");
    }

    const uids = [...new Set((Array.isArray(rosterUids) ? rosterUids : [])
      .map((uid) => String(uid || "").trim())
      .filter((uid) => /^[A-Za-z0-9_-]{6,160}$/.test(uid)))];
    if (!uids.length) throw new Error("배정할 활성 학생 계정이 없습니다.");

    const participantsSnap = await this.api.getDocs(
      this.api.collection(this.api.db, "schools", SCHOOL.id, "experimentParticipants"),
    );
    const participants = new Map(participantsSnap.docs.map((doc) => [doc.id, doc.data()]));
    const version = Number(config.version || 1);
    const ranked = uids
      .map((uid) => ({
        uid,
        bucket: deterministicBucket(`${uid}:${experimentId}:v${version}`, 10_000),
      }))
      .sort((a, b) => a.bucket - b.bucket || a.uid.localeCompare(b.uid));
    const nextCount = Math.floor(ranked.length / 2);
    const batch = this.api.writeBatch(this.api.db);
    const assignedAtMs = Date.now();
    let nextCreated = 0;
    let legacyCreated = 0;

    ranked.forEach((item, index) => {
      const variant = index < nextCount ? "next" : "legacy";
      if (variant === "next") nextCreated += 1;
      else legacyCreated += 1;
      const participant = String(participants.get(item.uid)?.anonymousParticipant || "");
      batch.set(
        this.api.doc(this.api.db, "schools", SCHOOL.id, "experiments", experimentId, "assignments", item.uid),
        {
          schemaVersion: EXPERIMENT_SCHEMA_VERSION,
          variant,
          bucket: item.bucket,
          assignedAtMs,
          experimentVersion: version,
          anonymousParticipant: participant,
          assignmentSource: "controlled",
        },
        { merge: false },
      );
    });
    await batch.commit();
    return {
      roster: ranked.length,
      assigned: ranked.length,
      nextCreated,
      legacyCreated,
      activated: ranked.filter((item) => participants.has(item.uid)).length,
    };
  }

  async notificationExperimentEnabled() {
    if (!this.api) await this.start();
    if (!this.user) throw new Error("실험 알림 설정을 변경하려면 로그인이 필요합니다.");
    const snapshot = await this.api.getDoc(this.api.doc(this.api.db,
      "schools", SCHOOL.id, "notificationExperimentPreferences", this.user.uid));
    return !snapshot.exists() || snapshot.data()?.enabled !== false;
  }

  async setNotificationExperimentEnabled(enabled) {
    if (!this.api) await this.start();
    if (!this.user) throw new Error("실험 알림 설정을 변경하려면 로그인이 필요합니다.");
    await this.api.setDoc(this.api.doc(this.api.db, "schools", SCHOOL.id,
      "notificationExperimentPreferences", this.user.uid), {
      enabled: Boolean(enabled),
      updatedAtMs: Date.now(),
    }, { merge: true });
    return { enabled: Boolean(enabled) };
  }

  async adminSetExperiment(experimentId, patch) {
    const ref = this.api.doc(this.api.db, "schools", SCHOOL.id, "experiments", experimentId);
    await this.api.setDoc(ref, {
      id: experimentId,
      ...patch,
      updatedAtMs: Date.now(),
      updatedBy: this.user.uid,
    }, { merge: true });
  }

  async adminSetFlag(flagId, patch) {
    const ref = this.api.doc(this.api.db, "schools", SCHOOL.id, "experimentFlags", flagId);
    await this.api.setDoc(ref, {
      ...patch,
      updatedAtMs: Date.now(),
      updatedBy: this.user.uid,
    }, { merge: true });
  }

  async adminSetTarget(experimentId, uid, mode) {
    const ref = this.api.doc(
      this.api.db,
      "schools", SCHOOL.id,
      "experiments", experimentId,
      "targets", uid,
    );
    await this.api.setDoc(ref, {
      mode,
      updatedAtMs: Date.now(),
      updatedBy: this.user.uid,
    }, { merge: true });
  }
}

let singleton = null;

export async function getExperimentPlatform() {
  if (!singleton) singleton = new ExperimentPlatform();
  if (!singleton.api) await singleton.start();
  return singleton;
}
