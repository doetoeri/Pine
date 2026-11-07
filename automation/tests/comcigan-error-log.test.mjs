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
