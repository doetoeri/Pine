import { diffChars } from 'diff';
import { z } from 'zod';

export const MAX_TEXT = 200_000;
export const EXAM_TYPES = ['어법 선택', '어휘 선택', '빈칸', '주제·요지·제목', '내용 일치', '문장 순서', '문장 삽입', '지시어', '요약문', '서술형'] as const;
export const STATES = ['unlearned', 'assisted', 'independent', 'reviewed'] as const;
export const STATE_LABELS = {
  unlearned: '아직 이해하지 못함',
  assisted: '설명을 보면 이해함',
  independent: '혼자서 판별 가능',
  reviewed: '복습 완료',
} as const;
export const PRIORITIES = ['low', 'normal', 'high'] as const;
export const PRIORITY_LABELS = { low: '낮음', normal: '보통', high: '높음' };
export const MARKS = ['underline', 'double', 'dotted', 'wavy', 'highlight', 'combo', 'mark', 'number'] as const;
export const MARK_LABELS = {
  underline: '단일 밑줄', double: '이중 밑줄', dotted: '점선 밑줄', wavy: '물결 밑줄',
  highlight: '형광펜', combo: '밑줄 + 형광펜', mark: '작은 주석 표시', number: '번호형 주석',
};
export const GRADES = ['forgot', 'uncertain', 'correct'] as const;
export const GRADE_LABELS = { forgot: '기억나지 않음', uncertain: '헷갈림', correct: '정확히 기억함' };

