import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
} from "firebase/firestore";

const PROJECT_ID = "pincon-school-life-rules-test";
const SCHOOL_ID = "gochon-high";
const CLASS_KEY = "1-8";
const OTHER_CLASS = "1-7";
let env;

const path = (...parts) => `schools/${SCHOOL_ID}/${parts.join("/")}`;

function commonBase() {
  return {
    classKey: CLASS_KEY,
    createdAtMs: 1,
    updatedAtMs: 1,
    deleted: false,
  };
}

function materialPayload(overrides = {}) {
  return {
    ...commonBase(),
    title: "이어폰",
    subject: "한국사",
    subjectKey: "한국사",
    date: "",
    period: 0,
    recurrence: "subject-default",
    scope: "subject",
    ownerUid: "",
    authorUid: "subject-history",
    authorDisplay: "김○○",
    authorRole: "과목부장",
    ...overrides,
  };
}

function assignmentPayload(overrides = {}) {
  return {
    ...commonBase(),
    type: "assessment",
    title: "한국사 발표",
    subject: "한국사",
    subjectKey: "한국사",
    period: 1,
    dueDate: "2026-09-10",
    dueAtMs: 1789052340000,
    description: "",
    dateType: "exact",
    evaluationRange: "",
    evaluationMethod: "",
    materials: "이어폰",
    materialItems: ["이어폰"],
    points: "",
    evaluationPlanId: "",
    pageReferences: "",
    verificationStatus: "verified",
    confirmed: true,
    changed: false,
    published: true,
    announcedDate: "2026-09-07",
    recoveryRelevant: true,
    createdBy: "subject-history",
    ...overrides,
  };
}

function overridePayload(overrides = {}) {
  return {
    ...commonBase(),
    date: "2026-09-10",
    period: 4,
    subject: "체육",
    subjectKey: "체육",
    previousSubject: "",
    location: "체육관",
    previousLocation: "운동장",
    startTime: "12:30",
    endTime: "13:20",
    isMovingClass: true,
    changed: true,
    createdBy: "vice",
    updatedBy: "vice",
    ...overrides,
  };
}

async function seed() {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, path("roles", "president")), {
        enabled: true,
        level: "president",
        classKeys: [CLASS_KEY],
        accountRoles: ["STUDENT", "CLASS_PRESIDENT"],
        subjectKeys: [],
      }),
      setDoc(doc(db, path("roles", "vice")), {
        enabled: true,
        level: "student",
        classKeys: [CLASS_KEY],
        accountRoles: ["STUDENT", "CLASS_VICE_PRESIDENT"],
        subjectKeys: [],
      }),
      setDoc(doc(db, path("roles", "subject-history")), {
        enabled: true,
        level: "student",
        classKeys: [CLASS_KEY],
        accountRoles: ["STUDENT", "SUBJECT_MANAGER"],
        subjectKeys: ["한국사"],
      }),
      setDoc(doc(db, path("roles", "subject-math")), {
        enabled: true,
        level: "student",
        classKeys: [CLASS_KEY],
        accountRoles: ["STUDENT", "SUBJECT_MANAGER"],
        subjectKeys: ["수학"],
      }),
      setDoc(doc(db, path("roles", "other-class")), {
        enabled: true,
        level: "student",
        classKeys: [OTHER_CLASS],
        accountRoles: ["STUDENT", "SUBJECT_MANAGER"],
        subjectKeys: ["한국사"],
      }),
      setDoc(doc(db, path("schoolLifeUsers", "student-a")), {
        ownerUid: "student-a",
        classKey: CLASS_KEY,
        enabled: true,
        updatedAtMs: 1,
      }),
      setDoc(doc(db, path("schoolLifeUsers", "student-b")), {
        ownerUid: "student-b",
        classKey: CLASS_KEY,
        enabled: true,
        updatedAtMs: 1,
      }),
    ]);
  });
}

