import test from "node:test";
import assert from "node:assert/strict";
import { notificationFailureSummary, safeNotificationErrorCode } from "../notification-error-log.mjs";

test("workflow failure summary excludes error messages, tokens, headers, and stacks", () => {
  const secret = "private-student-id-and-service-token";
  const error = Object.assign(new Error(`request failed for ${secret}`), {
    code: "messaging/server-unavailable",
    config: { url: `https://example.test/${secret}`, headers: { Authorization: secret } },
    response: { data: secret },
  });
  const summary = notificationFailureSummary(error);
  assert.deepEqual(summary, { component: "notification-frequency", status: "error", errorCode: "messaging/server-unavailable" });
  const output = JSON.stringify(summary);
  assert.equal(output.includes(secret), false);
  assert.equal(output.includes("headers"), false);
  assert.equal(output.includes("stack"), false);
});

test("unsafe, missing, and non-string error codes are replaced with a fixed value", () => {
  for (const error of [null, undefined, {}, { code: 7 }, { code: "uid:private" },
    { code: "token\\nsecret" }, { code: "a".repeat(65) }]) {
    assert.equal(safeNotificationErrorCode(error), "dispatcher-failed");
  }
  assert.equal(safeNotificationErrorCode({ code: "permission-denied" }), "permission-denied");
});