const id = z.string().min(1).max(120).regex(/^[\w.-]+$/);
const label = z.string().trim().min(1).max(200);
const short = z.string().max(500);
const long = z.string().max(12_000);
const date = z.string().datetime();
const detailSchema = z.object({ id, label }).strict();
const categorySchema = z.object({
  id, label, color: z.string().regex(/^#[\da-f]{6}$/i), mark: z.enum(MARKS),
  details: z.array(detailSchema).max(300),
}).strict();
const scopeSchema = z.object({ id, title: label }).strict();
const passageSchema = z.object({
  id, title: label, text: z.string().min(1).max(MAX_TEXT).refine((value) => Boolean(value.trim())),
  source: short, subject: short, scopeId: id.or(z.literal('')), year: z.string().regex(/^(\d{4})?$/),
  month: z.number().int().min(1).max(12).nullable(), questionNumber: z.string().regex(/^\d{0,4}$/),
  unit: short, tags: z.array(label).max(50), createdAt: date, updatedAt: date,
}).strict();
const anchorSchema = z.object({
  start: z.number().int().min(0).max(MAX_TEXT),
  end: z.number().int().min(1).max(MAX_TEXT),
  quote: z.string().min(1).max(MAX_TEXT).refine((value) => Boolean(value.trim())),
  before: z.string().max(40), after: z.string().max(40), segmentId: id,
  attached: z.boolean(),
}).strict().refine((value) => value.end - value.start === value.quote.length, '잘못된 주석 범위');
const tagSchema = z.object({ categoryId: id, detailId: id.or(z.literal('')) }).strict();
const fieldsSchema = z.object({
  confusion: long, reason: long, explanation: long, evidence: long, comparison: long,
  takeaway: long, memo: long, distractor: long, writing: long, example: long,
  question: long, meaning: long, grammar: long, structure: long,
}).strict();
export const aiAnswerSchema = z.object({
  sourceKey: z.string().regex(/^[a-f0-9]{16}$/),
  explanation: z.string().trim().max(2400),
  rule: z.string().trim().max(420),
  contextNeeded: z.string().trim().max(480),
}).strict();

const annotationSchema = z.object({
  id, documentId: id, anchors: z.array(anchorSchema).min(1).max(12),
  tags: z.array(tagSchema).min(1).max(100), primaryCategoryId: id,
  extraTags: z.array(label).max(50), examTypes: z.array(z.enum(EXAM_TYPES)).max(EXAM_TYPES.length),
  priority: z.enum(PRIORITIES), state: z.enum(STATES), fields: fieldsSchema, createdAt: date, updatedAt: date,
  aiAnswer: aiAnswerSchema.optional(),
}).strict();
const recordSchema = z.object({
  id, annotationId: id, createdAt: date, grade: z.enum(GRADES), state: z.enum(STATES),
}).strict();
const displaySchema = z.object({
  font: z.enum(['serif', 'sans']), fontSize: z.number().int().min(16).max(32),
  sentenceNumbers: z.boolean(),
}).strict();
export const exportSchema = z.object({
  mode: z.enum(['passages', 'types', 'quiz']), orientation: z.enum(['portrait', 'landscape']),
  size: z.number().int().min(9).max(22), lineSpacing: z.number().min(1.2).max(2.4),
  paragraphSpacing: z.number().int().min(4).max(32), margin: z.number().int().min(12).max(32),
  color: z.boolean(), marks: z.enum(['full', 'underline']), explanations: z.boolean(),
  numbers: z.boolean(), pages: z.boolean(), titles: z.boolean(), sources: z.boolean(),
  memo: z.boolean(), includeAI: z.boolean().optional(), answerMode: z.enum(['none', 'inline', 'separate']), answerSpace: z.boolean(),
}).strict();
export const workspaceSchema = z.object({
  documents: z.array(passageSchema).max(3000), annotations: z.array(annotationSchema).max(20_000),
  categories: z.array(categorySchema).min(1).max(30), scopes: z.array(scopeSchema).max(250),
  reviews: z.array(recordSchema).max(100_000), display: displaySchema, exportSettings: exportSchema,
}).strict();
const backupSchema = z.object({
  app: z.literal('munjang-note'), version: z.literal(1), exportedAt: date, workspace: workspaceSchema,
}).strict();

export type Passage = z.infer<typeof passageSchema>;
export type Anchor = z.infer<typeof anchorSchema>;
export type Tag = z.infer<typeof tagSchema>;
export type Annotation = z.infer<typeof annotationSchema>;
export type AIAnswer = z.infer<typeof aiAnswerSchema>;
export type Fields = z.infer<typeof fieldsSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Scope = z.infer<typeof scopeSchema>;
export type ReviewRecord = z.infer<typeof recordSchema>;
export type DisplaySettings = z.infer<typeof displaySchema>;
export type ExportSettings = z.infer<typeof exportSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type Mark = typeof MARKS[number];
export type State = typeof STATES[number];
export type Grade = typeof GRADES[number];
export type ExamType = typeof EXAM_TYPES[number];
export type Priority = typeof PRIORITIES[number];
export type Range = { start: number; end: number };
export type Sentence = Range & { id: string; paragraph: number; number: number };

export const uid = () => crypto.randomUUID?.() ?? Array.from(
  crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0'),
).join('');
export const now = () => new Date().toISOString();
export const splitTags = (value: string) => [...new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean))];
export const defaultDisplay: DisplaySettings = { font: 'serif', fontSize: 25, sentenceNumbers: false };
export const defaultExport: ExportSettings = {
  mode: 'passages', orientation: 'portrait', size: 12, lineSpacing: 1.65, paragraphSpacing: 10, margin: 18,
  color: true, marks: 'full', explanations: true, numbers: true, pages: true, titles: true, sources: true,
  memo: false, includeAI: true, answerMode: 'separate', answerSpace: true,
};

function category(id: string, label: string, color: string, mark: Mark, details: string[]): Category {
  return { id, label, color, mark, details: details.map((label, index) => ({ id: id + '-' + (index + 1), label })) };
}

export const unclassifiedCategory = category('unclassified', '미분류', '#6f665d', 'highlight', []);

