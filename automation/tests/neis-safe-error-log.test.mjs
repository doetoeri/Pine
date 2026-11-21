import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { safeAutomationErrorCode } from "../safe-automation-error.mjs";

test("known network errors retain only allowlisted codes", () => {
  assert.equal(safeAutomationErrorCode({ code: "ECONNRESET", message: "secret-token" }), "ECONNRESET");
  assert.equal(safeAutomationErrorCode({ code: "ETIMEDOUT" }), "ETIMEDOUT");
});

test("JSON failures have a fixed category without leaking messages", () => {
  assert.equal(safeAutomationErrorCode(new SyntaxError("URL?KEY=secret-token")), "INVALID_JSON");
});

test("unknown and malicious error fields are not reflected in logs", () => {
  const error = { code: "secret-token", message: "student-uid", stack: "request-headers" };
  const code = safeAutomationErrorCode(error);
  assert.equal(code, "UPSTREAM_FAILURE");
  assert.doesNotMatch(JSON.stringify({ code }), /secret-token|student-uid|request-headers/);
  assert.equal(safeAutomationErrorCode(null), "UPSTREAM_FAILURE");
  assert.equal(safeAutomationErrorCode({ get code() { throw Error("secret-token"); } }), "UPSTREAM_FAILURE");
});

test("NEIS fallback and fatal handlers never log raw exception objects or messages", async () => {
  const source = await readFile(new URL("../neis-sync.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /message:\s*error\?\.message|console\.error\(error\)/);
  assert.match(source, /COMCIGAN_CLASS_FETCH_FAILED/);
  assert.match(source, /COMCIGAN_FAILED_FALLING_BACK_TO_NEIS/);
  assert.match(source, /safeAutomationErrorCode\(error\)/);
});
