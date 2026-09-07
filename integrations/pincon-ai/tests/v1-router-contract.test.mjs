import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(root, "api");
const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
const router = fs.readFileSync(path.join(apiDir, "v1-router.mjs"), "utf8");

const V1_ROUTES = ["assignments", "events", "meals", "notices", "timetable", "today", "upcoming"];

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(resolved) : [resolved];
  });
}

test("all public v1 URLs are preserved through one router", () => {
  for (const route of V1_ROUTES) {
    const rewrite = vercel.rewrites.find((item) => item.source === `/api/v1/${route}`);
    assert.ok(rewrite, `missing rewrite for ${route}`);
    assert.equal(rewrite.destination, `/api/v1-router?route=${route}`);
    assert.match(router, new RegExp(`\\b${route}:`));
  }
});

test("legacy one-function-per-v1-route wrappers stay removed", () => {
  for (const route of V1_ROUTES) {
    assert.equal(fs.existsSync(path.join(apiDir, "v1", `${route}.mjs`)), false, `${route}.mjs should not return`);
  }
});

test("Vercel function source count remains below Hobby ceiling", () => {
  const functionFiles = filesUnder(apiDir).filter((file) => file.endsWith(".mjs"));
  assert.ok(functionFiles.length <= 12, `API function source count is ${functionFiles.length}; Hobby ceiling is 12`);
});