export const defaultCategories: Category[] = [
  category('vocab', '어휘', '#2566a0', 'highlight', [
    '단어의 뜻을 모름', '문맥상 의미', '다의어', '유의어 구별', '반의어 구별', '형태·철자가 비슷한 어휘',
    '품사 구별', '파생어·어형 변화', '숙어·관용 표현', '동사와 전치사의 결합', '콜로케이션', '문맥에 적절한 어휘 선택',
  ]),
  category('grammar', '문법·어법', '#af5424', 'underline', [
    '주어와 동사의 수일치', '시제', '능동태와 수동태', '관계대명사', '관계부사', '명사절', '부사절', '접속사',
    '전치사', '동명사', 'to부정사', '분사', '분사구문', '가정법', '비교 구문', '병렬 구조', '도치', '강조',
    '생략', '대명사', '형용사와 부사', '기타 문법',
  ]),
  category('structure', '문장 구조·해석', '#297553', 'double', [
    '주어와 동사 파악', '목적어 및 보어 파악', '수식 범위', '긴 문장 구조 분석', '절과 구의 구분', '삽입구',
    '생략된 표현', '중의적 해석', '직독직해', '해석상 주의할 표현',
  ]),
  category('logic', '내용·논리', '#704d9e', 'wavy', [
    '주제', '요지', '제목', '필자의 주장', '필자의 태도', '핵심 문장', '구체적 사례', '인과관계',
    '대조 관계', '문제와 해결', '추상적 표현', '지시 대상', '내용 일치 및 불일치', '문단 간 논리 관계',
  ]),
  category('flow', '문장 연결·배열', '#a44572', 'dotted', [
    '문장 순서', '문장 삽입', '연결어', '문장 간 인과관계', '지시어', '반복 표현', '문맥 단서', '문단 구조', '논리적 전개 순서',
  ]),
  category('writing', '표현·영작', '#177a7b', 'combo', [
    '한국어에서 영어로 영작', '어순', '서술형 핵심 표현', '동의 표현', '문장 구조 변환', '능동·수동 전환',
    '시제 변환', '문장 결합', '자연스러운 표현', '철자 실수',
  ]),
  unclassifiedCategory,
];

export function blankWorkspace(): Workspace {
  return {
    documents: [], annotations: [], categories: structuredClone(defaultCategories), scopes: [],
    reviews: [], display: { ...defaultDisplay }, exportSettings: { ...defaultExport },
  };
}

export function newPassage(scopeId = ''): Passage {
  const createdAt = now();
  return {
    id: uid(), title: '', text: '', source: '', subject: '공통영어2', scopeId, year: '',
    month: null, questionNumber: '', unit: '', tags: [], createdAt, updatedAt: createdAt,
  };
}

export const fields = (): Fields => ({
  confusion: '', reason: '', explanation: '', evidence: '', comparison: '', takeaway: '', memo: '',
  distractor: '', writing: '', example: '', question: '', meaning: '', grammar: '', structure: '',
});

export function newNote(documentId: string, anchor: Anchor, categoryId: string): Annotation {
  const createdAt = now();
  return {
    id: uid(), documentId, anchors: [anchor], tags: [{ categoryId, detailId: '' }], primaryCategoryId: categoryId,
    extraTags: [], examTypes: [], priority: 'normal', state: 'unlearned', fields: fields(), createdAt, updatedAt: createdAt,
  };
}

export function passageSource(document: Passage): string {
  return [
    document.source, document.year && document.year + '년', document.month && document.month + '월',
    document.questionNumber && document.questionNumber + '번', document.unit,
  ].filter(Boolean).join(' · ');
}

export function paragraphRanges(text: string): Range[] {
  const groups: Range[] = [];
  let start = 0;
  for (const match of text.matchAll(/(?:\r\n|(?<!\r)\n|\r(?!\n))[\t ]*(?:\r\n|(?<!\r)\n|\r(?!\n))(?:[\t ]*(?:\r\n|(?<!\r)\n|\r(?!\n)))*/g)) {
    const end = match.index + match[0].length;
    groups.push({ start, end });
    start = end;
  }
  if (start < text.length) groups.push({ start, end: text.length });
  return groups;
}

const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'sentence' }) : null;

export function sentenceRanges(text: string): Sentence[] {
  let number = 0;
  const result: Sentence[] = [];
  paragraphRanges(text).forEach(({ start, end }, paragraph) => {
    const part = text.slice(start, end);
    const sentences = segmenter?.segment(part) ?? [{ index: 0, segment: part }];
    let within = 0;
    for (const { index, segment } of sentences) {
      const stripped = segment.trim();
      if (!stripped) continue;
      const begin = start + index + segment.length - segment.trimStart().length;
      result.push({ start: begin, end: begin + stripped.length, id: 'p' + (paragraph + 1) + '-s' + (++within),
        paragraph: paragraph + 1, number: ++number });
    }
  });
  return result;
}

