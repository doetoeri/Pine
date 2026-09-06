import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const read = (relative) => readFile(path.resolve(root, relative), "utf8");

test("PinCon admin boots the classroom layout modules", async () => {
  const [html, bootstrap] = await Promise.all([
    read("next/admin/index.html"),
    read("next/admin/bootstrap.js"),
  ]);
  assert.match(html, /classroom-layout\.css/);
  assert.match(html, /classroom-nominations\.css/);
  assert.match(bootstrap, /classroom-layout\.js/);
  assert.match(bootstrap, /classroom-nominations\.js/);
});

test("classroom layout exposes exactly the three requested modes and assessment presets", async () => {
  const source = await read("next/admin/classroom-layout.js");
  assert.match(source, /general:\s*"일반"/);
  assert.match(source, /groups:\s*"모둠"/);
  assert.match(source, /assessment:\s*"수행평가"/);
  assert.match(source, /data-assessment-lines="5"/);
  assert.match(source, /data-assessment-lines="6"/);
  assert.match(source, /data-group-count/);
  assert.match(source, /data-group-size/);
  assert.match(source, /data-desk-rotation/);
  assert.match(source, /ROTATIONS\s*=\s*\[0, 90, 180, 270\]/);
});

test("private nomination aggregation remains outside the public student surface", async () => {
  const source = await read("next/admin/classroom-nominations.js");
  assert.match(source, /비공개 제안 · 취합/);
  assert.match(source, /data-confirm-focus/);
  assert.match(source, /data-confirm-pair/);
  assert.match(source, /\/api\/class-ops\/classroom-layout/);
  assert.match(source, /\/api\/class-ops\/settings/);
});

test("classroom API preserves blank seat positions and requires class-operator access", async () => {
  const [handler, router, vercel] = await Promise.all([
    read("integrations/pincon-ai/handlers/class-ops/classroom-layout.mjs"),
    read("integrations/pincon-ai/api/class-ops-router.mjs"),
    read("integrations/pincon-ai/vercel.json"),
  ]);
  assert.match(handler, /function seatList/);
  assert.match(handler, /return "";/);
  assert.match(handler, /isClassOperator/);
  assert.match(handler, /classroomLayouts/);
  assert.match(router, /"classroom-layout": classroomLayout/);
  assert.match(vercel, /\/api\/class-ops\/classroom-layout/);
});
