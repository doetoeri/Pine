import test from "node:test";
import assert from "node:assert/strict";
import { dispatchNotificationFrequencyExperiment } from "../notification-frequency-experiment.mjs";
import { inspectNotificationReadiness, retireLegacyNotificationStudy } from "../notification-study-readiness.mjs";
import { studyDefaults } from "../../next/experiment/notification-study.js";

// A document/transaction adapter exercises the real dispatcher without any
// production credentials or network sends. Transactions serialize claims.
class MemoryDb {
  constructor() { this.rows = new Map(); this.lock = Promise.resolve(); }
  collection(path) { return new Collection(this, path); }
  batch() { const ops = []; return { set: (ref, value) => ops.push(() => ref.set(value)), commit: async () => { for (const op of ops) await op(); } }; }
  async runTransaction(fn) {
    const previous = this.lock; let unlock;
    this.lock = new Promise((resolve) => { unlock = resolve; }); await previous;
    const writes = [];
    try {
      this.beforeClaim?.();
      const result = await fn({ get: (ref) => ref.get(), set: (ref, value, options) => writes.push(() => ref.set(value, options)) });
      for (const write of writes) await write();
      return result;
    } finally { unlock(); }
  }
}
class Collection {
  constructor(db, path, filters = []) { Object.assign(this, { db, path, filters }); }
  doc(id) { return new Document(this.db, `${this.path}/${id}`); }
  where(field, op, value) { return new Collection(this.db, this.path, [...this.filters, [field, op, value]]); }
  async get() {
    const docs = [...this.db.rows.entries()].filter(([path, value]) => path.startsWith(`${this.path}/`)
      && !path.slice(this.path.length + 1).includes("/") && this.filters.every(([field, , match]) => value[field] === match))
      .map(([path]) => new Document(this.db, path).snapshot());
    return { docs, size: docs.length };
  }
}
class Document {
  constructor(db, path) { this.db = db; this.path = path; this.id = path.split("/").at(-1); }
  collection(name) { return new Collection(this.db, `${this.path}/${name}`); }
  snapshot() { return { id: this.id, ref: this, exists: this.db.rows.has(this.path), data: () => this.db.rows.get(this.path) }; }
  async get() { return this.snapshot(); }
  async set(value, options = {}) { this.db.rows.set(this.path, options.merge ? { ...this.db.rows.get(this.path), ...value } : { ...value }); }
  async create(value) { if (this.db.rows.has(this.path)) throw Object.assign(new Error("exists"), { code: 6 }); await this.set(value); }
  async update(value) { await this.set(value, { merge: true }); }
  async delete() { this.db.rows.delete(this.path); }
}
const ROOT = "schools/gochon-high";
function fixture() {
  const db = new MemoryDb();
  db.rows.set(`${ROOT}/experiments/notification-frequency`, { ...studyDefaults(), status: "ACTIVE", version: 3,
    startDate: "2026-10-26", baselineDays: 0, periodDays: 1 });
  db.rows.set(`${ROOT}/experimentFlags/notification_experiment`, { enabled: true });
  db.rows.set(`${ROOT}/experiments/pincon-next-ui`, { status: "DRAFT" });
  for (const [uid, sequence] of [["uid-low", ["LOW", "MID", "HIGH"]], ["uid-high", ["HIGH", "LOW", "MID"]]]) {
    const anonymousParticipant = `participant_${uid.replaceAll("-", "")}_12345678901234`;
    db.rows.set(`${ROOT}/users/${uid}`, { uid, classKey: "1-8", status: "ACTIVE" });
    db.rows.set(`${ROOT}/experimentParticipants/${uid}`, { anonymousParticipant });
    db.rows.set(`${ROOT}/experiments/notification-frequency/assignments/${uid}`, { experimentVersion: 3, sequence, anonymousParticipant });
    db.rows.set(`${ROOT}/pushSubscriptions/${uid}`, { ownerUid: uid, token: `${uid}-long-test-token`, enabled: true, classKey: "1-8", preferences: {} });
  }
  const sent = [];
  return { db, sent, messaging: { send: async (payload) => { sent.push(payload); return "fake-fcm-accepted"; } } };
}
const at = (hour) => new Date(`2026-10-26T${String(hour).padStart(2, "0")}:10:00+09:00`);
const receipts = (db) => [...db.rows.entries()].filter(([path]) => path.startsWith(`${ROOT}/notificationExperimentReceipts/`)).map(([, data]) => data);
test("actual dispatcher sends zero vs three, skips classes, and repeated runs cannot duplicate a dose", async () => {
  const f = fixture();
  for (const hour of [8, 8, 10, 13, 17, 17, 19, 19]) await dispatchNotificationFrequencyExperiment({ ...f, now: at(hour) });
  assert.equal(f.sent.length, 3);
  assert.ok(f.sent.every((row) => row.token.startsWith("uid-high")));
  assert.deepEqual(f.sent.map((row) => Number(row.data.slotIndex)), [0, 2, 3]);
  assert.ok(f.sent.every((row) => row.data.experimentVersion === "3" && row.data.link === "https://pincon.app/new/"));
  assert.equal(receipts(f.db).filter((row) => row.status === "fcm-accepted").length, 3);
});
test("v3 needs no obsolete UI promotion but still refuses simultaneous UI experimentation", async () => {
  const f = fixture();
  assert.equal((await dispatchNotificationFrequencyExperiment({ ...f, now: at(8) })).sent, 1);
  f.db.rows.set(`${ROOT}/experiments/pincon-next-ui`, { status: "ACTIVE" });
  assert.equal((await dispatchNotificationFrequencyExperiment({ ...f, now: at(17) })).active, false);
});
test("baseline enrolls everyone without sending experiment pushes", async () => {
  const f = fixture();
  f.db.rows.get(`${ROOT}/experiments/notification-frequency`).baselineDays = 2;
  const result = await dispatchNotificationFrequencyExperiment({ ...f, now: at(8) });
  assert.equal(result.phase, "BASELINE"); assert.equal(result.preassigned, 2); assert.equal(f.sent.length, 0);
});
test("pause during claim blocks a send even after the initial active check", async () => {
  const f = fixture();
  f.db.beforeClaim = () => { f.db.rows.get(`${ROOT}/experimentFlags/notification_experiment`).enabled = false; };
  await dispatchNotificationFrequencyExperiment({ ...f, now: at(8) });
  assert.equal(f.sent.length, 0); assert.equal(receipts(f.db).length, 0);
});
test("a failed send retries the same receipt, rather than counting another notification", async () => {
  const f = fixture(); let attempts = 0;
  f.messaging.send = async (payload) => { if (++attempts === 1) throw Object.assign(new Error("temporary"), { code: "messaging/server-unavailable" }); f.sent.push(payload); };
  await dispatchNotificationFrequencyExperiment({ ...f, now: at(8) });
  await dispatchNotificationFrequencyExperiment({ ...f, now: at(8) });
  await dispatchNotificationFrequencyExperiment({ ...f, now: at(8) });
  assert.equal(attempts, 2); assert.equal(f.sent.length, 1); assert.equal(receipts(f.db).length, 1);
  assert.equal(receipts(f.db)[0].attemptCount, 2);
});
test("readiness does not reveal tokens and explicit account opt-in overrides stale device preferences", async () => {
  const f = fixture();
  f.db.rows.get(`${ROOT}/pushSubscriptions/uid-high`).preferences.notificationExperiment = false;
  f.db.rows.set(`${ROOT}/notificationExperimentPreferences/uid-high`, { enabled: true });
  await inspectNotificationReadiness(f.db, at(8));
  const device = f.db.rows.get(`${ROOT}/notificationStudyDevices/uid-high`);
  assert.equal(device.pushRegistered, true); assert.ok(!JSON.stringify(device).includes("token"));
  await dispatchNotificationFrequencyExperiment({ ...f, now: at(8) }); assert.equal(f.sent.length, 1);
  f.db.rows.set(`${ROOT}/notificationExperimentPreferences/uid-high`, { enabled: false });
  await dispatchNotificationFrequencyExperiment({ ...f, now: at(17) }); assert.equal(f.sent.length, 1);
});

test("release retires the obsolete active experiment once and preserves its assignments", async () => {
  const f = fixture();
  const config = f.db.rows.get(`${ROOT}/experiments/notification-frequency`);
  delete config.studyMode; config.version = 2;
  assert.equal(await retireLegacyNotificationStudy(f.db), true);
  assert.equal(f.db.rows.get(`${ROOT}/experiments/notification-frequency`).status, "PAUSED");
  assert.equal(f.db.rows.get(`${ROOT}/experiments/notification-frequency/runs/legacy-v2`).assignments.length, 2);
  assert.equal(await retireLegacyNotificationStudy(f.db), false);
});
