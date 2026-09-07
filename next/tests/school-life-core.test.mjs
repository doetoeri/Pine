import test from "node:test";
import assert from "node:assert/strict";

import {
  SCHOOL_LIFE_EVENT,
  buildBriefing,
  buildLessons,
  briefingText,
  eventRoute,
  isNonSchoolDay,
  materialsForLesson,
  mergeLessonBundles,
  normalizeNotificationPreferences,
  subjectKey,
} from "../core/school-life.js";

const date = "2026-09-10";

function timetable(periods = [
  { period: 1, subject: "한국사" },
  { period: 2, subject: "수학" },
  { period: 3, subject: "한문" },
  { period: 4, subject: "체육" },
  { period: 5, subject: "통합과학" },
]) {
  return { date, classKey: "1-8", source: "NEIS", periods };
}

test("교시를 중심으로 기본 준비물, 일회성 준비물, 개인 준비물, 수행평가 준비물을 합친다", () => {
  const lessons = buildLessons({ timetable: timetable() });
  const science = lessons.find((item) => item.period === 5);
  const items = materialsForLesson({
    lesson: science,
    ownerUid: "student-a",
    classMaterials: [
      { id: "default", title: "실험복", subject: "통합과학", subjectKey: subjectKey("통합과학"), recurrence: "subject-default", scope: "subject" },
      { id: "once", title: "보고서", subject: "통합과학", subjectKey: subjectKey("통합과학"), recurrence: "once", date, period: 5, scope: "class" },
      { id: "other", title: "이어폰", subject: "한국사", subjectKey: subjectKey("한국사"), recurrence: "subject-default", scope: "subject" },
    ],
    personalMaterials: [
      { id: "mine", title: "계산기", subject: "통합과학", subjectKey: subjectKey("통합과학"), recurrence: "once", date, period: 5, scope: "personal", ownerUid: "student-a" },
      { id: "someone", title: "남의 노트", subject: "통합과학", subjectKey: subjectKey("통합과학"), recurrence: "once", date, period: 5, scope: "personal", ownerUid: "student-b" },
    ],
    assignments: [
      { id: "assessment", type: "assessment", title: "과학 수행", subject: "통합과학", subjectKey: subjectKey("통합과학"), dueDate: date, period: 5, materialItems: ["실험복", "활동지"] },
    ],
  });

  assert.deepEqual(items.map((item) => item.title), ["계산기", "보고서", "실험복", "활동지"]);
});

test("완료 상태는 공용 준비물이 아니라 사용자별 상태에서 계산한다", () => {
  const lesson = buildLessons({ timetable: timetable() })[0];
  const base = { id: "earphones", title: "이어폰", subject: "한국사", subjectKey: subjectKey("한국사"), recurrence: "subject-default" };
  const uncompleted = materialsForLesson({ lesson, classMaterials: [base], states: {} });
  const key = uncompleted[0].stateKey;
  const completed = materialsForLesson({ lesson, classMaterials: [base], states: { [key]: { completed: true } } });
  assert.equal(uncompleted[0].completed, false);
  assert.equal(completed[0].completed, true);
});

test("시간표 과목이 바뀌면 이전 과목 준비물을 버리고 새 과목 준비물을 재계산한다", () => {
  const lessons = buildLessons({
    timetable: timetable([{ period: 5, subject: "영어" }]),
    lessonOverrides: [{ id: "change", date, period: 5, subject: "통합과학", previousSubject: "영어", changed: true }],
  });
  const bundles = mergeLessonBundles({
    lessons,
    classMaterials: [
      { id: "english", title: "영어 단어장", subject: "영어", subjectKey: subjectKey("영어"), recurrence: "subject-default" },
      { id: "science", title: "실험복", subject: "통합과학", subjectKey: subjectKey("통합과학"), recurrence: "subject-default" },
    ],
  });
  assert.equal(bundles[0].lesson.subject, "통합과학");
  assert.equal(bundles[0].lesson.previousSubject, "영어");
  assert.deepEqual(bundles[0].materials.map((item) => item.title), ["실험복"]);
});

