import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTodayChanges,
  buildTodayChangesShareText,
  TODAY_CHANGES_WINDOW_MS,
} from "../core/today-changes.js";

const NOW = Date.parse("2026-09-05T12:00:00+09:00");

test("today changes includes recent public information and excludes stale or hidden rows", () => {
  const rows = buildTodayChanges({
    announcements: [
      { id: "a1", title: "준비물 안내", createdAtMs: NOW - 2 * 60 * 60 * 1000 },
      { id: "old", title: "오래된 공지", createdAtMs: NOW - TODAY_CHANGES_WINDOW_MS - 1 },
      { id: "deleted", title: "삭제 공지", createdAtMs: NOW - 1000, deleted: true },
    ],
    classAssignments: [
      { id: "task", title: "과학 수행평가", createdAtMs: NOW - 5 * 60 * 60 * 1000, published: true },
      { id: "draft-task", title: "비공개 과제", createdAtMs: NOW - 1000, published: false },
    ],
  }, { nowMs: NOW });

  assert.deepEqual(rows.map((row) => row.id), ["announcements:a1", "classAssignments:task"]);
  assert.equal(rows[0].changeType, "new");
  assert.equal(rows[1].route, "schedule");
});

test("timetable notices and genuinely updated records are labeled as changes", () => {
  const rows = buildTodayChanges({
    content: [{
      id: "change",
      kind: "notice",
      category: "수업 변경",
      title: "1학년 8반 시간표 변경",
      body: "3교시 통합과학 → 공통수학",
      clientCreatedAt: NOW - 30 * 60 * 1000,
    }],
    classAssignments: [{
      id: "edited",
      title: "영어 수행평가",
      createdAtMs: NOW - 3 * 60 * 60 * 1000,
      updatedAtMs: NOW - 30 * 60 * 1000,
      published: true,
    }],
  }, { nowMs: NOW });

  const timetable = rows.find((row) => row.id === "content:change");
  const assignment = rows.find((row) => row.id === "classAssignments:edited");
  assert.equal(timetable.route, "timetable");
  assert.equal(timetable.changeType, "changed");
  assert.equal(assignment.changeType, "changed");
});

test("share text is compact, class-scoped, and distinguishes new versus changed", () => {
  const text = buildTodayChangesShareText([
    { title: "시간표 변경", summary: "3교시 교실 변경", changeType: "changed" },
    { title: "수학 숙제", summary: "12쪽", changeType: "new" },
  ], { grade: 1, classNumber: 8 });

  assert.match(text, /1학년 8반/);
  assert.match(text, /\[변경\] 시간표 변경/);
  assert.match(text, /\[새로 등록\] 수학 숙제/);
  assert.match(text, /PinCon에서 최신 정보 확인/);
});
