import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../admin/content-editor-v2.js", import.meta.url), "utf8");
test("active content actions use delegation and server-verified saves", () => {
  assert.match(source, /root\?\.addEventListener\("click", handleClick\)/);
  assert.match(source, /보관 후 서버에서 확인/);
  assert.match(source, /setStatus\(error\?\.message/);
  assert.match(source, /status\.dataset\.kind = "error"/);
});
