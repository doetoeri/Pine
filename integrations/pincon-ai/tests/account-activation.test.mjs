import test from "node:test";
import assert from "node:assert/strict";
import {
  generateActivationCode,
  hashActivationCode,
  normalizeActivationCode,
  validActivationCode,
  verifyActivationCode,
} from "../lib/account-activation.mjs";

test("activation codes are human-readable and avoid ambiguous characters", () => {
  for (let index = 0; index < 50; index += 1) {
    const code = generateActivationCode();
    assert.match(code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
    assert.equal(validActivationCode(code), true);
    assert.equal(normalizeActivationCode(code).length, 8);
    assert.doesNotMatch(code, /[01IO]/);
  }
});

test("activation codes are stored as salted scrypt digests and verify timing-safely", () => {
  const code = generateActivationCode();
  const { salt, digest } = hashActivationCode(code);
  assert.match(salt, /^[a-f0-9]{32}$/);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(digest.includes(normalizeActivationCode(code)), false);
  assert.equal(verifyActivationCode(code, salt, digest), true);
  assert.equal(verifyActivationCode(normalizeActivationCode(code), salt, digest), true);

  const normalized = normalizeActivationCode(code);
  const replacement = normalized.at(-1) === "A" ? "B" : "A";
  const tampered = `${normalized.slice(0, -1)}${replacement}`;
  assert.equal(verifyActivationCode(tampered, salt, digest), false);
});

test("invalid activation material is rejected without throwing during verification", () => {
  assert.equal(validActivationCode("0000-0000"), false);
  assert.equal(validActivationCode("TOO-SHORT"), false);
  assert.equal(verifyActivationCode("0000-0000", "bad", "bad"), false);
});
