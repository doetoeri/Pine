import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { sampleWorkspace } from '../src/examples';
import {
  applyReview, buildBackup, defaultExport, emptyFilter, groupByType, makeAnchor, matchingNotes, newNote,
  paragraphRanges, parseBackup, rebaseDocument, reviewHistory, reviewOrder, sentenceRanges,
} from '../src/model';
import { acceptsPenStroke, markedParts, sourceRangeBetween, textareaRange } from '../src/ranges';
import { generatePDF, quizItems } from '../src/pdf';

import { answerSourceKey, applyAIAnswers, buildConfusionPrompt, currentAIAnswer, parseAIAnswers } from '../src/study-prompt';

test('anchor ranges identify repeated expressions, overlaps, and paragraph-spanning selections', () => {
  const text = 'An early echo fades.\n\nLater we hear a soft echo from the valley.';
  const second = text.lastIndexOf('echo');
  const single = newNote('doc', makeAnchor(text, { start: second, end: second + 4 }), 'grammar');
  const overlap = newNote('doc', makeAnchor(text, { start: second - 5, end: second + 9 }), 'vocab');
  const multi = newNote('doc', makeAnchor(text, { start: 14, end: second + 1 }), 'flow');
  const parts = markedParts(text, [single, overlap, multi]);
  assert.equal(parts.map((part) => text.slice(part.start, part.end)).join(''), text);
  assert.equal(single.anchors[0].segmentId, 'p2-s1');
  assert.equal(parts.find((part) => part.start <= text.indexOf('echo') && part.end > text.indexOf('echo'))?.notes.length, 0);
  assert.equal(parts.find((part) => part.start === second)?.notes.length, 3);
  assert.equal(multi.anchors[0].quote.includes('\n\n'), true);
  const lines = 'Line one.\r\nLine two.\r\n\r\nLine three.';
  assert.equal(paragraphRanges(lines).length, 2);
  assert.equal(sentenceRanges(lines)[2].id, 'p2-s1');
  assert.equal(lines.slice(...Object.values(textareaRange(lines, 10, 19)) as [number, number]), 'Line two.');
});

test('source edits preserve an identifiable occurrence and detach a removed or ambiguous one', () => {
  const text = 'An early echo fades. Later we hear a soft echo from the valley.';
  const second = text.lastIndexOf('echo');
  const note = newNote('doc', makeAnchor(text, { start: second, end: second + 4 }), 'vocab');
  const prefix = 'An opening sentence. ';
  const moved = rebaseDocument([note], 'doc', text, prefix + text)[0].anchors[0];
  assert.equal(moved.start, second + prefix.length);
  assert.equal(moved.attached, true);
  assert.equal(rebaseDocument([note], 'doc', text, text.slice(0, second) + 'reflection' + text.slice(second + 4))[0].anchors[0].attached, false);

  const edge = 'The opening was clear. The ending surprised us.';
  const startNote = newNote('doc', makeAnchor(edge, { start: 0, end: 3 }), 'vocab');
  const startMoved = rebaseDocument([startNote], 'doc', edge, prefix + edge)[0].anchors[0];
  assert.equal(startMoved.attached, true);
  assert.equal(startMoved.start, prefix.length);

  const repeated = 'echo echo';
  const notes = [0, 5].map((start) => newNote('doc', makeAnchor(repeated, { start, end: start + 4 }), 'vocab'));
  assert.equal(rebaseDocument(notes, 'doc', repeated, 'echo').every((item) => !item.anchors[0].attached), true);
});

test('backup validates references and exact offsets before returning any data', () => {
  const data = sampleWorkspace();
  const raw = buildBackup(data);
  assert.deepEqual(parseBackup(raw), data);
  assert.throws(() => parseBackup('{'));
  const missing = JSON.parse(raw);
  missing.workspace.documents.pop();
  assert.throws(() => parseBackup(JSON.stringify(missing)), /원문/);
  const position = JSON.parse(raw);
  position.workspace.annotations[0].anchors[0].start += 1;
  position.workspace.annotations[0].anchors[0].end += 1;
  assert.throws(() => parseBackup(JSON.stringify(position)), /위치/);
  const version = JSON.parse(raw);
  version.version = 999;
  assert.throws(() => parseBackup(JSON.stringify(version)), /형식/);
});