export function makeAnchor(text: string, range: Range, sentences = sentenceRanges(text)): Anchor {
  const { start, end } = range;
  const sentence = sentences.find((item) => start < item.end && end > item.start);
  return {
    start, end, quote: text.slice(start, end), before: text.slice(Math.max(0, start - 40), start),
    after: text.slice(end, end + 40), segmentId: sentence?.id ?? 'p1-s1', attached: true,
  };
}

export function locationLabel(anchor: Anchor): string {
  if (!anchor.attached) return '위치 확인 필요';
  const match = /^p(\d+)-s(\d+)$/.exec(anchor.segmentId);
  return match ? match[1] + '문단 ' + match[2] + '문장' : '원문 ' + (anchor.start + 1) + '자';
}

type EqualRun = { oldStart: number; oldEnd: number; newStart: number };
function equalRuns(oldText: string, newText: string): EqualRun[] {
  let oldStart = 0;
  let newStart = 0;
  const runs: EqualRun[] = [];
  const diff = diffChars(oldText, newText, { timeout: 180, maxEditLength: 9000 });
  for (const change of diff ?? []) {
    const length = change.value.length;
    if (!change.added && !change.removed) runs.push({ oldStart, oldEnd: oldStart + length, newStart });
    if (!change.added) oldStart += length;
    if (!change.removed) newStart += length;
  }
  return runs;
}

const reverse = (text: string) => Array.from(text).reverse().join('');
function mappedStart(runs: EqualRun[], start: number, end: number): number | undefined {
  const run = runs.find((item) => item.oldStart <= start && item.oldEnd >= end);
  return run && run.newStart + start - run.oldStart;
}

function isUniqueAt(text: string, part: string, start: number): boolean {
  return part.length > 0 && text.indexOf(part) === start && text.indexOf(part, start + 1) === -1;
}

function contextConfirms(oldText: string, newText: string, anchor: Anchor, mapped: number): boolean {
  if (isUniqueAt(oldText, anchor.quote, anchor.start) && isUniqueAt(newText, anchor.quote, mapped)) return true;
  for (const size of [8, 16, 28, 40]) {
    const prefix = oldText.slice(Math.max(0, anchor.start - size), anchor.start);
    const suffix = oldText.slice(anchor.end, anchor.end + size);
    const prefixMatches = prefix.length >= 4 &&
      isUniqueAt(oldText, prefix + anchor.quote, anchor.start - prefix.length) &&
      isUniqueAt(newText, prefix + anchor.quote, mapped - prefix.length);
    const suffixMatches = suffix.length >= 4 &&
      isUniqueAt(oldText, anchor.quote + suffix, anchor.start) &&
      isUniqueAt(newText, anchor.quote + suffix, mapped);
    const sameLeftEdge = anchor.start === 0 && mapped === 0;
    const sameRightEdge = anchor.end === oldText.length && mapped + anchor.quote.length === newText.length;
    if ((prefixMatches && (suffixMatches || sameRightEdge)) || (suffixMatches && sameLeftEdge)) return true;
    if (size >= 16 && ((anchor.start === 0 && suffixMatches && suffix.length >= 16) ||
        (anchor.end === oldText.length && prefixMatches && prefix.length >= 16))) return true;
  }
  return false;
}

export function rebaseDocument(notes: Annotation[], documentId: string, oldText: string, newText: string): Annotation[] {
  if (oldText === newText) return notes;
  const forward = equalRuns(oldText, newText);
  const backward = equalRuns(reverse(oldText), reverse(newText));
  const sentences = sentenceRanges(newText);
  return notes.map((note) => {
    if (note.documentId !== documentId) return note;
    const anchors = note.anchors.map((anchor) => {
      if (!anchor.attached) return anchor;
      const start = mappedStart(forward, anchor.start, anchor.end);
      const fromEnd = mappedStart(backward, oldText.length - anchor.end, oldText.length - anchor.start);
      if (start === undefined || fromEnd === undefined || newText.length - fromEnd - anchor.quote.length !== start ||
          newText.slice(start, start + anchor.quote.length) !== anchor.quote ||
          !contextConfirms(oldText, newText, anchor, start)) return { ...anchor, attached: false };
      return makeAnchor(newText, { start, end: start + anchor.quote.length }, sentences);
    });
    return { ...note, anchors };
  });
}

