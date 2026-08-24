import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("Google auth uses Firebase GoogleAuthProvider with persistent popup sign-in", async () => {
  const auth = await source("../../pincon-guest-auth.js");
  assert.match(auth, /new api\.GoogleAuthProvider\(\)/);
  assert.match(auth, /signInWithPopup\(api\.auth, provider\)/);
  assert.match(auth, /browserLocalPersistence/);
  assert.match(auth, /signInWithGoogleAndSync/);
});

test("student trust UI exposes Google sign-in without granting admin by itself", async () => {
  const writeMode = await source("../write-mode.js");
  assert.match(writeMode, /id = "signInWithGoogle"/);
  assert.match(writeMode, /PINCON_GUEST_AUTH\.signInWithGoogleAndSync/);
  assert.doesNotMatch(writeMode, /level\s*[:=]\s*["']school["']/);
});

test("role manager renders and writes roles only after current school-admin verification", async () => {
  const manager = await source("../admin/role-manager.js");
  assert.match(manager, /role\?\.enabled === true && role\?\.level === "school"/);
  assert.match(manager, /"schools", SCHOOL\.id, "roles", uid/);
  assert.match(manager, /level: "class"/);
  assert.match(manager, /classKeys: \[classKey\]/);
  assert.match(manager, /writeBatch/);
});

test("production Firestore keeps role mutation server-gated by schoolAdmin", async () => {
  const rules = await source("../../firestore.rules");
  const marker = "match /schools/{schoolId}/roles/{userId}";
  const start = rules.indexOf(marker);
  assert.notEqual(start, -1);
  const block = rules.slice(start, rules.indexOf("\n    match /schools/", start + marker.length));
  assert.match(block, /allow create, update, delete: if schoolAdmin\(schoolId\)/);
});
