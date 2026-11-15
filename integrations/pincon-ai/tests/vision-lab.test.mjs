import assert from "node:assert/strict";
import { test } from "node:test";
import { createVisionLabHandler } from "../handlers/class-ops/vision-lab.mjs";

function fixture() {
  let visibility = false;
  const calls = { reads: 0, specimens: 0, writes: [] };
  const identities = {
    school: { uid: "school-test", roles: ["ADMIN"] },
    president: { uid: "president-test", roles: ["CLASS_PRESIDENT"] },
    student: { uid: "student-test", roles: ["STUDENT"] },
  };
  const handler = createVisionLabHandler({
    identify: async (req, config) => {
      assert.deepEqual(config.legacyLevels, ["school"]);
      const profile = identities[req.headers.authorization?.replace("Bearer ", "")];
      if (!profile) throw Object.assign(new Error("invalid identity"), { status: 401 });
      return { profile };
    },
    readSetting: async () => { calls.reads++; return visibility; },
    writeSetting: async (value, uid) => { visibility = value; calls.writes.push([value, uid]); },
    compare: async () => { calls.specimens++; return { before: "test-before", after: "test-after" }; },
  });
  async function request({ actor, view, method = "GET", body } = {}) {
    const requestHeaders = { origin: "https://pincon.app" };
    if (actor) requestHeaders.authorization = `Bearer ${actor}`;
    const reply = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(payload) { this.body = payload ? JSON.parse(payload) : undefined; } };
    await handler({ url: "/api/class-ops/vision-lab" + (view ? `?view=${view}` : ""), method, body, headers: requestHeaders }, reply);
    return reply;
  }
  return { request, calls };
}

test("private Vision Lab checks every request and keeps the specimen out of guest and student responses", async () => {
  const { request, calls } = fixture();
  for (const actor of [undefined, "student", "president"]) {
    const status = await request({ actor, view: "status" });
    assert.equal(status.statusCode, 200);
    assert.deepEqual(status.body, { available: false });
    const content = await request({ actor });
    assert.equal(content.statusCode, 403);
    assert.equal(content.body.comparison, undefined);
    assert.equal(content.headers["cache-control"], "no-store");
  }
  assert.equal((await request({ actor: "expired" })).statusCode, 401);
  assert.equal(calls.specimens, 0);
  const allowed = await request({ actor: "school" });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.body.comparison.before, "test-before");
  assert.deepEqual((await request({ actor: "school", view: "status" })).body, { available: true });
});

test("only school administrators can update visibility and a later request follows the stored setting", async () => {
  const { request, calls } = fixture();
  assert.equal((await request({ view: "settings" })).statusCode, 401);
  assert.equal((await request({ actor: "president", view: "settings" })).statusCode, 403);
  assert.equal((await request({ actor: "student", method: "POST", body: { public: true, roles: ["ADMIN"] } })).statusCode, 403);
  assert.equal((await request({ actor: "school", method: "POST", body: { public: "true" } })).statusCode, 400);
  assert.deepEqual(calls.writes, []);
  const publish = await request({ actor: "school", method: "POST", body: { public: true } });
  assert.deepEqual(publish.body, { public: true });
  assert.equal((await request()).statusCode, 200);
  assert.deepEqual((await request({ actor: "school", view: "settings" })).body, { public: true });
  assert.deepEqual((await request({ view: "status" })).body, { available: true });
  await request({ actor: "school", method: "POST", body: { public: false } });
  assert.equal((await request()).statusCode, 403);
  assert.deepEqual(calls.writes, [[true, "school-test"], [false, "school-test"]]);
  const options = await request({ method: "OPTIONS" });
  assert.equal(options.statusCode, 204);
  assert.match(options.headers.vary, /Authorization/);
});
