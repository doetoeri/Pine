import { gravityTilt, tiltDrive } from "../next/assessments/tilt-physics.js?v=20261011-tilt1";

const SETTING = "pincon-tilt-swipe-v1";
const screenAngle = () => Number.isFinite(screen.orientation?.angle) ? screen.orientation.angle : Number(window.orientation) || 0;

export class TiltSwipe {
  constructor() {
    this.enabled = false;
    this.active = false;
    this.phase = "off";
    this.handlers = new Set();
    this.listeners = null;
    this.watchdog = 0;
    this.value = 0;
    this.request = 0;
    this.blockedUntil = 0;
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)");
    this.onchange = () => {};
    this.onMotion = event => this.read(event);
    this.reduced.addEventListener("change", () => this.sync());
    document.addEventListener("visibilitychange", () => this.sync());
    window.addEventListener("pagehide", () => this.stop());
    window.addEventListener("pageshow", () => this.sync());
    let saved = false;
    try { saved = localStorage.getItem(SETTING) === "on"; } catch {}
    if (saved && this.supported()) {
      // Safari requires a fresh user gesture to request permission. Never
      // prompt on page load or claim that the sensor is already running.
      if (typeof DeviceMotionEvent.requestPermission === "function") this.phase = "permission";
      else { this.enabled = true; this.phase = "waiting"; }
    }
  }

  supported() { return window.isSecureContext && typeof window.DeviceMotionEvent !== "undefined"; }
  status() {
    if (!this.enabled) return this.phase;
    if (this.reduced.matches) return "reduced";
    if (document.hidden || !this.active || !this.handlers.size) return "paused";
    return this.phase;
  }
  notify() { this.onchange({ enabled: this.enabled, status: this.status() }); }
  save(enabled) { try { localStorage.setItem(SETTING, enabled ? "on" : "off"); } catch {} }

  async setEnabled(enabled) {
    const request = ++this.request;
    if (!enabled) {
      this.enabled = false; this.phase = "off"; this.stop(); this.save(false); this.notify(); return;
    }
    if (!this.supported()) { this.phase = "unavailable"; this.notify(); return; }
    if (this.reduced.matches) { this.phase = "reduced"; this.notify(); return; }
    if (typeof DeviceMotionEvent.requestPermission === "function") {
      this.phase = "requesting"; this.notify();
      try {
        // Called synchronously from the setting's change gesture, before any
        // await, so iPhone Safari can display its own permission sheet.
        const result = await DeviceMotionEvent.requestPermission();
        if (request !== this.request) return;
        if (result !== "granted") { this.phase = "denied"; this.save(false); this.notify(); return; }
      } catch {
        if (request !== this.request) return;
        this.phase = "denied"; this.save(false); this.notify(); return;
      }
    }
    if (request !== this.request) return;
    this.enabled = true; this.phase = "waiting"; this.save(true); this.sync();
  }

  setActive(active) {
    if (this.active === Boolean(active)) return;
    this.active = Boolean(active); this.sync();
  }
  subscribe(handler) {
    this.reset();
    if (this.listeners) this.phase = "waiting";
    this.handlers.add(handler); this.sync();
    return () => { this.handlers.delete(handler); this.sync(); };
  }
  emit(value) {
    if (this.value === value) return;
    this.value = value;
    for (const handler of this.handlers) handler(value);
  }
  reset() {
    this.baseline = null; this.filtered = 0; this.sampleAt = 0; this.calibrationAt = 0;
    this.emit(0);
  }
  pause(milliseconds = 700) {
    this.blockedUntil = performance.now() + milliseconds;
    this.reset();
    if (this.listeners) { this.phase = "calibrating"; this.notify(); }
  }
  stop() {
    this.listeners?.abort(); this.listeners = null;
    clearTimeout(this.watchdog); this.watchdog = 0; this.reset();
  }
  sync() {
    if (!this.enabled && this.phase === "reduced" && !this.reduced.matches) this.phase = "off";
    const run = this.enabled && this.active && this.handlers.size && !document.hidden && !this.reduced.matches;
    if (!run) this.stop();
    else if (!this.listeners) {
      this.reset(); this.blockedUntil = 0; this.phase = "waiting";
      this.lastReading = performance.now();
      this.angle = screenAngle();
      this.listeners = new AbortController();
      const options = { signal: this.listeners.signal, passive: true };
      // Orientation events may only fire when an angle changes. Motion events
      // arrive periodically, so holding a tilt keeps accelerating reliably.
      window.addEventListener("devicemotion", this.onMotion, options);
      const rotate = () => {
        const angle = screenAngle();
        // Safari can deliver both rotation notifications, or deliver one
        // after a motion sample has already observed the new display angle.
        // Only the actual angle change needs a new neutral pose.
        if (angle === this.angle) return;
        this.angle = angle; this.reset(); this.phase = "waiting"; this.notify();
      };
      screen.orientation?.addEventListener("change", rotate, options);
      window.addEventListener("orientationchange", rotate, options);
      this.watchdog = setTimeout(() => this.checkFreshness(), 600);
    }
    this.notify();
  }
  checkFreshness() {
    if (!this.listeners) return;
    const stale = performance.now() - this.lastReading;
    if (stale > 2500) {
      this.enabled = false; this.phase = "unavailable";
      this.stop(); this.save(false); this.notify(); return;
    }
    if (stale > 450) {
      // Pause velocity while samples stall, but retain the neutral pose.
      // Otherwise a delayed sample can turn a held tilt into the new neutral
      // position and silently stop browsing after a slow rendering frame.
      this.filtered = 0; this.emit(0); this.phase = "waiting"; this.notify();
    }
    this.watchdog = setTimeout(() => this.checkFreshness(), 600);
  }
  read(event) {
    if (!this.listeners || document.hidden || !this.active || this.reduced.matches) return;
    const angle = screenAngle(), raw = event.accelerationIncludingGravity;
    // Remove reported linear acceleration when available: a touch gesture or
    // a quick hand movement should not masquerade as a sustained phone tilt.
    const gravity = ["x", "y", "z"].map(axis => typeof raw?.[axis] === "number" ? raw[axis] - (Number.isFinite(event.acceleration?.[axis]) ? event.acceleration[axis] : 0) : null);
    const degrees = gravityTilt(...gravity, angle);
    if (degrees === null) { this.filtered = 0; this.emit(0); return; }
    if (angle !== this.angle) { this.angle = angle; this.reset(); }
    const now = performance.now(), dt = this.sampleAt ? Math.min((now - this.sampleAt) / 1000, .1) : 1 / 60;
    this.sampleAt = this.lastReading = now;
    if (this.baseline === null || now < this.blockedUntil) {
      this.baseline = degrees; this.filtered = 0; this.calibrationAt = now;
      if (this.phase !== "calibrating") { this.phase = "calibrating"; this.notify(); }
      this.emit(0); return;
    }
    if (now - this.calibrationAt < 200) {
      this.baseline += (degrees - this.baseline) * .2;
      return;
    }
    if (this.phase !== "ready") { this.phase = "ready"; this.notify(); }
    this.filtered += (degrees - this.baseline - this.filtered) * (1 - Math.exp(-dt / .075));
    this.emit(tiltDrive(this.filtered));
  }
}
