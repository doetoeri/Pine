import test from "node:test";
import assert from "node:assert/strict";

const service = await import("../admin/account-create-service.js");

test("student number is derived from grade, class, and seat", () => {
  assert.equal(service.studentNumberFromParts(1, 8, 4), "10804");
  assert.equal(service.studentNumberFromParts(3, 10, 60), "31060");
  assert.equal(service.studentNumberFromParts(1, 11, 1), "");
  assert.equal(service.studentNumberFromParts(1, 8, 61), "");
});

test("roster parser accepts number-name and full student-number formats", () => {
  const parsed = service.parseRoster("1 김학생\n2 이학생\n10803 박학생", { grade: 1, classNumber: 8 });
  assert.equal(parsed.errors.length, 0);
  assert.deepEqual(parsed.valid.map((row) => row.studentNumber), ["10801", "10802", "10803"]);
  assert.deepEqual(parsed.valid.map((row) => row.name), ["김학생", "이학생", "박학생"]);
});

test("roster parser keeps legacy five-column CSV compatible", () => {
  const parsed = service.parseRoster("학번,이름,학년,반,번호\n10804,김도영,1,8,4", { grade: 1, classNumber: 8 });
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.valid.length, 1);
  assert.equal(parsed.valid[0].studentNumber, "10804");
  assert.equal(parsed.valid[0].name, "김도영");
});

test("roster parser blocks duplicate student numbers before network submission", () => {
  const parsed = service.parseRoster("4 김학생\n10804 이학생", { grade: 1, classNumber: 8 });
  assert.equal(parsed.valid.length, 0);
  assert.equal(parsed.errors.length, 2);
  assert.match(parsed.errors[0].error, /중복/);
  assert.match(parsed.errors[1].error, /중복/);
});
