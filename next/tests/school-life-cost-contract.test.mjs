import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const optimized = fs.readFileSync(new URL("../../automation/school-life-notifications-optimized.mjs", import.meta.url), "utf8");
const runner = fs.readFileSync(new URL("../../automation/school-life-runner.mjs", import.meta.url), "utf8");
const notificationWorkflow = fs.readFileSync(new URL("../../.github/workflows/school-life-notifications.yml", import.meta.url), "utf8");
const visibilityBudget = fs.readFileSync(new URL("../firestore-visibility-budget.js", import.meta.url), "utf8");
const routeBudget = fs.readFileSync(new URL("../firestore-route-budget.js", import.meta.url), "utf8");
const inbox = fs.readFileSync(new URL("../school-life-inbox.js", import.meta.url), "utf8");
const bootstrap = fs.readFileSync(new URL("../app-bootstrap.js", import.meta.url), "utf8");

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

test("notification scheduler follows KST weekdays instead of UTC weekdays", () => {
  assert.match(notificationWorkflow, /cron: "\*\/5 0-13 \* \* 1-5"/);
  assert.match(notificationWorkflow, /cron: "\*\/5 21-23 \* \* 0-4"/);
  assert.doesNotMatch(notificationWorkflow, /cron: "\*\/5 \* \* \* 1-5"/);
  assert.doesNotMatch(notificationWorkflow, /branches: \[main\]/);
});

test("foreground Firestore listeners are suspended while the app is hidden", () => {
  assert.match(bootstrap, /firestore-visibility-budget\.js/);
  assert.match(visibilityBudget, /document\.addEventListener\("visibilitychange"/);
  assert.match(visibilityBudget, /window\.addEventListener\("pagehide"/);
  assert.match(visibilityBudget, /stopAll\(repo\.unsubscribers\)/);
  assert.match(visibilityBudget, /stopAll\(repo\.privateUnsubscribers\)/);
  assert.match(visibilityBudget, /repo\.listenPublic\?\.\(\)/);
});

test("Next public listeners are scoped by route before app startup", () => {
  const patchIndex = bootstrap.indexOf("firestore-route-budget.js");
  const appIndex = bootstrap.indexOf("./app.js");
  assert.ok(patchIndex >= 0 && appIndex > patchIndex, "route budget must patch the repository before app startup");
  assert.match(routeBudget, /const COLLECTION_ORDER = Object\.freeze/);
  assert.match(routeBudget, /today:/);
  assert.match(routeBudget, /timetable:/);
  assert.match(routeBudget, /schedule:/);
  assert.match(routeBudget, /classroom:/);
  assert.match(routeBudget, /more:/);
  assert.match(routeBudget, /if \(!wanted\.has\(collectionName\)\) return \(\) => \{\}/);
  assert.match(routeBudget, /path === "\/next" \|\| path === "\/next\/index\.html"/);
});

test("notification inbox listener only runs on visible more route", () => {
  assert.match(inbox, /route\(\) !== "more"/);
  assert.match(inbox, /document\.hidden/);
  assert.match(inbox, /window\.addEventListener\("hashchange"/);
});
