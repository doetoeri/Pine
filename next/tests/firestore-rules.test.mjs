import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

const PROJECT_ID = "pincon-next-rules-test";
const SCHOOL_ID = "gochon";
const CLASS_KEY = "1-8";

let env;

const rolePath = (uid) => `schools/${SCHOOL_ID}/roles/${uid}`;
const resourcePath = (id = "r1") => `schools/${SCHOOL_ID}/nextResources/${id}`;
const auditPath = (id) => `schools/${SCHOOL_ID}/nextAuditEvents/${id}`;

function role(level, classKeys = [CLASS_KEY], enabled = true) {
  return { level, classKeys, enabled };
}

function resource({
  id = "r1",
  actorUid = "editor",
  auditId = `audit-${id}`,
  status = "draft",
  deleted = false,
  now = 1000,
  extra = {},
} = {}) {
  return {
    schoolId: SCHOOL_ID,
    classKey: CLASS_KEY,
    title: "테스트 공지",
    body: "권한 규칙 테스트",
    status,
    deleted,
    createdAtMs: 900,
    updatedAtMs: now,
    createdBy: "editor",
    updatedBy: actorUid,
    auditId,
    approvedBy: null,
    approvedAtMs: null,
    ...extra,
  };
}

function audit({
  id,
  action,
  actorUid,
  actorRole,
  recordId = "r1",
  now,
} = {}) {
  return {
    schoolId: SCHOOL_ID,
    action,
    actorUid,
    actorRole,
    classKey: CLASS_KEY,
    collection: "nextResources",
    recordId,
    occurredAtMs: now,
    reason: `test:${id}`,
  };
}

async function seedBaseRoles() {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, rolePath("admin")), role("school", [])),
      setDoc(doc(db, rolePath("manager")), role("class")),
      setDoc(doc(db, rolePath("editor")), role("editor")),
      setDoc(doc(db, rolePath("outsider")), role("editor", ["1-7"])),
      setDoc(doc(db, rolePath("disabled-manager")), role("class", [CLASS_KEY], false)),
    ]);
  });
}

async function seedResource(data = resource()) {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), resourcePath("r1")), data);
  });
}

function batchCreate(db, { actorUid, actorRole, recordId = "r1", auditId, now = 1000 } = {}) {
  const batch = writeBatch(db);
  batch.set(
    doc(db, resourcePath(recordId)),
    resource({ id: recordId, actorUid, auditId, now }),
  );
  batch.set(
    doc(db, auditPath(auditId)),
    audit({ id: auditId, action: "create", actorUid, actorRole, recordId, now }),
  );
  return batch.commit();
}

test.before(async () => {
  const rules = await readFile(new URL("../firestore-next.rules", import.meta.url), "utf8");
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules },
  });
});

test.after(async () => {
  await env?.cleanup();
});

test.beforeEach(async () => {
  await env.clearFirestore();
  await seedBaseRoles();
});

test("viewer can read beta resources but cannot write", async () => {
  await seedResource();
  const publicDb = env.unauthenticatedContext().firestore();

  await assertSucceeds(getDoc(doc(publicDb, resourcePath())));
  await assertFails(setDoc(doc(publicDb, resourcePath("public-write")), resource({ id: "public-write" })));
});

test("editor can create only with a fresh audit event in the same atomic batch", async () => {
  const db = env.authenticatedContext("editor").firestore();

  await assertFails(
    setDoc(
      doc(db, resourcePath("no-audit")),
      resource({ id: "no-audit", actorUid: "editor", auditId: "missing-audit" }),
    ),
  );

  await assertSucceeds(
    batchCreate(db, {
      actorUid: "editor",
      actorRole: "editor",
      recordId: "created",
      auditId: "audit-created",
      now: 1100,
    }),
  );
});

test("class scope is enforced server-side even if the client lies", async () => {
  const db = env.authenticatedContext("outsider").firestore();

  await assertFails(
    batchCreate(db, {
      actorUid: "outsider",
      actorRole: "editor",
      recordId: "scope-bypass",
      auditId: "audit-scope-bypass",
      now: 1200,
    }),
  );
});

test("editor may update ordinary content but cannot approve, archive, restore, or hard-delete", async () => {
  await seedResource(resource({ auditId: "seed", actorUid: "editor", now: 1000 }));
  const db = env.authenticatedContext("editor").firestore();

  const ordinary = writeBatch(db);
  ordinary.update(doc(db, resourcePath()), {
    title: "수정된 공지",
    updatedAtMs: 1300,
    updatedBy: "editor",
    auditId: "audit-update",
  });
  ordinary.set(
    doc(db, auditPath("audit-update")),
    audit({ id: "audit-update", action: "update", actorUid: "editor", actorRole: "editor", now: 1300 }),
  );
  await assertSucceeds(ordinary.commit());

  const approve = writeBatch(db);
  approve.update(doc(db, resourcePath()), {
    status: "approved",
    approvedBy: "editor",
    approvedAtMs: 1400,
    updatedAtMs: 1400,
    updatedBy: "editor",
    auditId: "audit-editor-approve",
  });
  approve.set(
    doc(db, auditPath("audit-editor-approve")),
    audit({ id: "audit-editor-approve", action: "approve", actorUid: "editor", actorRole: "editor", now: 1400 }),
  );
  await assertFails(approve.commit());

  const archive = writeBatch(db);
  archive.update(doc(db, resourcePath()), {
    status: "archived",
    deleted: true,
    deletedBy: "editor",
    deletedAtMs: 1500,
    updatedAtMs: 1500,
    updatedBy: "editor",
    auditId: "audit-editor-archive",
  });
  archive.set(
    doc(db, auditPath("audit-editor-archive")),
    audit({ id: "audit-editor-archive", action: "archive", actorUid: "editor", actorRole: "editor", now: 1500 }),
  );
  await assertFails(archive.commit());

  await assertFails(deleteDoc(doc(db, resourcePath())));
});

