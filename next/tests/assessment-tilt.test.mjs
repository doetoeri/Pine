import test from "node:test";
import assert from "node:assert/strict";
import { gravityTilt, tiltDrive, advanceTilt } from "../assessments/tilt-physics.js";

const screenTilt = (beta, gamma, angle = 0) => {
  const b = beta * Math.PI / 180, g = gamma * Math.PI / 180;
  return gravityTilt(-9.8 * Math.sin(g) * Math.cos(b), 9.8 * Math.sin(b), 9.8 * Math.cos(b) * Math.cos(g), angle);
};

test("display tilt handles upright, landscape, rotation and absent readings", () => {
  assert.ok(Math.abs(screenTilt(0, 20) - 20) < 1e-8);
  assert.ok(Math.abs(screenTilt(-20, 0, 90) - 20) < 1e-8);
  assert.ok(Math.abs(screenTilt(20, 0, -90) - 20) < 1e-8);
  assert.ok(Math.abs(screenTilt(0, 20, 180) + 20) < 1e-8);
  assert.ok(Math.abs(screenTilt(70, 90) - 20) < 1e-8);
  assert.equal(gravityTilt(null, 0, 9.8), null);
  assert.equal(gravityTilt(0, NaN, 9.8), null);
  assert.equal(gravityTilt(0, undefined, 9.8), null);
  assert.equal(gravityTilt(0, 0, 0), null);
  assert.equal(gravityTilt(0, 0, 30), null);
});

test("hand tremor stays quiet and stronger tilt increases a bounded speed", () => {
  for (const degrees of [-4, -2, 0, 2, 4]) assert.ok(tiltDrive(degrees) === 0);
  assert.ok(tiltDrive(24) > tiltDrive(12));
  assert.equal(tiltDrive(-12), -tiltDrive(12));
  assert.equal(tiltDrive(90), 1);
  assert.equal(tiltDrive(-90), -1);
  assert.equal(tiltDrive(NaN), 0);
});

const run = (drive, fps, duration = 1) => {
  let state = { position: 50, speed: 0 };
  for (let i = 0; i < fps * duration; i++) state = advanceTilt(state.position, state.speed, drive, 1 / fps, 100);
  return state;
};
test("holding a tilt accelerates progressively and stays consistent at 30/60/120fps", () => {
  const beginning = advanceTilt(50, 0, 1, 1 / 60, 100);
  const later = run(1, 60);
  assert.ok(beginning.speed > 0 && beginning.speed < later.speed);
  assert.ok(later.speed < 3.2 && later.speed > 3);
  assert.ok(run(tiltDrive(24), 60).position > run(tiltDrive(12), 60).position);
  for (const fps of [30, 120]) assert.ok(Math.abs(run(1, fps).position - later.position) < 1e-8);
  assert.ok(run(-1, 60).position < 50);
});

test("ends absorb velocity without overscroll or accumulated speed", () => {
  assert.deepEqual(advanceTilt(0, -3.2, -1, .05, 10), { position: 0, speed: 0 });
  assert.deepEqual(advanceTilt(10, 3.2, 1, .05, 10), { position: 10, speed: 0 });
  let state = { position: 9.99, speed: 3 };
  for (let i = 0; i < 300; i++) state = advanceTilt(state.position, state.speed, 1, .05, 10);
  assert.deepEqual(state, { position: 10, speed: 0 });
  const reverse = advanceTilt(state.position, state.speed, -1, .05, 10);
  assert.ok(reverse.position < 10 && reverse.speed < 0);
  assert.ok(advanceTilt(5, 0, 1, 10, 10).position < 5.1);
});
