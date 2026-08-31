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

test("daily brief v2 separates data, renderer and UI while remaining deterministic", async () => {
  const [ui, data, renderer] = await Promise.all([
    read("../admin/daily-brief-image.js"),
    read("../admin/daily-brief-data.js"),
    read("../admin/daily-brief-renderer.js"),
  ]);
  assertModuleSyntax(ui, "daily-brief-image.js");
  assertModuleSyntax(data, "daily-brief-data.js");
  assertModuleSyntax(renderer, "daily-brief-renderer.js");

  assert.match(renderer, /width:\s*1080/);
  assert.match(renderer, /height:\s*1350/);
  assert.match(ui, /canvas\.toBlob/);
  assert.match(ui, /"image\/jpeg"/);
  assert.match(data, /neisTimetables/);
  assert.match(data, /classAssignments/);
  assert.match(data, /academicSchedules/);
  assert.match(data, /announcements/);
  assert.match(data, /meals/);
  assert.match(data, /checklist/);
  assert.match(data, /tomorrow/);
  assert.match(renderer, /Material|오늘 필요한 것만/);
  assert.match(ui, /생성형 AI는 사용하지 않습니다/);
  for (const source of [ui, data, renderer]) {
    assert.doesNotMatch(source, /\bfetch\s*\(/);
    assert.doesNotMatch(source, /openai|gemini|anthropic|image_gen/i);
  }
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