export type Filter = { documentId: string; categoryId: string; detailId: string; state: string; priority: string; exam: string; query: string };
export const emptyFilter: Filter = { documentId: '', categoryId: '', detailId: '', state: '', priority: '', exam: '', query: '' };

export function matchingNotes(notes: Annotation[], filter: Filter, data: Workspace): Annotation[] {
  const query = filter.query.trim().toLocaleLowerCase('ko');
  const docs = new Map(data.documents.map((document) => [document.id, document]));
  const categories = new Map(data.categories.map((category) => [category.id, category]));
  return notes.filter((note) => {
    if (filter.documentId && filter.documentId !== note.documentId) return false;
    if ((filter.categoryId || filter.detailId) && !note.tags.some((tag) =>
      (!filter.categoryId || filter.categoryId === tag.categoryId) && (!filter.detailId || filter.detailId === tag.detailId))) return false;
    if (filter.state && note.state !== filter.state) return false;
    if (filter.priority && note.priority !== filter.priority) return false;
    if (filter.exam && !note.examTypes.some((exam) => exam === filter.exam)) return false;
    if (!query) return true;
    const document = docs.get(note.documentId);
    const labels = note.tags.flatMap((tag) => {
      const category = categories.get(tag.categoryId);
      return [category?.label, category?.details.find((detail) => detail.id === tag.detailId)?.label];
    });
    return [
      ...note.anchors.map((anchor) => anchor.quote), ...Object.values(note.fields), ...note.extraTags, ...labels, ...note.examTypes,
      document?.title, document && passageSource(document),
    ].some((value) => value?.toLocaleLowerCase('ko').includes(query));
  });
}

export type CategoryGroup = { key: string; label: string; parent?: string; category?: Category; notes: Annotation[] };
export function groupByType(notes: Annotation[], categories: Category[], filter = emptyFilter): CategoryGroup[] {
  const groups: CategoryGroup[] = [];
  for (const category of categories) {
    if (filter.categoryId && filter.categoryId !== category.id) continue;
    const withCategory = notes.filter((note) => note.tags.some((tag) => tag.categoryId === category.id));
    for (const detail of [...category.details, { id: '', label: '세부 유형 미지정' }]) {
      if (filter.detailId && filter.detailId !== detail.id) continue;
      const withDetail = withCategory.filter((note) => note.tags.some((tag) => tag.categoryId === category.id && tag.detailId === detail.id));
      if (withDetail.length) groups.push({ key: category.id + ':' + detail.id, label: detail.label, parent: category.label, category, notes: withDetail });
    }
  }
  return groups;
}

export const FIELD_LABELS: Record<keyof Fields, string> = {
  confusion: '무엇이 헷갈리나요?', reason: '헷갈리는 이유', explanation: '정확한 설명', evidence: '정답 판별 근거',
  comparison: '내 질문', takeaway: '구분하는 방법', memo: '개인 메모', distractor: '자주 틀리는 선택지',
  writing: '서술형 주의사항', example: '관련 문제·추가 예문', question: '내 복습 질문',
  meaning: '뜻·품사·문맥상 의미', grammar: '문법 개념·규칙', structure: '구조·해석',
};

export function learningAnswer(note: Annotation): Array<[string, string]> {
  const keys: Array<keyof Fields> = ['meaning', 'grammar', 'structure', 'explanation', 'evidence', 'comparison', 'takeaway'];
  return keys.flatMap((key) => note.fields[key].trim() ? [[FIELD_LABELS[key], note.fields[key]] as [string, string]] : []);
}

export function reviewHistory(reviews: ReviewRecord[]): Map<string, ReviewRecord[]> {
  const groups = new Map<string, ReviewRecord[]>();
  for (const record of reviews) {
    const group = groups.get(record.annotationId) ?? [];
    if (!groups.has(record.annotationId)) groups.set(record.annotationId, group);
    group.push(record);
  }
  for (const group of groups.values()) group.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return groups;
}

export function reviewOrder(notes: Annotation[], history: Map<string, ReviewRecord[]>): Annotation[] {
  const wrong = (id: string) => (history.get(id) ?? []).filter((record) => record.grade !== 'correct').length;
  const rank = new Map(notes.map((note) => [note.id, wrong(note.id)]));
  const recent = (id: string) => history.get(id)?.[0]?.createdAt ?? '';
  return [...notes].sort((a, b) => (rank.get(b.id) ?? 0) - (rank.get(a.id) ?? 0)
    || recent(a.id).localeCompare(recent(b.id)) || PRIORITIES.indexOf(b.priority) - PRIORITIES.indexOf(a.priority));
}

