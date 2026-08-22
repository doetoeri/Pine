import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateAnswers,
  academicSchedulesForGrade,
  buildNotificationDigest,
  buildPatchDraft,
  buildTodayFeed,
  isExamPeriod,
  isOpenWindow,
  kstDate,
  nextPatchVersion,
  safeExternalUrl,
  searchAll,
} from "../pincon-class-ops-core.js";

const NOW = Date.parse("2026-08-20T08:00:00+09:00");

test("KST 날짜가 기기 시간대와 무관하게 계산된다", () => {
  assert.equal(kstDate(NOW), "2026-08-20");
  assert.equal(kstDate(NOW, 1), "2026-08-21");
});

test("NEIS 학사일정은 선택한 학년에 해당하는 행사만 표시한다", () => {
  const rows = academicSchedulesForGrade([{
    date: "2026-08-21",
    events: ["1학년 행사", "2학년 행사"],
    eventsByGrade: { 1: ["1학년 행사"], 2: ["2학년 행사"], 3: [] },
  }], 2);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "2학년 행사");
  assert.deepEqual(academicSchedulesForGrade(rows, 3), []);
});

test("오늘 피드는 긴급 공지와 오늘 수행평가를 먼저 배치한다", () => {
  const rows = buildTodayFeed({
    announcements: [
      { id: "normal", title: "일반 공지", body: "내용", priority: "normal", createdAtMs: NOW },
      { id: "urgent", title: "긴급 공지", body: "내용", priority: "urgent", createdAtMs: NOW },
    ],
    classAssignments: [
      { id: "today", type: "assessment", title: "수학 수행평가", dueDate: "2026-08-20" },
      { id: "tomorrow", type: "assessment", title: "영어 발표", dueDate: "2026-08-21" },
    ],
  }, NOW);
  assert.deepEqual(rows.slice(0, 3).map((row) => row.id), ["urgent", "today", "tomorrow"]);
});

test("시험기간 모드는 14일 이내 시험만 감지한다", () => {
  const result = isExamPeriod({
    academicSchedules: [{ title: "1학기 기말고사", date: "2026-08-27" }],
  }, NOW);
  assert.equal(result.active, true);
  assert.equal(result.days, 7);
  assert.equal(isExamPeriod({
    classAssignments: [{ title: "수학 수행평가", type: "assessment", dueDate: "2026-08-21" }],
  }, NOW).active, false);
});

test("행사와 투표는 마감 시각 이후 자동으로 닫힌 것으로 계산한다", () => {
  assert.equal(isOpenWindow({ status: "open", closesAtMs: NOW + 1000 }, NOW), true);
  assert.equal(isOpenWindow({ status: "open", closesAtMs: NOW - 1 }, NOW), false);
  assert.equal(isOpenWindow({ status: "closed", closesAtMs: NOW + 1000 }, NOW), false);
});

test("패치노트 초안은 완료·검토 의견과 변경을 자동 분류한다", () => {
  const draft = buildPatchDraft({
    month: "2026-08",
    feedback: [
      { title: "가위 추가", status: "completed", updatedAtMs: NOW },
      { title: "충전 공간", status: "reviewing", updatedAtMs: NOW },
      { title: "자리 배치", status: "difficult", updatedAtMs: NOW },
    ],
    supplies: [{ name: "가위", quantity: 2, unit: "개", createdAtMs: NOW }],
    events: [{ title: "우리반 34명에게 물었습니다", date: "2026-08-22" }],
  });
  assert.ok(draft.fixed.includes("가위 추가"));
  assert.ok(draft.reviewing.includes("충전 공간"));
  assert.ok(draft.added.some((line) => line.includes("가위")));
  assert.equal(draft.feedbackSummary.total, 3);
  assert.equal(draft.feedbackSummary.difficult, 1);
});

