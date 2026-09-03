import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("active student gate uses server PIN authentication", async () => {
  const gate = await source("../simple-account-gate.js");
  const auth = await source("../core/server-pin-auth.js");
  assert.match(gate, /core\/server-pin-auth\.js\?v=20260903-serverpin1/);
  assert.match(auth, /\/api\/accounts\/login/);
  assert.match(auth, /signInWithCustomToken/);
  assert.doesNotMatch(auth, /signInWithEmailAndPassword/);
});

test("PIN change returns through custom-token reauthentication", async () => {
  const browser = await source("../core/server-pin-auth.js");
  const server = await source("../../integrations/pincon-ai/handlers/accounts/change-pin.mjs");
  assert.match(browser, /accountRequest\("\/api\/accounts\/change-pin"/);
  assert.match(browser, /result\?\.customToken/);
  assert.match(server, /hashPin\(newPin\)/);
  assert.match(server, /accountCredentials/);
  assert.match(server, /createCustomToken/);
  assert.doesNotMatch(server, /updateUser\([^\n]*password/);
});

test("server PIN login is rate limited and never returns PIN material", async () => {
  const login = await source("../../integrations/pincon-ai/handlers/accounts/login.mjs");
  assert.match(login, /MAX_FAILURES = 8/);
  assert.match(login, /LOCK_MS = 2 \* 60 \* 1000/);
  assert.match(login, /verifyPin/);
  assert.match(login, /createCustomToken/);
  assert.doesNotMatch(login, /return \{[^}]*pin/i);
});
