export function motionPreference() {
  return globalThis.PINCON_ACCESSIBILITY?.motion ?? matchMedia("(prefers-reduced-motion: reduce)");
}
