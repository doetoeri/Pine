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

test("evaluation plan v2 owns upload validation without prototype monkey patches", async () => {
  const [service, compatibility, storage] = await Promise.all([
    read("../evaluation-plans/service.js"),
    read("../core/evaluation-plan-media.js"),
    read("../../storage.rules"),
  ]);

  assertModuleSyntax(service, "service.js");
  for (const type of ["application/pdf", "image/jpeg", "image/png", "image/webp"]) {
    assert.match(service, new RegExp(type.replace("/", "\\/")));
  }
  assert.match(service, /10 \* 1024 \* 1024/);
  assert.match(service, /class-evaluation-plans/);
  assert.match(service, /contentDisposition:\s*`inline/);
  assert.match(service, /adminWrite\("evaluationPlans"/);
  assert.match(service, /deleteObject/);
  assert.doesNotMatch(service, /prototype\.uploadFile/);
  assert.doesNotMatch(compatibility, /prototype/);
  assert.match(compatibility, /evaluation-plans\/service\.js/);
  assert.match(storage, /class-evaluation-plans/);
  assert.match(storage, /application\/pdf\|image\/\(jpeg\|png\|webp\)/);
});

test("administrator workflow removes the legacy editor instead of hiding it", async () => {
  const [admin, compatibility, css] = await Promise.all([
    read("../evaluation-plans/admin.js"),
    read("../admin/evaluation-plan-media.js"),
    read("../evaluation-plans/evaluation-plans.css"),
  ]);

  assertModuleSyntax(admin, "admin.js");
  assert.match(admin, /managed-evaluationPlans-title/);
  assert.match(admin, /legacySection\(\)\?\.remove\(\)/);
  assert.doesNotMatch(admin, /legacy\.hidden\s*=/);
  assert.match(admin, /평가계획서 등록/);
  assert.match(admin, /학생 공개 · 검토 중/);
  assert.match(admin, /원본 확인 완료/);
  assert.match(admin, /application\/pdf,image\/jpeg,image\/png,image\/webp/);
  assert.match(admin, /service\.save/);
  assert.match(admin, /service\.archive/);
  assert.doesNotMatch(admin, /MutationObserver/);
  assert.match(compatibility, /evaluation-plans\/admin\.js/);
  assert.match(css, /evaluation-plan-admin__grid/);
});

test("student library owns a full-width surface and never mutates the old surface contents", async () => {
  const [student, compatibility, css, bootstrap, html] = await Promise.all([
    read("../evaluation-plans/student.js"),
    read("../evaluation-plan-preview.js"),
    read("../evaluation-plans/evaluation-plans.css"),
    read("../app-bootstrap.js"),
    read("../index.html"),
  ]);

  assertModuleSyntax(student, "student.js");
  assert.match(student, /평가계획서 과목 필터/);
  assert.match(student, /data-evaluation-plan-library-host/);
  assert.match(student, /legacy\.outerHTML\s*=\s*html/);
  assert.doesNotMatch(student, /surface\.innerHTML\s*=\s*libraryMarkup/);
  assert.match(student, /data-evaluation-plan-open/);
  assert.match(student, /service\.preview/);
  assert.match(student, /<iframe/);
  assert.match(student, /<img/);
  assert.match(student, /전체 화면으로 보기/);
  assert.match(student, /evaluation-plan:evaluationPlans:/);
  assert.doesNotMatch(student, /MutationObserver/);
  assert.match(compatibility, /evaluation-plans\/student\.js/);
  assert.match(css, /evaluation-plan-library-surface/);
  assert.match(css, /grid-column:\s*1 \/ -1/);
  assert.match(css, /evaluation-plan-viewer__preview/);
  assert.match(bootstrap, /evaluation-plan-preview\.js/);
  assert.match(html, /evaluation-plan-preview\.css/);
});
