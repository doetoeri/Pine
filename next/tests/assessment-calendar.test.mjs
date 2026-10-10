import test from "node:test";
import assert from "node:assert/strict";
import { assessmentCalendar, assessmentCalendarMarkup, calendarDate, seoulToday, shiftCalendarMonth, shiftCalendarDay } from "../../new/calendar.js";

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
