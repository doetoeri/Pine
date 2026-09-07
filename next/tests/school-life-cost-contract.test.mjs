import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const optimized = fs.readFileSync(new URL("../../automation/school-life-notifications-optimized.mjs", import.meta.url), "utf8");
const runner = fs.readFileSync(new URL("../../automation/school-life-runner.mjs", import.meta.url), "utf8");

test("school-life runner uses bounded-read scheduler", () => {
  assert.match(runner, /school-life-notifications-optimized\.mjs/);
  assert.match(optimized, /implementation: "bounded-read-v2"/);
});

test("personal completion states are fetched only by relevant document ids", () => {
  assert.match(optimized, /queryRowsByIds/);
  assert.match(optimized, /collectionRef\.firestore\.getAll/);
  assert.match(optimized, /materialStateIds/);
  assert.match(optimized, /assessmentStateIds/);
  assert.doesNotMatch(optimized, /materialStates"\)\.limit\(600\)/);
  assert.doesNotMatch(optimized, /assessmentStates"\)\.limit\(400\)/);
});

test("personal materials are limited to recurring plus today and tomorrow", () => {
  assert.match(optimized, /where\("date", "==", ""\)/);
  assert.match(optimized, /where\("date", ">=", context\.date\)/);
  assert.match(optimized, /where\("date", "<=", context\.tomorrow\)/);
});

test("push subscriptions are loaded lazily only when a notification is sent", () => {
  assert.match(optimized, /function lazySubscriptionMap/);
  assert.match(optimized, /if \(!promise\) promise = subscriptionMap\(root\)/);
  assert.match(optimized, /await subscriptionsByUid\.get\(user\.uid\)/);
  assert.doesNotMatch(optimized, /const subscriptionsByUid = await subscriptionMap\(root\)/);
});
