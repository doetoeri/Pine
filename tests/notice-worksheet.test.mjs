import test from "node:test";
import assert from "node:assert/strict";

import { buildClassNotice } from "../pincon-class-ops-core.js";

test("buildClassNotice composes class information and omits unapproved resources", () => {
  const now = Date.now();
  const notice = buildClassNotice({
    neisTimetables: [{ date: "2026-08-24", periods: [{ period: 1, subject: "국어" }, { period: 2, subject: "수학", room: "수학실" }] }],
    classAssignments: [{ dueDate: "2026-08-24", type: "preparation", subject: "과학", title: "실험복" }],
    announcements: [{ title: "체육복 안내", body: "등교 전에 확인하세요.", priority: "important", updatedAtMs: now }],
    resources: [
      { title: "함수 복습 학습지", subject: "수학", moderationStatus: "approved", updatedAtMs: now },
      { title: "승인 전 자료", subject: "영어", moderationStatus: "pending", updatedAtMs: now },
    ],
    meals: [{ date: "2026-08-24", dishes: ["현미밥", "미역국"] }],
  }, {
    date: "2026-08-24",
    classLabel: "2학년 3반",
    detailUrl: "https://example.com/pincon?class-ops=1",
  });

  assert.match(notice, /2학년 3반/);
  assert.match(notice, /1교시 국어/);
  assert.match(notice, /준비물 · 과학 · 실험복/);
  assert.match(notice, /체육복 안내/);
  assert.match(notice, /수학 · 함수 복습 학습지/);
  assert.match(notice, /현미밥 · 미역국/);
  assert.match(notice, /https:\/\/example\.com\/pincon\?class-ops=1/);
  assert.doesNotMatch(notice, /승인 전 자료/);
});

test("buildClassNotice provides an editable empty-state message", () => {
  const notice = buildClassNotice({}, { date: "2026-08-25", classLabel: "1학년 1반" });
  assert.match(notice, /등록된 알림 항목이 없습니다/);
  assert.match(notice, /발송 전 날짜와 내용을/);
});
