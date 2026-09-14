import {
  ALLOWED_EVENT_PROPERTY_KEYS,
  ALLOWED_EVENT_TYPES,
  EXPERIMENT_SCHEMA_VERSION,
  deviceCategory,
} from "./constants.js";

const QUEUE_KEY = "pincon-experiment-event-queue-v1";
const MAX_QUEUE = 300;
const SESSION_KEY = "pincon-experiment-session-v1";

function json(value, fallback) {
  try { return JSON.parse(value) ?? fallback; } catch { return fallback; }
}

function randomId(prefix) {
  const token = crypto.randomUUID
    ? crypto.randomUUID().replaceAll("-", "")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${token.slice(0, 28)}`;
}

function sessionId() {
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = randomId("session");
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

function safeProperties(properties = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(properties || {})) {
    if (!ALLOWED_EVENT_PROPERTY_KEYS.has(key)) continue;
    if (typeof value === "string") clean[key] = value.slice(0, 120);
    else if (typeof value === "number" && Number.isFinite(value)) clean[key] = Math.round(value * 1000) / 1000;
    else if (typeof value === "boolean") clean[key] = value;
  }
  return clean;
}

export class ExperimentAnalytics {
  constructor({ contextProvider, transport }) {
    this.contextProvider = contextProvider;
    this.transport = transport;
    this.flushing = false;
    this.flushTimer = 0;
    this.lastEventByKey = new Map();
    window.addEventListener("online", () => this.scheduleFlush(50), { passive: true });
  }

  queue() {
    return json(localStorage.getItem(QUEUE_KEY), []).filter((item) => item && item.eventId).slice(-MAX_QUEUE);
  }

  saveQueue(rows) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(rows.slice(-MAX_QUEUE)));
  }

  log(eventType, properties = {}, { dedupeKey = "", dedupeMs = 800 } = {}) {
    if (!ALLOWED_EVENT_TYPES.has(eventType)) return false;
    const context = this.contextProvider?.();
    if (!context?.anonymousParticipant || !context?.experimentId) return false;

    if (dedupeKey) {
      const previous = Number(this.lastEventByKey.get(dedupeKey) || 0);
      if (Date.now() - previous < dedupeMs) return false;
      this.lastEventByKey.set(dedupeKey, Date.now());
    }

    const event = {
      schemaVersion: EXPERIMENT_SCHEMA_VERSION,
      eventId: randomId("event"),
      anonymousParticipant: context.anonymousParticipant,
      experimentId: context.experimentId,
      experimentVersion: Number(context.experimentVersion || 1),
      variant: String(context.variant || ""),
      eventType,
      timestampMs: Date.now(),
      sessionId: sessionId(),
      deviceCategory: deviceCategory(),
      properties: safeProperties(properties),
    };

    const rows = this.queue();
    rows.push(event);
    this.saveQueue(rows);
    this.scheduleFlush();
    return true;
  }

  scheduleFlush(delay = 900) {
    window.clearTimeout(this.flushTimer);
    this.flushTimer = window.setTimeout(() => this.flush(), delay);
  }

  async flush() {
    if (this.flushing || !navigator.onLine) return;
    const rows = this.queue();
    if (!rows.length) return;
    this.flushing = true;
    try {
      const batch = rows.slice(0, 25);
      await this.transport(batch);
      const sent = new Set(batch.map((item) => item.eventId));
      this.saveQueue(this.queue().filter((item) => !sent.has(item.eventId)));
      if (this.queue().length) this.scheduleFlush(250);
    } catch {
      this.scheduleFlush(12_000);
    } finally {
      this.flushing = false;
    }
  }
}
