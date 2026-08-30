import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("personal notifications stay behind the authenticated server API", async () => {
  const [handler, router, vercel, browser, admin] = await Promise.all([
    read("../../integrations/pincon-ai/handlers/accounts/personal-notifications.mjs"),
    read("../../integrations/pincon-ai/api/class-ops-router.mjs"),
    read("../../integrations/pincon-ai/vercel.json"),
    read("../personal-notification-filter.js"),
    read("../admin/personal-notifications.js"),
  ]);

  assert.match(handler, /requireProfileOrLegacy\(req\)/);
  assert.match(handler, /where\("targetUid",\s*"==",\s*profile\.uid\)/);
  assert.match(handler, /where\("classKey",\s*"==",\s*profile\.classKey\)/);
  assert.match(handler, /isClassOperator\(actor\)/);
  assert.match(handler, /assertSameClass\(actor,\s*target\)/);
  assert.match(handler, /targetUid:\s*target\.uid/);

  assert.match(router, /personal-notifications/);
  assert.match(vercel, /\/api\/accounts\/personal-notifications/);

  assert.match(browser, /accountRequest\("\/api\/accounts\/personal-notifications"/);
  assert.doesNotMatch(browser, /firebase-firestore|collection\(|getDocs\(|onSnapshot\(/);

  assert.match(admin, /accountRequest\("\/api\/accounts\/personal-notifications\?mode=recipients"/);
  assert.match(admin, /targetUid/);
  assert.doesNotMatch(admin, /adminWrite\("announcements"/);
  assert.doesNotMatch(admin, /targetStudentNumber:\s*studentNumber/);
});

test("legacy targeted announcements are migrated off the public collection", async () => {
  const handler = await read("../../integrations/pincon-ai/handlers/accounts/personal-notifications.mjs");
  assert.match(handler, /personalNotification/);
  assert.match(handler, /targetStudentNumber/);
  assert.match(handler, /announcements/);
  assert.match(handler, /batch\.delete\(doc\.ref\)/);
  assert.match(handler, /batch\.commit\(\)/);
});
