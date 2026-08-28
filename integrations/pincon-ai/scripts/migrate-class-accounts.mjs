import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { firestore } from "../lib/firebase.mjs";
import {
  SCHOOL_ID,
  publicProfile,
  syncCompatibilityRole,
} from "../lib/class-accounts.mjs";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const outputArg = process.argv.slice(2).find((item) => item.startsWith("--output="));
const outputPath = resolve(outputArg?.slice("--output=".length) || `pincon-account-migration-${Date.now()}.json`);

function safeRole(role = {}) {
  return {
    enabled: role.enabled === true,
    level: String(role.level || ""),
    classKeys: Array.isArray(role.classKeys) ? role.classKeys.map(String).slice(0, 30) : [],
    managedByAccountSystem: role.managedByAccountSystem === true,
    updatedAtMs: Number(role.updatedAtMs || 0),
  };
}

async function documents(collectionPath) {
  const snapshot = await firestore().collection(collectionPath).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function main() {
  const [users, legacyRoles] = await Promise.all([
    documents(`schools/${SCHOOL_ID}/users`),
    documents(`schools/${SCHOOL_ID}/roles`),
  ]);

  const backup = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    schoolId: SCHOOL_ID,
    mode: apply ? "apply" : "dry-run",
    note: "PIN/password values are never exported. Legacy role documents are preserved; this migration only reconciles compatibility roles for already-provisioned PinCon accounts.",
    counts: {
      users: users.length,
      legacyRoles: legacyRoles.length,
    },
    users: users.map((item) => publicProfile(item)),
    legacyRoles: legacyRoles.map((item) => ({ uid: item.id, ...safeRole(item) })),
  };

  await writeFile(outputPath, `${JSON.stringify(backup, null, 2)}\n`, "utf8");

  const actions = [];
  for (const user of users) {
    const profile = publicProfile(user);
    if (!profile?.uid) continue;
    const action = {
      uid: profile.uid,
      studentNumber: profile.studentNumber,
      classKey: profile.classKey,
      roles: profile.roles,
      compatibilityRole: profile.roles.includes("ADMIN")
        ? "school"
        : profile.roles.includes("CLASS_PRESIDENT")
          ? "president"
          : profile.roles.includes("TEACHER")
            ? "class"
            : "none",
      applied: false,
    };
    if (apply) {
      await syncCompatibilityRole(profile, "account-migration");
      action.applied = true;
    }
    actions.push(action);
  }

  const report = {
    backup: outputPath,
    mode: apply ? "apply" : "dry-run",
    usersChecked: users.length,
    legacyRolesPreserved: legacyRoles.length,
    actions,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
