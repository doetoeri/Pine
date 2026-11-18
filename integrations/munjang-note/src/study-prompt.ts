import type { Annotation, Workspace } from './model';

const instructions = [
  '고1 영어 내신을 준비 중이야. 아래는 지문을 읽다가 헷갈린 표현들이야.',
  '',
  '1. 항목마다 두 표현이 언제 쓰이는지 쉬운 말로 비교해 줘.',
  '2. 시험장에서 바로 쓸 수 있는 구분 기준을 한 줄로 써 줘. 내가 적은 방법이 있으면 정확한지 확인하고 필요하면 고쳐 줘.',
  '3. 문맥이 부족하면 어떤 정보가 필요한지 알려 줘. 비슷한 실수는 묶어 줘.',
];

export function buildConfusionPrompt(data: Workspace, notes: Annotation[]): string {
  const categories = new Map(data.categories.map((item) => [item.id, item]));
  const documents = new Map(data.documents.map((item) => [item.id, item]));
  const entries = notes.map((note, index) => {
    const document = documents.get(note.documentId);
    const types = note.tags.map((tag) => {
      const category = categories.get(tag.categoryId);
      return [category?.label, category?.details.find((item) => item.id === tag.detailId)?.label].filter(Boolean).join(' › ');
    });
    const fields = [
      ['헷갈리는 표현', note.fields.comparison],
      ['헷갈리는 이유', note.fields.reason || note.fields.confusion],
      ['내가 적은 구분 방법', note.fields.takeaway || note.fields.evidence],
    ].flatMap(([label, value]) => value.trim() ? [label + ' — ' + value.trim()] : []);
    return [
      String(index + 1) + '. ' + types.filter(Boolean).join(', '),
      ...note.anchors.map((anchor) => '원문 — ' + anchor.quote.trim()),
      ...fields,
      ...(document ? ['지문 — ' + document.title] : []),
    ].join('\n');
  });
  return [...instructions, ...entries.flatMap((entry) => ['', entry])].join('\n');
}

export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* Show manual copy if the browser declines. */ }
  }
  return false;
}
