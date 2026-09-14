import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  CROSSOVER_SEQUENCES,
  crossoverSequenceFor,
  deterministicUiVariant,
  notificationConditionFor,
  resolveUiVariant,
} from "../next/experiment/assignment-service.js";
import {
  currentSlot,
  dailyBudget,
  eligibleForSlot,
  periodFor,
  sequenceFor,
} from "../automation/notification-frequency-core.mjs";

test("UI assignment is deterministic and sticky", () => {
  const deterministic = deterministicUiVariant({
    uid: "uid-10804",
    experimentId: "pincon-next-ui",
    experimentVersion: 1,
    nextPercent: 50,
  });
  assert.deepEqual(deterministic, deterministicUiVariant({
    uid: "uid-10804",
    experimentId: "pincon-next-ui",
    experimentVersion: 1,
    nextPercent: 50,
  }));

  const resolved = resolveUiVariant({
    uid: "uid-10804",
    config: { id: "pincon-next-ui", status: "ACTIVE", version: 1, stableVariant: "legacy", allocation: { nextPercent: 50 } },
    assignment: { experimentVersion: 1, variant: "legacy", bucket: 1234 },
  });
  assert.equal(resolved.variant, "legacy");
  assert.equal(resolved.source, "sticky");
});

test("Canary exposes Next only to explicit targets", () => {
  const config = { id: "pincon-next-ui", status: "CANARY", version: 1, stableVariant: "legacy" };
  assert.equal(resolveUiVariant({ uid: "a", config }).variant, "legacy");
  assert.equal(resolveUiVariant({ uid: "a", config, target: { mode: "canary" } }).variant, "next");
  assert.equal(resolveUiVariant({ uid: "a", config, target: { mode: "force_legacy" } }).variant, "legacy");
});

test("Public beta stays separate from controlled A-B and respects admin fallback", () => {
  const config = { id: "pincon-next-ui", status: "CANARY", version: 1, stableVariant: "legacy", publicBetaEnabled: true };
  const beta = resolveUiVariant({ uid: "beta-user", config, betaEnrollment: { enabled: true } });
  assert.equal(beta.variant, "next");
  assert.equal(beta.source, "public-beta");

  const notJoined = resolveUiVariant({ uid: "legacy-user", config, betaEnrollment: { enabled: false } });
  assert.equal(notJoined.variant, "legacy");

  const forcedBack = resolveUiVariant({
    uid: "beta-user",
    config,
    betaEnrollment: { enabled: true },
    target: { mode: "force_legacy" },
  });
  assert.equal(forcedBack.variant, "legacy");
  assert.equal(forcedBack.source, "target:force_legacy");

  const active = resolveUiVariant({
    uid: "beta-user",
    config: { ...config, status: "ACTIVE" },
    betaEnrollment: { enabled: true },
    assignment: { experimentVersion: 1, variant: "legacy", bucket: 1111 },
  });
  assert.equal(active.variant, "legacy");
  assert.equal(active.source, "sticky");
});

test("Rollout buckets are monotonic and 100 percent promotes Next", () => {
  const base = { id: "pincon-next-ui", status: "ROLLOUT", version: 1, stableVariant: "legacy", promotedVariant: "next" };
  const at25 = resolveUiVariant({ uid: "student-a", config: { ...base, rolloutPercent: 25 } });
  const at50 = resolveUiVariant({ uid: "student-a", config: { ...base, rolloutPercent: 50 } });
  if (at25.variant === "next") assert.equal(at50.variant, "next");
  assert.equal(resolveUiVariant({ uid: "student-a", config: { ...base, rolloutPercent: 100 } }).variant, "next");
});

test("Crossover sequences always contain LOW MID HIGH exactly once", () => {
  assert.equal(CROSSOVER_SEQUENCES.length, 6);
  for (let index = 0; index < 50; index += 1) {
    const browser = crossoverSequenceFor(`uid-${index}`).sequence;
    const server = sequenceFor(`uid-${index}`).sequence;
    assert.deepEqual([...browser].sort(), ["HIGH", "LOW", "MID"]);
    assert.deepEqual([...server].sort(), ["HIGH", "LOW", "MID"]);
  }
});

test("Notification experiment honors baseline, periods, and frequency budgets", () => {
  const config = { startDate: "2026-09-01", baselineDays: 2, periodDays: 4, frequency: { lowPerDay: 1, midPerDay: 3, highPerDay: 4 } };
  assert.equal(periodFor(config, new Date("2026-09-01T03:00:00Z")).phase, "BASELINE");
  const period = periodFor(config, new Date("2026-09-03T03:00:00Z"));
  assert.equal(period.phase, "EXPERIMENT");
  assert.equal(period.period, 1);
  assert.equal(dailyBudget("LOW", config), 1);
  assert.equal(dailyBudget("MID", config), 3);
  assert.equal(dailyBudget("HIGH", config), 4);
  const slot = currentSlot(new Date("2026-09-14T03:05:00Z"));
  assert.equal(slot?.hour, 12);
  assert.equal(eligibleForSlot("LOW", slot, config), false);
  assert.equal(eligibleForSlot("MID", slot, config), true);

  const condition = notificationConditionFor({
    assignment: { sequence: ["HIGH", "LOW", "MID"] },
    config,
    now: new Date("2026-09-03T03:00:00Z"),
  });
  assert.equal(condition.condition, "HIGH");
});

test("Firestore contract keeps experiment settings admin-only and raw events anonymous", async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  assert.match(rules, /match \/schools\/\{schoolId\}\/experiments\/\{experimentId\}/);
  assert.match(rules, /allow create, update: if schoolAdmin\(schoolId\)/);
  assert.match(rules, /experimentWriteIsolated/);
  assert.match(rules, /match \/schools\/\{schoolId\}\/experimentEvents\/\{eventId\}/);
  assert.match(rules, /anonymousParticipant/);
  assert.doesNotMatch(rules.slice(rules.indexOf("experimentEvents/{eventId}"), rules.indexOf("experimentNotifications/{notificationId}")), /studentNumber|displayName|email|userUid/);
});

test("PWA and bootstrap include experiment modules and stable fallback", async () => {
  const [sw, bootstrap] = await Promise.all([
    readFile(new URL("../sw.js", import.meta.url), "utf8"),
    readFile(new URL("../next/app-bootstrap.js", import.meta.url), "utf8"),
  ]);
  assert.match(sw, /next\/experiment\/experiment-service\.js/);
  assert.match(sw, /next\/experiments\/pincon-next-ui\.js/);
  assert.match(sw, /next\/experiments\/public-beta\.js/);
  assert.match(bootstrap, /initExperimentPlatform/);
  assert.match(bootstrap, /dataset\.pinconVariant = "legacy"/);
  assert.match(bootstrap, /experimentPlatform\?\.uiContext\?\.variant === "next"/);
});
