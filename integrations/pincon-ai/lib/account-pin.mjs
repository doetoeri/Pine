import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const PIN_VERSION = 1;

export function validPin(value) {
  const pin = String(value || "");
  return /^\d{6,12}$/.test(pin) && !/^(\d)\1+$/.test(pin);
}

function material(pin) {
  return `pincon-pin:v${PIN_VERSION}:${String(pin || "")}`;
}

export function hashPin(pin, salt = randomBytes(16).toString("hex")) {
  if (!validPin(pin)) throw new Error("invalid-pin");
  const digest = scryptSync(material(pin), String(salt), 32).toString("hex");
  return { version: PIN_VERSION, salt: String(salt), digest };
}

export function verifyPin(pin, salt, digest, version = PIN_VERSION) {
  if (!validPin(pin) || Number(version) !== PIN_VERSION || !salt || !digest) return false;
  try {
    const candidate = scryptSync(material(pin), String(salt), 32);
    const expected = Buffer.from(String(digest), "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}
