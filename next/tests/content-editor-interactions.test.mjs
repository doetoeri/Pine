import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../admin/content-editor.js", import.meta.url), "utf8");

test("managed content actions survive dashboard rerenders", () => {
  assert.match(source, /root\?\.addEventListener\("click", handleManagedAction\)/);
  assert.match(source, /event\.composedPath\?\.\(\)/);
  assert.doesNotMatch(source, /querySelectorAll\("\[data-managed-archive\]"\).*addEventListener/);
});

test("archive failures stay visible inside the confirmation dialog", () => {
  assert.match(source, /id="managedArchiveStatus" role="status"/);
  assert.match(source, /보관하고 변경 기록을 남기는 중/);
  assert.match(source, /status\.dataset\.kind = "error"/);
});