test('cross-document grouping distinguishes causes and exam types and review depends on user grades', () => {
  let data = sampleWorkspace();
  const filter = { ...emptyFilter, categoryId: 'grammar', detailId: 'grammar-1', exam: '어법 선택' };
  const notes = matchingNotes(data.annotations, filter, data);
  assert.equal(new Set(notes.map((note) => note.documentId)).size, 2);
  assert.equal(groupByType(notes, data.categories, filter)[0].notes.length, 2);
  assert.equal(matchingNotes(data.annotations, { ...filter, state: 'reviewed' }, data).length, 0);
  data = applyReview(data, notes[0].id, 'uncertain');
  data = applyReview(data, notes[0].id, 'forgot');
  assert.equal(reviewOrder(data.annotations, reviewHistory(data.reviews))[0].id, notes[0].id);
  data = applyReview(data, notes[0].id, 'correct');
  assert.equal(matchingNotes(data.annotations, { ...filter, state: 'reviewed' }, data).length, 1);
  assert.equal(reviewHistory(data.reviews).get(notes[0].id)?.length, 3);
});

test('PDF produces paginated text and preserves quiz answers separately', async () => {
  const font = await readFile(new URL('../public/fonts/NotoSansKR-study.ttf', import.meta.url));
  const data = sampleWorkspace();
  const document = data.documents[0];
  data.annotations[0].fields.memo = '긴 설명에서 한영 글꼴과 줄바꿈을 점검합니다. Next line.\n'.repeat(180);
  const analysis = await generatePDF(data, [document], data.annotations.filter((item) => item.documentId === document.id), defaultExport, font);
  assert.ok(analysis.pages.length > 2);
  assert.equal((await PDFDocument.load(analysis.bytes)).getPageCount(), analysis.pages.length);
  assert.ok(analysis.pages.flatMap((page) => page.text).some((line) => line.text.includes('긴 설명')));
  assert.ok(analysis.pages.flatMap((page) => page.text).every((line) => line.x >= 0 && line.x + line.width <= analysis.width));
  const grammar = { ...emptyFilter, categoryId: 'grammar', detailId: 'grammar-1' };
  const type = await generatePDF(data, [], matchingNotes(data.annotations, grammar, data), { ...defaultExport, mode: 'types', color: false, orientation: 'landscape' }, font, grammar);
  assert.ok(type.width > type.height);
  const types = type.pages.flatMap((page) => page.text.map((line) => line.text)).join(' ');
  assert.match(types, /주어와 동사의 수일치/);
  assert.match(types, /The number of ideas/);
  assert.match(types, /a number of choices/);
  const quiz = await generatePDF(data, [], data.annotations, { ...defaultExport, mode: 'quiz', answerMode: 'separate' }, font);
  assert.ok(quiz.pages.length >= 2);
  assert.ok(quiz.pages[0].text.some((line) => line.text.includes('__________')));
  assert.ok(quiz.pages.slice(1).flatMap((page) => page.text).some((line) => line.text.includes('정답 및 해설')));
  const exact = quizItems(data, data.annotations).find((item) => item.answer === 'reveal');
  assert.ok(exact?.context?.includes('__________'));
  assert.ok(!exact?.context?.includes('reveal'));
});


test('pen drags ignore palm touches and retain the exact occurrence in either direction', () => {
  const source = 'The first sample.\n\nA second sample reveals a pattern.';
  const start = source.lastIndexOf('sample');
  const forward = sourceRangeBetween(source, start - 1, start + 7);
  const backward = sourceRangeBetween(source, start + 7, start - 1);
  assert.deepEqual(forward, { start, end: start + 6 });
  assert.deepEqual(backward, forward);
  assert.equal(sourceRangeBetween(source, 17, 19), null);
  assert.deepEqual(sourceRangeBetween(source, start, start), null);
  assert.equal(acceptsPenStroke('pen', 0), true);
  assert.equal(acceptsPenStroke('mouse', 0), true);
  assert.equal(acceptsPenStroke('touch', 0), false);
  assert.equal(acceptsPenStroke('mouse', 2), false);
});

