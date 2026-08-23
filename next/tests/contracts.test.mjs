import test from "node:test";
import assert from "node:assert/strict";

import { buildNotificationFeed } from "../core/notification-store.js";
import {
  NEXT_ROLE,
  PERMISSION,
  canAccess,
  createAuditEvent,
  resolveNextAccess,
  restorePatch,
  softDeletePatch,
} from "../core/trust-model.js";

test("notification feed combines canonical class sources and excludes hidden records", () => {
  const feed = buildNotificationFeed({
    announcements: [
      { id: "a1", title: "공지", updatedAtMs: 200 },
      { id: "deleted", title: "삭제됨", deleted: true, updatedAtMs: 400 },
    ],
    classAssignments: [
      { id: "w1", title: "수학 수행", dueDate: "2026-08-25", updatedAtMs: 300 },
    ],
    events: [
      { id: "draft", title: "초안 행사", status: "draft", updatedAtMs: 500 },
    ],
  });

  assert.deepEqual(feed.map((item) => item.id), ["assignment:w1", "announcement:a1"]);
  assert.equal(feed[0].route, "schedule");
  assert.equal(feed[1].route, "today");
});

test("legacy manager mapping never opens the Beta write gate", () => {
  const access = resolveNextAccess({
    user: { uid: "user-1", displayName: "Manager" },
    classKey: "1-8",
    legacyRole: { enabled: true, level: "class", classKeys: ["1-8"] },
  });

  assert.equal(access.role, NEXT_ROLE.MANAGER);
  assert.equal(access.signedIn, true);
  assert.equal(access.canRead, true);
  assert.equal(access.canWrite, false);
  assert.equal(canAccess(access, PERMISSION.ARCHIVE), false);
});

test("audit and recovery contracts retain actor and time metadata", () => {
  const deleted = softDeletePatch({ actorUid: "u1", now: 1000 });
  const restored = restorePatch({ actorUid: "u2", now: 2000 });
  const audit = createAuditEvent({
    action: "archive",
    actorUid: "u1",
    actorRole: NEXT_ROLE.MANAGER,
    classKey: "1-8",
    collection: "announcements",
    recordId: "a1",
    before: { title: "공지" },
    after: deleted,
    now: 1000,
  });

  assert.equal(deleted.deleted, true);
  assert.equal(deleted.status, "archived");
  assert.equal(restored.deleted, false);
  assert.equal(restored.status, "active");
  assert.equal(audit.actorUid, "u1");
  assert.equal(audit.occurredAtMs, 1000);
  assert.equal(audit.recordId, "a1");
});
