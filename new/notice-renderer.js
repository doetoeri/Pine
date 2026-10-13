import { subjectTheme } from "../next/assessments/coverflow.js?v=20261011-tilt1";
import { noticeDateLabel } from "./notice-data.js?v=20261013-notice1";

export const NOTICE_SIZE = Object.freeze({ width: 1080, height: 1440 });
const FONT = '"PinCon OpenAI Sans", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
const INK = "#273043", MUTED = "#58677d";
// Same stops as /new's six assessment covers.
const PAPERS = [
  ["#b2cafa", "#dbe6ff", "#f7f9ff", "#c1d2f4", "#839cca", "#c4d7f8"],
  ["#e9bacd", "#f4d7e4", "#fff6fa", "#e0c5d6", "#bba3c7", "#e5d6ea"],
  ["#99c8bf", "#d2e9e1", "#f6fcf9", "#bdd7ce", "#82aca3", "#cfe3da"],
  ["#d6ad7b", "#efdec4", "#fff9ef", "#ddc6a2", "#b69b72", "#eedab7"],
  ["#b8b1e5", "#e0dcf9", "#f9f7ff", "#cfcaed", "#9e94c4", "#ddd6f4"],
  ["#9fabbe", "#d9dfe8", "#fafcff", "#bac5d4", "#8794aa", "#d3dce8"],
];
function font(ctx, size, weight = 500) { ctx.font = `${weight} ${size}px ${FONT}`; ctx.textBaseline = "top"; }
function text(ctx, value, x, y, color = INK) { ctx.fillStyle = color; ctx.fillText(String(value), x, y); }

export function noticeWrap(ctx, value, width) {
  const lines = [];
  for (const paragraph of String(value || "").replace(/\r/g, "").split("\n")) {
    let line = "";
    for (const char of Array.from(paragraph)) {
      if (line && ctx.measureText(line + char).width > width) { lines.push(line.trimEnd()); line = ""; }
      line += char;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export function noticeLayout(ctx, model) {
  const pieces = [];
  for (const row of model.rows) {
    font(ctx, 38, 700);
    const title = noticeWrap(ctx, row.title, 864).map(value => ({ value, title: true }));
    font(ctx, 24);
    const materials = model.includeMaterials && row.materials ? noticeWrap(ctx, `준비물 · ${row.materials}`, 864).map(value => ({ value, title: false })) : [];
    let lines = [], lineHeight = 0, continuation = 0;
    for (const line of [...title, ...materials]) {
      const height = line.title ? 50 : 34;
      if (lineHeight + height > 700) {
        pieces.push({ row, lines, height: 152 + lineHeight, continuation: continuation++ });
        lines = []; lineHeight = 0;
      }
      lines.push(line); lineHeight += height;
    }
    pieces.push({ row, lines, height: Math.max(226, 152 + lineHeight), continuation });
  }
  const pages = [{ pieces: [], y: 328 }];
  for (const piece of pieces) {
    let page = pages.at(-1);
    if (page.y + piece.height > 1290 && page.pieces.length) { page = { pieces: [], y: 328 }; pages.push(page); }
    page.pieces.push({ ...piece, y: page.y }); page.y += piece.height + 18;
  }
  return pages;
}

export function drawNotice(ctx, model, page, index, total) {
  const { width: w, height: h } = NOTICE_SIZE;
  ctx.clearRect(0, 0, w, h);
  const bg = ctx.createRadialGradient(540, 510, 60, 540, 510, 1150);
  bg.addColorStop(0, "#ffffff"); bg.addColorStop(.48, "#f8f9fc"); bg.addColorStop(1, "#edf0f5");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  font(ctx, 32, 600); text(ctx, "PinCon", 64, 53);
  font(ctx, 24); ctx.textAlign = "right"; text(ctx, model.classLabel, 1016, 60, MUTED); ctx.textAlign = "left";
  font(ctx, 66, 700); text(ctx, "수행 공지", 60, 108);
  font(ctx, 27); text(ctx, `${model.day.slice(0, 4)}년 ${noticeDateLabel(model.day)} 밤 · 내일부터 ${model.horizon}일`, 64, 194, MUTED);
  font(ctx, 25);
  const noteLines = noticeWrap(ctx, model.message || `내일 ${model.rows.filter(row => row.group === "내일").length}개 · 선택한 수행 ${model.rows.length}개`, 952);
  // 80 characters at this size fit in three lines; whitespace is normalized.
  const note = noteLines.slice(0, 3);
  note.forEach((line, i) => text(ctx, line, 64, 239 + i * 27));
  for (const piece of page.pieces) {
    const { row, y, height } = piece, x = 64, width = 952;
    const gradient = ctx.createLinearGradient(x, y, x + width, y + height * 2.2);
    PAPERS[subjectTheme(row.subject)].forEach((color, i) => gradient.addColorStop([0, .27, .43, .60, .83, 1][i], color));
    ctx.save(); ctx.shadowColor = "#27395312"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
    ctx.fillStyle = gradient; ctx.fillRect(x, y, width, height); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip();
    const sheen = ctx.createLinearGradient(x, y, x + width, y);
    sheen.addColorStop(0, "#ffffff00"); sheen.addColorStop(.39, "#ffffff00"); sheen.addColorStop(.46, "#ffffff40"); sheen.addColorStop(.54, "#ffffff00"); sheen.addColorStop(1, "#ffffff00");
    ctx.fillStyle = sheen; ctx.fillRect(x, y, width, height);
    let subjectSize = 24;
    font(ctx, subjectSize, 600);
    while (ctx.measureText(row.subject).width > 640 && subjectSize > 12) font(ctx, --subjectSize, 600);
    text(ctx, row.subject, x + 32, y + 25);
    font(ctx, 23, 600); ctx.textAlign = "right"; text(ctx, `${row.group}${piece.continuation ? " · 계속" : ""}`, x + width - 32, y + 25); ctx.textAlign = "left";
    let lineY = y + 69;
    for (const line of piece.lines) {
      font(ctx, line.title ? 38 : 24, line.title ? 700 : 500);
      text(ctx, line.value, x + 32, lineY); lineY += line.title ? 50 : 34;
    }
    font(ctx, 25, 600); text(ctx, row.dateLabel, x + 32, y + height - 60);
    font(ctx, 23, 500); ctx.textAlign = "right"; text(ctx, `${row.dueLabel} · ${row.verified ? "공식 자료 확인" : "확인 중"}`, x + width - 32, y + height - 59); ctx.textAlign = "left";
    ctx.restore();
  }
  if (!page.pieces.length) {
    font(ctx, 44, 600); text(ctx, "선택한 수행이 없어요.", 64, 461);
    font(ctx, 27); text(ctx, "일정이 추가될 수 있으니 PinCon에서 확인해 주세요.", 64, 529, MUTED);
  }
  font(ctx, 22); text(ctx, "안내문·상세 내용은 pincon.app/new", 64, 1323, MUTED);
  font(ctx, 19);
  const time = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(model.generatedAtMs);
  text(ctx, `${model.cached ? "저장된 자료 기준 · 최신 일정 재확인" : "PinCon 등록 자료 기준"} · ${noticeDateLabel(new Date(model.generatedAtMs + 9 * 3600000).toISOString().slice(0, 10))} ${time} 생성`, 64, 1362, MUTED);
  ctx.textAlign = "right"; text(ctx, `${index + 1} / ${total}`, 1016, 1362, MUTED); ctx.textAlign = "left";
}
