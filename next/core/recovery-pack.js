const RECOVERY_PROGRESS_KEY = "pincon-recovery-progress-v1";

function cleanText(value, max = 240) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function localDateFromMs(value) {
  const time = Number(value || 0);
  if (!Number.isFinite(time) || time <= 0) return "";
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function recoveryDate(item = {}) {
  const explicit = cleanText(item.announcedDate || item.recoveryDate, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;
  return localDateFromMs(item.createdAtMs || item.updatedAtMs);
}

function visible(item = {}) {
  return item && item.deleted !== true && item.published !== false && item.status !== "draft";
}

function pushRows(target, rows, date, spec) {
  for (const item of Array.isArray(rows) ? rows : []) {
    if (!visible(item) || item.recoveryRelevant === false || recoveryDate(item) !== date) continue;
    const title = cleanText(item.title || item.name || item.subject || spec.fallbackTitle);
    target.push({
      id: `${spec.collection}:${item.id || `${date}-${title}`}`,
      collection: spec.collection,
      kind: spec.kind,
      title: title || spec.fallbackTitle,
      action: cleanText(typeof spec.action === "function" ? spec.action(item) : spec.action),
      subject: cleanText(item.subject, 40),
      item,
      order: Number(item.updatedAtMs || item.createdAtMs || 0),
    });
  }
}

export function buildRecoveryPack(data = {}, date = "") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return [];
  const rows = [];
  pushRows(rows, data.announcements, date, {
    collection: "announcements",
    kind: "announcement",
    fallbackTitle: "학급 공지",
    action: "공지 내용 확인",
  });
  pushRows(rows, data.classAssignments, date, {
    collection: "classAssignments",
    kind: "assignment",
    fallbackTitle: "수행·숙제",
    action: (item) => String(item.verificationStatus || "") === "changed"
      ? "변경된 수행평가 내용 확인"
      : "수행평가·숙제 내용 확인",
  });
  pushRows(rows, data.resources, date, {
    collection: "resources",
    kind: "resource",
    fallbackTitle: "학습 자료",
    action: "학습지·자료 확인",
  });
  pushRows(rows, data.evaluationPlans, date, {
    collection: "evaluationPlans",
    kind: "evaluation-plan",
    fallbackTitle: "평가계획서",
    action: "평가계획서 원본 확인",
  });
  return rows.sort((a, b) => b.order - a.order || a.title.localeCompare(b.title, "ko"));
}

function progressKey(classKey, date) {
  return `${cleanText(classKey, 12)}:${cleanText(date, 10)}`;
}

function readAll(storage) {
  try {
    return JSON.parse(storage?.getItem?.(RECOVERY_PROGRESS_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

export function recoveryProgress(storage, classKey, date) {
  const value = readAll(storage)[progressKey(classKey, date)];
  return value && typeof value === "object" ? value : {};
}

export function setRecoveryItemCompleted(storage, classKey, date, itemId, completed) {
  const all = readAll(storage);
  const key = progressKey(classKey, date);
  const current = all[key] && typeof all[key] === "object" ? all[key] : {};
  if (completed) current[cleanText(itemId, 240)] = true;
  else delete current[cleanText(itemId, 240)];
  all[key] = current;
  storage?.setItem?.(RECOVERY_PROGRESS_KEY, JSON.stringify(all));
  return current;
}

