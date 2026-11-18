import { useMemo, useState, type FormEvent } from 'react';
import { ArrowRight, BookOpen, ChevronRight, FileText, FolderOpen, FolderPlus, Plus, Trash2 } from 'lucide-react';
import { MAX_TEXT, newPassage, now, passageSource, splitTags, uid, type Passage, type Scope, type Workspace } from './model';
import { examScope } from './examples';
import type { Commit } from './storage';
import { Button, Empty, Field, PageIntro, SearchBox, reportError, type Report, Modal } from './ui';

type LibraryProps = { data: Workspace; commit: Commit; open: (id: string) => void; report: Report };

export function Library({ data, commit, open, report }: LibraryProps) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [sort, setSort] = useState('updated');
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState(false);
  const [recentId] = useState(() => {
    try { return localStorage.getItem('munjang-note:last-read'); } catch { return null; }
  });
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const note of data.annotations) result.set(note.documentId, (result.get(note.documentId) ?? 0) + 1);
    return result;
  }, [data.annotations]);
  const docs = useMemo(() => {
    const search = query.trim().toLocaleLowerCase('ko');
    return data.documents.filter((document) => (!group || document.scopeId === group) &&
      (!search || [document.title, document.source, document.subject, passageSource(document), document.text, ...document.tags]
        .some((value) => value.toLocaleLowerCase('ko').includes(search))))
      .sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) :
        sort === 'notes' ? (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || b.updatedAt.localeCompare(a.updatedAt) :
          b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title));
  }, [counts, data.documents, group, query, sort]);
  const recent = data.documents.find((document) => document.id === recentId) ?? data.documents.find((document) => document.id === 'example-experiments') ?? docs[0];
  const featuredAnchor = recent && data.annotations.filter((note) => note.documentId === recent.id)
    .flatMap((note) => note.anchors).filter((anchor) => anchor.attached).sort((a, b) => a.start - b.start)[0];
  const introStart = recent && featuredAnchor
    ? recent.text.lastIndexOf(' ', Math.max(0, featuredAnchor.start - 45)) + 1 : 0;
  const activeScope = data.scopes.find((scope) => scope.id === group);
  const defaultScope = activeScope?.id ?? data.scopes.find((scope) => scope.id === examScope.id)?.id ?? '';

  return <div className="main-content library-page">
    <PageIntro context="영어 내신 학습" title="지문 라이브러리" subtitle={activeScope?.title ?? data.scopes.find((scope) => scope.id === examScope.id)?.title}>
      <Button onClick={() => setManaging(true)}><FolderPlus size={17} />시험 범위</Button>
      <Button variant="primary" onClick={() => setCreating(true)}><Plus size={19} />새 지문</Button>
    </PageIntro>
    {recent && !query && !group && <section className="continue-card" aria-labelledby="continue-title">
      <div className="continue-content">
        <div className="continue-label"><BookOpen size={16} />{recentId === recent.id ? '이어서 읽기' : '추천 지문'}</div>
        <h2 id="continue-title" lang="en">{recent.title}</h2>
        <div className="continue-meta">{passageSource(recent) || recent.subject || '내 지문'}<span aria-hidden="true">·</span> 주석 {counts.get(recent.id) ?? 0}개</div>
        <Button variant="primary" onClick={() => open(recent.id)}>지문 열기<ArrowRight size={17} /></Button>
      </div>
      <div className="paper-illustration" aria-hidden="true">
        <div className="mini-paper mini-paper-back" />
        <div className="mini-paper mini-paper-front">
          <div className="mini-title" lang="en">{recent.title}</div>
          <div lang="en" className="mini-text">{featuredAnchor ? <>
            {introStart > 0 ? '…' : ''}{recent.text.slice(introStart, featuredAnchor.start)}<mark>{featuredAnchor.quote}</mark>{recent.text.slice(featuredAnchor.end, featuredAnchor.end + 102).replace(/\s+\S*$/, '')}…
          </> : recent.text.slice(0, 204)}</div>
          <div className="mini-rule" />
          <div className="mini-foot"><span /><span /><span /></div>
        </div>
      </div>
    </section>}
    <section className="library-list" aria-labelledby="library-list-title">
      <div className="section-heading"><h2 id="library-list-title">{group ? '시험 범위 지문' : '전체 지문'}</h2><span className="count">{docs.length}개</span></div>
      <div className="library-tools">
        <SearchBox value={query} onChange={setQuery} placeholder="제목, 출처, 지문 검색" />
        <select aria-label="시험 범위 필터" value={group} onChange={(event) => setGroup(event.target.value)}>
          <option value="">모든 시험 범위</option>
          {data.scopes.map((scope) => <option key={scope.id} value={scope.id}>{scope.title}</option>)}
        </select>
        <select aria-label="지문 정렬" value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="updated">최근 수정순</option><option value="title">제목순</option><option value="notes">주석 많은순</option>
        </select>
      </div>
      {docs.length > 0 ? <ul className="document-list">{docs.map((document) => <li key={document.id}>
        <button type="button" className="document-row" onClick={() => open(document.id)}>
          <span className="document-icon" aria-hidden="true"><FileText size={20} /></span>
          <span className="document-info">
            <strong>{document.title}</strong>
            <span>{[passageSource(document) || document.subject, data.scopes.find((scope) => scope.id === document.scopeId && scope.title !== document.source)?.title].filter(Boolean).join(' · ') || '출처 미지정'}</span>
          </span>
          <span className="document-tags">{document.tags.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}</span>
          <span className="document-count">주석 {counts.get(document.id) ?? 0}개</span><ChevronRight className="row-chevron" size={17} aria-hidden="true" />
        </button>
      </li>)}</ul> : <Empty title={query ? '검색 결과가 없어요' : '등록된 지문이 없어요'} text={query ? '다른 검색어를 입력해 보세요.' : '영어 원문을 붙여넣어 공부를 시작하세요.'}>
        {!query && <Button variant="primary" onClick={() => setCreating(true)}><Plus size={17} />새 지문</Button>}
      </Empty>}
    </section>
    {creating && <PassageForm initial={newPassage(defaultScope)} title="새 지문" scopes={data.scopes} close={() => setCreating(false)} save={async (draft) => {
      await commit((previous) => {
        if (previous.documents.length >= 3000) throw new Error('지문을 3,000개까지 저장할 수 있어요.');
        if (draft.scopeId && !previous.scopes.some((scope) => scope.id === draft.scopeId)) throw new Error('시험 범위를 다시 선택해 주세요.');
        return { ...previous, documents: [...previous.documents, draft] };
      });
      setCreating(false);
      open(draft.id);
      report('지문을 저장했어요.');
    }} />}
    {managing && <ScopeManager scopes={data.scopes} commit={commit} report={report} close={() => setManaging(false)}
      onDelete={(id) => { if (group === id) setGroup(''); }} />}
  </div>;
}