test("패치노트 버전은 최근 월의 부 버전을 자동으로 올린다", () => {
  assert.equal(nextPatchVersion([]), "v1.0");
  assert.equal(nextPatchVersion([
    { month: "2026-08", version: "v1.9" },
    { month: "2026-07", version: "v2.1" },
  ]), "v1.10");
});

test("오늘 피드는 지난 일정과 준비 중인 행사를 노출하지 않는다", () => {
  const rows = buildTodayFeed({
    classAssignments: [
      { id: "past", type: "assessment", title: "지난 평가", dueDate: "2026-08-19" },
      { id: "future", type: "assessment", title: "내일 평가", dueDate: "2026-08-21" },
    ],
    events: [
      { id: "draft", type: "event", title: "준비 중 행사", date: "2026-08-20", status: "draft" },
    ],
  }, NOW);
  assert.deepEqual(rows.map((row) => row.id), ["future"]);
});

test("오늘 피드는 이번 주 학사일정·행사를 포함하고 오래된 기존 공지를 제외한다", () => {
  const rows = buildTodayFeed({
    academicSchedules: [{ id: "academic", title: "진로 체험", date: "2026-08-25", source: "NEIS" }],
    events: [{ id: "event", title: "학급 행사", date: "2026-08-26", status: "open" }],
    content: [{ id: "old", kind: "notice", title: "지난 공지", createdAtMs: NOW - 20 * 86_400_000 }],
  }, NOW);
  assert.deepEqual(rows.map((row) => row.id), ["academic", "event"]);
});

test("오늘 피드는 배열형 NEIS 식단을 읽기 쉬운 메뉴로 표시한다", () => {
  const rows = buildTodayFeed({
    meals: [{ id: "meal", date: "2026-08-20", mealType: "중식", dishes: ["현미밥", { name: "미역국" }] }],
  }, NOW);
  assert.equal(rows[0].title, "중식 급식");
  assert.equal(rows[0].body, "현미밥 · 미역국");
});

test("익명 행사 응답은 같은 답을 빈도순으로 집계한다", () => {
  const result = aggregateAnswers([
    { answers: ["가족오락관", "퀴즈"] },
    { answers: ["가족오락관"] },
    { answers: [" 가족오락관 "] },
  ]);
  assert.deepEqual(result[0], { label: "가족오락관", count: 3 });
});

test("통합 검색은 삭제된 항목을 제외하고 모든 자료형을 찾는다", () => {
  const rows = searchAll({
    classAssignments: [{ id: "a", title: "과학 수행평가", subject: "통합과학" }],
    resources: [{ id: "r", title: "과학 시험범위", deleted: true }],
    polls: [{ id: "p", question: "다음 과학 행사는?", options: ["실험", "퀴즈"] }],
  }, "과학");
  assert.deepEqual(rows.map((row) => row.id), ["a", "p"]);
});

test("묶음 알림은 사용자가 끈 알림 종류를 제외한다", () => {
  const lines = buildNotificationDigest({
    classAssignments: [
      { type: "assessment", title: "수학 수행", dueDate: "2026-08-20" },
      { type: "preparation", title: "실험복", dueDate: "2026-08-20", important: true },
    ],
  }, { assessmentToday: false, importantPreparation: true }, NOW);
  assert.deepEqual(lines, ["오늘 준비물: 실험복"]);
});

test("시험 일정도 수행평가 알림 설정에 따라 묶인다", () => {
  const lines = buildNotificationDigest({
    classAssignments: [{ type: "exam", subject: "영어", title: "단어 시험", dueDate: "2026-08-21" }],
  }, { assessmentTomorrow: true }, NOW);
  assert.deepEqual(lines, ["내일 영어 단어 시험"]);
});

test("외부 링크는 HTTP(S)만 허용한다", () => {
  assert.equal(safeExternalUrl("javascript:alert(1)"), "");
  assert.equal(safeExternalUrl("https://example.com/a"), "https://example.com/a");
});
