import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("mobile admin navigation cancels long smooth-scroll chains", async () => {
  const [source, bootstrap] = await Promise.all([
    read("next/admin/admin-nav-performance.js"),
    read("next/admin/bootstrap.js"),
  ]);

  assert.match(source, /max-width:\s*820px/);
  assert.match(source, /behavior:\s*"auto"/);
  assert.match(source, /stopImmediatePropagation\(\)/);
  assert.match(source, /addEventListener\("click",\s*handleMobileTargetClick,\s*true\)/);
  assert.doesNotMatch(source, /behavior:\s*"smooth"/);
  assert.match(bootstrap, /admin-nav-performance\.js/);
});

test("mobile admin navigation observer watches shell replacement only", async () => {
  const source = await read("next/admin/admin-nav-performance.js");
  assert.match(source, /observe\(root,\s*\{\s*childList:\s*true\s*\}\)/);
  assert.doesNotMatch(source, /subtree:\s*true/);
});
