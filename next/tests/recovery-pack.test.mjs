import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRecoveryPack,
  recoveryProgress,
  setRecoveryItemCompleted,
} from "../core/recovery-pack.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

test("recovery pack collects only the selected day's visible class updates", () => {
  const pack = buildRecoveryPack({
    announcements: [
      { id: "a1", title: "준비물 안내", announcedDate: "2026-08-27" },
      { id: "a2", title: "다른 날 공지", announcedDate: "2026-08-26" },
    ],
    classAssignments: [
      { id: "w1", title: "과학 보고서", subject: "통과", announcedDate: "2026-08-27", verificationStatus: "changed" },
      { id: "hidden", title: "숨긴 초안", announcedDate: "2026-08-27", published: false },
    ],
    evaluationPlans: [
      { id: "p1", title: "통합과학 평가계획서", subject: "통과", announcedDate: "2026-08-27", status: "verified" },
      { id: "draft", title: "검토 전 문서", announcedDate: "2026-08-27", status: "draft" },
    ],
  }, "2026-08-27");

  assert.deepEqual(pack.map((item) => item.id).sort(), [
    "announcements:a1",
    "classAssignments:w1",
    "evaluationPlans:p1",
  ]);
  assert.match(pack.find((item) => item.id === "classAssignments:w1").action, /변경된/);
});

test("recovery progress is private to each class and date", () => {
  const storage = memoryStorage();
  setRecoveryItemCompleted(storage, "1-8", "2026-08-27", "classAssignments:w1", true);

  assert.equal(recoveryProgress(storage, "1-8", "2026-08-27")["classAssignments:w1"], true);
  assert.deepEqual(recoveryProgress(storage, "1-8", "2026-08-28"), {});
  assert.deepEqual(recoveryProgress(storage, "1-7", "2026-08-27"), {});

  setRecoveryItemCompleted(storage, "1-8", "2026-08-27", "classAssignments:w1", false);
  assert.deepEqual(recoveryProgress(storage, "1-8", "2026-08-27"), {});
});

