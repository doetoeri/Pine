const STORAGE_PREFIX = "pincon-next-notification-state-v1";
const MAX_READ_IDS = 400;

function parseJson(value, fallback) {
  try { return JSON.parse(value) ?? fallback; } catch { return fallback; }
}

function storageKey(classKey) {
  return `${STORAGE_PREFIX}:${classKey || "unscoped"}`;
}

function cleanText(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function dateFrom(item = {}) {
  const raw = item.dueDate || item.date || item.startsOn || item.startDate || item.dueAt || "";
  const match = String(raw).match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] || "";
}

function titleFrom(item = {}, fallback) {
  return cleanText(item.title || item.name || item.subject || item.body || fallback);
}

function orderFrom(item = {}) {
  const candidates = [item.updatedAtMs, item.createdAtMs, item.publishedAtMs, item.startsAtMs, item.dueAtMs];
  const numeric = candidates.map(Number).find((value) => Number.isFinite(value) && value > 0);
  if (numeric) return numeric;
  const date = dateFrom(item);
  return date ? Date.parse(`${date}T12:00:00`) || 0 : 0;
}

function fallbackId(kind, item = {}, index = 0) {
  const seed = [kind, dateFrom(item), titleFrom(item, "item"), item.classKey || "", index].join("|");
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${kind}:${(hash >>> 0).toString(36)}`;
}

function normalize(kind, item, index, options) {
  if (!item || item.deleted || item.status === "draft") return null;
  const title = titleFrom(item, options.fallbackTitle);
  if (!title) return null;
  return {
    id: `${kind}:${item.id || fallbackId(kind, item, index)}`,
    recordId: item.id || "",
    detailKind: options.detailKind || kind,
    collection: options.collection || `${kind}s`,
    kind: options.label,
    icon: options.icon,
    title,
    body: cleanText(item.body || item.description || item.subject || item.location || options.body || ""),
    date: dateFrom(item),
    route: typeof options.route === "function" ? options.route(item) : options.route,
    order: orderFrom(item),
    occurredAtMs: orderFrom(item),
    changeSummary: cleanText(item.changeSummary || item.changeDescription || item.body || item.description || options.body || ""),
  };
}

export function buildNotificationFeed(data = {}, limit = 80) {
  const specs = [
    ["announcement", data.announcements || [], { label: "공지", icon: "campaign", route: "today", collection: "announcements", detailKind: "announcement", fallbackTitle: "새 공지" }],
    ["content", (data.content || []).filter((item) => item?.kind === "notice"), { label: "공지", icon: "update", route: (item) => item.category === "수업 변경" ? "timetable" : "today", collection: "content", detailKind: "announcement", fallbackTitle: "새 공지" }],
    ["assignment", data.classAssignments || [], { label: "수행·숙제", icon: "assignment", route: "schedule", collection: "classAssignments", detailKind: "assignment", fallbackTitle: "새 수행·숙제" }],
    ["event", data.events || [], { label: "학급 행사", icon: "celebration", route: "classroom", collection: "events", detailKind: "event", fallbackTitle: "새 학급 행사" }],
  ];

  const rows = [];
  for (const [kind, items, options] of specs) {
    items.forEach((item, index) => {
      const row = normalize(kind, item, index, options);
      if (row) rows.push(row);
    });
  }

  return rows
    .sort((a, b) => (b.order - a.order) || b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export class NotificationStore extends EventTarget {
  constructor(classKey = "") {
    super();
    this.classKey = classKey;
    this.readIds = this.load();
  }

  load() {
    const value = parseJson(localStorage.getItem(storageKey(this.classKey)), { readIds: [] });
    return new Set(Array.isArray(value.readIds) ? value.readIds.slice(-MAX_READ_IDS) : []);
  }

  persist() {
    try {
      localStorage.setItem(storageKey(this.classKey), JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        readIds: [...this.readIds].slice(-MAX_READ_IDS),
      }));
    } catch {}
  }

  setClassKey(classKey = "") {
    if (classKey === this.classKey) return;
    this.classKey = classKey;
    this.readIds = this.load();
    this.emit();
  }

  decorate(items = []) {
    return items.map((item) => ({ ...item, read: this.readIds.has(item.id) }));
  }

  unreadCount(items = []) {
    return items.reduce((count, item) => count + (this.readIds.has(item.id) ? 0 : 1), 0);
  }

  markRead(id) {
    if (!id || this.readIds.has(id)) return;
    this.readIds.add(id);
    this.persist();
    this.emit();
  }

  markAllRead(items = []) {
    let changed = false;
    for (const item of items) {
      if (!this.readIds.has(item.id)) {
        this.readIds.add(item.id);
        changed = true;
      }
    }
    if (!changed) return;
    this.persist();
    this.emit();
  }

  emit() {
    this.dispatchEvent(new CustomEvent("change", { detail: { classKey: this.classKey } }));
  }
}
