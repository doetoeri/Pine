export const DAILY_BRIEF_SIZE = Object.freeze({ width: 1080, height: 1350 });

const C = Object.freeze({
  bg: "#F7F8F4",
  surface: "#FFFFFF",
  text: "#1B1C18",
  sub: "#5B6057",
  primary: "#46652E",
  primarySoft: "#DDF0C9",
  purple: "#EEE8FF",
  purpleStrong: "#6652C8",
  blue: "#E4EEFF",
  blueStrong: "#2B5F98",
  green: "#E8F5DC",
  amber: "#FFF1CA",
  amberStrong: "#765A00",
  outline: "#D8DDD3",
});

const PERIOD_COLORS = ["#E85D61", "#E88D3D", "#D7AD30", "#4BA562", "#4C7FE0", "#7659CF", "#3B9DA9", "#C95F91"];

function font(ctx, weight, size) {
  ctx.font = `${weight} ${size}px "Noto Sans KR", "Apple SD Gothic Neo", sans-serif`;
  ctx.textBaseline = "alphabetic";
}

function rounded(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function fillRound(ctx, x, y, w, h, r, fill) {
  rounded(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

function card(ctx, x, y, w, h, r, fill) {
  ctx.save();
  ctx.shadowColor = "rgba(29, 32, 25, .09)";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 11;
  fillRound(ctx, x, y, w, h, r, fill);
  ctx.restore();
}

function text(ctx, value, x, y, color = C.text) {
  ctx.fillStyle = color;
  ctx.fillText(String(value ?? ""), x, y);
}

function ellipsis(ctx, value, maxWidth) {
  const raw = String(value ?? "");
  if (ctx.measureText(raw).width <= maxWidth) return raw;
  let output = raw;
  while (output.length > 1 && ctx.measureText(`${output}…`).width > maxWidth) output = output.slice(0, -1);
  return `${output}…`;
}

function wrap(ctx, value, maxWidth, maxLines = 2) {
  const chunks = String(value || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const chunk of chunks) {
    const candidate = current ? `${current} ${chunk}` : chunk;
    if (!current || ctx.measureText(candidate).width <= maxWidth) current = candidate;
    else {
      lines.push(current);
      current = chunk;
    }
  }
  if (current) lines.push(current);
  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines && visible.length) visible[visible.length - 1] = ellipsis(ctx, visible.at(-1), maxWidth);
  return visible;
}

function chip(ctx, x, y, label, fill, color, opts = {}) {
  font(ctx, opts.weight || 700, opts.size || 20);
  const px = opts.paddingX || 17;
  const h = opts.height || 38;
  const width = Math.ceil(ctx.measureText(label).width) + px * 2;
  fillRound(ctx, x, y, width, h, h / 2, fill);
  text(ctx, label, x + px, y + h - 11, color);
  return width;
}

function sectionTitle(ctx, x, y, title, supporting = "") {
  font(ctx, 760, 25);
  text(ctx, title, x, y, C.text);
  if (supporting) {
    font(ctx, 560, 18);
    text(ctx, supporting, x, y + 28, C.sub);
  }
}

function drawBackground(ctx) {
  const gradient = ctx.createLinearGradient(0, 0, 1080, 1350);
  gradient.addColorStop(0, "#F8FAF5");
  gradient.addColorStop(.52, "#F5F7F3");
  gradient.addColorStop(1, "#F8F4FB");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1080, 1350);

  ctx.save();
  ctx.globalAlpha = .62;
  ctx.fillStyle = "#D8EFC2";
  ctx.beginPath();
  ctx.arc(1035, 48, 142, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#E6DEFF";
  ctx.beginPath();
  ctx.arc(22, 1324, 150, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHeader(ctx, data) {
  chip(ctx, 64, 58, "PINCON DAILY", C.primarySoft, C.primary, { size: 18, height: 36 });
  font(ctx, 820, 56);
  text(ctx, "오늘 필요한 것만, 한 장에.", 64, 144);
  font(ctx, 600, 23);
  text(ctx, data.classLabel, 68, 184, C.sub);

  font(ctx, 700, 21);
  const dateWidth = Math.ceil(ctx.measureText(data.displayDate).width) + 38;
  fillRound(ctx, 1080 - 64 - dateWidth, 77, dateWidth, 44, 22, "rgba(255,255,255,.86)");
  text(ctx, data.displayDate, 1080 - 64 - dateWidth + 19, 107, C.primary);
}

function taskIcon(kind) {
  if (kind === "assignment") return "✓";
  if (kind === "event") return "◆";
  if (kind === "academic") return "▣";
  return "●";
}

function drawPriorityCard(ctx, data) {
  const x = 64, y = 220, w = 952, h = 270;
  card(ctx, x, y, w, h, 42, C.purple);
  sectionTitle(ctx, x + 34, y + 51, "놓치면 안 되는 것", data.primary.length ? `${data.primary.length}개 우선 표시` : "가까운 일정 기준");
  chip(ctx, x + w - 128, y + 28, "NOW", "#DDD4FF", C.purpleStrong, { size: 17, height: 34 });

  if (!data.primary.length) {
    font(ctx, 650, 27);
    text(ctx, "지금 표시할 중요 일정이 없습니다.", x + 36, y + 150, C.sub);
    font(ctx, 520, 19);
    text(ctx, "수행·행사·학사일정과 중요 공지를 자동으로 모읍니다.", x + 36, y + 190, C.sub);
    return;
  }

  data.primary.slice(0, 4).forEach((item, index) => {
    const rowY = y + 105 + index * 41;
    fillRound(ctx, x + 34, rowY - 20, 34, 34, 17, item.important ? "#6C58D0" : "#B7AAEA");
    font(ctx, 760, 17);
    text(ctx, taskIcon(item.kind), x + 44, rowY + 3, "#FFFFFF");
    font(ctx, 660, 23);
    text(ctx, ellipsis(ctx, item.title, 600), x + 83, rowY + 4, C.text);
    if (item.dateLabel) {
      font(ctx, 720, 17);
      const bw = Math.ceil(ctx.measureText(item.dateLabel).width) + 26;
      fillRound(ctx, x + w - bw - 32, rowY - 22, bw, 34, 17, "rgba(255,255,255,.62)");
      text(ctx, item.dateLabel, x + w - bw - 19, rowY + 1, C.purpleStrong);
    }
  });
}

function drawTimetableCard(ctx, data) {
  const x = 64, y = 516, w = 952, h = 378;
  card(ctx, x, y, w, h, 42, C.surface);
  const summary = data.daySummary.periodCount
    ? `${data.daySummary.periodCount}교시${data.daySummary.finishTime ? ` · ${data.daySummary.finishTime} 종료` : ""}`
    : "시간표 없음";
  sectionTitle(ctx, x + 34, y + 51, "오늘 시간표", summary);
  if (data.daySummary.changedCount) chip(ctx, x + w - 126, y + 28, `변경 ${data.daySummary.changedCount}`, C.amber, C.amberStrong, { size: 16, height: 34 });

  const periods = data.timetable.periods;
  if (!periods.length) {
    font(ctx, 650, 27);
    text(ctx, "오늘 시간표가 아직 없습니다.", x + 36, y + 155, C.sub);
    return;
  }

  const rowH = Math.min(42, Math.floor(270 / periods.length));
  periods.forEach((row, index) => {
    const rowY = y + 92 + index * rowH;
    const accent = PERIOD_COLORS[index % PERIOD_COLORS.length];
    fillRound(ctx, x + 34, rowY, 100, rowH - 6, 16, accent);
    font(ctx, 760, 19);
    text(ctx, `${row.period}교시`, x + 55, rowY + 25, "#FFFFFF");
    font(ctx, 720, 25);
    text(ctx, ellipsis(ctx, row.subject, 360), x + 162, rowY + 27, C.text);
    const support = [row.room, row.teacher].filter(Boolean).join(" · ");
    if (support) {
      font(ctx, 520, 18);
      ctx.textAlign = "right";
      text(ctx, ellipsis(ctx, support, 285), x + w - 36, rowY + 25, C.sub);
      ctx.textAlign = "left";
    }
  });
}

function drawMealCard(ctx, data) {
  const x = 64, y = 920, w = 456, h = 328;
  card(ctx, x, y, w, h, 40, C.green);
  sectionTitle(ctx, x + 30, y + 48, "오늘 급식", data.meal.calories || "점심 메뉴");
  if (data.meal.rating) {
    font(ctx, 700, 19);
    text(ctx, `${"★".repeat(Math.round(data.meal.rating))}${"☆".repeat(5 - Math.round(data.meal.rating))}`, x + 30, y + 91, C.primary);
  }
  const start = data.meal.rating ? y + 126 : y + 102;
  if (!data.meal.items.length) {
    font(ctx, 620, 23);
    text(ctx, "급식 정보가 없습니다.", x + 30, start, C.sub);
    return;
  }
  data.meal.items.slice(0, 6).forEach((item, index) => {
    const rowY = start + index * 31;
    ctx.beginPath();
    ctx.arc(x + 35, rowY - 7, 4, 0, Math.PI * 2);
    ctx.fillStyle = C.primary;
    ctx.fill();
    font(ctx, 600, 20);
    text(ctx, ellipsis(ctx, item, 365), x + 49, rowY, C.text);
  });
}

function drawUsefulCard(ctx, data) {
  const x = 544, y = 920, w = 472, h = 328;
  card(ctx, x, y, w, h, 40, C.blue);
  sectionTitle(ctx, x + 30, y + 48, "다음까지 준비", data.checklist.length ? "준비물 · 체크" : "다가오는 일정");

  const checklist = data.checklist.slice(0, 3);
  const upcoming = data.upcoming.slice(0, checklist.length ? 2 : 4);
  let cursor = y + 102;

  checklist.forEach((item) => {
    fillRound(ctx, x + 30, cursor - 20, 26, 26, 8, "#BFD4F4");
    font(ctx, 760, 16);
    text(ctx, "✓", x + 36, cursor - 1, C.blueStrong);
    font(ctx, 610, 20);
    const lines = wrap(ctx, item, 350, 1);
    text(ctx, lines[0] || item, x + 69, cursor, C.text);
    cursor += 39;
  });

  if (checklist.length && upcoming.length) {
    ctx.strokeStyle = "rgba(43,95,152,.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 30, cursor - 13);
    ctx.lineTo(x + w - 30, cursor - 13);
    ctx.stroke();
    cursor += 12;
  }

  upcoming.forEach((item) => {
    font(ctx, 730, 17);
    text(ctx, item.dateLabel || item.kindLabel, x + 30, cursor, C.blueStrong);
    font(ctx, 600, 19);
    text(ctx, ellipsis(ctx, item.title, 330), x + 115, cursor, C.text);
    cursor += 34;
  });

  if (!checklist.length && !upcoming.length) {
    font(ctx, 620, 22);
    text(ctx, "추가로 챙길 항목이 없습니다.", x + 30, y + 130, C.sub);
  }

  if (data.tomorrow.length) {
    const preview = data.tomorrow.map((row) => `${row.period} ${row.subject}`).join(" · ");
    font(ctx, 650, 17);
    text(ctx, "내일 첫 수업", x + 30, y + h - 43, C.blueStrong);
    font(ctx, 560, 17);
    text(ctx, ellipsis(ctx, preview, 290), x + 133, y + h - 43, C.sub);
  }
}

function drawFooter(ctx, data) {
  font(ctx, 540, 17);
  text(ctx, "PinCon 데이터 기반 자동 편집 · 생성형 AI 미사용", 64, 1314, C.sub);
  ctx.textAlign = "right";
  text(ctx, data.timetable.source ? `시간표 ${data.timetable.source}` : "", 1016, 1314, C.sub);
  ctx.textAlign = "left";
}

export async function renderDailyBrief(canvas, data) {
  if (!canvas) throw new Error("공지 이미지 캔버스를 찾을 수 없습니다.");
  if (document.fonts?.ready) await document.fonts.ready;
  canvas.width = DAILY_BRIEF_SIZE.width;
  canvas.height = DAILY_BRIEF_SIZE.height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("브라우저가 이미지 렌더링을 지원하지 않습니다.");

  drawBackground(ctx);
  drawHeader(ctx, data);
  drawPriorityCard(ctx, data);
  drawTimetableCard(ctx, data);
  drawMealCard(ctx, data);
  drawUsefulCard(ctx, data);
  drawFooter(ctx, data);

  return {
    width: DAILY_BRIEF_SIZE.width,
    height: DAILY_BRIEF_SIZE.height,
    taskCount: data.primary.length,
    periodCount: data.timetable.periods.length,
    mealCount: data.meal.items.length,
    checklistCount: data.checklist.length,
    today: data.today,
  };
}
