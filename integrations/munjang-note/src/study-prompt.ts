import { z } from 'zod';
import { aiAnswerSchema, now, type Annotation, type Workspace } from './model';

const format = 'munjang-note.ai-answers';
const entrySchema = aiAnswerSchema.extend({ noteId: z.string().min(1).max(120).regex(/^[\w.-]+$/) });
const fileSchema = z.object({
  format: z.literal(format),
  version: z.literal(1),
  answers: z.array(entrySchema).min(1).max(20_000),
}).strict();
export const AI_FILE_MAX_BYTES = 8_000_000;
export type AIFileEntry = z.infer<typeof entrySchema>;

function question(note: Annotation) {
  return note.fields.comparison.trim() || note.fields.question.trim() || note.fields.confusion.trim();
}

function myRule(note: Annotation) {
  return note.fields.takeaway.trim() || note.fields.evidence.trim();
}

export function answerSourceKey(note: Annotation): string {
  const input = JSON.stringify([
    note.documentId, note.tags, question(note), note.fields.reason.trim(), myRule(note),
    note.anchors.map(({ attached, quote, before, after }) => [attached, quote, before, after]),
  ]);
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x85ebca6b);
  }
  return [a, b].map((value) => (value >>> 0).toString(16).padStart(8, '0')).join('');
}

export function currentAIAnswer(note: Annotation) {
  return note.aiAnswer && note.aiAnswer.sourceKey === answerSourceKey(note) ? note.aiAnswer : undefined;
}

export function buildConfusionPrompt(data: Workspace, notes: Annotation[]): string {
  const categories = new Map(data.categories.map((item) => [item.id, item]));
  const documents = new Map(data.documents.map((item) => [item.id, item.title]));
  const entries = notes.map((note) => {
    const types = note.tags.map((tag) => {
      const category = categories.get(tag.categoryId);
      return [category?.label, category?.details.find((item) => item.id === tag.detailId)?.label].filter(Boolean).join(' › ');
    }).filter(Boolean);
    return {
      noteId: note.id, sourceKey: answerSourceKey(note), passage: documents.get(note.documentId) ?? '', types,
      original: note.anchors.map((anchor) => shortExcerpt(anchor.quote.trim())),
      nearbyText: note.anchors.filter((anchor) => anchor.attached).map((anchor) =>
        (anchor.before + shortExcerpt(anchor.quote) + anchor.after).trim()),
      question: question(note), reason: note.fields.reason, myRule: myRule(note),
    };
  });
  const example = {
    format, version: 1,
    answers: [{ noteId: '입력에 있는 noteId', sourceKey: '입력에 있는 sourceKey', explanation: '핵심 설명', rule: '시험장에서 쓸 기준 한 줄', contextNeeded: '' }],
  };
  return [
    '고1 영어 내신에서 헷갈린 표현을 정리하고 있어. 아래 자료의 각 주석에 한국어로 답해 줘.',
    'question에 비교 표현이 있으면 차이를 설명하고, 질문이면 그 질문에 바로 답해 줘. 질문이 비어 있으면 원문에서 기억할 포인트를 짚어 줘.',
    'explanation은 3문장 이내, rule은 시험장에서 바로 쓸 기준 한 줄로 적어 줘. myRule에 오류가 있으면 설명에서 고쳐 줘.',
    '문맥이 부족하면 필요한 정보를 contextNeeded에 적고, 안전하게 판단할 수 없는 설명과 기준은 빈 문자열로 둬. 답할 수 있는 항목의 contextNeeded는 빈 문자열로 둬.',
    '',
    '파일 이름이 munjang-note-ai-answers.json인 UTF-8 JSON 파일을 첨부해 줘.',
    '답변 파일은 아래 구조 그대로 만들고, 모든 입력 항목의 noteId와 sourceKey를 글자 하나도 바꾸지 않고 복사해 줘. 정답은 answers 배열에 주석당 한 개만 넣어 줘.',
    '파일을 첨부할 수 있는 기능이 없으면 같은 내용의 유효한 JSON을 코드 블록 하나로 출력해 줘. JSON 안에는 안내 문장이나 마크다운을 넣지 마.',
    '',
    JSON.stringify(example, null, 2),
    '',
    '주석 입력 자료',
    JSON.stringify(entries, null, 2),
  ].join('\n');
}

function shortExcerpt(text: string) {
  return text.length <= 1800 ? text : text.slice(0, 900) + ' […] ' + text.slice(-900);
}

export function parseAIAnswers(text: string): AIFileEntry[] {
  let raw: unknown;
  try { raw = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new Error('JSON 파일을 읽을 수 없어요. AI가 첨부한 .json 파일을 선택해 주세요.'); }
  const result = fileSchema.safeParse(raw);
  if (!result.success) throw new Error('AI 답변 파일 형식이 달라요. 모아보기에서 프롬프트를 새로 복사해 다시 요청해 주세요.');
  const ids = new Set<string>();
  for (const row of result.data.answers) {
    if (ids.has(row.noteId)) throw new Error('같은 주석에 대한 답변이 파일에 두 번 들어 있어요.');
    if (!row.explanation && !row.rule && !row.contextNeeded) throw new Error('설명, 구분법, 필요한 문맥이 모두 비어 있는 답변이 있어요.');
    ids.add(row.noteId);
  }
  return result.data.answers;
}

export function applyAIAnswers(workspace: Workspace, answers: AIFileEntry[]) {
  const pending = new Map(answers.map(({ noteId, ...answer }) => [noteId, answer]));
  let applied = 0;
  const stamp = now();
  const annotations = workspace.annotations.map((note) => {
    const answer = pending.get(note.id);
    if (!answer || answer.sourceKey !== answerSourceKey(note)) return note;
    applied += 1;
    return { ...note, aiAnswer: answer, updatedAt: stamp };
  });
  return { workspace: applied ? { ...workspace, annotations } : workspace, applied, skipped: answers.length - applied };
}

export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* Show manual copy if the browser declines. */ }
  }
  return false;
}
