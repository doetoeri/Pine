import test from "node:test";
import assert from "node:assert/strict";

import { adminAccessState, archivedRecords, canEnterAdmin, normalizedAuditLogs } from "../core/admin-policy.js";
import { NEXT_ROLE } from "../core/trust-model.js";

test("admin entry requires an authenticated manager role", () => {
  assert.equal(canEnterAdmin({ signedIn: false, role: NEXT_ROLE.SYSTEM_ADMIN }), false);
  assert.equal(canEnterAdmin({ signedIn: true, role: NEXT_ROLE.VIEWER }), false);
  assert.equal(canEnterAdmin({ signedIn: true, role: NEXT_ROLE.EDITOR }), false);
  assert.equal(canEnterAdmin({ signedIn: true, role: NEXT_ROLE.MANAGER }), true);
  assert.equal(canEnterAdmin({ signedIn: true, role: NEXT_ROLE.SYSTEM_ADMIN }), true);
});

test("admin state reports write-enabled mode for an authenticated manager", () => {
  const state = adminAccessState({ signedIn: true, role: NEXT_ROLE.MANAGER });
  assert.equal(state.allowed, true);
  assert.equal(state.mode, "write-enabled");
  assert.match(state.message, /서버 권한/);
});

test("signed out and viewer states do not reveal the dashboard", () => {
  assert.deepEqual(adminAccessState({ signedIn: false, role: NEXT_ROLE.VIEWER }).allowed, false);
  assert.equal(adminAccessState({ signedIn: true, role: NEXT_ROLE.VIEWER }).mode, "forbidden");
});

test("audit logs accept supported legacy keys and sort newest first", () => {
  const rows = normalizedAuditLogs({
    auditLogs: [
      { recordId: "old", occurredAtMs: 100 },
      { recordId: "new", occurredAtMs: 300 },
      { recordId: "middle", occurredAtMs: 200 },
    ],
  });
  assert.deepEqual(rows.map((item) => item.recordId), ["new", "middle", "old"]);
});

test("archive inventory only returns soft deleted or archived records", () => {
  const rows = archivedRecords({
    announcements: [
      { id: "active", status: "active", deleted: false },
      { id: "deleted", deleted: true, deletedAtMs: 30 },
    ],
    resources: [
      { id: "archived", status: "archived", updatedAtMs: 20 },
      { id: "approved", status: "approved" },
    ],
    metadata: { ignored: true },
  });

  assert.deepEqual(rows.map(({ item }) => item.id), ["deleted", "archived"]);
});