test.before(async () => {
  const rules = await readFile(new URL("../../firestore.rules", import.meta.url), "utf8");
  env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules } });
});

test.after(async () => {
  await env?.cleanup();
});

test.beforeEach(async () => {
  await env.clearFirestore();
  await seed();
});

test("개인 준비물은 본인만 읽고 쓸 수 있다", async () => {
  const ownDb = env.authenticatedContext("student-a").firestore();
  const otherDb = env.authenticatedContext("student-b").firestore();
  const ref = doc(ownDb, path("schoolLifeUsers", "student-a", "materials", "mine"));
  const payload = materialPayload({
    scope: "personal",
    ownerUid: "student-a",
    authorUid: "student-a",
    authorDisplay: "나",
    authorRole: "개인",
  });
  await assertSucceeds(setDoc(ref, payload));
  await assertSucceeds(getDoc(ref));
  await assertFails(getDoc(doc(otherDb, path("schoolLifeUsers", "student-a", "materials", "mine"))));
  await assertFails(setDoc(doc(otherDb, path("schoolLifeUsers", "student-a", "materials", "hack")), {
    ...payload,
    ownerUid: "student-b",
    authorUid: "student-b",
  }));
});

test("준비물 완료 상태도 사용자별로 격리된다", async () => {
  const ownDb = env.authenticatedContext("student-a").firestore();
  const otherDb = env.authenticatedContext("student-b").firestore();
  const stateRef = doc(ownDb, path("schoolLifeUsers", "student-a", "materialStates", "2026-09-10:m1"));
  await assertSucceeds(setDoc(stateRef, {
    ownerUid: "student-a",
    completed: true,
    updatedAtMs: 2,
  }));
  await assertFails(getDoc(doc(otherDb, path("schoolLifeUsers", "student-a", "materialStates", "2026-09-10:m1"))));
});

test("과목 담당은 담당 과목 공통 준비물만 만들 수 있다", async () => {
  const historyDb = env.authenticatedContext("subject-history").firestore();
  const mathDb = env.authenticatedContext("subject-math").firestore();
  const otherClassDb = env.authenticatedContext("other-class").firestore();
  await assertSucceeds(setDoc(doc(historyDb, path("lessonMaterials", "history")), materialPayload()));
  await assertFails(setDoc(doc(mathDb, path("lessonMaterials", "history-by-math")), materialPayload({ authorUid: "subject-math" })));
  await assertFails(setDoc(doc(otherClassDb, path("lessonMaterials", "history-other-class")), materialPayload({ authorUid: "other-class" })));
});

test("과목 담당은 담당 과목 수행평가를 등록할 수 있지만 다른 과목은 거부된다", async () => {
  const historyDb = env.authenticatedContext("subject-history").firestore();
  const mathDb = env.authenticatedContext("subject-math").firestore();
  await assertSucceeds(setDoc(doc(historyDb, path("classAssignments", "history-assessment")), assignmentPayload()));
  await assertFails(setDoc(doc(mathDb, path("classAssignments", "history-assessment-by-math")), assignmentPayload({ createdBy: "subject-math" })));
});

test("부회장은 학교생활 공통 정보는 관리하지만 기존 전체 관리자 역할로 승격되지 않는다", async () => {
  const viceDb = env.authenticatedContext("vice").firestore();
  await assertSucceeds(setDoc(doc(viceDb, path("lessonMaterials", "vice-material")), materialPayload({ authorUid: "vice" })));
  await assertSucceeds(setDoc(doc(viceDb, path("classAssignments", "vice-assessment")), assignmentPayload({ createdBy: "vice" })));
  await assertFails(setDoc(doc(viceDb, path("announcements", "not-full-admin")), {
    ...commonBase(),
    title: "권한 과다 테스트",
    body: "",
    priority: "normal",
    important: false,
    pinned: false,
    published: true,
  }));
});

