import test from "node:test";
import assert from "node:assert/strict";
import { assessmentCalendar, assessmentCalendarMarkup, assessmentDate, assessmentCalendarAnchor, calendarDate, seoulToday, shiftCalendarMonth, shiftCalendarDay } from "../../new/calendar.js";

test("calendar dates reject rollover and preserve leap days", () => {
  for (const date of ["2026-02-29", "2024-02-30", "2026-13-01", "2026-00-10", "2026-01-00", "2026-1-2", "unknown"]) assert.equal(calendarDate(date), "");
  assert.equal(calendarDate("2024-02-29"), "2024-02-29");
  assert.equal(shiftCalendarDay("2024-02-29", 1), "2024-03-01");
  assert.equal(shiftCalendarMonth("2026-12", 1), "2027-01");
  assert.equal(shiftCalendarMonth("2026-01", -1), "2025-12");
});

test("today and month boundaries use the school timezone", () => {
  assert.equal(seoulToday(Date.parse("2026-10-31T14:59:59Z")), "2026-10-31");
  assert.equal(seoulToday(Date.parse("2026-10-31T15:00:00Z")), "2026-11-01");
  const model = assessmentCalendar([], "2026-11", Date.parse("2026-10-31T15:00:00Z"));
  assert.equal(model.days.length, 35);
  assert.equal(model.days[0].date, "2026-11-01");
  assert.equal(model.days.at(-1).date, "2026-12-05");
  assert.equal(model.days.filter(day => day.current).length, 30);
  assert.equal(model.today, "2026-11-01");
});

test("whole weeks contain every day across all months, including six-week months", () => {
  for (let number = 1; number <= 12; number++) {
    const month = `2026-${String(number).padStart(2, "0")}`;
    const model = assessmentCalendar([], month);
    assert.ok([28, 35, 42].includes(model.days.length));
    assert.equal(new Date(model.days[0].date + "T00:00:00Z").getUTCDay(), 0);
    assert.equal(new Date(model.days.at(-1).date + "T00:00:00Z").getUTCDay(), 6);
    assert.equal(model.days.filter(day => day.current).length, new Date(Date.UTC(2026, number, 0)).getUTCDate());
    for (let i = 1; i < model.days.length; i++) assert.equal(Date.parse(model.days[i].date) - Date.parse(model.days[i - 1].date), 86400000);
  }
  assert.equal(assessmentCalendar([], "2026-05").days.length, 42);
});

test("calendar retains same-day work and separates unconfirmed dates", () => {
  const rows = [
    { id: "a", dueDate: "2026-11-13" }, { id: "b", dueDate: "2026-11-13", dateType: "exact" },
    { id: "undated" }, { id: "monthly", dueDate: "2026-11-01", dateType: "month" },
    { id: "range", dueDate: "2026-11-20", dateType: "range" }, { id: "invalid", dueDate: "2026-02-30" },
    { id: "deleted", dueDate: "2026-11-13", deleted: true }, { id: "draft", published: false },
  ];
  const model = assessmentCalendar(rows, "2026-11");
  assert.deepEqual(model.days.find(day => day.date === "2026-11-13").rows.map(row => row.id), ["a", "b"]);
  assert.deepEqual(model.unscheduled.map(row => row.id), ["undated", "monthly", "range", "invalid"]);
});

test("calendar escapes content and exposes every task on a crowded date", () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: `task-${i}`, subject: "국어", title: '<script>alert("x")</script>', dueDate: "2026-11-13" }));
  const html = assessmentCalendarMarkup(rows, "2026-11", "2026-11-13");
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("수행평가 5개 모두 보기"));
  for (const row of rows) assert.ok(html.includes(`data-assessment-id="${row.id}"`));
});

test("deadline recognition normalizes written dates and stale undecided state", () => {
  const now = Date.parse("2026-10-13T00:00:00Z");
  for (const dueDate of ["2026-11-13", "2026.11.13", "2026/11/13", "2026년 11월 13일", "11월 13일 (금)", "11.13"]) {
    assert.equal(assessmentDate({ dueDate, dateType: "undecided" }, now), "2026-11-13");
  }
  assert.equal(assessmentDate({ dueAtMs: Date.parse("2026-11-12T15:00:00Z") }, now), "2026-11-13");
  assert.equal(assessmentDate({ description: "준비물: 필기도구\n제출일: 11월 13일 (금)까지", announcedDate: "2026-10-01" }, now), "2026-11-13");
  assert.equal(assessmentDate({ description: "마감: 1월 5일", announcedDate: "2026-12-21" }, now), "2027-01-05");
  assert.equal(assessmentDate({ description: "제출 기한: 2026년 11월 13일" }, now), "2026-11-13");
  assert.equal(assessmentDate({ dueDate: "2026-11-13", description: "제출일: 11월 20일" }, now), "2026-11-13");
});

test("automatic dates reject tentative, conflicting, invalid and incidental dates", () => {
  const now = Date.parse("2026-10-13T00:00:00Z");
  for (const row of [
    { description: "발표 연습: 11월 13일" },
    { title: "11월 13일 발표 연습" },
    { description: "제출일: 11월 13일 예정" },
    { description: "마감: 11월 13일 ~ 11월 20일" },
    { description: "제출일: 11월 13일\n마감일: 11월 20일" },
    { dueDate: "2026-02-30", description: "제출일: 11월 13일" },
    { dueDate: "2026-11-13", dateType: "month" },
    { dueDate: "2026-11-13", dateType: "range" },
    { dueAtMs: Infinity },
    { dueAtMs: 9e15 },
    { createdAtMs: 9e15 },
    { dueAtMs: Date.parse("2026-11-13"), dateType: "undecided" },
  ]) assert.equal(assessmentDate(row, now), "", JSON.stringify(row));
});

test("each calendar entry follows the chosen cover and keeps it visible on a crowded day", () => {
  const now = Date.parse("2026-10-13T00:00:00Z");
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: `task-${i}`, title: `보고서 ${i}`, dueDate: "2027-01-05" }));
  const anchor = assessmentCalendarAnchor(rows, "task-4", now);
  assert.deepEqual(anchor, { id: "task-4", date: "2027-01-05", month: "2027-01" });
  const html = assessmentCalendarMarkup(rows, anchor.month, "", now, anchor);
  assert.match(html, /is-anchor" data-date="2027-01-05"/);
  assert.match(html, /data-assessment-id="task-4" data-calendar-anchor="true"/);
  assert.ok(!html.includes("pc-calendar-agenda"));
  assert.deepEqual(assessmentCalendarAnchor([{ id: "undated" }], "undated", now), { id: "undated", date: "", month: "2026-10" });
  assert.deepEqual(assessmentCalendarAnchor([{ id: "draft", published: false, dueDate: "2027-01-05" }], "draft", now), { id: "", date: "", month: "2026-10" });
});
