import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  TODAY_OPEN_WRITE_CLASS_KEY,
  TODAY_OPEN_WRITE_UNTIL_MS,
  todayOpenWriteEligible,
} from "../core/today-open-write.js";

test("temporary write opens only for authenticated 1-8 before cutoff", () => {
  const user = { uid: "guest-1" };
  assert.equal(TODAY_OPEN_WRITE_CLASS_KEY, "1-8");
  assert.equal(todayOpenWriteEligible({
    user,
    profile: { classKey: "1-8" },
    now: TODAY_OPEN_WRITE_UNTIL_MS - 1,
  }), true);
  assert.equal(todayOpenWriteEligible({
    user: null,
    profile: { classKey: "1-8" },
    now: TODAY_OPEN_WRITE_UNTIL_MS - 1,
  }), false);
  assert.equal(todayOpenWriteEligible({
    user,
    profile: { classKey: "1-7" },
    now: TODAY_OPEN_WRITE_UNTIL_MS - 1,
  }), false);
  assert.equal(todayOpenWriteEligible({
    user,
    profile: { classKey: "1-8" },
    now: TODAY_OPEN_WRITE_UNTIL_MS,
  }), false);
});

test("production deploy transform scopes temporary writes to managed content and change logs", async () => {
  process.env.PINCON_OPEN_WRITE_CLASS = "1-8";
  process.env.PINCON_OPEN_WRITE_UNTIL_MS = String(TODAY_OPEN_WRITE_UNTIL_MS);
  const moduleUrl = new URL("../../automation/deploy-firestore-rules.mjs?temporary-write-test", import.meta.url);
  const { applyTemporaryOpenWrite } = await import(moduleUrl.href);
  const source = await readFile(new URL("../../firestore.rules", import.meta.url), "utf8");
  const patched = applyTemporaryOpenWrite(source);

  assert.match(patched, /function temporaryClassEditor\(classKey\)/);
  assert.match(patched, /classKey == '1-8'/);
  assert.match(patched, new RegExp(`request\\.time\\.toMillis\\(\\) < ${TODAY_OPEN_WRITE_UNTIL_MS}`));

  for (const collection of ["announcements", "classAssignments", "events", "changeLogs"]) {
    const marker = `match /schools/{schoolId}/${collection}/`;
    const start = patched.indexOf(marker);
    assert.notEqual(start, -1, `${collection} block should exist`);
    const next = patched.indexOf("\n    match /schools/", start + marker.length);
    const block = patched.slice(start, next < 0 ? patched.length : next);
    assert.match(block, /temporaryClassEditor\(request\.resource\.data\.classKey\)/);
  }

  for (const collection of ["supplies", "resources", "classSettings"]) {
    const marker = `match /schools/{schoolId}/${collection}/`;
    const start = patched.indexOf(marker);
    assert.notEqual(start, -1, `${collection} block should exist`);
    const next = patched.indexOf("\n    match /schools/", start + marker.length);
    const block = patched.slice(start, next < 0 ? patched.length : next);
    assert.doesNotMatch(block, /temporaryClassEditor\(request\.resource\.data\.classKey\)/);
  }
});