export function PassageForm({ initial, title, scopes, close, save }: {
  initial: Passage; title: string; scopes: Scope[]; close: () => void; save: (draft: Passage) => Promise<void>;
}) {
  const [draft, setDraft] = useState(initial);
  const [tags, setTags] = useState(initial.tags.join(', '));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const change = <K extends keyof Passage,>(key: K, value: Passage[K]) => setDraft((previous) => ({ ...previous, [key]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!draft.title.trim() || !draft.text.trim()) { setError('제목과 영어 원문을 입력해 주세요.'); return; }
    const tagList = splitTags(tags);
    if (tagList.length > 50 || tagList.some((tag) => tag.length > 200)) { setError('태그는 50개까지, 각 200자 이내로 입력해 주세요.'); return; }
    setError('');
    setSaving(true);
    try { await save({ ...draft, title: draft.title.trim(), tags: tagList, updatedAt: now() }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '지문을 저장할 수 없어요.'); }
    finally { setSaving(false); }
  }

  return <Modal title={title} onClose={close} wide>
    <form className="modal-body passage-form" onSubmit={submit}>
      <Field label="제목"><input autoFocus required maxLength={200} placeholder="예. 교과서 3과 본문" value={draft.title} onChange={(event) => change('title', event.target.value)} /></Field>
      <Field label="영어 원문" hint="붙여넣은 줄바꿈과 문장부호가 원문에 유지돼요."><textarea className="passage-input" lang="en" rows={9} maxLength={MAX_TEXT} required
        value={draft.text} onChange={(event) => change('text', event.target.value)} placeholder="Paste the English passage here." /></Field>
      <div className="form-grid">
        <Field label="출처"><input maxLength={500} value={draft.source} onChange={(event) => change('source', event.target.value)} placeholder="예. 학교 학습지" /></Field>
        <Field label="과목"><input maxLength={500} value={draft.subject} onChange={(event) => change('subject', event.target.value)} /></Field>
        <Field label="시험 범위"><select value={draft.scopeId} onChange={(event) => change('scopeId', event.target.value)}>
          <option value="">지정하지 않음</option>{scopes.map((scope) => <option key={scope.id} value={scope.id}>{scope.title}</option>)}
        </select></Field>
        <Field label="교과서 단원"><input maxLength={500} value={draft.unit} onChange={(event) => change('unit', event.target.value)} placeholder="예. Lesson 3" /></Field>
      </div>
      <details className="form-details" open={Boolean(draft.year || draft.month || draft.questionNumber) || undefined}>
        <summary>모의고사 정보</summary>
        <div className="form-grid three">
          <Field label="연도"><input placeholder="2026" inputMode="numeric" maxLength={4} pattern="[0-9]{4}" value={draft.year} onChange={(event) => change('year', event.target.value)} /></Field>
          <Field label="월"><select value={draft.month ?? ''} onChange={(event) => change('month', event.target.value ? Number(event.target.value) : null)}>
            <option value="">지정하지 않음</option>{Array.from({ length: 12 }, (_, index) => <option key={index} value={index + 1}>{index + 1}월</option>)}
          </select></Field>
          <Field label="문항 번호"><input inputMode="numeric" placeholder="29" pattern="[0-9]{1,4}" maxLength={4} value={draft.questionNumber} onChange={(event) => change('questionNumber', event.target.value)} /></Field>
        </div>
      </details>
      <Field label="지문 태그" hint="쉼표로 구분해요."><input maxLength={4000} value={tags} onChange={(event) => setTags(event.target.value)} placeholder="예. 교과서, 서술형" /></Field>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="form-actions"><Button onClick={close}>취소</Button><Button type="submit" variant="primary" disabled={saving}>지문 저장</Button></div>
    </form>
  </Modal>;
}

function ScopeManager({ scopes, commit, report, close, onDelete }: {
  scopes: Scope[]; commit: Commit; report: Report; close: () => void; onDelete: (id: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [editing, setEditing] = useState('');
  const [deleting, setDeleting] = useState<Scope>();
  async function save(event: FormEvent) {
    event.preventDefault();
    const value = title.trim();
    if (!value) return;
    try {
      await commit((previous) => {
        if (previous.scopes.some((scope) => scope.title === value && scope.id !== editing)) throw new Error('같은 이름의 시험 범위가 있어요.');
        if (previous.scopes.length >= 250 && !editing) throw new Error('시험 범위는 250개까지 추가할 수 있어요.');
        return { ...previous, scopes: editing ? previous.scopes.map((scope) => scope.id === editing ? { ...scope, title: value } : scope) :
          [...previous.scopes, { id: uid(), title: value }] };
      });
      setTitle('');
      setEditing('');
      report('시험 범위를 저장했어요.');
    } catch (error) { reportError(report, error); }
  }
  return <Modal title="시험 범위 관리" onClose={close}>
    <div className="modal-body">
      <form className="scope-form" onSubmit={save}>
        <Field label={editing ? '시험 범위 이름 수정' : '시험 범위 이름'}><input autoFocus maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} required /></Field>
        <Button type="submit" variant="primary">{editing ? '수정' : '추가'}</Button>
        {editing && <Button onClick={() => { setEditing(''); setTitle(''); }}>취소</Button>}
      </form>
      <ul className="settings-list">{scopes.map((scope) => <li key={scope.id}>
        <span><FolderOpen size={17} aria-hidden="true" />{scope.title}</span>
        <div><Button variant="ghost" onClick={() => { setEditing(scope.id); setTitle(scope.title); }}>이름 수정</Button>
          <Button variant="ghost" className="icon-button" aria-label={scope.title + ' 삭제'} onClick={() => setDeleting(scope)}><Trash2 size={16} /></Button></div>
      </li>)}</ul>
      {deleting && <div className="inline-confirm"><p>‘{deleting.title}’ 시험 범위에서 지문을 해제할까요?</p><Button onClick={() => setDeleting(undefined)}>취소</Button>
        <Button variant="danger" onClick={async () => {
          try {
            await commit((previous) => ({ ...previous, scopes: previous.scopes.filter((scope) => scope.id !== deleting.id),
              documents: previous.documents.map((document) => document.scopeId === deleting.id ? { ...document, scopeId: '' } : document) }));
            onDelete(deleting.id); setDeleting(undefined);
            if (editing === deleting.id) { setEditing(''); setTitle(''); }
            report('시험 범위를 삭제했어요.');
          } catch (error) { reportError(report, error); }
        }}>범위 삭제</Button>
      </div>}
    </div>
  </Modal>;
}
