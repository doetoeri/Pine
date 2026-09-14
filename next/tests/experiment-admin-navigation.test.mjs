import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const admin = fs.readFileSync(new URL("../admin/admin.js", import.meta.url), "utf8");
const experiments = fs.readFileSync(new URL("../admin/experiments.js", import.meta.url), "utf8");
const adminCss = fs.readFileSync(new URL("../admin/admin.css", import.meta.url), "utf8");
const experimentCss = fs.readFileSync(new URL("../admin/experiments.css", import.meta.url), "utf8");
const indexHtml = fs.readFileSync(new URL("../admin/index.html", import.meta.url), "utf8");

test("system admin gets a dedicated experiment statistics navigation item", () => {
  assert.match(admin, /snapshot\.access\?\.role === "system-admin"/);
  assert.match(admin, /\["experiments", "science", "실험 · 통계", ""\]/);
  assert.match(admin, /activeAdminTarget === "experiments"/);
});

test("experiment navigation switches the admin workspace instead of only scrolling", () => {
  assert.match(admin, /admin-workspace--experiments/);
  assert.match(admin, /pincon-admin-view-change/);
  assert.match(adminCss, /admin-workspace--experiments > :not\(\.admin-topbar\):not\(#pinconExperimentAdmin\)/);
});

test("experiment module starts its own gateway and renders as a dedicated view", () => {
  assert.match(experiments, /await gateway\.start\(\)/);
  assert.match(experiments, /workspace\.insertAdjacentHTML\("beforeend", markup\(\)\)/);
  assert.match(experiments, /experimentViewOpen\(\)/);
  assert.match(experiments, /if \(!document\.querySelector\("#pinconExperimentAdmin"\)\) render\(\)/);
});

test("experiment dashboard exposes visual comparisons and cache-busted assets", () => {
  assert.match(experiments, /compareBar\("핵심 정보 도달률"/);
  assert.match(experiments, /conditionBar\("알림 클릭률"/);
  assert.match(experimentCss, /\.experiment-comparison/);
  assert.match(indexHtml, /experiments\.css\?v=20260914-exp2/);
  assert.match(indexHtml, /bootstrap\.js\?v=20260914-exp2/);
});
