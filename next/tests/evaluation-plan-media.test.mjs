import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("evaluation plans accept PDF and safe image formats", async () => {
  const [core, storage, admin] = await Promise.all([
    read("../core/evaluation-plan-media.js"),
    read("../../storage.rules"),
    read("../admin/evaluation-plan-media.js"),
  ]);

  for (const type of ["application/pdf", "image/jpeg", "image/png", "image/webp"]) {
    assert.match(core, new RegExp(type.replace("/", "\\/")));
  }
  assert.match(core, /10 \* 1024 \* 1024/);
  assert.match(core, /contentDisposition:\s*`inline/);
  assert.match(storage, /class-evaluation-plans/);
  assert.match(storage, /application\/pdf\|image\/\(jpeg\|png\|webp\)/);
  assert.match(admin, /image\/jpeg/);
  assert.match(admin, /image\/png/);
  assert.match(admin, /image\/webp/);
});

test("student evaluation plan detail renders authenticated inline previews", async () => {
  const [core, preview, css, bootstrap, html] = await Promise.all([
    read("../core/evaluation-plan-media.js"),
    read("../evaluation-plan-preview.js"),
    read("../evaluation-plan-preview.css"),
    read("../app-bootstrap.js"),
    read("../index.html"),
  ]);

  assert.match(core, /previewEvaluationPlanFile/);
  assert.match(core, /getBlob/);
  assert.match(core, /URL\.createObjectURL/);
  assert.match(preview, /document\.createElement\("img"\)/);
  assert.match(preview, /document\.createElement\("iframe"\)/);
  assert.match(preview, /preview\.revoke\(\)/);
  assert.match(preview, /전체 화면으로 보기/);
  assert.match(css, /evaluation-plan-preview__frame/);
  assert.match(bootstrap, /core\/evaluation-plan-media\.js/);
  assert.match(bootstrap, /evaluation-plan-preview\.js/);
  assert.match(html, /evaluation-plan-preview\.css/);
});
