import { useState, type FormEvent } from 'react';
import { AlertCircle, Check, Link2, Plus, Trash2, X } from 'lucide-react';
import {
  defaultCategories, EXAM_TYPES, FIELD_LABELS, GRADE_LABELS, PRIORITIES, PRIORITY_LABELS, STATES, STATE_LABELS, locationLabel,
  splitTags, type Anchor, type Annotation, type Category, type Fields, type ReviewRecord, type Sentence, type Tag,
} from './model';
import { Button, CategoryChip, Field, colorStyle, formatDate, StatePill } from './ui';

const quickFields = [
  { key: 'comparison', label: '무엇과 헷갈리나요?', placeholder: '예. affect와 effect' },
  { key: 'reason', label: '왜 헷갈리나요?', placeholder: '예. 뜻과 철자가 비슷해요' },
  { key: 'takeaway', label: '어떻게 구분할까요?', placeholder: '예. 문장에서 먼저 확인할 단서' },
] as const;

const advancedFields: Array<keyof Fields> = [
  'confusion', 'meaning', 'grammar', 'structure', 'explanation', 'evidence', 'memo', 'distractor', 'writing', 'example', 'question',
];
const compactLabels: Record<string, string> = {
  vocab: '어휘', grammar: '문법', structure: '문장 해석', logic: '내용', flow: '문장 연결', writing: '영작',
};
const sameTag = (a: Tag, b: Tag) => a.categoryId === b.categoryId && a.detailId === b.detailId;

function typeName(category: Category) {
  return defaultCategories.some((item) => item.id === category.id && item.label === category.label)
    ? compactLabels[category.id] ?? category.label : category.label;
}

