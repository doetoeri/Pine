import {
  EXPERIMENT_STATUS,
  NOTIFICATION_CONDITIONS,
  STABLE_UI_VARIANT,
} from "./constants.js";

export function hash32(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function deterministicBucket(seed, modulus = 10_000) {
  const safeModulus = Math.max(1, Math.trunc(Number(modulus) || 10_000));
  return hash32(seed) % safeModulus;
}

export function deterministicUiVariant({
  uid,
  experimentId,
  experimentVersion,
  nextPercent = 50,
} = {}) {
  const percent = Math.max(0, Math.min(100, Number(nextPercent) || 0));
  const bucket = deterministicBucket(`${uid}:${experimentId}:v${experimentVersion}`, 10_000);
  return {
    bucket,
    variant: bucket < Math.round(percent * 100) ? "next" : "legacy",
  };
}

function forcedVariant(target = {}) {
  const mode = String(target?.mode || "");
  if (mode === "force_next" || mode === "canary") return "next";
  if (mode === "force_legacy" || mode === "blocked") return "legacy";
  return "";
}

export function resolveUiVariant({
  config = null,
  flag = null,
  assignment = null,
  target = null,
  betaEnrollment = null,
  uid = "",
} = {}) {
  const stable = ["legacy", "next"].includes(config?.stableVariant)
    ? config.stableVariant
    : STABLE_UI_VARIANT;

  if (!config || flag?.enabled === false) {
    return { variant: stable, source: "stable", bucket: null, needsAssignment: false };
  }

  const forced = forcedVariant(target);
  if (forced) {
    return { variant: forced, source: `target:${target.mode}`, bucket: null, needsAssignment: false };
  }

  const status = String(config.status || EXPERIMENT_STATUS.DRAFT);
  if (
    status === EXPERIMENT_STATUS.CANARY
    && config.publicBetaEnabled === true
    && betaEnrollment?.enabled === true
  ) {
    return { variant: "next", source: "public-beta", bucket: null, needsAssignment: false };
  }
  if ([EXPERIMENT_STATUS.DRAFT, EXPERIMENT_STATUS.PAUSED, EXPERIMENT_STATUS.ABORTED].includes(status)) {
    return { variant: stable, source: "stable", bucket: null, needsAssignment: false };
  }

  if (status === EXPERIMENT_STATUS.CANARY) {
    return { variant: stable, source: "canary-stable", bucket: null, needsAssignment: false };
  }

  if (status === EXPERIMENT_STATUS.COMPLETED) {
    const promoted = ["legacy", "next"].includes(config.promotedVariant)
      ? config.promotedVariant
      : stable;
    return { variant: promoted, source: "completed", bucket: null, needsAssignment: false };
  }

  if (status === EXPERIMENT_STATUS.ROLLOUT) {
    const rolloutPercent = Math.max(0, Math.min(100, Number(config.rolloutPercent) || 0));
    const bucket = deterministicBucket(`${uid}:${config.id || "pincon-next-ui"}:rollout`, 10_000);
    const promoted = config.promotedVariant === "legacy" ? "legacy" : "next";
    const fallback = promoted === "next" ? stable : "next";
    return {
      variant: bucket < Math.round(rolloutPercent * 100) ? promoted : fallback,
      source: "rollout",
      bucket,
      needsAssignment: false,
    };
  }

  if (status === EXPERIMENT_STATUS.ACTIVE) {
    const version = Number(config.version || 1);
    if (
      assignment
      && assignment.experimentVersion === version
      && ["legacy", "next"].includes(assignment.variant)
    ) {
      return {
        variant: assignment.variant,
        source: "sticky",
        bucket: Number.isFinite(Number(assignment.bucket)) ? Number(assignment.bucket) : null,
        needsAssignment: false,
      };
    }
    const result = deterministicUiVariant({
      uid,
      experimentId: config.id || "pincon-next-ui",
      experimentVersion: version,
      nextPercent: Number(config?.allocation?.nextPercent ?? 50),
    });
    return { ...result, source: "deterministic", needsAssignment: true };
  }

  return { variant: stable, source: "stable", bucket: null, needsAssignment: false };
}

export const CROSSOVER_SEQUENCES = Object.freeze([
  Object.freeze(["LOW", "MID", "HIGH"]),
  Object.freeze(["MID", "HIGH", "LOW"]),
  Object.freeze(["HIGH", "LOW", "MID"]),
  Object.freeze(["LOW", "HIGH", "MID"]),
  Object.freeze(["HIGH", "MID", "LOW"]),
  Object.freeze(["MID", "LOW", "HIGH"]),
]);

export function crossoverSequenceFor(uid, experimentId = "notification-frequency", version = 1) {
  const index = deterministicBucket(`${uid}:${experimentId}:v${version}:sequence`, CROSSOVER_SEQUENCES.length);
  return { index, sequence: [...CROSSOVER_SEQUENCES[index]] };
}

export function notificationPeriodAt(config = {}, now = new Date()) {
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(config.startDate || ""))
    ? String(config.startDate)
    : "";
  if (!startDate) return { phase: "NOT_STARTED", period: 0, periodDay: 0 };

  const today = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const current = Date.parse(`${today}T00:00:00Z`);
  const day = Math.floor((current - start) / 86_400_000);
  if (day < 0) return { phase: "NOT_STARTED", period: 0, periodDay: 0 };

  const baselineDays = Math.max(0, Math.trunc(Number(config.baselineDays ?? 2)));
  const periodDays = Math.max(1, Math.trunc(Number(config.periodDays ?? 4)));
  if (day < baselineDays) return { phase: "BASELINE", period: 0, periodDay: day + 1 };

  const afterBaseline = day - baselineDays;
  const period = Math.floor(afterBaseline / periodDays) + 1;
  if (period > 3) return { phase: "COMPLETE", period: 4, periodDay: 0 };
  return {
    phase: "EXPERIMENT",
    period,
    periodDay: (afterBaseline % periodDays) + 1,
  };
}

export function notificationConditionFor({ assignment, config, now = new Date() } = {}) {
  const periodInfo = notificationPeriodAt(config, now);
  if (periodInfo.phase !== "EXPERIMENT") return { ...periodInfo, condition: "" };
  const sequence = Array.isArray(assignment?.sequence)
    && assignment.sequence.length === 3
    && assignment.sequence.every((item) => NOTIFICATION_CONDITIONS.includes(item))
    ? assignment.sequence
    : [];
  return {
    ...periodInfo,
    condition: sequence[periodInfo.period - 1] || "",
  };
}
