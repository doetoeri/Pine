const DEFAULT_WINDOW_MS = 36 * 60 * 60 * 1000;
const CHANGE_PATTERN = /시간표\s*변경|수업\s*변경|교실\s*변경|일정\s*변경|변경됨|변경했|수정됨|수정했/;

function cleanText(value) {
  return String(value || "")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function timestampMs(value) {
  if (Number.isFinite(Number(value)) && Number(value) > 0) return Number(value);
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (Number.isFinite(Number(value?.seconds))) return Number(value.seconds) * 1000;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstTimestamp(item, keys) {
  for (const key of keys) {
    const value = timestampMs(item?.[key]);
    if (value) return value;
  }
  return 0;
}

function createdAtMs(item) {
  return firstTimestamp(item, ["createdAtMs", "clientCreatedAt", "publishedAtMs", "createdAt", "publishedAt"]);
}

function occurredAtMs(item) {
  return firstTimestamp(item, [
    "updatedAtMs",
    "clientUpdatedAt",
    "changedAtMs",
    "lastVerifiedAtMs",
    "updatedAt",
    "createdAtMs",
    "clientCreatedAt",
    "publishedAtMs",
    "createdAt",
    "publishedAt",
  ]);
}

function changedRecord(item) {
  const status = String(item?.verificationStatus || item?.confirmationStatus || item?.status || "").toLowerCase();
  if (item?.changed === true || ["changed", "updated", "modified"].includes(status)) return true;

  const text = cleanText([
    item?.category,
    item?.title,
    item?.body,
    item?.description,
    item?.changeSummary,
    item?.changeDescription,
  ].filter(Boolean).join(" "));
  if (CHANGE_PATTERN.test(text)) return true;

  const created = createdAtMs(item);
  const updated = firstTimestamp(item, ["updatedAtMs", "clientUpdatedAt", "changedAtMs", "updatedAt"]);
  return Boolean(created && updated && updated - created > 60_000);
}

function titleFrom(item, fallback) {
  return cleanText(item?.title || item?.name || item?.subject || fallback) || fallback;
}

function summaryFrom(item) {
  return cleanText(item?.changeSummary || item?.changeDescription || item?.body || item?.description || item?.subject || item?.category || "");
}

function rowId(collection, item, index, time) {
  if (item?.id) return `${collection}:${item.id}`;
  const seed = [collection, titleFrom(item, "item"), time, index].join("|");
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${collection}:${(hash >>> 0).toString(36)}`;
}

function validRecord(item) {
  return Boolean(item && !item.deleted && item.status !== "draft" && item.published !== false);
}

const SPECS = Object.freeze([
  {
    collection: "announcements",
    label: "공지",
    icon: "campaign",
    route: () => "today",
    fallbackTitle: "새 공지",
    rows: (data) => data.announcements || [],
  },
  {
    collection: "content",
    label: "공지",
    icon: "update",
    route: (item) => item.category === "수업 변경" || CHANGE_PATTERN.test(cleanText(`${item.title || ""} ${item.body || ""}`)) ? "timetable" : "today",
    fallbackTitle: "새 안내",
    rows: (data) => (data.content || []).filter((item) => item?.kind === "notice"),
  },
  {
    collection: "classAssignments",
    label: "수행·숙제",
    icon: "assignment",
    route: () => "schedule",
    fallbackTitle: "새 수행·숙제",
    rows: (data) => data.classAssignments || [],
  },
  {
    collection: "evaluationPlans",
    label: "평가계획서",
    icon: "picture_as_pdf",
    route: () => "classroom",
    fallbackTitle: "새 평가계획서",
    rows: (data) => data.evaluationPlans || [],
  },
  {
    collection: "events",
    label: "학급 행사",
    icon: "celebration",
    route: () => "classroom",
    fallbackTitle: "새 학급 행사",
    rows: (data) => data.events || [],
  },
]);

export function buildTodayChanges(data = {}, { nowMs = Date.now(), windowMs = DEFAULT_WINDOW_MS, limit = 6 } = {}) {
  const cutoff = nowMs - Math.max(1, Number(windowMs) || DEFAULT_WINDOW_MS);
  const rows = [];

  for (const spec of SPECS) {
    spec.rows(data).forEach((item, index) => {
      if (!validRecord(item)) return;
      const occurred = occurredAtMs(item);
      if (!occurred || occurred < cutoff || occurred > nowMs + 5 * 60 * 1000) return;
      rows.push({
        id: rowId(spec.collection, item, index, occurred),
        recordId: item.id || "",
        collection: spec.collection,
        kind: spec.label,
        icon: spec.icon,
        route: spec.route(item),
        title: titleFrom(item, spec.fallbackTitle),
        summary: summaryFrom(item),
        occurredAtMs: occurred,
        changeType: changedRecord(item) ? "changed" : "new",
      });
    });
  }

  return rows
    .sort((a, b) => (b.occurredAtMs - a.occurredAtMs) || a.id.localeCompare(b.id))
    .slice(0, Math.max(1, Number(limit) || 6));
}

export function buildTodayChangesShareText(rows = [], profile = null) {
  const classLabel = profile?.grade && profile?.classNumber
    ? `${Number(profile.grade)}학년 ${Number(profile.classNumber)}반`
    : "우리 반";
  const lines = [`📌 ${classLabel} · 오늘 바뀐 것 ${rows.length}건`];

  if (!rows.length) {
    lines.push("• 최근 확인된 새 정보나 변경사항이 없습니다.");
  } else {
    for (const row of rows.slice(0, 6)) {
      const prefix = row.changeType === "changed" ? "변경" : "새로 등록";
      lines.push(`• [${prefix}] ${row.title}${row.summary ? ` · ${row.summary}` : ""}`);
    }
  }
  lines.push("PinCon에서 최신 정보 확인");
  return lines.join("\n");
}

export const TODAY_CHANGES_WINDOW_MS = DEFAULT_WINDOW_MS;
