import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  canonicalSubscriptionIds,
  currentSlot,
  dailyBudget,
  plannedSlotIndexes,
} from "../automation/notification-frequency-core.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("all three conditions have the study's exact 0/1/3 default exposure budget", () => {
  assert.equal(dailyBudget("LOW"), 0);
  assert.equal(dailyBudget("MID"), 1);
  assert.equal(dailyBudget("HIGH"), 3);
  const params = { anonymousParticipant: "study-person", date: "2026-10-26", period: 1 };
  assert.equal(plannedSlotIndexes({ ...params, condition: "LOW" }).length, 0);
  assert.equal(plannedSlotIndexes({ ...params, condition: "MID" }).length, 1);
  assert.equal(plannedSlotIndexes({ ...params, condition: "HIGH" }).length, 3);
});

test("only the four KST clock hours are eligible, including late scheduler starts", () => {
  assert.equal(currentSlot(new Date("2026-10-25T23:50:00Z"))?.hour, 8);
  assert.equal(currentSlot(new Date("2026-10-26T04:45:00Z"))?.hour, 13);
  assert.equal(currentSlot(new Date("2026-10-26T08:45:00Z"))?.hour, 17);
  assert.equal(currentSlot(new Date("2026-10-26T10:45:00Z"))?.hour, 19);
  assert.equal(currentSlot(new Date("2026-10-26T00:00:00Z")), null);
});

test("account-wide opt-out prevents delivery via any stale device", () => {
  const docs = [
    { id: "old-a", ownerUid: "a", enabled: true, token: "old", updatedAtMs: 1 },
    { id: "new-a", ownerUid: "a", enabled: true, token: "new", updatedAtMs: 2 },
    { id: "old-b", ownerUid: "b", enabled: true, token: "old", updatedAtMs: 9 },
    { id: "disabled-b", ownerUid: "b", enabled: false, token: "other", updatedAtMs: 10,
      preferences: { notificationExperiment: false } },
    { id: "disabled-c", ownerUid: "c", enabled: false, token: "disabled", updatedAtMs: 4 },
    { id: "missing-owner", enabled: true, token: "unsafe", updatedAtMs: 5 },
  ];
  assert.deepEqual(canonicalSubscriptionIds(docs), ["new-a"]);
});

test("server enrollment is independent of push subscriptions and covers baseline", async () => {
  const c = await read("../automation/notification-frequency-experiment.mjs");
  assert.match(c, /root\.collection\("users"\)\.where\("status", "==", "ACTIVE"\)/);
  assert.match(c, /const preassignment = await preassignActiveAccounts\(root, ready\.config\);[\s\S]*?if \(period\.phase !== "EXPERIMENT"/);
  assert.match(c, /preassignment\.accounts\.get/);
  assert.match(c, /profile\.classKey/);
  assert.match(c, /ref\.create\(record\)/);
});

test("two workers cannot send a receipt twice and accepted sends never auto-retry", async () => {
  const c = await read("../automation/notification-frequency-experiment.mjs");
  assert.match(c, /db\.runTransaction\(async \(tx\)/);
  assert.match(c, /if \(!canRetryReceipt\(previous\)\) return null/);
  assert.match(c, /"sending", "send-uncertain"/);
  assert.match(c, /if \(fcmAccepted\)/);
  assert.match(c, /status: "send-uncertain"/);
});

test("independent workflow is not blocked by timetable sync failures", async () => {
  const [workflow, cron, legacy, dispatch] = await Promise.all([
    read("../.github/workflows/notification-frequency.yml"),
    read("../automation/notification-frequency-cron.mjs"),
    read("../automation/neis-sync.mjs"),
    read("../automation/notification-frequency-experiment.mjs"),
  ]);
  assert.match(workflow, /cron: "\*\/30 \* \* \* \*"/);
  assert.match(workflow, /FIREBASE_SERVICE_ACCOUNT_JSON/);
  assert.match(cron, /dispatchNotificationFrequencyExperiment/);
  assert.doesNotMatch(legacy, /dispatchNotificationFrequencyExperiment/);
  assert.match(dispatch, /FALLBACK_BY_SLOT/);
  assert.match(dispatch, /"PinCon 아침 확인"/);
});
