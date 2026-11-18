import { blankWorkspace, makeAnchor, newNote, newPassage, type Annotation, type Passage, type Workspace } from './model';

const date = '2026-11-18T00:00:00.000Z';
export const examScope = { id: 'exam-2026-2', title: '2026학년도 2학기 2차 정기시험' };
const sampleScope = { id: 'samples', title: '연습용 지문' };

const passages: Passage[] = [
  {
    ...newPassage(sampleScope.id), id: 'example-experiments', title: 'The Value of Small Experiments',
    source: '연습용 지문', tags: ['어법', '빈칸'],
    text: 'When people face a difficult problem, they often try to find a perfect solution before taking action. But a small experiment can reveal information that even a detailed plan cannot provide. The number of ideas matters less than the quality of the evidence they produce.\n\nFor example, a team that wants to make a library easier to use might first move a single sign. If visitors find the entrance more quickly, the team has a reason to test a larger change. If nothing improves, the team can try a different placement at little cost.\n\nIn this way, small experiments make uncertainty manageable. Each result, whether expected or surprising, helps people decide what to do next.',
    createdAt: date, updatedAt: '2026-11-18T02:00:00.000Z',
  },
  {
    ...newPassage(sampleScope.id), id: 'example-quiet', title: 'Designing for Quiet',
    source: '연습용 지문', tags: ['문장 삽입'],
    text: 'A quiet room is not always a useful place to study. When everyone is silent, even a small sound can attract attention. In contrast, a steady background sound can make a brief interruption less noticeable.\n\nA school library can respond to these differences by offering several kinds of space. Some desks can be placed away from busy paths, while others can be reserved for students who prefer a gentle level of activity. The goal is to let students choose the conditions that help them concentrate.',
    createdAt: date, updatedAt: '2026-11-18T01:00:00.000Z',
  },
  {
    ...newPassage(sampleScope.id), id: 'example-charts', title: 'What a Chart Leaves Out',
    source: '연습용 지문', tags: ['내용 일치', '어법'],
    text: 'A chart can make a complicated set of numbers easier to understand. However, a number of choices shape what a chart appears to say. For instance, a change can look larger when the vertical axis starts above zero.\n\nThis does not mean that the chart is wrong. It means that readers should check the scale, the labels, and the source of the data before drawing a conclusion.',
    createdAt: date, updatedAt: date,
  },
];

function exampleNote(document: Passage, id: string, quote: string, categoryId: string, detailId: string, added: Partial<Annotation> = {}): Annotation {
  const start = document.text.indexOf(quote);
  const note = newNote(document.id, makeAnchor(document.text, { start, end: start + quote.length }), categoryId);
  return { ...note, id, tags: [{ categoryId, detailId }], createdAt: date, updatedAt: date, ...added,
    fields: { ...note.fields, ...added.fields } };
}

function sampleNotes(): Annotation[] {
  const [first, second, third] = passages;
  const word = exampleNote(first, 'example-reveal', 'reveal', 'vocab', 'vocab-2', { state: 'assisted', examTypes: ['어휘 선택'] });
  word.fields.meaning = '드러내다, 밝혀 주다 (동사). 여기서는 실험을 통해 몰랐던 정보를 알아낸다는 뜻이에요.';
  word.fields.comparison = 'discover는 새로 발견하는 주체에, reveal은 정보가 드러나게 하는 데 초점을 둬요.';
  const grammar = exampleNote(first, 'example-number', 'The number of ideas', 'grammar', 'grammar-1', { priority: 'high', examTypes: ['어법 선택', '서술형'] });
  grammar.fields.grammar = 'the number of + 복수명사는 단수 동사와 함께 써요. a number of + 복수명사는 복수 동사와 함께 써요.';
  grammar.fields.evidence = '주어의 중심은 ideas가 아니라 number이므로 단수 동사 matters를 사용했어요.';
  grammar.fields.question = 'The number of와 A number of는 각각 어떤 수의 동사와 함께 쓰나요? 근거도 말해 보세요.';
  const structure = exampleNote(first, 'example-relative', 'that even a detailed plan cannot provide', 'structure', 'structure-3', {
    tags: [{ categoryId: 'structure', detailId: 'structure-3' }, { categoryId: 'grammar', detailId: 'grammar-4' }],
    state: 'assisted', examTypes: ['어법 선택', '서술형'],
  });
  structure.fields.structure = 'that절은 앞의 information을 수식해요. provide의 목적어 자리가 비어 있어요.';
  const flow = exampleNote(second, 'example-in-contrast', 'In contrast', 'flow', 'flow-3', { examTypes: ['문장 삽입'] });
  flow.fields.explanation = '앞 문장의 갑작스러운 작은 소리와 뒤의 일정한 배경 소리를 대조해요.';
  const other = exampleNote(third, 'example-a-number', 'a number of choices', 'grammar', 'grammar-1', { priority: 'high', examTypes: ['어법 선택'] });
  other.fields.evidence = 'a number of는 여러 개라는 뜻이며 복수 주어 choices와 복수 동사 shape가 쓰였어요.';
  other.fields.comparison = 'the number of choices는 선택지의 수라는 뜻이며 단수로 취급해요.';
  return [word, grammar, structure, flow, other];
}

export function sampleWorkspace(): Workspace {
  return {
    ...blankWorkspace(), documents: passages, annotations: sampleNotes(), scopes: [examScope, sampleScope],
  };
}
