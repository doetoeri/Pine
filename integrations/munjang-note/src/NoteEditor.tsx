import { useState, type FormEvent } from 'react';
import { AlertCircle, ScanText, Trash2 } from 'lucide-react';
import { FIELD_LABELS, locationLabel, type Annotation, type Category, type Fields } from './model';
import { currentAIAnswer } from './study-prompt';
import { Button, Field } from './ui';

const activeFields = ['comparison', 'reason', 'takeaway'] as const;

export function NoteEditor({ draft, isNew, categories, update, save, remove, reselect, formId }: {
  draft: Annotation; isNew: boolean; categories: Category[];
  update: (draft: Annotation) => void; save: (draft: Annotation) => Promise<void>; remove: () => Promise<void>;
  reselect: (index: number) => void; formId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const type = draft.tags[0];
  const category = categories.find((item) => item.id === type.categoryId);
  const ai = currentAIAnswer(draft);
  const previousFields = (Object.keys(FIELD_LABELS) as (keyof Fields)[])
    .filter((key) => !activeFields.some((field) => key === field) && draft.fields[key].trim());

  function setType(categoryId: string, detailId = '') {
    const tag = { categoryId, detailId };
    const remaining = draft.tags.slice(1).filter((item) => item.categoryId !== categoryId || item.detailId !== detailId);
    update({ ...draft, primaryCategoryId: categoryId, tags: [tag, ...remaining] });
  }

  function setField(key: keyof Fields, value: string) {
    update({ ...draft, fields: { ...draft.fields, [key]: value } });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try { await save(draft); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '주석을 저장할 수 없어요.'); }
    finally { setBusy(false); }
  }

  return <form id={formId} className="note-editor focus-note" onSubmit={submit} aria-busy={busy} onKeyDown={(event) => {
    if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey) || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.requestSubmit();
  }}>
    <div className="editor-anchors">
      {draft.anchors.map((anchor, index) => <div className={'anchor-card ' + (!anchor.attached ? 'unresolved' : '')} key={index}>
        <div className="anchor-meta">
          <span>{!anchor.attached && <AlertCircle size={14} />}{locationLabel(anchor)}</span>
          <Button variant="ghost" className="retarget" onClick={() => reselect(index)}><ScanText size={15} />범위 다시 선택</Button>
        </div>
        <blockquote lang="en">{anchor.quote}</blockquote>
      </div>)}
    </div>

    <Field label="어떤 점이 헷갈려요?">
      <textarea className="note-question" rows={2} maxLength={12_000} value={draft.fields.comparison}
        placeholder="예. learn 다음에 동명사가 올 수 있나?" onChange={(event) => setField('comparison', event.target.value)} />
    </Field>

    <details className="form-details editor-more">
      <summary>유형·구분법</summary>
      <div className="field-stack">
        <Field label="헷갈리는 유형">
          <select value={type.categoryId} onChange={(event) => setType(event.target.value)}>{categories.map((item) =>
            <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        </Field>
        {category && category.details.length > 0 && <Field label="세부 유형">
          <select value={type.detailId} onChange={(event) => setType(type.categoryId, event.target.value)}>
            <option value="">세부 유형 선택</option>
            {category.details.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </Field>}
        <Field label="헷갈리는 이유">
          <textarea rows={2} value={draft.fields.reason} maxLength={12_000} onChange={(event) => setField('reason', event.target.value)} />
        </Field>
        <Field label="내가 정한 구분법">
          <textarea rows={2} value={draft.fields.takeaway} maxLength={12_000} onChange={(event) => setField('takeaway', event.target.value)} />
        </Field>
      </div>
    </details>

    {ai && <section className="ai-note" aria-label="AI 답변">
      <strong>AI 참고 해설</strong>
      {ai.explanation && <p>{ai.explanation}</p>}
      {ai.rule && <p><b>구분법</b> {ai.rule}</p>}
      {ai.contextNeeded && <p><b>필요한 문맥</b> {ai.contextNeeded}</p>}
    </section>}
    {previousFields.length > 0 && <details className="form-details">
      <summary>이전에 적은 내용</summary>
      <dl className="legacy-note">{previousFields.map((key) =>
        <div key={key}><dt>{FIELD_LABELS[key]}</dt><dd>{draft.fields[key]}</dd></div>)}</dl>
    </details>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {!isNew && !confirmDelete && <div className="editor-actions">
      <Button variant="ghost" className="delete-icon" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 size={16} />주석 삭제</Button>
    </div>}
    {confirmDelete && <div className="inline-confirm"><p>이 주석을 삭제할까요?</p>
      <Button onClick={() => setConfirmDelete(false)}>취소</Button><Button variant="danger" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await remove(); } catch (reason) { setError(reason instanceof Error ? reason.message : '삭제할 수 없어요.'); setBusy(false); }
      }}>주석 삭제</Button>
    </div>}
  </form>;
}
