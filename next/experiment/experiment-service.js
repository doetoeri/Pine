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

const FIREBASE = globalThis.PINCON_FIREBASE_CONFIG || {};
const SCHOOL = globalThis.PINCON_SCHOOL_CONFIG || { id: "gochon-high", name: "학교" };
const SDK = "12.17.1";
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
    if (!this.user) {
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
    const [config, flag, assignment] = await Promise.all([
      readOptional(api, "schools", SCHOOL.id, "experiments", NOTIFICATION_EXPERIMENT_ID),
      readOptional(api, "schools", SCHOOL.id, "experimentFlags", NOTIFICATION_FLAG_ID),
      readOptional(api, "schools", SCHOOL.id, "experiments", NOTIFICATION_EXPERIMENT_ID, "assignments", uid),
    ]);

    if (!config || flag?.enabled === false) {
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
    if (experimentIsRunning(config.status) && !assignment) {
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
        cohort: "notification",
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
      status: String(config.status || EXPERIMENT_STATUS.DRAFT),
      source: "crossover",
      cohort: "notification",
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
  }) {
    if (!this.user || this.context?.experimentId !== NOTIFICATION_EXPERIMENT_ID) {
      throw new Error("알림 실험이 활성화되어 있지 않습니다.");
    }
    const surveyId = `period-${Math.max(1, Math.min(3, Number(period) || 1))}`;
    const ref = this.api.doc(
      this.api.db,
      "schools", SCHOOL.id,
      "experiments", NOTIFICATION_EXPERIMENT_ID,
      "participants", this.user.uid,
      "surveyResponses", surveyId,
    );
    await this.api.setDoc(ref, {
      schemaVersion: EXPERIMENT_SCHEMA_VERSION,
      anonymousParticipant: this.context.anonymousParticipant,
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

  async adminReadExperiment(experimentId) {
    const uiExperiment = experimentId === UI_EXPERIMENT_ID;
    const [configSnap, assignmentsSnap, eventsSnap, participantsSnap, betaSnap] = await Promise.all([
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
