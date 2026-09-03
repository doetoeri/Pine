import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;

export function normalizeActivationCode(value) {
  return String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, CODE_LENGTH);
}

export function validActivationCode(value) {
  const code = normalizeActivationCode(value);
  return code.length === CODE_LENGTH && [...code].every((char) => ALPHABET.includes(char));
}

export function generateActivationCode() {
  let code = "";
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += ALPHABET[randomInt(0, ALPHABET.length)];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function hashActivationCode(code, salt = randomBytes(16).toString("hex")) {
  const normalized = normalizeActivationCode(code);
  if (!validActivationCode(normalized)) throw new Error("invalid-activation-code");
  const digest = scryptSync(normalized, salt, 32).toString("hex");
  return { salt, digest };
}

export function verifyActivationCode(code, salt, digest) {
  const normalized = normalizeActivationCode(code);
  if (!validActivationCode(normalized) || !salt || !digest) return false;
  try {
    const candidate = scryptSync(normalized, String(salt), 32);
    const expected = Buffer.from(String(digest), "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}
