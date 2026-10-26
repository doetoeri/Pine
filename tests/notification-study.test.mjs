import test from "node:test";
import assert from "node:assert/strict";
import { balancedSequences, dateKey, isCareerStudy, studyCalendar, studyDefaults, studyPeriodAt, studySlots, validateStudyConfig } from "../next/experiment/notification-study.js";
import { crossoverSequenceFor, notificationPeriodAt } from "../next/experiment/assignment-service.js";
import { currentSlot, dailyBudget, notificationId, periodFor, plannedSlotIndexes, sequenceFor } from "../automation/notification-frequency-core.mjs";
import { analyzeStudy, anonymousStudyExport, studyCsv, studyReport } from "../next/experiment/study-analysis.js";
import { adminMarkup, participantMarkup } from "../experiments/view.js";

test("browser and server use exactly the same v3 assignment for every account", () => {
  for (let version = 3; version <= 8; version++) for (let i = 0; i < 100; i++) {
    assert.deepEqual(sequenceFor(`uid-${i}`, "notification-frequency", version), crossoverSequenceFor(`uid-${i}`, "notification-frequency", version));
  }
});
test("34 students are balanced across six orders and all three conditions in every period", () => {
  const uids = Array.from({ length: 34 }, (_, i) => `student-${i}`);
  const assignments = balancedSequences(uids, "fixed-test-seed");
  assert.deepEqual(assignments, balancedSequences([...uids].reverse(), "fixed-test-seed"));
  for (let period = 0; period < 3; period++) {
    const counts = ["LOW", "MID", "HIGH"].map((condition) => [...assignments.values()].filter((row) => row.sequence[period] === condition).length);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
  }
});
test("career schedule never chooses a lesson hour and exposes exactly 0, 1, or 3 slots", () => {
  const config = studyDefaults();
  assert.equal(dailyBudget("LOW", { ...config, frequency: { lowPerDay: 4 } }), 0);
  for (let hour = 0; hour < 24; hour++) {
    const now = new Date(`2026-10-26T${String(hour).padStart(2, "0")}:10:00+09:00`);
    assert.equal(Boolean(currentSlot(now, config)), [8, 17, 19].includes(hour));
  }
  for (const condition of ["LOW", "MID", "HIGH"]) {
    const context = { anonymousParticipant: "participant_test", date: "2026-10-26", period: 1, condition };
    assert.deepEqual(plannedSlotIndexes({ ...context, config }), studySlots(context));
    assert.equal(studySlots(context).length, { LOW: 0, MID: 1, HIGH: 3 }[condition]);
  }
});

test("paused and ended experiments never accrue zero activity on subsequent dates", () => {
  const later = new Date("2026-10-29T21:00:00+09:00");
  const stopped = { ...config, status: "COMPLETED", endedAtMs: Date.parse("2026-10-26T21:00:00+09:00") };
  const data = analyzeStudy({ config: stopped, assignments }, later);
  assert.equal(data.rows.find((row) => row.period === 1).exposureDays, 1);
  assert.equal(data.rows.find((row) => row.period === 2).exposureDays, 0);
  const paused = analyzeStudy({ config: { ...config, status: "PAUSED", pausedAtMs: Date.parse("2026-10-27T12:00:00+09:00") }, assignments }, later);
  assert.equal(paused.rows.find((row) => row.period === 1).exposureDays, 1);
  assert.equal(paused.rows.find((row) => row.period === 2).exposureDays, 0);
});
test("calendar uses KST, real dates, weekdays and explicit exclusions in both runtimes", () => {
  const config = { ...studyDefaults(), startDate: "2026-10-23", baselineDays: 1, periodDays: 1, excludedDates: ["2026-10-26"] };
  assert.equal(dateKey(new Date("2026-10-25T15:00:00Z")), "2026-10-26");
  assert.deepEqual(studyCalendar(config).map((row) => row.date), ["2026-10-23", "2026-10-27", "2026-10-28", "2026-10-29"]);
  for (let i = 23; i <= 31; i++) {
    const now = new Date(`2026-10-${i}T12:00:00+09:00`);
    assert.deepEqual(periodFor(config, now), notificationPeriodAt(config, now));
    assert.deepEqual(studyPeriodAt(config, now), notificationPeriodAt(config, now));
  }
  assert.throws(() => validateStudyConfig({ ...config, startDate: "2026-02-30" }));
  assert.throws(() => validateStudyConfig({ ...config, targetClassKeys: [] }));
});
test("changing candidate content in the same v3 slot cannot create a second send receipt", () => {
  const context = { anonymousParticipant: "participant_a", date: "2026-10-26", period: 1, slotIndex: 0, experimentVersion: 3 };
  assert.equal(notificationId({ ...context, candidateKey: "before" }), notificationId({ ...context, candidateKey: "after" }));
  assert.notEqual(notificationId({ ...context, candidateKey: "a" }), notificationId({ ...context, slotIndex: 2, candidateKey: "a" }));
});
const config = { ...studyDefaults(), version: 3, baselineDays: 0, periodDays: 1, startDate: "2026-10-26", activeStartedAtMs: Date.parse("2026-10-26T00:00:00+09:00") };
const assignments = [{ id: "private-uid", experimentVersion: 3, anonymousParticipant: "participant_a", sequence: ["LOW", "MID", "HIGH"] },
  { id: "never-opened", experimentVersion: 3, anonymousParticipant: "participant_b", sequence: ["LOW", "MID", "HIGH"] }];
