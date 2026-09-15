import test from "node:test";
import assert from "node:assert/strict";
import { constraintErrors, normalizePlanner, inspectSeating, seatingCandidates, seatDistance, publicSeatingView } from "../../integrations/pincon-ai/lib/seating-planner.mjs";

const ids = Array.from({ length: 34 }, (_, i) => `student-${i + 1}`);
function general(overrides = {}) {
  return { rows: 6, cols: 6, sections: [6, 6, 5], blocked: [34, 35], seats: ids.concat(["", ""]), focusStudentIds: ids.slice(0, 6), separationPairs: [[ids[0], ids[1]], [ids[4], ids[5]]], planner: normalizePlanner({}, ids), ...overrides };
}
function solve(g, options) { return [...seatingCandidates(g, ids, options)].at(-1); }

test("34 students occupy 12/12/10 seats once each, retaining front choices and fixed seats across seeds", () => {
  const g = general({ planner: normalizePlanner({ frontRows: 1, frontStudentIds: [ids[0], ids[1], ids[2]], lockedSeats: [{ uid: ids[0], index: 0 }, { uid: ids[33], index: 33 }] }, ids) });
  for (const seed of [1, 27, 510]) {
    const result = solve(g, { seed });
    assert.deepEqual(result.report.hard, []);
    assert.equal(result.seats[0], ids[0]); assert.equal(result.seats[33], ids[33]);
    assert.equal(new Set(result.seats.filter(Boolean)).size, 34);
    assert.equal(result.seats[34], ""); assert.equal(result.seats[35], "");
    assert.deepEqual([0, 1, 2].map(section => result.seats.filter((id, i) => id && Math.floor(i % 6 / 2) === section).length), [12, 12, 10]);
    for (const id of g.planner.frontStudentIds) assert.ok(result.seats.indexOf(id) < 6);
  }
});
test("feasible pair and focus constraints are satisfied, including diagonals", () => {
  const result = solve(general(), { seed: 713 });
  assert.equal(result.report.conflicts.length, 0);
  assert.equal(seatDistance(0, 7, 6), 1);
  assert.equal(result.progress, 1);
});
test("insufficient front capacity counts front seats occupied by other fixed students", () => {
  const g = general({ planner: normalizePlanner({ frontRows: 1, frontStudentIds: ids.slice(0, 6), lockedSeats: [{ uid: ids[10], index: 0 }] }, ids) });
  assert.match(constraintErrors(g, ids).join(" "), /앞자리가 1석 부족/);
  assert.throws(() => solve(g), /앞자리가/);
});
test("fixed seat conflicts and capacity errors stop generation", () => {
  const configs = [
    { blocked: [0, 34, 35] },
    { planner: normalizePlanner({ lockedSeats: [{ uid: ids[0], index: 0 }, { uid: ids[1], index: 0 }] }, ids) },
    { planner: normalizePlanner({ lockedSeats: [{ uid: ids[0], index: 34 }] }, ids) },
    { planner: normalizePlanner({ frontRows: 1, frontStudentIds: [ids[0]], lockedSeats: [{ uid: ids[0], index: 6 }] }, ids) },
  ];
  for (const config of configs) assert.throws(() => solve(general(config)));
});
test("impossible distance constraints remain reported without breaking hard constraints", () => {
  const g = general({ separationPairs: [[ids[0], ids[1]]], focusStudentIds: [], planner: normalizePlanner({ lockedSeats: [{ uid: ids[0], index: 0 }, { uid: ids[1], index: 1 }] }, ids) });
  const result = solve(g, { seed: 1, restarts: 2, iterations: 20 });
  assert.deepEqual(result.report.hard, []);
  assert.equal(result.report.conflicts.length, 1);
  assert.equal(result.report.conflicts[0].type, "pair");
});
test("manual corruption cannot pass validation", () => {
  const g = general();
  for (const seats of [ids.concat([ids[0], ""]), ids.slice(1), ["outsider", ...ids.slice(1), "", ""], [ids[0], ...ids.slice(0, 33)]]) {
    assert.ok(inspectSeating(g, ids, seats).hard.length);
  }
});
test("same seed is reproducible and optional seat rotation can find a derangement", () => {
  const g = general({ focusStudentIds: [], separationPairs: [], planner: normalizePlanner({ avoidPrevious: true }, ids) });
  const a = solve(g, { seed: 888 }), b = solve(g, { seed: 888 });
  assert.deepEqual(a.seats, b.seats); assert.equal(a.report.repeat, 0);
});
test("TV response is allowlisted and never includes constraints or reporter/student metadata", () => {
  const g = general(); g.nominations = [{ reason: "PRIVATE_REASON", proposerName: "PRIVATE_REPORTER" }];
  const tv = publicSeatingView({ classKey: "1-8", roster: ids.map(uid => ({ uid, name: "예시", number: 1, studentNumber: "PRIVATE_NUMBER", secret: "PRIVATE_SECRET" })), general: g, updatedAtMs: 10 });
  assert.doesNotMatch(JSON.stringify(tv), /PRIVATE_|planner|focusStudentIds|separationPairs|nominations|proposer|studentNumber/);
  assert.deepEqual(tv.general.sections, [6, 6, 5]);
  assert.equal(tv.general.seats.length, 36);
});
