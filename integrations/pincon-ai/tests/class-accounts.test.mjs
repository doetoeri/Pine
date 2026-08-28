import test from "node:test";
import assert from "node:assert/strict";

import {
  ROLE,
  canManageDepartment,
  canManageSubject,
  normalizeProfile,
  publicProfile,
  studentEmail,
  validStudentNumber,
} from "../lib/class-accounts.mjs";
import {
  phoneStatus,
  recommendCleaningCandidate,
  subjectEntryType,
} from "../lib/class-operations.mjs";

function student(overrides = {}) {
  return normalizeProfile({
    studentNumber: "10804",
    name: "테스트 학생",
    grade: 1,
    classNumber: 8,
    number: 4,
    roles: [ROLE.STUDENT],
    subjectRoles: [],
    departmentId: "learning",
    status: "ACTIVE",
    ...overrides,
  }, { uid: overrides.uid || "uid-10804" });
}

test("student number is only an identifier and maps to a non-routable Firebase Auth email", () => {
  assert.equal(validStudentNumber("10804"), true);
  assert.equal(validStudentNumber("1080"), false);
  assert.equal(studentEmail("10804"), "gochon-high.10804@students.pincon.invalid");
});

test("one user may carry department and subject roles at the same time", () => {
  const profile = student({
    roles: [ROLE.STUDENT, ROLE.DEPARTMENT_HEAD, ROLE.SUBJECT_MANAGER],
    subjectRoles: [{ subject: "수학" }],
  });
  assert.deepEqual(profile.roles, [ROLE.STUDENT, ROLE.DEPARTMENT_HEAD, ROLE.SUBJECT_MANAGER]);
  assert.deepEqual(profile.subjectRoles, [{ subject: "수학", role: ROLE.SUBJECT_MANAGER }]);
  assert.equal(canManageDepartment(profile, "learning"), true);
  assert.equal(canManageDepartment(profile, "environment"), false);
  assert.equal(canManageSubject(profile, "수학"), true);
  assert.equal(canManageSubject(profile, "영어"), false);
});

test("class president can operate the class without being hard-coded to a student number", () => {
  const president = student({ studentNumber: "10819", uid: "president", roles: [ROLE.STUDENT, ROLE.CLASS_PRESIDENT] });
  assert.equal(canManageDepartment(president, "any-department"), true);
  assert.equal(canManageSubject(president, "통합과학"), true);
});

test("profile normalization ignores credential-like fields", () => {
  const profile = student({ pin: "123456", password: "should-never-persist", phoneNumber: "01000000000" });
  assert.equal(Object.hasOwn(profile, "pin"), false);
  assert.equal(Object.hasOwn(profile, "password"), false);
  assert.equal(Object.hasOwn(profile, "phoneNumber"), false);
  const visible = publicProfile(profile);
  assert.equal(Object.hasOwn(visible, "mustChangePin"), true);
  assert.equal(Object.hasOwn(visible, "password"), false);
});

test("cleaning recommendation prioritizes fewer monthly assignments and avoids immediate repeats", () => {
  const candidates = [
    student({ uid: "a", studentNumber: "10801", number: 1, roles: [ROLE.STUDENT] }),
    student({ uid: "b", studentNumber: "10802", number: 2, roles: [ROLE.STUDENT] }),
    student({ uid: "c", studentNumber: "10803", number: 3, roles: [ROLE.STUDENT, ROLE.SUBJECT_MANAGER], subjectRoles: [{ subject: "수학" }] }),
  ];
  const assignments = [
    { assigneeUid: "a", date: "2026-08-01", status: "COMPLETED" },
    { assigneeUid: "a", date: "2026-08-12", status: "COMPLETED" },
    { assigneeUid: "b", date: "2026-08-10", status: "COMPLETED" },
  ];
  const result = recommendCleaningCandidate(candidates, assignments, { lastAssigneeUid: "b" });
  assert.equal(result.user.uid, "c");
  assert.equal(result.count, 0);
  assert.match(result.reason, /이번 달 담당 횟수가 가장 적습니다/);
});

test("cleaning recommendation excludes absent or exempted candidates supplied by the caller", () => {
  const candidates = [
    student({ uid: "a", studentNumber: "10801", number: 1 }),
    student({ uid: "b", studentNumber: "10802", number: 2 }),
  ];
  const result = recommendCleaningCandidate(candidates, [], { excludedUids: ["a"] });
  assert.equal(result.user.uid, "b");
});

test("phone and subject entry enums reject unknown states", () => {
  assert.equal(phoneStatus("submitted"), "SUBMITTED");
  assert.throws(() => phoneStatus("LOST"), /invalid-phone-status/);
  assert.equal(subjectEntryType("homework"), "HOMEWORK");
  assert.throws(() => subjectEntryType("OTHER"), /invalid-subject-entry-type/);
});