const event = (type, date, id = "n1") => ({ experimentId: "notification-frequency", experimentVersion: 3, anonymousParticipant: "participant_a",
  eventType: type, variant: "MID", timestampMs: Date.parse(`${date}T17:10:00+09:00`), properties: { notificationId: id } });
test("zero-dose controls and never-opened accounts remain in the behavioral denominator", () => {
  const data = analyzeStudy({ config, assignments, events: [event("assignment_view", "2026-10-26"), event("assignment_view", "2026-10-26")] }, new Date("2026-10-26T21:00:00+09:00"));
  const low = data.groups.find((row) => row.condition === "LOW");
  assert.equal(low.observed, 2);
  assert.equal(low.informationDayRate, 0.5);
  assert.equal(low.clickRate, null);
  assert.equal(data.groups.find((row) => row.condition === "MID").informationDayRate, null);
  assert.equal(data.rows.filter((row) => row.period === 1)[1].informationDayRate, 0);
});
test("clicks are deduplicated by accepted receipt and neither failures nor old versions contaminate results", () => {
  const receipts = [{ id: "n1", anonymousParticipant: "participant_a", experimentVersion: 3, period: 2, condition: "MID", status: "fcm-accepted", scheduledAtMs: Date.parse("2026-10-27T17:00:00+09:00") },
    { id: "failed", anonymousParticipant: "participant_a", experimentVersion: 3, period: 2, condition: "MID", status: "send-failed", scheduledAtMs: Date.parse("2026-10-27T17:00:00+09:00") }];
  const events = [event("notification_click", "2026-10-27"), event("notification_click", "2026-10-27"), event("notification_click", "2026-10-27", "failed"),
    { ...event("assignment_view", "2026-10-27"), experimentVersion: 2 }];
  const data = analyzeStudy({ config, assignments, receipts, events }, new Date("2026-10-27T21:00:00+09:00"));
  const mid = data.rows.find((row) => row.anonymousParticipant === "participant_a" && row.period === 2);
  assert.equal(mid.notificationCount, 1); assert.equal(mid.clickCount, 1); assert.equal(mid.clickRate, 1);
  assert.equal(mid.informationDays, 0);
});
test("unstarted and future periods have no observed rates, and survey versions are isolated", () => {
  const data = analyzeStudy({ config: { ...config, activeStartedAtMs: 0 }, assignments }, new Date("2026-10-29T21:00:00+09:00"));
  assert.ok(data.groups.every((row) => row.observed === 0 && row.informationDayRate === null));
  const oldSurvey = { experimentVersion: 2, anonymousParticipant: "participant_a", period: 1, condition: "LOW", annoyanceScore: 5 };
  const current = analyzeStudy({ config, assignments, surveys: [oldSurvey] }, new Date("2026-10-29T21:00:00+09:00"));
  assert.ok(current.groups.every((row) => row.annoyanceScore === null));
});
test("research exports contain no UID, name, device token or update owner", () => {
  const data = { config: { ...config, updatedBy: "secret-admin-uid" }, assignments, roster: [{ name: "실명", uid: "private-uid" }], devices: [{ token: "secret-token" }] };
  const text = JSON.stringify(anonymousStudyExport(data));
  for (const secret of ["private-uid", "secret-admin-uid", "secret-token", "실명", "never-opened"]) assert.ok(!text.includes(secret));
  assert.match(studyCsv(analyzeStudy(data)), /informationDayRate/);
});
test("operator views escape student labels and participant view never includes the roster", () => {
  const roster = [{ uid: "private-uid", classKey: "1-8", name: '<script>alert("x")</script>', studentNumber: "10804", status: "ACTIVE" }];
  const html = adminMarkup({ bundle: { config, assignments }, roster, tab: "members" });
  assert.ok(!html.includes("<script>")); assert.match(html, /&lt;script&gt;/);
  const student = participantMarkup({ context: { config, sequence: ["LOW", "MID", "HIGH"], experimentVersion: 3 } });
  assert.ok(!student.includes("10804")); assert.ok(!student.includes("private-uid"));
});
