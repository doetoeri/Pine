// Exercise the real HTTP handler with isolated auth/storage boundaries; no live class writes.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import * as planner from "../../integrations/pincon-ai/lib/seating-planner.mjs";

const roster = Array.from({ length: 34 }, (_, i) => ({ uid: `s${i}`, name: `예시 ${i}`, number: i + 1 }));
const ids = roster.map(s => s.uid);
const g = () => ({ rows: 6, cols: 6, sections: [6, 6, 5], seats: ids.concat(["", ""]), blocked: [34, 35], focusStudentIds: [], separationPairs: [], nominations: [{ id: "n1", studentUid: "s0", reason: "PRIVATE_REASON", proposerName: "PRIVATE_REPORTER" }], planner: planner.normalizePlanner({}, ids) });
async function harness() {
  let data = { classKey: "1-8", updatedAtMs: 100, classroomLayout: { mode: "groups", general: g(), groups: { groupCount: 2, sizes: [12, 12], members: [ids.slice(0, 12), ids.slice(12, 24)] }, assessment: { lines: 5, seats: ids }, display: { activeScene: "morning" } } };
  const touched = [], audits = []; let queue = Promise.resolve();
  const ref = { get: async () => ({ exists: true, data: () => structuredClone(data) }), set: async value => { data = structuredClone(value); } };
  ref.firestore = { runTransaction(fn) { const task = queue.then(() => fn({ get: () => ref.get(), set: (_ref, value) => { data = structuredClone(value); } })); queue = task.catch(() => {}); return task; } };
  const stubs = {
    "class-accounts.mjs": { ROLE: { ADMIN: "ADMIN", TEACHER: "TEACHER", CLASS_PRESIDENT: "CLASS_PRESIDENT", CLASS_VICE_PRESIDENT: "CLASS_VICE_PRESIDENT", DEPARTMENT_HEAD: "DEPARTMENT_HEAD" }, canReportClassroomLayout: a => a.viewer, canSeeClassroomReporter: a => a.roles.includes("ADMIN"), canViewClassroomLayout: a => a.viewer, corsHeaders: () => ({}), hasRole: (a, role) => a.roles.includes(role), isClassOperator: a => a.operator, requireProfileOrLegacy: async req => ({ profile: req.actor }) },
    "class-operations.mjs": { safeText: (s, n) => String(s || "").slice(0, n) },
    "class-ops-store.mjs": { appendOpsAudit: async row => audits.push(row), classUsers: async () => roster, document: (_collection, key) => { touched.push(key); return ref; } },
    "request.mjs": { jsonBody: async req => req.body, sendJson: (res, status, body) => { res.status = status; res.body = JSON.parse(JSON.stringify(body)); } },
    "seating-planner.mjs": planner,
  };
  const context = vm.createContext({ structuredClone, URL, console });
  const source = await readFile(new URL("../../integrations/pincon-ai/handlers/class-ops/classroom-layout.mjs", import.meta.url), "utf8");
  const module = new vm.SourceTextModule(source, { context });
  await module.link(specifier => {
    const exports = stubs[specifier.split("/").at(-1)]; if (!exports) throw new Error(specifier);
    return new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
  });
  await module.evaluate();
  const actor = { uid: "president", name: "예시 운영자", classKey: "1-8", roles: ["CLASS_PRESIDENT"], operator: true, viewer: true };
  return { touched, audits, data: () => data, async request(body, options = {}) { const res = {}; await module.namespace.default({ method: options.method || "POST", url: options.url || "/", body, actor: { ...actor, ...options.actor } }, res); return res; } };
}
const save = (general = g()) => ({ action: "SAVE_GENERAL", classKey: "1-8", baseUpdatedAtMs: 100, general });

test("seating-only save preserves groups, assessment and server nominations", async () => {
  const h = await harness(), next = g(); [next.seats[0], next.seats[1]] = [next.seats[1], next.seats[0]];
  next.nominations = []; next.planner.frontStudentIds = ["s0"];
  const result = await h.request(save(next));
  assert.equal(result.status, 200);
  assert.equal(h.data().classroomLayout.general.nominations[0].reason, "PRIVATE_REASON");
  assert.deepEqual(h.data().classroomLayout.groups.members[0], ids.slice(0, 12));
  assert.deepEqual(h.data().classroomLayout.assessment.seats, ids);
  assert.deepEqual(h.data().classroomLayout.general.previousSeats, g().seats);
  assert.deepEqual(h.data().classroomLayout.general.planner.frontStudentIds, ["s0"]);
});
test("stale/concurrent saves get 409 without overwriting the accepted seating", async () => {
  const h = await harness();
  const result = await Promise.all([h.request(save()), h.request(save())]);
  assert.deepEqual(result.map(r => r.status).sort(), [200, 409]);
  assert.equal(h.audits.length, 1);
});
test("ordinary viewers cannot save, and a president cannot target another class", async () => {
  const h = await harness();
  const denied = await h.request(save(), { actor: { operator: false } }); assert.equal(denied.status, 403); assert.equal(h.data().updatedAtMs, 100);
  const saved = await h.request({ ...save(), classKey: "2-7" }); assert.equal(saved.status, 200);
  assert.ok(h.touched.every(key => key === "1-8"));
});
test("invalid/unknown/duplicate/hidden seats cannot be saved", async () => {
  for (const change of [g => { g.seats[0] = "unknown"; }, g => { g.seats[0] = g.seats[1]; }, g => { g.seats[34] = g.seats[0]; g.seats[0] = ""; }, g => { g.sections = [6, 6, 6]; }]) {
    const h = await harness(), next = g(); change(next);
    assert.equal((await h.request(save(next))).status, 400); assert.equal(h.data().updatedAtMs, 100);
  }
});
test("distance conflicts require explicit acknowledgement before save", async () => {
  const h = await harness(), next = g(); next.separationPairs = [["s0", "s1"]];
  assert.equal((await h.request(save(next))).status, 400);
  assert.equal((await h.request({ ...save(next), acceptConflicts: true })).status, 200);
});
test("TV HTTP response excludes all private constraints even for an administrator", async () => {
  const h = await harness();
  const response = await h.request(null, { method: "GET", url: "/?projection=seating-tv", actor: { roles: ["ADMIN"] } });
  assert.equal(response.status, 200); assert.equal(response.body.projection, "seating-tv");
  assert.doesNotMatch(JSON.stringify(response.body), /PRIVATE|planner|focusStudentIds|separationPairs|nominations/);
});
