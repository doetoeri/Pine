import test from "node:test";
import assert from "node:assert/strict";
import { studyAccess } from "../experiment/study-access.js";
import { accountMarkup } from "../../experiments/view.js";

test("study access follows real target-class roles, including student-number managers", () => {
  const user = { uid: "manager", isAnonymous: false };
  const role = { enabled: true, level: "president", classKeys: ["1-8"] };
  assert.equal(studyAccess(user, role).canManage, true);
  assert.equal(studyAccess(user, role, { targetClassKeys: ["1-8", "1-7"] }).canManage, false);
  assert.equal(studyAccess(user, { ...role, enabled: false }).canManage, false);
  assert.equal(studyAccess({ ...user, isAnonymous: true }, role).canManage, false);
  assert.equal(studyAccess(user, { ...role, level: "editor" }).canManage, false);
  assert.equal(studyAccess(user, { ...role, classKeys: ["1-7"] }).canManage, false);
  assert.equal(studyAccess(user, { enabled: true, level: "school" }, { targetClassKeys: ["1-7"] }).canManage, true);
});

test("restarting an already connected gateway preserves the verified administrator", async () => {
  const saved = new Map();
  globalThis.localStorage = { getItem: (key) => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
  globalThis.window = { addEventListener() {} };
  const { NextDataGateway, saveClassProfile } = await import("../core/data-gateway.js");
  saveClassProfile(1, 8);
  const gateway = new NextDataGateway();
  gateway.repository = {};
  for (const [level, expected] of [["school", "system-admin"], ["president", "manager"]]) {
    gateway.applyRepositorySnapshot({ ready: true, profile: { grade: 1, classNumber: 8, classKey: "1-8" },
      user: { uid: "admin" }, role: { enabled: true, level, classKeys: ["1-8"] } });
    assert.equal(gateway.snapshot().access.role, expected);
    assert.equal((await gateway.start()).access.role, expected);
    assert.equal((await gateway.start()).access.role, expected);
  }
});

test("signed-in participants can see their access and switch to a manager account", () => {
  const html = accountMarkup({ displayName: "<student>" }, { label: "참가자", canManage: false });
  assert.match(html, /현재 연구의 관리 권한이 없어요/);
  assert.match(html, /권한 다시 확인/);
  assert.match(html, /Google 계정 변경/);
  assert.match(html, /학번 계정 변경/);
  assert.doesNotMatch(html, /<student>/);
});
