import { NextDataGateway } from "../core/data-gateway.js";

const root = document.querySelector("#adminApp");
const gateway = new NextDataGateway();
const WIDTH = 1080;
const HEIGHT = 1350;
const MAX_TASKS = 4;
const MAX_MEALS = 6;

let lastRenderSummary = null;

function snapshot() {
  return gateway.snapshot();
}

function data() {
  return snapshot().data || Object.create(null);
}

function profile() {
  return snapshot().profile || globalThis.PINCON_ACCOUNT?.profile || null;
}

function activeRows(name) {
  const rows = data()[name];
  return Array.isArray(rows)
    ? rows.filter((item) => item && item.deleted !== true && item.status !== "archived" && item.published !== false)
    : [];
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromValue(value) {
  if (!value) return "";
  if (Number.isFinite(Number(value)) && Number(value) > 10_000_000_000) return localDateKey(new Date(Number(value)));
  if (typeof value?.toMillis === "function") return localDateKey(new Date(value.toMillis()));
  const direct = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  if (direct) return direct[0];
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? localDateKey(new Date(parsed)) : "";
}

function itemDate(item = {}) {
  return dateFromValue(
    item.dueDate
    || item.date
    || item.startsOn
    || item.startDate
    || item.dueAt
    || item.dueAtMs
    || item.startsAtMs
  );
}

function itemTitle(item = {}, fallback = "일정") {
  return String(item.title || item.name || item.subject || item.body || fallback)
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function timeText(item = {}) {
  const direct = [item.dueTime, item.time, item.startTime].find((value) => /^\d{1,2}:\d{2}$/.test(String(value || "")));
  if (direct) return String(direct).padStart(5, "0");
  const timestamp = Number(item.dueAtMs || item.startsAtMs || 0);
  if (timestamp > 10_000_000_000) {
    return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(timestamp));
  }
  return "";
}

function dateDistanceLabel(dateString, today = localDateKey()) {
  if (!dateString) return "";
  if (dateString === today) return "오늘";
  const base = new Date(`${today}T12:00:00`);
  const target = new Date(`${dateString}T12:00:00`);
  const days = Math.round((target - base) / 86_400_000);
  if (days === 1) return "내일";
  if (days > 1 && days <= 6) return `${days}일 뒤`;
  if (days < 0) return "";
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" }).format(target).replace(/\s/g, "");
}

function normalizeTask(item, kind) {
  const date = itemDate(item);
  const time = timeText(item);
  const label = [dateDistanceLabel(date), time].filter(Boolean).join(" ");
  return {
    title: itemTitle(item),
    date,
    time,
    label,
    kind,
    important: item.important === true || ["urgent", "important", "high"].includes(String(item.priority || "").toLowerCase()),
  };
}

function taskRows(today) {
  const horizon = new Date(`${today}T12:00:00`);
  horizon.setDate(horizon.getDate() + 6);
  const maxDate = localDateKey(horizon);

  const candidates = [
    ...activeRows("classAssignments").map((item) => normalizeTask(item, "assignment")),
    ...activeRows("events").map((item) => normalizeTask(item, "event")),
    ...activeRows("academicSchedules").map((item) => normalizeTask(item, "academic")),
  ].filter((item) => item.date && item.date >= today && item.date <= maxDate);

  const announcements = [
    ...activeRows("announcements"),
    ...activeRows("content").filter((item) => item.kind === "notice"),
  ]
    .filter((item) => item.important === true || ["urgent", "important", "high"].includes(String(item.priority || "").toLowerCase()))
    .map((item) => normalizeTask(item, "notice"));

  return [...candidates, ...announcements]
    .sort((a, b) => {
      if (a.important !== b.important) return a.important ? -1 : 1;
      const dateCompare = (a.date || "9999-99-99").localeCompare(b.date || "9999-99-99");
      if (dateCompare) return dateCompare;
      return (a.time || "99:99").localeCompare(b.time || "99:99");
    })
    .slice(0, MAX_TASKS);
}

function todayTimetable(today) {
  const document = activeRows("neisTimetables").find((item) => item.date === today) || null;
  const periods = Array.isArray(document?.periods) ? document.periods : [];
  return periods.map((item, index) => ({
    period: Number(item.period || index + 1),
    subject: String(item.subject || "수업").trim(),
    teacher: String(item.teacher || item.teacherName || "").trim(),
    room: String(item.room || item.classroom || "").trim(),
  })).slice(0, 8);
}

function decodeHtmlText(value) {
  const node = document.createElement("div");
  node.innerHTML = String(value || "").replace(/<br\s*\/?\s*>/gi, "\n");
  return (node.textContent || "").replace(/\u00a0/g, " ");
}

function mealRows(today) {
  const meal = activeRows("meals").find((item) => item.date === today) || null;
  if (!meal) return { items: [], rating: 0 };
  const raw = decodeHtmlText(meal.dishesHtml || meal.menu || meal.dishes || "");
  const items = raw
    .split(/\n|[·•]/)
    .map((value) => value.replace(/\([0-9.,\s]+\)/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, MAX_MEALS);
  const rating = Math.max(0, Math.min(5, Number(meal.rating || meal.score || 0) || 0));
  return { items, rating };
}

function palette() {
  return {
    background: "#F7F9F1",
    surface: "#FFFFFF",
    onSurface: "#191D16",
    onVariant: "#43483E",
    primary: "#49662E",
    primaryContainer: "#C9EFAA",
    secondaryContainer: "#DFE8D4",
    tertiaryContainer: "#D9E7FF",
    outline: "#C4C8BB",
  };
}

function roundedPath(ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function fillRound(ctx, x, y, width, height, radius, fill) {
  roundedPath(ctx, x, y, width, height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
}

function card(ctx, x, y, width, height, radius, fill) {
  ctx.save();
  ctx.shadowColor = "rgba(25,29,22,0.10)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 12;
  fillRound(ctx, x, y, width, height, radius, fill);
  ctx.restore();
}

function setFont(ctx, weight, size) {
  ctx.font = `${weight} ${size}px "Noto Sans KR", "Apple SD Gothic Neo", sans-serif`;
  ctx.textBaseline = "alphabetic";
}

function ellipsis(ctx, text, maxWidth) {
  const value = String(text || "");
  if (ctx.measureText(value).width <= maxWidth) return value;
  let output = value;
  while (output.length > 1 && ctx.measureText(`${output}…`).width > maxWidth) output = output.slice(0, -1);
  return `${output}…`;
}

function sectionLabel(ctx, x, y, text, fill, color) {
  setFont(ctx, 700, 24);
  const width = Math.ceil(ctx.measureText(text).width) + 42;
  fillRound(ctx, x, y - 31, width, 48, 24, fill);
  ctx.fillStyle = color;
  ctx.fillText(text, x + 21, y + 2);
}

function drawTaskCard(ctx, rows, colors) {
  const x = 64;
  const y = 232;
  const width = 952;
  const height = 292;
  card(ctx, x, y, width, height, 40, "#F1ECFF");
  sectionLabel(ctx, x + 32, y + 56, "해야 할 일", "#DDD4FF", "#4B3BA5");

  if (!rows.length) {
    setFont(ctx, 600, 28);
    ctx.fillStyle = colors.onVariant;
    ctx.fillText("등록된 가까운 일정이 없습니다.", x + 38, y + 150);
    setFont(ctx, 500, 21);
    ctx.fillText("PinCon의 수행·행사·학사일정에서 자동으로 가져옵니다.", x + 38, y + 192);
    return;
  }

  rows.forEach((row, index) => {
    const rowY = y + 104 + index * 46;
    fillRound(ctx, x + 32, rowY - 24, 12, 12, 6, row.important ? "#6F5CE7" : "#A99DE8");
    setFont(ctx, 650, 25);
    ctx.fillStyle = colors.onSurface;
    ctx.fillText(ellipsis(ctx, row.title, 690), x + 62, rowY - 10);
    if (row.label) {
      setFont(ctx, 700, 20);
      ctx.fillStyle = "#5B4BCB";
      const labelWidth = ctx.measureText(row.label).width + 28;
      fillRound(ctx, x + width - labelWidth - 32, rowY - 37, labelWidth, 36, 18, "#E2DBFF");
      ctx.fillText(row.label, x + width - labelWidth - 18, rowY - 12);
    }
  });
}

const PERIOD_COLORS = ["#F15B5B", "#F2913D", "#E6B735", "#4EAE62", "#4B83E8", "#795BD7", "#3EA8B7", "#D45F9B"];

function drawTimetableCard(ctx, periods, colors) {
  const x = 64;
  const y = 548;
  const width = 952;
  const height = 430;
  card(ctx, x, y, width, height, 40, colors.surface);
  sectionLabel(ctx, x + 32, y + 56, "오늘 시간표", colors.tertiaryContainer, "#24558A");

  const count = Math.max(1, periods.length);
  const rowHeight = Math.min(43, Math.floor(322 / count));
  if (!periods.length) {
    setFont(ctx, 600, 28);
    ctx.fillStyle = colors.onVariant;
    ctx.fillText("오늘 시간표가 아직 없습니다.", x + 38, y + 150);
    return;
  }

  periods.forEach((row, index) => {
    const rowY = y + 98 + index * rowHeight;
    const accent = PERIOD_COLORS[index % PERIOD_COLORS.length];
    fillRound(ctx, x + 32, rowY, 112, rowHeight - 7, 18, accent);
    setFont(ctx, 750, 22);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(`${row.period}교시`, x + 56, rowY + 27);

    setFont(ctx, 700, 27);
    ctx.fillStyle = colors.onSurface;
    ctx.fillText(ellipsis(ctx, row.subject, 360), x + 174, rowY + 28);

    const support = [row.room, row.teacher].filter(Boolean).join(" · ");
    if (support) {
      setFont(ctx, 500, 20);
      ctx.fillStyle = colors.onVariant;
      ctx.textAlign = "right";
      ctx.fillText(ellipsis(ctx, support, 300), x + width - 36, rowY + 26);
      ctx.textAlign = "left";
    }
  });

  const last = periods[periods.length - 1]?.period || periods.length;
  setFont(ctx, 700, 21);
  const text = `${last}교시 수업`;
  const pillWidth = ctx.measureText(text).width + 38;
  fillRound(ctx, x + width - pillWidth - 32, y + 34, pillWidth, 42, 21, colors.secondaryContainer);
  ctx.fillStyle = colors.primary;
  ctx.fillText(text, x + width - pillWidth - 13, y + 62);
}

function drawStars(ctx, x, y, rating, colors) {
  if (!rating) return;
  setFont(ctx, 700, 28);
  ctx.fillStyle = colors.primary;
  ctx.fillText(`${"★".repeat(Math.round(rating))}${"☆".repeat(5 - Math.round(rating))}`, x, y);
}

function drawMealCard(ctx, meal, colors) {
  const x = 64;
  const y = 1002;
  const width = 952;
  const height = 278;
  card(ctx, x, y, width, height, 40, "#E6F5DA");
  sectionLabel(ctx, x + 32, y + 56, "오늘 급식", colors.primaryContainer, colors.primary);
  drawStars(ctx, x + 725, y + 60, meal.rating, colors);

  if (!meal.items.length) {
    setFont(ctx, 600, 28);
    ctx.fillStyle = colors.onVariant;
    ctx.fillText("오늘 급식 정보가 없습니다.", x + 38, y + 150);
    return;
  }

  meal.items.forEach((item, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const itemX = x + 38 + column * 450;
    const itemY = y + 118 + row * 48;
    ctx.beginPath();
    ctx.arc(itemX + 7, itemY - 7, 5, 0, Math.PI * 2);
    ctx.fillStyle = colors.primary;
    ctx.fill();
    setFont(ctx, 600, 24);
    ctx.fillStyle = colors.onSurface;
    ctx.fillText(ellipsis(ctx, item, 385), itemX + 24, itemY);
  });
}

function drawDecorations(ctx, colors) {
  ctx.save();
  ctx.globalAlpha = 0.52;
  ctx.fillStyle = colors.primaryContainer;
  ctx.beginPath();
  ctx.arc(1002, 68, 118, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#DDD4FF";
  ctx.beginPath();
  ctx.arc(36, 1295, 135, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

async function renderDailyBrief(canvas) {
  if (!canvas) return null;
  if (document.fonts?.ready) await document.fonts.ready;

  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("이미지 캔버스를 만들 수 없습니다.");

  const colors = palette();
  const today = localDateKey();
  const tasks = taskRows(today);
  const periods = todayTimetable(today);
  const meal = mealRows(today);
  const classProfile = profile();

  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawDecorations(ctx, colors);

  setFont(ctx, 800, 56);
  ctx.fillStyle = colors.onSurface;
  ctx.fillText("오늘의 학급 브리프", 64, 118);

  setFont(ctx, 650, 24);
  ctx.fillStyle = colors.onVariant;
  const classText = classProfile ? `${classProfile.grade}학년 ${classProfile.classNumber}반 · PinCon` : "PinCon";
  ctx.fillText(classText, 68, 162);

  const date = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${today}T12:00:00`));
  setFont(ctx, 700, 22);
  const dateWidth = ctx.measureText(date).width + 42;
  fillRound(ctx, WIDTH - dateWidth - 64, 78, dateWidth, 48, 24, colors.secondaryContainer);
  ctx.fillStyle = colors.primary;
  ctx.fillText(date, WIDTH - dateWidth - 43, 110);

  drawTaskCard(ctx, tasks, colors);
  drawTimetableCard(ctx, periods, colors);
  drawMealCard(ctx, meal, colors);

  setFont(ctx, 550, 18);
  ctx.fillStyle = colors.onVariant;
  ctx.textAlign = "right";
  ctx.fillText("PinCon 데이터로 자동 구성 · AI 미사용", WIDTH - 66, 1321);
  ctx.textAlign = "left";

  lastRenderSummary = { today, taskCount: tasks.length, periodCount: periods.length, mealCount: meal.items.length };
  return lastRenderSummary;
}

function canvasMarkup() {
  return `<md-dialog id="dailyBriefImageDialog" class="daily-brief-dialog">
    <div slot="headline">오늘 공지 이미지</div>
    <div slot="content" class="daily-brief-dialog__content">
      <div class="daily-brief-canvas-wrap">
        <canvas id="dailyBriefCanvas" width="${WIDTH}" height="${HEIGHT}" aria-label="오늘 공지 이미지 미리보기"></canvas>
      </div>
      <div class="daily-brief-spec">
        <span><md-icon>aspect_ratio</md-icon>1080 × 1350 · JPG</span>
        <span><md-icon>database</md-icon>PinCon 데이터만 사용</span>
        <span><md-icon>auto_awesome</md-icon>생성형 AI 미사용</span>
      </div>
      <p id="dailyBriefStatus" class="managed-editor-status" role="status"></p>
    </div>
    <div slot="actions">
      <md-text-button id="dailyBriefRefresh"><md-icon slot="icon">refresh</md-icon>다시 구성</md-text-button>
      <md-text-button id="dailyBriefClose">닫기</md-text-button>
      <md-filled-button id="dailyBriefDownload"><md-icon slot="icon">download</md-icon>JPG 저장</md-filled-button>
    </div>
  </md-dialog>`;
}

function cardMarkup() {
  const today = localDateKey();
  const tasks = taskRows(today);
  const periods = todayTimetable(today);
  const meal = mealRows(today);
  return `<section class="admin-card admin-card--wide daily-brief-card" id="dailyBriefImageCard" aria-labelledby="daily-brief-title">
    <div class="daily-brief-card__copy">
      <span class="daily-brief-card__eyebrow">매일 공지</span>
      <h2 id="daily-brief-title">오늘 데이터를 한 장의 JPG로</h2>
      <p>공지·수행·시간표·급식을 정해진 PinCon Material You Expressive 템플릿에 자동 배치합니다. 생성형 AI는 사용하지 않습니다.</p>
      <div class="daily-brief-card__meta">
        <span>${tasks.length}개 할 일</span>
        <span>${periods.length}개 수업</span>
        <span>${meal.items.length}개 급식 항목</span>
      </div>
    </div>
    <md-filled-tonal-button id="dailyBriefOpen"><md-icon slot="icon">image</md-icon>이미지 만들기</md-filled-tonal-button>
    ${canvasMarkup()}
  </section>`;
}

function mount() {
  if (!root || !(snapshot().canManageContent || snapshot().canArchiveContent)) return;
  const overview = root.querySelector("#adminOverview");
  if (!overview) return;
  if (!root.querySelector("#dailyBriefImageCard")) overview.insertAdjacentHTML("beforeend", cardMarkup());

  const quickActions = root.querySelector(".admin-quick-actions");
  if (quickActions && !quickActions.querySelector("[data-daily-brief-open]")) {
    quickActions.insertAdjacentHTML("beforeend", `<button type="button" data-daily-brief-open><md-icon>image</md-icon><span><strong>오늘 공지 이미지</strong><small>1080×1350 JPG 자동 구성</small></span></button>`);
  }
}

function openDialog() {
  mount();
  const dialog = root?.querySelector("#dailyBriefImageDialog");
  const canvas = root?.querySelector("#dailyBriefCanvas");
  if (!dialog || !canvas) return;
  Promise.resolve(renderDailyBrief(canvas)).then((summary) => {
    const status = root.querySelector("#dailyBriefStatus");
    if (status && summary) status.textContent = `할 일 ${summary.taskCount}개 · 수업 ${summary.periodCount}개 · 급식 ${summary.mealCount}개를 반영했습니다.`;
  }).catch((error) => {
    const status = root.querySelector("#dailyBriefStatus");
    if (status) {
      status.dataset.kind = "error";
      status.textContent = error?.message || "이미지를 구성하지 못했습니다.";
    }
  });
  dialog.show?.();
}

function downloadCanvas() {
  const canvas = root?.querySelector("#dailyBriefCanvas");
  const status = root?.querySelector("#dailyBriefStatus");
  if (!canvas) return;
  canvas.toBlob((blob) => {
    if (!blob) {
      if (status) {
        status.dataset.kind = "error";
        status.textContent = "JPG 파일을 만들지 못했습니다.";
      }
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `PinCon-${lastRenderSummary?.today || localDateKey()}-daily-brief.jpg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    if (status) {
      status.dataset.kind = "success";
      status.textContent = "1080×1350 JPG를 저장했습니다.";
    }
  }, "image/jpeg", 0.94);
}

root?.addEventListener("click", (event) => {
  const path = event.composedPath?.() || [];
  const control = path.find((node) => node instanceof HTMLElement && (
    node.id === "dailyBriefOpen"
    || node.id === "dailyBriefRefresh"
    || node.id === "dailyBriefClose"
    || node.id === "dailyBriefDownload"
    || node.hasAttribute("data-daily-brief-open")
  ));
  if (!control) return;
  if (control.id === "dailyBriefOpen" || control.hasAttribute("data-daily-brief-open")) return openDialog();
  if (control.id === "dailyBriefClose") return root.querySelector("#dailyBriefImageDialog")?.close?.();
  if (control.id === "dailyBriefRefresh") return renderDailyBrief(root.querySelector("#dailyBriefCanvas"));
  if (control.id === "dailyBriefDownload") return downloadCanvas();
});

gateway.addEventListener("change", () => requestAnimationFrame(mount));
window.addEventListener("hashchange", () => requestAnimationFrame(mount));
requestAnimationFrame(() => requestAnimationFrame(mount));

export { renderDailyBrief, taskRows, todayTimetable, mealRows };