export function buildBackup(workspace: Workspace): string {
  return JSON.stringify({ app: 'munjang-note', version: 1, exportedAt: now(), workspace }, null, 2);
}

function requireUnique<T>(items: T[], key: (item: T) => string): void {
  if (new Set(items.map(key)).size !== items.length) throw new Error('백업에 중복된 항목이 있어요.');
}

export function parseBackup(json: string): Workspace {
  if (json.length > 30_000_000) throw new Error('읽을 수 있는 백업 크기를 초과했어요.');
  let input: unknown;
  try { input = JSON.parse(json); } catch { throw new Error('JSON 파일을 읽을 수 없어요.'); }
  const parsed = backupSchema.safeParse(input);
  if (!parsed.success) {
    const path = parsed.error.issues[0].path.join('.');
    throw new Error('문장노트 백업 형식과 맞지 않아요.' + (path ? ' (' + path + ')' : ''));
  }
  const data = parsed.data.workspace;
  for (const list of [data.documents, data.annotations, data.categories, data.scopes, data.reviews]) requireUnique<{ id: string }>(list, (item) => item.id);
  const documents = new Map(data.documents.map((item) => [item.id, item]));
  const categoryTags = new Map(data.categories.map((item) => [item.id, new Set(item.details.map((detail) => detail.id))]));
  const sentenceCache = new Map<string, Sentence[]>();
  const noteIds = new Set(data.annotations.map((item) => item.id));
  const scopeIds = new Set(data.scopes.map((item) => item.id));
  for (const category of data.categories) requireUnique(category.details, (detail) => detail.id);
  for (const document of data.documents) {
    if (document.scopeId && !scopeIds.has(document.scopeId)) throw new Error('일부 지문의 시험 범위를 찾을 수 없어요.');
  }
  for (const note of data.annotations) {
    const document = documents.get(note.documentId);
    if (!document) throw new Error('원문을 찾을 수 없는 주석이 있어요.');
    const text = document.text;
    requireUnique(note.tags, (tag) => tag.categoryId + ':' + tag.detailId);
    if (!note.tags.some((tag) => tag.categoryId === note.primaryCategoryId)) throw new Error('대표 유형이 올바르지 않은 주석이 있어요.');
    for (const tag of note.tags) {
      const details = categoryTags.get(tag.categoryId);
      if (!details || (tag.detailId && !details.has(tag.detailId))) throw new Error('존재하지 않는 유형이 연결된 주석이 있어요.');
    }
    note.anchors = note.anchors.map((anchor) => {
      if (!anchor.attached) return anchor;
      if (anchor.end > text.length || text.slice(anchor.start, anchor.end) !== anchor.quote ||
          text.slice(Math.max(0, anchor.start - 40), anchor.start) !== anchor.before ||
          text.slice(anchor.end, anchor.end + 40) !== anchor.after) {
        throw new Error('원문과 선택 위치가 일치하지 않는 주석이 있어요.');
      }
      let sentences = sentenceCache.get(document.id);
      if (!sentences) {
        sentences = sentenceRanges(text);
        sentenceCache.set(document.id, sentences);
      }
      return makeAnchor(text, anchor, sentences);
    });
  }
  if (data.reviews.some((record) => !noteIds.has(record.annotationId))) throw new Error('연결된 주석이 없는 복습 기록이 있어요.');
  return data;
}

export function applyReview(data: Workspace, id: string, grade: Grade): Workspace {
  const note = data.annotations.find((item) => item.id === id);
  if (!note) return data;
  const state = grade === 'correct' ? 'reviewed' :
    grade === 'forgot' ? 'unlearned' : note.state === 'unlearned' ? 'unlearned' : 'assisted';
  const createdAt = now();
  return {
    ...data,
    annotations: data.annotations.map((item) => item.id === id ? { ...item, state, updatedAt: createdAt } : item),
    reviews: [...data.reviews, { id: uid(), annotationId: id, grade, state, createdAt }],
  };
}
