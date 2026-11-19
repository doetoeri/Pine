import { PDFDocument, rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {
  emptyFilter, FIELD_LABELS, groupByType, learningAnswer, locationLabel, paragraphRanges, passageSource, sentenceRanges,
  type Annotation, type Category, type ExportSettings, type Fields, type Filter, type Mark, type Passage, type Workspace,
} from './model';
import { markedParts } from './ranges';
import { currentAIAnswer } from './study-prompt';

const A4 = [595.28, 841.89] as const;
const BLACK = '#25221f';
const MUTED = '#504a43';
const ACCENT = '#8b412a';
const GRAY = '#444444';
const MONO_TEXT = '#222222';
const mutedRule = '#bbb4aa';

type Run = { text: string; mark?: Mark; color?: string };
type Block = { runs: Run[]; kind: 'title' | 'heading' | 'subheading' | 'meta' | 'body' | 'space'; page?: boolean; keepNext?: boolean;
  lines?: number; gap?: number };
export type PreviewText = Run & { x: number; y: number; width: number; size: number; ink: string };
export type PreviewPage = { text: PreviewText[]; rules: Array<{ x: number; y: number; width: number }> };
export type GeneratedPDF = { bytes: Uint8Array<ArrayBuffer>; pages: PreviewPage[]; width: number; height: number };

const converted = (color: string) => rgb(parseInt(color.slice(1, 3), 16) / 255, parseInt(color.slice(3, 5), 16) / 255, parseInt(color.slice(5, 7), 16) / 255);
function block(kind: Block['kind'], text: string, options?: Omit<Partial<Block>, 'runs' | 'kind'>): Block {
  return { kind, runs: [{ text }], ...options };
}

function hexMix(color: string, base: string, weight: number) {
  const components = [1, 3, 5].map((index) => {
    const a = parseInt(color.slice(index, index + 2), 16);
    const b = parseInt(base.slice(index, index + 2), 16);
    return Math.round(a * weight + b * (1 - weight)).toString(16).padStart(2, '0');
  });
  return '#' + components.join('');
}

function annotationBlocks(note: Annotation, options: ExportSettings, withAll = true): Block[] {
  const entries = !options.explanations ? [] : withAll ? (Object.keys(FIELD_LABELS) as (keyof Fields)[])
    .flatMap((key) => note.fields[key].trim() ? [[FIELD_LABELS[key], note.fields[key]]] : []) : learningAnswer(note);
  const blocks = entries.map(([label, value]) => block('body', label + '  ' + value, { gap: 4 }));
  const ai = options.includeAI !== false && currentAIAnswer(note);
  if (ai) {
    blocks.push(block('meta', 'AI 참고 해설', { keepNext: true }));
    if (ai.explanation) blocks.push(block('body', ai.explanation, { gap: 4 }));
    if (ai.rule) blocks.push(block('body', '구분법  ' + ai.rule, { gap: 4 }));
    if (ai.contextNeeded) blocks.push(block('body', '필요한 문맥  ' + ai.contextNeeded, { gap: 4 }));
  }
  return blocks;
}

function originalBlocks(passage: Passage, notes: Annotation[], categories: Category[], options: ExportSettings): Block[] {
  const paragraphs = paragraphRanges(passage.text);
  const positions = new Map(notes.map((note, index) => [note.id, index + 1]));
  const paragraphEnds = paragraphs.map((item) => item.end);
  const parts = markedParts(passage.text, notes, paragraphEnds);
  const categoryMap = new Map(categories.map((item) => [item.id, item]));
  const blocks: Block[] = [];
  let index = 0;
  for (const paragraph of paragraphs) {
    const runs: Run[] = [];
    while (index < parts.length && parts[index].start < paragraph.end) {
      const part = parts[index++];
      const atEnd = part.end === paragraph.end;
      const whole = passage.text.slice(part.start, part.end);
      const text = atEnd ? whole.replace(/(?:[\t ]*\r?\n)+[\t ]*$/, '') : whole;
      const category = categoryMap.get(part.notes[0]?.primaryCategoryId);
      const mark = category ? options.marks === 'underline' ?
        (['double', 'dotted', 'wavy'].includes(category.mark) ? category.mark : 'underline') : category.mark : undefined;
      const color = category ? options.color ? category.color : GRAY : undefined;
      if (text) runs.push({ text, mark, color });
      const ending = part.notes.filter((note) => note.anchors.some((anchor) => anchor.attached && anchor.end === part.end));
      if (ending.length && options.numbers) runs.push({
        text: ' [' + ending.map((note) => positions.get(note.id)).join(', ') + ']', color, mark: undefined,
      });
      else if (ending.length && (mark === 'mark' || mark === 'number')) runs.push({ text: ' •', color });
    }
    if (runs.some((run) => run.text.trim())) blocks.push({ kind: 'body', runs });
  }
  return blocks;
}

function passageBlocks(data: Workspace, documents: Passage[], notes: Annotation[], options: ExportSettings) {
  const blocks: Block[] = [];
  for (const [index, passage] of documents.entries()) {
    const relevant = notes.filter((note) => note.documentId === passage.id)
      .sort((a, b) => a.anchors[0].start - b.anchors[0].start || a.id.localeCompare(b.id));
    const source = passageSource(passage);
    blocks.push(block('title', options.titles ? passage.title : '지문별 분석집', { page: index > 0, keepNext: true }));
    if (options.sources && source) blocks.push(block('meta', source, { keepNext: true }));
    blocks.push(...originalBlocks(passage, relevant, data.categories, options));
    const explained = relevant.map((note, index) => ({ note, index, body: annotationBlocks(note, options) }))
      .filter((item) => options.explanations || item.body.length);
    if (explained.length) {
      blocks.push(block('heading', '주석 해설', { keepNext: true }));
      for (const { index: position, note, body } of explained) {
        const name = data.categories.find((category) => category.id === note.primaryCategoryId)?.label;
        blocks.push(block('subheading', (options.numbers ? '[' + (position + 1) + '] ' : '') + note.anchors.map((anchor) => anchor.quote).join(' · '), { keepNext: true }));
        blocks.push(block('meta', [name, ...note.anchors.map(locationLabel)].filter(Boolean).join(' · '), { keepNext: true }));
        blocks.push(...body);
      }
    }
    if (options.memo) {
      blocks.push(block('heading', '학습 메모', { keepNext: true }));
      blocks.push({ kind: 'space', runs: [], lines: 4 });
    }
  }
  return blocks;
}

function typeBlocks(data: Workspace, notes: Annotation[], options: ExportSettings, filter: Filter) {
  const docs = new Map(data.documents.map((document) => [document.id, document]));
  const groups = groupByType(notes, data.categories, filter);
  const blocks = [block('title', '혼동 유형별 정리집', { keepNext: true })];
  for (const group of groups) {
    blocks.push(block('heading', [group.parent, group.label].filter(Boolean).join(' / '), { keepNext: true }));
    for (const [index, note] of group.notes.entries()) {
      const document = docs.get(note.documentId);
      const category = group.category;
      const meaningMark = category && options.marks === 'full' && category.mark !== 'mark' && category.mark !== 'number' ?
        category.mark : 'underline';
      blocks.push({
        kind: 'subheading', keepNext: true,
        runs: [
          { text: options.numbers ? '[' + (index + 1) + '] ' : '' },
          { text: note.anchors.map((anchor) => anchor.quote).join(' · '), mark: meaningMark, color: options.color ? category?.color : GRAY },
        ],
      });
      const position = note.anchors.map(locationLabel).join(' · ');
      blocks.push(block('meta', [options.titles ? document?.title : '', options.sources && document ? passageSource(document) : '', position].filter(Boolean).join(' · '), { keepNext: true }));
      blocks.push(...annotationBlocks(note, options));
      if (options.memo) blocks.push({ kind: 'space', runs: [], lines: 2 });
    }
  }
  return blocks;
}

type QuizItem = { note: Annotation; document: Passage; prompt: string; context?: string; answer?: string };
export function quizItems(data: Workspace, notes: Annotation[]): QuizItem[] {
  const docs = new Map(data.documents.map((document) => [document.id, document]));
  const sentenceCache = new Map<string, ReturnType<typeof sentenceRanges>>();
  return notes.flatMap((note) => {
    const document = docs.get(note.documentId);
    if (!document) return [];
    const prompt = note.fields.question.trim();
    if (prompt) return [{ document, note, prompt }];
    const anchor = note.anchors.find((item) => item.attached && item.quote.trim().length <= 140 && !/[\r\n]/.test(item.quote)
      && document.text.slice(item.start, item.end) === item.quote);
    if (anchor) {
      let sentences = sentenceCache.get(document.id);
      if (!sentences) {
        sentences = sentenceRanges(document.text);
        sentenceCache.set(document.id, sentences);
      }
      const answer = anchor.quote.trim();
      const start = anchor.start + anchor.quote.length - anchor.quote.trimStart().length;
      const end = start + answer.length;
      const sentence = sentences.find((item) => item.start <= start && item.end >= end);
      const left = sentence?.start ?? Math.max(0, start - 85);
      const right = sentence?.end ?? Math.min(document.text.length, end + 85);
      const prefix = document.text.slice(Math.max(left, start - 210), start);
      const suffix = document.text.slice(end, Math.min(right, end + 210));
      if ((prefix + suffix).trim()) return [{
        document, note, prompt: '원문과 같은 표현을 쓰세요.',
        context: prefix + '__________' + suffix, answer,
      }];
    }
    return learningAnswer(note).length ? [{ document, note, prompt: '다음 표현의 뜻, 해석 또는 판별 근거를 적으세요.',
      context: note.anchors.map((item) => item.quote).join(' · ') }] : [];
  });
}

function quizBlocks(data: Workspace, notes: Annotation[], options: ExportSettings) {
  const items = quizItems(data, notes);
  const blocks = [block('title', '빈칸·서술형 복습 시험지', { keepNext: true })];
  const answers: Block[] = [];
  for (const [index, item] of items.entries()) {
    const lead = (index + 1) + '. ';
    blocks.push(block('subheading', lead + item.prompt, { keepNext: true }));
    if (item.context) blocks.push(block('body', item.context));
    const source = [options.titles ? item.document.title : '', options.sources ? passageSource(item.document) : '', locationLabel(item.note.anchors[0])].filter(Boolean).join(' · ');
    if (options.sources) blocks.push(block('meta', source));
    if (options.answerSpace || options.memo) blocks.push({ kind: 'space', runs: [], lines: options.memo ? 4 : 2 });
    if (options.answerMode === 'none') continue;
    const answer = annotationBlocks(item.note, options, false);
    const leadAnswer = item.answer ?? (answer.length ? '아래 해설을 참고하세요.' : '저장된 정답이 없어요.');
    const row = [block('subheading', (options.answerMode === 'separate' ? lead : '') + '정답  ' + leadAnswer, { keepNext: answer.length > 0 }), ...answer];
    if (options.answerMode === 'inline') blocks.push(...row);
    else answers.push(...row);
  }
  if (answers.length) blocks.push(block('title', options.explanations || options.includeAI !== false ? '정답 및 해설' : '정답', { page: true, keepNext: true }), ...answers);
  return blocks;
}

function blockMetrics(kind: Block['kind'], options: ExportSettings) {
  switch (kind) {
    case 'title': return { size: Math.max(options.size + 9, 22), gap: options.paragraphSpacing + 5, ink: ACCENT, leading: 1.28 };
    case 'heading': return { size: options.size + 4, gap: 7, ink: ACCENT, leading: 1.40 };
    case 'subheading': return { size: options.size + 1, gap: 4, ink: BLACK, leading: Math.max(1.4, options.lineSpacing) };
    case 'meta': return { size: Math.max(options.size - 2, 9), gap: 6, ink: MUTED, leading: 1.5 };
    default: return { size: options.size, gap: options.paragraphSpacing, ink: BLACK, leading: options.lineSpacing };
  }
}

type Slice = Run & { width: number };
type Line = { slices: Slice[]; width: number };

function lineWrap(runs: Run[], size: number, limit: number, measure: (text: string, size: number) => number, glyphs: Set<number>): Line[] {
  const lines: Line[] = [];
  let line: Line = { slices: [], width: 0 };
  const nextLine = () => { lines.push(line); line = { width: 0, slices: [] }; };
  for (const run of runs) {
    const sanitized = Array.from(run.text, (char) =>
      char === '\t' ? '    ' : char === '\r' || char === '\n' || glyphs.has(char.codePointAt(0)!) ? char : '□',
    ).join('');
    const pieces = sanitized.matchAll(/\r\n|\n|\r|[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7ff]|[^\S\r\n]+|[^\s\u1100-\u11ff\u3000-\u9fff\uac00-\ud7ff]+/gu);
    const append = (text: string, width: number) => {
      const tail = line.slices.at(-1);
      if (tail && tail.mark === run.mark && tail.color === run.color) { tail.text += text; tail.width += width; }
      else line.slices.push({ ...run, text, width });
      line.width += width;
    };
    for (const [piece] of pieces) {
      if (/^[\r\n]/.test(piece)) { nextLine(); continue; }
      let width = piece.length > 160 ? limit + 1 : measure(piece, size);
      if (width <= limit) {
        if (line.width && line.width + width > limit) {
          nextLine();
          if (!piece.trim()) continue;
        }
        append(piece, width);
      } else {
        for (const char of piece) {
          width = measure(char, size);
          if (line.width && line.width + width > limit) nextLine();
          append(char, width);
        }
      }
    }
  }
  if (line.slices.length || !lines.length) nextLine();
  return lines;
}

function drawMark(page: PDFPage, text: PreviewText, monochrome: boolean) {
  const { x, y, size, width, mark } = text;
  if (!mark || !text.text.trim()) return;
  const color = monochrome ? GRAY : text.color ?? GRAY;
  if (mark === 'highlight' || mark === 'combo') page.drawRectangle({
    x, y: y - size * 0.18, width, height: size * 1.13, color: converted(hexMix(color, '#ffffff', monochrome ? 0.15 : 0.19)),
  });
  if (mark === 'highlight' || mark === 'mark' || mark === 'number') return;
  const ink = converted(monochrome ? GRAY : hexMix(color, '#211c17', 0.77));
  const baseline = y - size * 0.21;
  const line = (start: number, end: number, y1: number, y2: number) =>
    page.drawLine({ start: { x: x + start, y: y1 }, end: { x: x + end, y: y2 }, thickness: 0.67, color: ink });
  if (mark === 'dotted') {
    for (let at = 0; at < width; at += 2.6) line(at, Math.min(at + 1.1, width), baseline, baseline);
  } else if (mark === 'wavy') {
    for (let at = 0; at < width; at += 3.9) {
      line(at, Math.min(at + 1.95, width), baseline, baseline + 0.76);
      if (at + 1.95 < width) line(at + 1.95, Math.min(at + 3.9, width), baseline + 0.76, baseline);
    }
  } else {
    line(0, width, baseline, baseline);
    if (mark === 'double') line(0, width, baseline - 1.65, baseline - 1.65);
  }
}

let fontRequest: Promise<ArrayBuffer> | undefined;
async function loadFont() {
  if (!fontRequest) {
    const url = new URL(import.meta.env.BASE_URL + 'fonts/NotoSansKR-study.ttf', location.href);
    fontRequest = fetch(url).then((response) => {
      if (!response.ok) throw new Error('PDF용 한영 글꼴을 불러오지 못했어요. 연결을 확인해 주세요.');
      return response.arrayBuffer();
    }).catch((error) => { fontRequest = undefined; throw error; });
  }
  return fontRequest;
}

export async function generatePDF(data: Workspace, documents: Passage[], notes: Annotation[], options: ExportSettings,
  fontBytes?: ArrayBuffer | Uint8Array, filter = emptyFilter): Promise<GeneratedPDF> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  // Keep the prepared font's glyph IDs intact for readers that use the embedded outlines directly.
  const font = await pdf.embedFont(fontBytes ?? await loadFont(), { subset: false });
  pdf.setLanguage('ko-KR');
  pdf.setTitle(options.mode === 'types' ? '문장노트 · 혼동 유형별 정리집' : options.mode === 'quiz' ? '문장노트 · 복습 시험지' : '문장노트 · 지문별 분석집');
  pdf.setCreator('문장노트');
  const blocks = options.mode === 'passages' ? passageBlocks(data, documents, notes, options) :
    options.mode === 'types' ? typeBlocks(data, notes, options, filter) : quizBlocks(data, notes, options);
  const width = options.orientation === 'portrait' ? A4[0] : A4[1];
  const height = options.orientation === 'portrait' ? A4[1] : A4[0];
  const margin = options.margin * 72 / 25.4;
  const minY = margin + (options.pages ? 14 : 0);
  const available = width - margin * 2;
  const preview: PreviewPage[] = [];
  const pageArray: PDFPage[] = [];
  let cursor = height - margin;
  const addPage = () => {
    if (pageArray.length >= 450) throw new Error('한 파일에 넣을 수 있는 페이지가 450쪽을 초과했어요. 출력 범위를 나눠 주세요.');
    pageArray.push(pdf.addPage([width, height]));
    preview.push({ text: [], rules: [] });
    cursor = height - margin;
  };
  addPage();
  const glyphs = new Set(font.getCharacterSet());
  const cache = new Map<string, number>();
  const measure = (text: string, size: number) => {
    let unit = cache.get(text);
    if (unit === undefined) {
      unit = font.widthOfTextAtSize(text, 1);
      if (cache.size < 50_000) cache.set(text, unit);
    }
    return size * unit;
  };
  const emptyPage = () => cursor === height - margin;
  for (const [index, block] of blocks.entries()) {
    if (block.page && !emptyPage()) addPage();
    if (block.kind === 'space') {
      const lineHeight = options.size * 1.8;
      for (let length = 0; length < (block.lines ?? 2); length++) {
        if (cursor - lineHeight < minY) addPage();
        cursor -= lineHeight;
        pageArray.at(-1)!.drawLine({ start: { x: margin, y: cursor }, end: { x: width - margin, y: cursor },
          thickness: 0.62, color: converted(options.color ? mutedRule : '#b5b5b5') });
        preview.at(-1)!.rules.push({ x: margin, y: cursor, width: available });
      }
      cursor -= 6;
      continue;
    }
    const metrics = blockMetrics(block.kind, options);
    const lineHeight = metrics.size * metrics.leading;
    const lines = lineWrap(block.runs, metrics.size, available, measure, glyphs);
    const firstCount = Math.min(2, lines.length);
    const next = blocks[index + 1];
    const nextMetrics = next ? blockMetrics(next.kind, options) : null;
    const nextHeight = block.keepNext && nextMetrics ? (block.gap ?? metrics.gap) + nextMetrics.size * nextMetrics.leading : 0;
    if (!emptyPage() && cursor - lineHeight * firstCount - nextHeight < minY) addPage();
    for (const [lineIndex, line] of lines.entries()) {
      const canFit = Math.floor((cursor - minY) / lineHeight);
      if (canFit <= 0 || (canFit === 1 && lines.length - lineIndex === 2 && !emptyPage())) addPage();
      const y = cursor - metrics.size;
      let x = margin;
      for (const slice of line.slices) {
        const piece = { ...slice, x, y, size: metrics.size,
          ink: options.color ? metrics.ink : MONO_TEXT };
        drawMark(pageArray.at(-1)!, piece, !options.color);
        pageArray.at(-1)!.drawText(piece.text, { x, y, size: piece.size, font, color: converted(piece.ink) });
        preview.at(-1)!.text.push(piece);
        x += slice.width;
      }
      cursor -= lineHeight;
    }
    cursor -= block.gap ?? metrics.gap;
  }
  if (options.pages) for (const [index, page] of pageArray.entries()) {
    const text = (index + 1) + ' / ' + pageArray.length;
    const size = 8;
    const textWidth = measure(text, size);
    const x = width / 2 - textWidth / 2;
    const y = Math.max(15, margin / 2);
    page.drawText(text, { x, y, size, font, color: converted(options.color ? MUTED : GRAY) });
    preview[index].text.push({ text, x, y, size, width: textWidth, ink: options.color ? MUTED : GRAY });
  }
  const raw = await pdf.save();
  return { bytes: new Uint8Array(raw), pages: preview, width, height };
}