test("manager can archive and restore only with matching append-only audit records", async () => {
  await seedResource(resource({ auditId: "seed", actorUid: "editor", now: 1000 }));
  const db = env.authenticatedContext("manager").firestore();

  const archive = writeBatch(db);
  archive.update(doc(db, resourcePath()), {
    status: "archived",
    deleted: true,
    deletedBy: "manager",
    deletedAtMs: 2000,
    updatedAtMs: 2000,
    updatedBy: "manager",
    auditId: "audit-manager-archive",
  });
  archive.set(
    doc(db, auditPath("audit-manager-archive")),
    audit({ id: "audit-manager-archive", action: "archive", actorUid: "manager", actorRole: "manager", now: 2000 }),
  );
  await assertSucceeds(archive.commit());

  const restore = writeBatch(db);
  restore.update(doc(db, resourcePath()), {
    status: "active",
    deleted: false,
    deletedBy: null,
    deletedAtMs: null,
    restoredBy: "manager",
    restoredAtMs: 2100,
    updatedAtMs: 2100,
    updatedBy: "manager",
    auditId: "audit-manager-restore",
  });
  restore.set(
    doc(db, auditPath("audit-manager-restore")),
    audit({ id: "audit-manager-restore", action: "restore", actorUid: "manager", actorRole: "manager", now: 2100 }),
  );
  await assertSucceeds(restore.commit());

  await assertFails(
    updateDoc(doc(db, auditPath("audit-manager-archive")), { reason: "감사 기록 변조" }),
  );
  await assertFails(deleteDoc(doc(db, auditPath("audit-manager-archive"))));
});

test("manager can approve, but editing approved content requires reopening it", async () => {
  await seedResource(resource({ auditId: "seed", actorUid: "editor", now: 1000 }));
  const db = env.authenticatedContext("manager").firestore();

  const approve = writeBatch(db);
  approve.update(doc(db, resourcePath()), {
    status: "approved",
    approvedBy: "manager",
    approvedAtMs: 2200,
    updatedAtMs: 2200,
    updatedBy: "manager",
    auditId: "audit-manager-approve",
  });
  approve.set(
    doc(db, auditPath("audit-manager-approve")),
    audit({ id: "audit-manager-approve", action: "approve", actorUid: "manager", actorRole: "manager", now: 2200 }),
  );
  await assertSucceeds(approve.commit());

  const mutateApproved = writeBatch(db);
  mutateApproved.update(doc(db, resourcePath()), {
    body: "승인 상태를 유지한 채 내용만 바꾸기",
    updatedAtMs: 2300,
    updatedBy: "manager",
    auditId: "audit-approved-mutation",
  });
  mutateApproved.set(
    doc(db, auditPath("audit-approved-mutation")),
    audit({ id: "audit-approved-mutation", action: "update", actorUid: "manager", actorRole: "manager", now: 2300 }),
  );
  await assertFails(mutateApproved.commit());

  const reopen = writeBatch(db);
  reopen.update(doc(db, resourcePath()), {
    body: "수정 때문에 다시 검토 대기",
    status: "pending",
    approvedBy: null,
    approvedAtMs: null,
    updatedAtMs: 2400,
    updatedBy: "manager",
    auditId: "audit-reopen",
  });
  reopen.set(
    doc(db, auditPath("audit-reopen")),
    audit({ id: "audit-reopen", action: "update", actorUid: "manager", actorRole: "manager", now: 2400 }),
  );
  await assertSucceeds(reopen.commit());
});

test("audit ids cannot be reused to smuggle a second mutation", async () => {
  await seedResource(resource({ auditId: "seed", actorUid: "editor", now: 1000 }));
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), auditPath("already-used")),
      audit({ id: "already-used", action: "update", actorUid: "editor", actorRole: "editor", now: 2500 }),
    );
  });

  const db = env.authenticatedContext("editor").firestore();
  const batch = writeBatch(db);
  batch.update(doc(db, resourcePath()), {
    title: "재사용 시도",
    updatedAtMs: 2500,
    updatedBy: "editor",
    auditId: "already-used",
  });

  await assertFails(batch.commit());
});

test("only school-level system admin can manage roles, and roles are never hard-deleted", async () => {
  const adminDb = env.authenticatedContext("admin").firestore();
  const managerDb = env.authenticatedContext("manager").firestore();

  await assertSucceeds(
    updateDoc(doc(adminDb, rolePath("editor")), {
      enabled: false,
    }),
  );

  await assertFails(
    updateDoc(doc(managerDb, rolePath("outsider")), {
      enabled: false,
    }),
  );

  await assertFails(deleteDoc(doc(adminDb, rolePath("outsider"))));
});

test("disabled roles lose elevated access immediately", async () => {
  await seedResource(resource({ auditId: "seed", actorUid: "editor", now: 1000 }));
  const db = env.authenticatedContext("disabled-manager").firestore();

  const archive = writeBatch(db);
  archive.update(doc(db, resourcePath()), {
    status: "archived",
    deleted: true,
    deletedBy: "disabled-manager",
    deletedAtMs: 2600,
    updatedAtMs: 2600,
    updatedBy: "disabled-manager",
    auditId: "audit-disabled",
  });
  archive.set(
    doc(db, auditPath("audit-disabled")),
    audit({ id: "audit-disabled", action: "archive", actorUid: "disabled-manager", actorRole: "manager", now: 2600 }),
  );

  await assertFails(archive.commit());
});