export function NoteEditor({ draft, isNew, categories, sentences, source, records, update, save, remove, reselect, addSentence, formId }: {
  draft: Annotation; isNew: boolean; categories: Category[]; sentences: Sentence[]; source: string; records: ReviewRecord[];
  update: (draft: Annotation) => void; save: (draft: Annotation) => Promise<void>; remove: () => Promise<void>;
  reselect: (index: number) => void; addSentence: (sentence: Sentence) => void; formId: string;
}) {
  const [extra, setExtra] = useState(draft.extraTags.join(', '));
  const [categoryId, setCategoryId] = useState(draft.primaryCategoryId);
  const [detailId, setDetailId] = useState('');
  const [sentenceId, setSentenceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const tagCategory = categories.find((category) => category.id === categoryId) ?? categories[0];
  const tagIds = [...new Set(draft.tags.map((tag) => tag.categoryId))];
  const first = draft.tags[0];
  const firstCategory = categories.find((item) => item.id === first.categoryId);
  const selectedDetail = firstCategory?.details.find((item) => item.id === first.detailId);

  function changeTags(tags: Tag[]) {
    update({ ...draft, tags, primaryCategoryId: tags.some((tag) => tag.categoryId === draft.primaryCategoryId) ? draft.primaryCategoryId : tags[0].categoryId });
  }

  function chooseCategory(id: string) {
    if (id === first.categoryId) return;
    const other = draft.tags.slice(1);
    const head = other.find((tag) => tag.categoryId === id) ?? { categoryId: id, detailId: '' };
    update({ ...draft, primaryCategoryId: id, tags: [head, ...other.filter((tag) => !sameTag(tag, head))] });
    setCategoryId(id);
    setDetailId('');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const extraTags = splitTags(extra);
    if (extraTags.length > 50 || extraTags.some((tag) => tag.length > 200)) { setError('추가 태그를 50개 이하로 줄여 주세요.'); return; }
    setBusy(true);
    setError('');
    try { await save({ ...draft, extraTags }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '주석을 저장할 수 없어요.'); }
    finally { setBusy(false); }
  }

  const textField = (key: keyof Fields, label = FIELD_LABELS[key], placeholder?: string, rows = 2) =>
    <Field key={key} label={label}>
      <textarea value={draft.fields[key]} rows={rows} maxLength={12_000} placeholder={placeholder}
        onChange={(event) => update({ ...draft, fields: { ...draft.fields, [key]: event.target.value } })} />
    </Field>;

  return <form id={formId} className="note-editor" onSubmit={submit} aria-busy={busy}>
    <div className="editor-anchors">
      {draft.anchors.map((anchor: Anchor, index) => <div className={'anchor-card ' + (!anchor.attached ? 'unresolved' : '')} key={index}>
        <div className="anchor-meta"><span>{!anchor.attached && <AlertCircle size={14} />}{locationLabel(anchor)}</span>
          {draft.anchors.length > 1 && <Button variant="ghost" aria-label={'연결 ' + (index + 1) + ' 삭제'} className="icon-button"
            onClick={() => update({ ...draft, anchors: draft.anchors.filter((_, position) => position !== index) })}><X size={15} /></Button>}</div>
        <blockquote lang="en">{anchor.quote}</blockquote>
        {!anchor.attached && <Button onClick={() => reselect(index)}><Link2 size={16} />원문에서 다시 선택</Button>}
      </div>)}
    </div>

    <fieldset className="quick-types">
      <legend>헷갈리는 유형</legend>
      <div className="quick-type-grid">{categories.map((category) =>
        <button type="button" key={category.id} className="quick-type" style={colorStyle(category)}
          aria-pressed={first.categoryId === category.id} title={category.label} onClick={() => chooseCategory(category.id)}>
          {first.categoryId === category.id && <Check size={14} aria-hidden="true" />}{typeName(category)}
        </button>)}</div>
      {selectedDetail && <p className="quick-detail">{selectedDetail.label}</p>}
    </fieldset>

    <div className="quick-fields">
      {quickFields.map(({ key, label, placeholder }) => textField(key, label, placeholder, 1))}
    </div>

    <details className="form-details editor-more">
      <summary>더보기</summary>
      <div className="field-stack">
        {firstCategory && firstCategory.details.length > 0 && <Field label="세부 유형">
          <select value={first.detailId} onChange={(event) => {
            const head = { ...first, detailId: event.target.value };
            changeTags([head, ...draft.tags.slice(1).filter((tag) => !sameTag(tag, head))]);
          }}>
            <option value="">세부 유형 선택</option>{firstCategory.details.map((detail) => <option value={detail.id} key={detail.id}>{detail.label}</option>)}
          </select>
        </Field>}
        {draft.tags.length > 1 && <div className="chip-list">
          {draft.tags.slice(1).map((tag, index) => {
            const category = categories.find((item) => item.id === tag.categoryId);
            if (!category) return null;
            return <div className="editable-chip" key={tag.categoryId + ':' + tag.detailId}>
              <CategoryChip category={category}>{category.details.find((item) => item.id === tag.detailId)?.label ?? category.label}</CategoryChip>
              <Button variant="ghost" className="icon-button" aria-label={'추가 유형 ' + (index + 1) + ' 삭제'}
                onClick={() => changeTags(draft.tags.filter((_, position) => position !== index + 1))}><X size={13} /></Button>
            </div>;
          })}
        </div>}
        <details className="form-details"><summary><Plus size={15} />유형 추가</summary>
          <div className="form-grid">
            <Field label="추가 대분류"><select value={tagCategory.id} onChange={(event) => { setCategoryId(event.target.value); setDetailId(''); }}>
              {categories.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select></Field>
            <Field label="추가 세부 유형"><select value={detailId} onChange={(event) => setDetailId(event.target.value)}>
              <option value="">세부 유형 미지정</option>{tagCategory.details.map((detail) => <option key={detail.id} value={detail.id}>{detail.label}</option>)}
            </select></Field>
          </div>
          <Button disabled={draft.tags.length >= 100 || draft.tags.some((tag) => sameTag(tag, { categoryId: tagCategory.id, detailId }))}
            onClick={() => changeTags([...draft.tags, { categoryId: tagCategory.id, detailId }])}><Plus size={15} />이 유형 추가</Button>
        </details>
        {tagIds.length > 1 && <Field label="대표 표시 유형"><select value={draft.primaryCategoryId} onChange={(event) => update({ ...draft, primaryCategoryId: event.target.value })}>
          {tagIds.map((id) => <option value={id} key={id}>{categories.find((item) => id === item.id)?.label}</option>)}
        </select></Field>}

        <details className="form-details anchor-links">
          <summary><Link2 size={15} />다른 문장과 연결</summary>
          <div className="link-field">
            <Field label="연결할 문장"><select value={sentenceId} onChange={(event) => setSentenceId(event.target.value)}>
              <option value="">문장 선택</option>{sentences.map((sentence) =>
                <option value={sentence.id} key={sentence.id}>{sentence.number + '. ' + source.slice(sentence.start, sentence.end).slice(0, 84)}</option>)}
            </select></Field>
            <Button disabled={!sentenceId || draft.anchors.length >= 12} onClick={() => {
              const sentence = sentences.find((item) => item.id === sentenceId);
              if (sentence) { addSentence(sentence); setSentenceId(''); }
            }}><Plus size={16} />연결</Button>
          </div>
        </details>

        <details className="form-details"><summary>추가 설명·복습 질문</summary>
          <div className="field-stack">
            {advancedFields.map((key) => textField(key))}
            <Field label="추가 태그" hint="쉼표로 구분해요."><input maxLength={4000} value={extra}
              onChange={(event) => { setExtra(event.target.value); update({ ...draft, extraTags: splitTags(event.target.value) }); }} /></Field>
          </div>
        </details>
        <fieldset className="check-tags"><legend>예상 출제 유형</legend>{EXAM_TYPES.map((type) =>
          <label className="check-chip" key={type}><input type="checkbox" checked={draft.examTypes.includes(type)} onChange={(event) =>
            update({ ...draft, examTypes: event.target.checked ? [...draft.examTypes, type] : draft.examTypes.filter((item) => item !== type) })} /><span>{type}</span></label>)}</fieldset>
        <div className="form-grid">
          <Field label="중요도"><select value={draft.priority} onChange={(event) => update({ ...draft, priority: event.target.value as Annotation['priority'] })}>
            {PRIORITIES.map((priority) => <option value={priority} key={priority}>{PRIORITY_LABELS[priority]}</option>)}
          </select></Field>
          <Field label="학습 상태"><select value={draft.state} onChange={(event) => update({ ...draft, state: event.target.value as Annotation['state'] })}>
            {STATES.map((state) => <option value={state} key={state}>{STATE_LABELS[state]}</option>)}
          </select></Field>
        </div>
        {!isNew && <details className="form-details"><summary>복습 기록 ({records.length}회)</summary>
          {records.length ? <ul className="review-records">{records.slice(0, 10).map((record) =>
            <li key={record.id}><time dateTime={record.createdAt}>{formatDate(record.createdAt)}</time>{GRADE_LABELS[record.grade]}<StatePill state={record.state} /></li>)}</ul> :
            <p className="field-hint">복습 화면에서 평가하면 여기에 기록돼요.</p>}
        </details>}
        {!isNew && <div className="editor-actions">
          <Button variant="ghost" className="delete-icon" disabled={busy} onClick={() => setConfirmDelete(true)}>
            <Trash2 size={17} />주석 삭제
          </Button>
        </div>}
        {confirmDelete && <div className="inline-confirm"><p>이 주석과 연결된 복습 기록을 삭제할까요?</p>
          <Button onClick={() => setConfirmDelete(false)}>취소</Button><Button variant="danger" disabled={busy} onClick={async () => {
            setBusy(true);
            try { await remove(); } catch (reason) { setError(reason instanceof Error ? reason.message : '삭제할 수 없어요.'); setBusy(false); }
          }}>주석 삭제</Button>
        </div>}
      </div>
    </details>
    {error && <p className="inline-error" role="alert">{error}</p>}
  </form>;
}