test("장소/이동수업/시각은 원본을 덮지 않는 교시 오버레이와 설정에서 계산한다", () => {
  const [lesson] = buildLessons({
    timetable: timetable([{ period: 4, subject: "체육", location: "운동장" }]),
    classSettings: { periodTimes: { "4": { startTime: "12:30", endTime: "13:20" } } },
    lessonOverrides: [{ date, period: 4, subject: "체육", location: "체육관", previousLocation: "운동장", isMovingClass: true, changed: true }],
  });
  assert.equal(lesson.location, "체육관");
  assert.equal(lesson.previousLocation, "운동장");
  assert.equal(lesson.isMovingClass, true);
  assert.equal(lesson.startTime, "12:30");
  assert.equal(lesson.endTime, "13:20");
});

test("알림 설정은 사용자 지정 시각과 3/5/10분 이동 알림을 보존한다", () => {
  const prefs = normalizeNotificationPreferences({
    dailyBriefing: true,
    dailyBriefingTime: "07:40",
    nextDayMaterials: true,
    nextDayMaterialsTime: "21:15",
    movingClassMinutes: 10,
    assessmentReminderMinutes: 180,
  });
  assert.equal(prefs.dailyBriefingTime, "07:40");
  assert.equal(prefs.nextDayMaterialsTime, "21:15");
  assert.equal(prefs.movingClassMinutes, 10);
  assert.equal(prefs.assessmentReminderMinutes, 180);
});

test("휴업일은 시간표가 없을 때 정규 브리핑 대상에서 제외할 수 있다", () => {
  assert.equal(isNonSchoolDay({
    date,
    timetable: { date, periods: [] },
    academicSchedules: [{ date, title: "학교장 재량휴업일" }],
  }), true);
  assert.equal(isNonSchoolDay({
    date,
    timetable: { date, periods: [{ period: 1, subject: "국어" }] },
    academicSchedules: [{ date, title: "단축수업" }],
  }), false);
});

test("브리핑은 완료되지 않은 준비물, 수행평가, 변경, 급식을 하나로 묶는다", () => {
  const lessons = buildLessons({ timetable: timetable([{ period: 1, subject: "한국사" }]) });
  const bundles = mergeLessonBundles({
    lessons,
    classMaterials: [{ id: "m1", title: "이어폰", subject: "한국사", subjectKey: subjectKey("한국사"), recurrence: "subject-default" }],
    assignments: [{ id: "a1", type: "assessment", title: "한국사 발표", subject: "한국사", subjectKey: subjectKey("한국사"), dueDate: date, period: 1 }],
  });
  const brief = buildBriefing({
    date,
    bundles,
    meal: { menu: ["제육볶음", "미역국", "김치"] },
    changes: [{ date, summary: "4교시 체육 · 운동장 → 체육관" }],
  });
  const text = briefingText(brief);
  assert.match(text, /이어폰/);
  assert.match(text, /한국사 발표/);
  assert.match(text, /운동장 → 체육관/);
  assert.match(text, /제육볶음/);
});

test("알림 클릭은 이벤트별 화면과 해당 교시 정보를 유지한다", () => {
  assert.match(eventRoute(SCHOOL_LIFE_EVENT.MOVING_CLASS, { date, period: 5, relatedId: "lesson-5" }), /#timetable$/);
  assert.match(eventRoute(SCHOOL_LIFE_EVENT.MOVING_CLASS, { date, period: 5, relatedId: "lesson-5" }), /period=5/);
  assert.match(eventRoute(SCHOOL_LIFE_EVENT.ASSESSMENT_REMINDER, { date, period: 2, relatedId: "a1" }), /#schedule$/);
  assert.match(eventRoute(SCHOOL_LIFE_EVENT.DAILY_BRIEFING, { date }), /#today$/);
});
