import test from "node:test";
import assert from "node:assert/strict";
import { summarizeComciganError } from "../comcigan-error-log.mjs";

test("reports a useful network error code without exposing Axios request details", () => {
  const error = Object.assign(new Error("socket hang up; token=SECRET"), {
    name: "AxiosError", code: "ECONNRESET", config: { headers: { Authorization: "SECRET" } },
    request: { path: "/private?uid=SECRET" },
  });
  const report = summarizeComciganError(error, { stage: "school-search", attempt: 2 });
  assert.deepEqual(report, { code: "ECONNRESET", stage: "school-search", attempt: 2 });
  assert.ok(!JSON.stringify(report).includes("SECRET"));
  assert.ok(!JSON.stringify(report).includes("private"));
});

test("rejects untrusted error codes, stages and attempt numbers", () => {
  const report = summarizeComciganError({ code: "token=SECRET\n" }, { stage: "uid=SECRET", attempt: 100 });
  assert.deepEqual(report, { code: "UNKNOWN", stage: "priority-sync" });
  assert.deepEqual(summarizeComciganError(null), { code: "UNKNOWN", stage: "priority-sync" });
});

test("does not reflect identifier-like uppercase codes even when syntactically valid", () => {
  for (const code of ["STUDENT_10804", "SECRET_TOKEN_123", "UID_123456789", "PRIVATE_USER_ID"]) {
    const result = summarizeComciganError({ code, message: `private-${code}` });
    assert.deepEqual(result, { code: "UNKNOWN", stage: "priority-sync" });
    assert.ok(!JSON.stringify(result).includes(code));
  }
});

test("handles throwing code getters without leaking data or masking original failure", () => {
  const result = summarizeComciganError({ get code() { throw Error("private-uid"); } }, { stage: "timetable", attempt: 3 });
  assert.deepEqual(result, { code: "UNKNOWN", stage: "timetable", attempt: 3 });
});
