import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const js = fs.readFileSync(new URL("../experiments/pincon-next-ui.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../experiments/pincon-next-ui.css", import.meta.url), "utf8");

test("Flux keeps live PinCon data instead of prototype fixtures", () => {
  assert.match(js, /NextDataGateway/);
  assert.match(js, /neisTimetables/);
  assert.match(js, /classAssignments/);
  assert.match(js, /academicSchedules/);
  assert.match(js, /announcements/);
  assert.match(js, /meals/);
});

test("Presence timeline exposes draggable lesson selection and Living Spine", () => {
  assert.match(js, /data-qf-cursor/);
  assert.match(js, /handlePointerMove/);
  assert.match(js, /selectLesson/);
  assert.match(js, /data-qf-spine-node/);
  assert.match(css, /\.qf-cursor/);
  assert.match(css, /\.qf-spine-node/);
});

test("Quiet Flux keeps elastic navigation, expandable context, and preparation completion", () => {
  assert.match(js, /data-qf-dock-wrap/);
  assert.match(js, /data-qf-prep/);
  assert.match(js, /data-qf-focus/);
  assert.match(js, /data-qf-notice-toggle/);
  assert.match(js, /data-qf-class-toggle/);
  assert.match(css, /\.qf-selector/);
  assert.match(css, /\.qf-task\.done/);
  assert.match(css, /\.qf-notice\.open/);
  assert.match(css, /\.qf-class-item\.open/);
});

test("Flux motion respects reduced-motion accessibility", () => {
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(js, /prefers-reduced-motion: reduce/);
});
