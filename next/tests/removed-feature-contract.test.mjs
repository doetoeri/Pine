import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const removedPaths = [
  "../problem-bank.js",
  "../problem-bank.css",
  "../admin/problem-bank-guide.js",
  "../data/problem-bank.json",
  "../data/problem-bank.schema.json",
  "../AI_PROBLEM_BANK.md",
];

const runtimeFiles = [
  "../app-bootstrap.js",
  "../index.html",
  "../admin/bootstrap.js",
];

test("problem bank remains outside the PinCon Next product scope", async () => {
  for (const path of removedPaths) {
    await assert.rejects(
      access(new URL(path, import.meta.url)),
      (error) => error?.code === "ENOENT",
      `${path} should stay removed`,
    );
  }

  for (const path of runtimeFiles) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /problem[-_ ]?bank|problemBank|문제은행/i, `${path} must not load or expose the removed feature`);
  }
});
