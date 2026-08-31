import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

function assertModuleSyntax(source, label) {
  const result = spawnSync(process.execPath, ["--input-type=module", "--check"], {
    input: source,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${label} syntax error:\n${result.stderr}`);
}

test("daily brief image is deterministic canvas export without generative AI", async () => {
  const source = await read("../admin/daily-brief-image.js");
  assertModuleSyntax(source, "daily-brief-image.js");
  assert.match(source, /const WIDTH = 1080/);
  assert.match(source, /const HEIGHT = 1350/);
  assert.match(source, /canvas\.toBlob/);
  assert.match(source, /"image\/jpeg"/);
  assert.match(source, /neisTimetables/);
  assert.match(source, /classAssignments/);
  assert.match(source, /academicSchedules/);
  assert.match(source, /meals/);
  assert.match(source, /생성형 AI 미사용/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /openai|gemini|anthropic|image_gen/i);
});

test("detail history guard closes stale WebKit detail layer after browser back", async () => {
  const source = await read("../detail-history-stability.js");
  assertModuleSyntax(source, "detail-history-stability.js");
  assert.match(source, /popstate/);
  assert.match(source, /hashchange/);
  assert.match(source, /classList\.remove\("is-open"\)/);
  assert.match(source, /aria-hidden/);
  assert.match(source, /layer\.hidden = true/);
  assert.match(source, /requestAnimationFrame/);
});
