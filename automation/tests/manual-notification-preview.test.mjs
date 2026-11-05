import test from "node:test";
import assert from "node:assert/strict";
import { previewEligibility } from "../manual-notification-preview.mjs";

const now = new Date("2026-11-05T04:10:00Z");
const base = {
  config: { status: "ACTIVE", studyMode: "career-v3", design: "parallel-v4",
    version: 4, startDate: "2026-11-05", baselineDays: 0, periodDays: 4,
    targetClassKeys: ["1-8"], createdAtMs: 1, schoolDaysOnly: true },
  now, slotIndex: 1, accounts: new Map(), subscriptions: [], preferences: [], assignments: new Map(),
};

test("disabled experiment flag prevents any eligible preview", () => {
  const report = previewEligibility({ ...base, enabled: false });
  assert.equal(report.active, false);
  assert.equal(report.planned, 0);
  assert.equal(report.ready, 0);
});

test("invalid slot does not produce eligible targets", () => {
  const report = previewEligibility({ ...base, slotIndex: 99 });
  assert.equal(report.slotValid, false);
  assert.equal(report.planned, 0);
});

test("preview does not mutate participant data", () => {
  const accounts = new Map([["example", { classKey: "1-8" }]]);
  const report = previewEligibility({ ...base, accounts, enabled: false });
  assert.equal(report.accounts, 1);
  assert.equal(accounts.size, 1);
});
