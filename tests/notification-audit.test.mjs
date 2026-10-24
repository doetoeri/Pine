import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildNotificationAudit, nextNotificationPeriod, notificationAuditMarkup } from "../next/admin/notification-audit-view.js";

const config = {
  status: "ACTIVE", version: 2, startDate: "2026-10-22",
  baselineDays: 2, periodDays: 4, schoolDaysOnly: true,
};

const accounts = [
  { uid: "uid-a", studentNumber: "10001", name: "학생 A", status: "ACTIVE" },
  { uid: "uid-b", studentNumber: "10002", name: "<script>alert(1)</script>", status: "ACTIVE" },
];
const assignments = [
  { id: "uid-a", anonymousParticipant: "participant_a", experimentVersion: 2, sequence: ["MID","HIGH","LOW"] },
  { id: "uid-b", anonymousParticipant: "participant_b", experimentVersion: 2, sequence: ["LOW","MID","HIGH"] },
];
const receipts = [
  {
    id: "nexp_sent_a", notificationId: "nexp_sent_a", anonymousParticipant: "participant_a",
    experimentVersion: 2, period: 1, condition: "MID", title: "학급 일정", body: "예정표 확인",
    status: "fcm-accepted", scheduledAtMs: Date.parse("2026-10-26T04:00:00Z"),
  },
  {
    id: "nexp_failed_b", notificationId: "nexp_failed_b", anonymousParticipant: "participant_b",
    experimentVersion: 2, period: 1, condition: "LOW",
    status: "send-failed", scheduledAtMs: Date.parse("2026-10-26T04:00:00Z"),
  },
  {
    id: "nexp_old", notificationId: "nexp_old", anonymousParticipant: "participant_a",
    experimentVersion: 1, status: "fcm-accepted", scheduledAtMs: Date.parse("2026-10-22T04:00:00Z"),
  },
];
const events = [
  { experimentVersion: 2, eventType: "notification_received", properties: { notificationId: "nexp_sent_a" } },
  { experimentVersion: 2, eventType: "notification_click", properties: { notificationId: "nexp_sent_a" } },
  { experimentVersion: 2, eventType: "notification_click", properties: { notificationId: "nexp_sent_a" } },
  { experimentVersion: 2, eventType: "notification_click", properties: { notificationId: "nexp_old" } },
];

test("weekend OFF_DAY shows the next scheduled period rather than treating all as unassigned", () => {
  const saturday = new Date("2026-10-24T03:00:00Z");
  const next = nextNotificationPeriod(config, saturday);
  assert.equal(next?.period, 1);
  assert.equal(next?.date.toISOString().slice(0, 10), "2026-10-26");
  const audit = buildNotificationAudit({ config, assignments, roster: accounts, now: saturday });
  assert.equal(audit.state.phase, "OFF_DAY");
  assert.equal(audit.period, 1);
  assert.equal(audit.members[0].currentCondition, "MID");
  assert.equal(audit.members[1].currentCondition, "LOW");
  assert.deepEqual(audit.members[0].sequence, ["MID", "HIGH", "LOW"]);
});

test("FCM acceptance, service-worker received and click are three different counts", () => {
  const audit = buildNotificationAudit({
    config, assignments, receipts, events, roster: accounts,
    now: new Date("2026-10-26T03:00:00Z"),
  });
  assert.equal(audit.storedReceipts, 2);
  assert.equal(audit.accepted, 1);
  assert.equal(audit.received, 1);
  assert.equal(audit.opened, 1);
  assert.equal(audit.members[0].accepted, 1);
  assert.equal(audit.members[0].received, 1);
  assert.equal(audit.members[0].opened, 1);
  assert.equal(audit.members[1].accepted, 0);
  assert.equal(audit.recent[0].title, "학급 일정");
});

test("all student labels and notification copy are escaped before rendering", () => {
  const html = notificationAuditMarkup({ config, assignments, receipts, events, roster: accounts });
  assert.match(html, /학생별 조건 및 반응/);
  assert.match(html, /FCM 수락/);
  assert.match(html, /학급 일정/);
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("read-only dashboard is system-admin gated and uses private receipt collection", async () => {
  const [admin, platform, rules, sender] = await Promise.all([
    readFile(new URL("../next/admin/experiments.js", import.meta.url), "utf8"),
    readFile(new URL("../next/experiment/experiment-service.js", import.meta.url), "utf8"),
    readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
    readFile(new URL("../automation/notification-frequency-experiment.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(admin, /snap\.access\?\.role !== "system-admin"/);
  assert.match(admin, /notificationAuditMarkup\(\{ \.\.\.bundle, roster \}\)/);
  assert.match(platform, /notificationExperimentReceipts/);
  assert.match(platform, /receipts: receiptsSnap/);
  assert.match(rules, /match \/schools\/\{schoolId\}\/notificationExperimentReceipts\/\{receiptId\}/);
  assert.match(rules, /allow read: if schoolAdmin\(schoolId\)/);
  assert.match(sender, /title: String\(candidate\.title/);
  assert.match(sender, /body: String\(candidate\.body/);
});
