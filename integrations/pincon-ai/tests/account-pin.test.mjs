import test from "node:test";
import assert from "node:assert/strict";
import { hashPin, validPin, verifyPin } from "../lib/account-pin.mjs";

test("PIN validation accepts 6-12 digits but rejects a single repeated digit", () => {
  assert.equal(validPin("123456"), true);
  assert.equal(validPin("123456789012"), true);
  assert.equal(validPin("12345"), false);
  assert.equal(validPin("1234567890123"), false);
  assert.equal(validPin("111111"), false);
  assert.equal(validPin("12A456"), false);
});

test("PIN hashes are salted and verify without storing the original PIN", () => {
  const first = hashPin("7351942");
  const second = hashPin("7351942");
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.digest, second.digest);
  assert.equal(first.digest.includes("7351942"), false);
  assert.equal(verifyPin("7351942", first.salt, first.digest, first.version), true);
  assert.equal(verifyPin("7351943", first.salt, first.digest, first.version), false);
});
