import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("student auth uses Firebase email/password without storing PIN locally", async () => {
  const auth = await source("../core/student-auth.js");
  assert.match(auth, /signInWithEmailAndPassword\(authApi\.auth, studentEmail\(number\), secret\)/);
  assert.match(auth, /browserLocalPersistence/);
  assert.match(auth, /browserSessionPersistence/);
  assert.match(auth, /@students\\\.pincon\\\.invalid/);
  assert.doesNotMatch(auth, /localStorage\.(?:setItem|getItem)\([^\n]*(?:pin|password|secret)/i);
});

test("login errors do not reveal whether the student number or PIN was wrong", async () => {
  const gate = await source("../account-gate.js");
  assert.match(gate, /학번 또는 PIN을 다시 확인해주세요\./);
  assert.doesNotMatch(gate, /존재하지 않는 학번|PIN이 틀|비밀번호가 틀/);
});

test("first login forces a PIN change and never exposes an old PIN lookup path", async () => {
  const gate = await source("../account-gate.js");
  const auth = await source("../core/student-auth.js");
  assert.match(gate, /account\.mustChangePin/);
  assert.match(gate, /PinCon 시작하기/);
  assert.match(auth, /changeStudentPin/);
  assert.doesNotMatch(`${gate}\n${auth}`, /기존 PIN 확인|currentPin|oldPin/i);
});

test("legacy Google administrators retain a migration login path", async () => {
  const gate = await source("../account-gate.js");
  assert.match(gate, /관리자 Google 로그인/);
  assert.match(gate, /PINCON_GUEST_AUTH/);
  assert.match(gate, /mode: "legacy"/);
});

test("application modules boot only after the account gate resolves", async () => {
  const bootstrap = await source("../app-bootstrap.js");
  const html = await source("../index.html");
  assert.match(bootstrap, /await accountReady/);
  assert.match(bootstrap, /await import\("\.\/app\.js"\)/);
  assert.match(html, /src="\.\/app-bootstrap\.js"/);
  assert.doesNotMatch(html, /src="\.\/app\.js"/);
});

test("test-only authentication bypass is restricted to localhost", async () => {
  const gate = await source("../account-gate.js");
  assert.match(gate, /\["127\.0\.0\.1", "localhost"\]\.includes\(location\.hostname\)/);
  assert.match(gate, /get\("auth"\) !== "1"/);
});