test('AI prompt includes the chosen note and all three quick fields', () => {
  const data = sampleWorkspace();
  const note = data.annotations[0];
  note.fields.comparison = 'affect와 effect';
  note.fields.reason = '비슷한 철자';
  note.fields.takeaway = '문장에서 맡는 역할을 확인한다.';
  const actual = buildConfusionPrompt(data, [note]);
  assert.match(actual, /affect와 effect/);
  assert.match(actual, /비슷한 철자/);
  assert.match(actual, /문장에서 맡는 역할을 확인한다/);
  assert.match(actual, /munjang-note-ai-answers.json/);
  assert.match(actual, new RegExp(answerSourceKey(note)));
  assert.match(actual, new RegExp(note.anchors[0].quote));
  assert.equal(actual.includes(data.documents[0].text), false);
  assert.equal(actual.includes(data.annotations[1].anchors[0].quote), false);
});

test('versioned AI JSON attaches only to unchanged note IDs and survives a backup', () => {
  const data = sampleWorkspace();
  const [first, second, third] = data.annotations;
  const answer = { noteId: first.id, sourceKey: answerSourceKey(first), explanation: '원문을 확인하세요.', rule: '명사의 수를 살피세요.', contextNeeded: '' };
  const raw = {
    format: 'munjang-note.ai-answers', version: 1,
    answers: [answer, { ...answer, noteId: second.id }, { ...answer, noteId: 'missing' }],
  };
  assert.throws(() => parseAIAnswers(JSON.stringify({ ...raw, version: 2 })), /형식/);
  assert.throws(() => parseAIAnswers(JSON.stringify({ ...raw, answers: [answer, answer] })), /두 번/);
  assert.throws(() => parseAIAnswers(JSON.stringify({ ...raw, answers: [{ ...answer, explanation: ' ', rule: '' }] })), /비어/);
  const result = applyAIAnswers(data, parseAIAnswers('\uFEFF' + JSON.stringify(raw)));
  assert.equal(result.applied, 1);
  assert.equal(result.skipped, 2);
  const [updated, unchanged] = result.workspace.annotations;
  assert.equal(currentAIAnswer(updated)?.rule, answer.rule);
  assert.deepEqual(updated.fields, first.fields);
  assert.equal(updated.state, first.state);
  assert.equal(unchanged, second);
  assert.equal(currentAIAnswer({ ...updated, fields: { ...updated.fields, comparison: '이전과 다른 질문' } }), undefined);
  assert.equal(result.workspace.annotations[2], third);
  assert.deepEqual(parseBackup(buildBackup(result.workspace)), result.workspace);
  const { includeAI: _includeAI, ...oldExportSettings } = data.exportSettings;
  const old = { ...data, exportSettings: oldExportSettings };
  assert.deepEqual(parseBackup(buildBackup(old)), old);
});

test('AI explanations appear in selected PDFs and can be omitted independently', async () => {
  const font = await readFile(new URL('../public/fonts/NotoSansKR-study.ttf', import.meta.url));
  const data = sampleWorkspace();
  const first = data.annotations[0];
  const document = data.documents.find((item) => item.id === first.documentId)!;
  const { workspace } = applyAIAnswers(data, [{
    noteId: first.id, sourceKey: answerSourceKey(first),
    explanation: '주어의 핵심 명사를 확인해요.', rule: '동사는 핵심 명사와 일치해요.', contextNeeded: '',
  }]);
  const notes = [workspace.annotations[0]];
  for (const mode of ['passages', 'types'] as const) {
    const pdf = await generatePDF(workspace, [document], notes, { ...defaultExport, mode, explanations: false }, font);
    const rendered = pdf.pages.flatMap((page) => page.text.map((item) => item.text)).join(' ');
    assert.match(rendered, /AI 참고 해설/);
    assert.match(rendered, /주어의 핵심 명사를 확인해요/);
    assert.match(rendered, /동사는 핵심 명사와 일치해요/);
    assert.ok((await PDFDocument.load(pdf.bytes)).getPageCount());
  }
  const withoutAI = await generatePDF(workspace, [document], notes, { ...defaultExport, includeAI: false }, font);
  assert.doesNotMatch(withoutAI.pages.flatMap((page) => page.text.map((item) => item.text)).join(' '), /AI 참고 해설/);
});
