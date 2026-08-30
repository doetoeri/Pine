import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const gatewaySource = await readFile(new URL("../core/data-gateway.js", import.meta.url), "utf8");
const editorSource = await readFile(new URL("../admin/content-editor.js", import.meta.url), "utf8");

test("Saturday closures are excluded before schedule rendering", () => {
  assert.match(appSource, /토요\\s\*\(\?:휴업일\|공휴일\)/);
  assert.doesNotMatch(appSource, /토요휴업일 \$\{recurring\.length\}회/);
});

test("assignment verification badges can be intentionally hidden", () => {
  assert.match(gatewaySource, /"review", "verified", "changed", "hidden"/);
  assert.match(editorSource, /\["hidden","표시 안 함"\]/);
  assert.match(appSource, /if \(status\.hidden\) return ""/);
});
