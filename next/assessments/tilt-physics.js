const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const radians = Math.PI / 180;

// Project gravity onto the display's horizontal axis. This works upright and
// in landscape, without depending on compass heading or Euler-angle jumps.
export function gravityTilt(x, y, z, angle = 0) {
  if (![x, y, z, angle].every(value => typeof value === "number" && Number.isFinite(value))) return null;
  const gravity = Math.hypot(x, y, z);
  if (gravity < 6 || gravity > 14) return null;
  const horizontal = (-x * Math.cos(angle * radians) - y * Math.sin(angle * radians)) / gravity;
  return Math.asin(clamp(horizontal, -1, 1)) / radians;
}

export function tiltDrive(degrees) {
  if (!Number.isFinite(degrees)) return 0;
  // A quiet central zone absorbs hand tremor. Beyond it, speed increases
  // progressively, with a firm ceiling for deliberate, controllable browsing.
  return Math.sign(degrees) * Math.pow(clamp((Math.abs(degrees) - 4) / 22, 0, 1), 1.3);
}

export function advanceTilt(position, speed, drive, seconds, maxIndex) {
  const dt = clamp(seconds, 0, .05), terminal = clamp(drive, -1, 1) * 3.2;
  const decay = Math.exp(-3.6 * dt);
  const distance = terminal * dt + (speed - terminal) * (1 - decay) / 3.6;
  const next = clamp(position + distance, 0, maxIndex);
  return { position: next, speed: next === 0 && terminal < 0 || next === maxIndex && terminal > 0 ? 0 : terminal + (speed - terminal) * decay };
}