test("시간표/장소 오버레이와 변경 이벤트는 학급 운영 범위에서만 쓸 수 있다", async () => {
  const viceDb = env.authenticatedContext("vice").firestore();
  const subjectDb = env.authenticatedContext("subject-history").firestore();
  await assertSucceeds(setDoc(doc(viceDb, path("lessonOverrides", "sports-location")), overridePayload()));
  await assertFails(setDoc(doc(subjectDb, path("lessonOverrides", "subject-cannot-change-schedule")), overridePayload({
    subject: "한국사",
    subjectKey: "한국사",
    createdBy: "subject-history",
    updatedBy: "subject-history",
  })));
  await assertSucceeds(setDoc(doc(viceDb, path("notificationEvents", "sports-location-event")), {
    type: "SPORTS_LOCATION_CHANGED",
    classKey: CLASS_KEY,
    audience: "class",
    targetUserIds: [],
    date: "2026-09-10",
    period: 4,
    title: "체육 수업 장소가 변경됐어요",
    body: "운동장 → 체육관",
    relatedId: "sports-location",
    status: "pending",
    createdBy: "vice",
    createdAtMs: 2,
    sentAtMs: 0,
  }));
});

test("알림 설정은 본인만 쓰고 서버용 알림함은 클라이언트가 위조할 수 없다", async () => {
  const db = env.authenticatedContext("student-a").firestore();
  await assertSucceeds(setDoc(doc(db, path("schoolLifeUsers", "student-a", "settings", "notifications")), {
    ownerUid: "student-a",
    dailyBriefing: true,
    dailyBriefingTime: "08:00",
    movingClass: true,
    movingClassMinutes: 5,
    updatedAtMs: 3,
  }));
  await assertFails(setDoc(doc(db, path("schoolLifeUsers", "student-a", "notificationInbox", "fake")), {
    title: "가짜 서버 알림",
    read: false,
    createdAtMs: 3,
  }));
});


test("과목 담당은 자기 과목 준비물 변경 알림 이벤트만 만들 수 있다", async () => {
  const historyDb = env.authenticatedContext("subject-history").firestore();
  const mathDb = env.authenticatedContext("subject-math").firestore();
  const payload = { type: "MATERIAL_REMINDER", classKey: CLASS_KEY, subjectKey: "한국사", audience: "class", targetUserIds: [], date: "2026-09-10", period: 1, title: "준비물이 변경됐어요", body: "한국사 · 이어폰 → 이어폰, 활동지", relatedId: "history-material", status: "pending", createdBy: "subject-history", createdAtMs: 4, sentAtMs: 0 };
  await assertSucceeds(setDoc(doc(historyDb, path("notificationEvents", "history-material-event")), payload));
  await assertFails(setDoc(doc(mathDb, path("notificationEvents", "history-material-event-by-math")), { ...payload, createdBy: "subject-math" }));
});

test("수행평가 제출 상태는 본인만 읽고 쓸 수 있다", async () => {
  const ownDb = env.authenticatedContext("student-a").firestore();
  const otherDb = env.authenticatedContext("student-b").firestore();
  const ref = doc(ownDb, path("schoolLifeUsers", "student-a", "assessmentStates", "assessment-1"));
  await assertSucceeds(setDoc(ref, { ownerUid: "student-a", submitted: true, updatedAtMs: 5 }));
  await assertSucceeds(getDoc(ref));
  await assertFails(getDoc(doc(otherDb, path("schoolLifeUsers", "student-a", "assessmentStates", "assessment-1"))));
});


test("부회장은 자신이 만든 학교생활 수행평가를 수정할 수 있다", async () => {
  const viceDb = env.authenticatedContext("vice").firestore();
  const ref = doc(viceDb, path("classAssignments", "vice-editable-assessment"));
  await assertSucceeds(setDoc(ref, assignmentPayload({ createdBy: "vice" })));
  await assertSucceeds(setDoc(ref, assignmentPayload({ createdBy: "vice", title: "수정된 수행평가", updatedAtMs: 2 })));
});
