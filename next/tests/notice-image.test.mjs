import test from "node:test";
import assert from "node:assert/strict";
import { noticeModel, noticeDateLabel } from "../../new/notice-data.js";
import { noticeLayout, noticeWrap } from "../../new/notice-renderer.js";

const now = Date.parse("2026-10-13T12:00:00Z");
const snapshot = rows => ({ ready: true, online: true, profile: { grade: 1, classNumber: 8, classKey: "1-8" }, data: { classAssignments: rows } });
const row = (id, dueDate, rest = {}) => ({ id, dueDate, subject: "국어", title: id, type: "assessment", classKey: "1-8", ...rest });

test("nightly notices use Seoul, include tomorrow through day seven, and isolate public class assessments", () => {
  const data = snapshot([row("today", "2026-10-13"), row("tomorrow", "2026-10-14", { completed: true }), row("last", "2026-10-20"), row("later", "2026-10-21"), row("other", "2026-10-14", { classKey: "1-7" }), row("draft", "2026-10-14", { published: false }), row("deleted", "2026-10-14", { deleted: true }), row("exam", "2026-10-14", { type: "exam" })]);
  const model = noticeModel(data, {}, now);
  assert.equal(model.day, "2026-10-13");
  assert.deepEqual(model.rows.map(row => row.id), ["tomorrow", "last"]);
  assert.equal(model.rows[0].dueLabel, "내일");
  assert.deepEqual(noticeModel(data, { horizon: 1 }, now).rows.map(row => row.id), ["tomorrow"]);
  assert.equal(noticeModel(data, {}, Date.parse("2026-10-13T15:00:00Z")).day, "2026-10-14");
  assert.equal(noticeDateLabel("2026-10-14"), "10.14 (수)");
});

test("dates stay tentative, undated rows are optional, and published class work ignores personal progress", () => {
  const data = snapshot([row("tentative", "2026-10-14", { title: "독서(미확정)" }), row("range", "2026-10-14", { dateType: "range" }), row("unknown", ""), row("verified", "2026-10-15", { verificationStatus: "verified" })]);
  const model = noticeModel(data, { includeUndated: true }, now);
  assert.equal(model.rows[0].dueLabel, "일정 확인");
  assert.match(model.rows[0].dateLabel, /예정/);
  assert.equal(model.rows.find(row => row.id === "range").date, "");
  assert.equal(model.rows.find(row => row.id === "verified").verified, true);
  assert.equal(noticeModel(data, {}, now).rows.length, 2);
  assert.deepEqual(noticeModel(data, { selectedIds: ["verified", "not-in-class"] }, now).rows.map(row => row.id), ["verified"]);
  assert.equal(noticeModel(data, { selectedIds: [] }, now).rows.length, 0);
});

test("month and year boundaries are inclusive and cached/pending states are explicit", () => {
  const data = snapshot([row("newyear", "2027-01-01"), row("seven", "2027-01-07"), row("eight", "2027-01-08")]);
  const model = noticeModel(data, { day: "2026-12-31" }, now);
  assert.deepEqual(model.rows.map(row => row.id), ["newyear", "seven"]);
  assert.equal(noticeModel({ ...data, usingCache: true }, {}, now).cached, true);
  assert.equal(noticeModel({ ready: false, data: {} }, {}, now).pending, true);
  assert.equal(noticeModel(snapshot([]), {}, now).pending, false);
});

// Layout measures every line before pagination; verify bounds and preservation
// independently of a device's font metrics or Canvas implementation.
const ctx = { font: "", measureText(value) { return { width: Array.from(value).length * Number(this.font.match(/(\d+)px/)[1]) }; } };
test("long Korean words, multiline materials and crowded notices retain every line on bounded pages", () => {
  const rows = Array.from({ length: 22 }, (_, i) => row(String(i), "2026-10-14", { title: "공동보고서작성".repeat(18), materials: "연필 지우개 색연필\n".repeat(20) }));
  const model = noticeModel(snapshot(rows), {}, now), pages = noticeLayout(ctx, model);
  assert.ok(pages.length > 1);
  const pieces = pages.flatMap(page => page.pieces);
  for (const piece of pieces) assert.ok(piece.y >= 328 && piece.y + piece.height <= 1290);
  for (const entry of model.rows) {
    const own = pieces.filter(piece => piece.row.id === entry.id);
    assert.equal(own.flatMap(piece => piece.lines.filter(line => line.title).map(line => line.value)).join(""), entry.title);
    assert.ok(own.some(piece => piece.continuation > 0));
    assert.ok(own.flatMap(piece => piece.lines).some(line => line.value.includes("준비물")));
  }
  ctx.font = "700 38px sans-serif";
  assert.ok(noticeWrap(ctx, "한".repeat(500), 864).every(line => ctx.measureText(line).width <= 864));
  assert.equal(noticeLayout(ctx, noticeModel(snapshot([]), {}, now)).length, 1);
});
