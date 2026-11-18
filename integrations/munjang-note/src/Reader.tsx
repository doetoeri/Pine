import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import {
  ArrowLeft, BookOpen, ChevronRight, Copy, FileDown, Filter, Hash, Keyboard, Layers2, List, PanelRightClose,
  PanelRightOpen, PenLine, Pencil, Plus, Save, Settings2, SlidersHorizontal, TextQuote, Trash2, X,
} from 'lucide-react';
import {
  emptyFilter, makeAnchor, matchingNotes, newNote, now, passageSource, rebaseDocument, sentenceRanges, uid,
  type Annotation, type Category, type Passage, type Range, type Workspace,
} from './model';
import { markedParts, offsetAtPoint, readSelection, showSourceRange, sourceRangeBetween, textareaRange } from './ranges';
import { PassageForm } from './Library';
import { NoteEditor } from './NoteEditor';
import { Button, CategoryChip, Empty, FilterFields, Modal, StatePill, colorStyle, reportError, type Report } from './ui';
import type { Commit } from './storage';

export type ReaderProps = {
  data: Workspace; document: Passage; requestedNote: string; commit: Commit; report: Report; open: (id: string) => void;
  close: () => void; print: (id: string) => void;
};

function useNarrowReader() {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 820px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 820px)');
    const changed = () => setNarrow(media.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  return narrow;
}

export function Reader({ data, document: passage, requestedNote, commit, report, open, close, print }: ReaderProps) {
  const root = useRef<HTMLElement>(null);
  const choiceRef = useRef<Range | null>(null);
  const originalNote = useRef<Annotation | undefined>(undefined);
  const revisionText = useRef(passage.text);
  const lastSource = useRef(passage.text);
  const stroke = useRef<{ pointerId: number; start: number; end: number } | null>(null);
  const lastStroke = useRef(-Infinity);
  const narrow = useNarrowReader();
  const [panelOpen, setPanelOpen] = useState(!narrow);
  const [filterOpen, setFilterOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [penMode, setPenMode] = useState(false);
  const [filter, setFilter] = useState({ ...emptyFilter });
  const [pending, setPending] = useState<Range | null>(null);
  const [draft, setDraft] = useState<Annotation>();
  const [candidates, setCandidates] = useState<string[]>([]);
  const [isNew, setIsNew] = useState(false);
  const [linkIndex, setLinkIndex] = useState<number | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [editingPassage, setEditingPassage] = useState<Passage>();
  const [deleting, setDeleting] = useState(false);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const sentences = useMemo(() => sentenceRanges(passage.text), [passage.text]);
  const notes = useMemo(() => data.annotations.filter((note) => note.documentId === passage.id)
    .sort((a, b) => a.anchors[0].start - b.anchors[0].start || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)), [data.annotations, passage.id]);
  const visible = useMemo(() => matchingNotes(notes, filter, data), [notes, filter, data]);
  const numbers = useMemo(() => new Map(notes.map((note, index) => [note.id, index + 1])), [notes]);
  const sentencePoints = useMemo(() => data.display.sentenceNumbers ? new Map(sentences.map((sentence) => [sentence.start, sentence.number])) : new Map<number, number>(),
    [data.display.sentenceNumbers, sentences]);
  const parts = useMemo(() => markedParts(passage.text, visible, sentencePoints.keys()), [passage.text, visible, sentencePoints]);

  function remember(range: Range | null) {
    choiceRef.current = range;
    setPending((previous) => previous?.start === range?.start && previous?.end === range?.end ? previous : range);
  }

  function forget() {
    globalThis.getSelection()?.removeAllRanges();
    remember(null);
  }

  function editNote(note: Annotation, scroll = false, overlap: string[] = []) {
    originalNote.current = note;
    revisionText.current = passage.text;
    setDraft(note);
    setCandidates(overlap);
    setIsNew(false);
    setPanelOpen(true);
    setLinkIndex(null);
    forget();
    if (scroll) {
      const first = note.anchors.find((anchor) => anchor.attached);
      if (first) requestAnimationFrame(() => {
        root.current?.querySelector('[data-text-start="' + first.start + '"]')?.scrollIntoView({ block: 'center', behavior: 'instant' });
      });
    }
  }

  useEffect(() => {
    if (!requestedNote) return;
    const note = notes.find((item) => item.id === requestedNote);
    if (note) editNote(note, true);
    // Each URL change opens the requested note once, keeping in-progress edits when data updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedNote, passage.id]);

  useEffect(() => {
    function read() {
      if (!root.current) return;
      const selected = readSelection(root.current, passage.text, globalThis.getSelection());
      if (selected) remember(selected);
    }
    globalThis.document.addEventListener('selectionchange', read);
    globalThis.document.addEventListener('pointerup', read);
    return () => {
      globalThis.document.removeEventListener('selectionchange', read);
      globalThis.document.removeEventListener('pointerup', read);
    };
  }, [passage.text]);

  useLayoutEffect(() => {
    if (lastSource.current === passage.text) return;
    lastSource.current = passage.text;
    cancelPen();
  }, [passage.text]);

  function finishRange(range: Range) {
    const anchor = makeAnchor(passage.text, range, sentences);
    if (linkIndex !== null && revisionText.current !== passage.text) {
      report('원문이 바뀌었어요. 주석을 다시 열고 위치를 확인해 주세요.', true);
      forget();
      return;
    }
    if (!anchor.quote.trim()) return;
    if (linkIndex !== null && draft) {
      setDraft({ ...draft, anchors: draft.anchors.map((oldAnchor, index) => index === linkIndex ? anchor : oldAnchor) });
      setLinkIndex(null);
    } else {
      originalNote.current = undefined;
      revisionText.current = passage.text;
      setDraft(newNote(passage.id, anchor, filter.categoryId || data.categories[0].id));
      setIsNew(true);
      setCandidates([]);
    }
    setPanelOpen(true);
    forget();
  }

  function cancelPen() {
    const active = stroke.current;
    stroke.current = null;
    if (active && root.current?.hasPointerCapture(active.pointerId)) root.current.releasePointerCapture(active.pointerId);
    setPenMode(false);
    forget();
  }

  useEffect(() => {
    if (!penMode) return;
    function escape(event: KeyboardEvent) { if (event.key === 'Escape') cancelPen(); }
    globalThis.document.addEventListener('keydown', escape);
    return () => globalThis.document.removeEventListener('keydown', escape);
  }, [penMode]);

  function startPen(event: PointerEvent<HTMLElement>) {
    if (!penMode || !event.isPrimary || event.button !== 0) return;
    const start = offsetAtPoint(event.currentTarget, event.clientX, event.clientY);
    if (start === null) return;
    event.preventDefault();
    forget();
    stroke.current = { pointerId: event.pointerId, start, end: start };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* The reading pane still receives direct pointer moves. */ }
  }

  function movePen(event: PointerEvent<HTMLElement>) {
    const active = stroke.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const end = offsetAtPoint(event.currentTarget, event.clientX, event.clientY);
    if (end === null || end === active.end) return;
    event.preventDefault();
    active.end = end;
    showSourceRange(event.currentTarget, sourceRangeBetween(passage.text, active.start, end));
  }

  function endPen(event: PointerEvent<HTMLElement>) {
    const active = stroke.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    const end = offsetAtPoint(event.currentTarget, event.clientX, event.clientY) ?? active.end;
    const selected = sourceRangeBetween(passage.text, active.start, end);
    lastStroke.current = performance.now();
    stroke.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!selected) { forget(); return; }
    setPenMode(false);
    finishRange(selected);
  }

  function handleMark(event: MouseEvent, ids: string[]) {
    if (penMode || performance.now() - lastStroke.current < 250) return;
    if (!root.current || readSelection(root.current, passage.text, globalThis.getSelection())) return;
    if (event.detail > 1) return;
    // An underlying tap can move the mobile selection handles while the user is reattaching.
    if (linkIndex !== null) return;
    forget();
    if (ids.length === 1) {
      const note = notes.find((item) => item.id === ids[0]);
      if (note) editNote(note);
    } else {
      setDraft(undefined);
      setCandidates(ids);
      setPanelOpen(true);
    }
  }

  function closeForm() {
    setDraft(undefined);
    setIsNew(false);
    setLinkIndex(null);
    setCandidates([]);
    if (narrow) setPanelOpen(false);
  }

  async function saveNote(note: Annotation) {
    const previousNote = originalNote.current;
    await commit((previous) => {
      const latest = previous.documents.find((item) => item.id === passage.id);
      if (!latest || latest.text !== revisionText.current) throw new Error('원문이 바뀌었어요. 지문을 다시 열고 위치를 확인해 주세요.');
      const stored = previous.annotations.find((item) => item.id === note.id);
      if (previousNote && (!stored || stored.updatedAt !== previousNote.updatedAt ||
          JSON.stringify(stored.anchors) !== JSON.stringify(previousNote.anchors))) throw new Error('다른 화면에서 주석이 바뀌었어요. 주석을 다시 열어 주세요.');
      if (note.tags.some((tag) => !previous.categories.some((category) => category.id === tag.categoryId &&
          (!tag.detailId || category.details.some((detail) => detail.id === tag.detailId))))) throw new Error('현재 분류에 있는 유형을 다시 선택해 주세요.');
      if (note.anchors.some((anchor) => anchor.attached && latest.text.slice(anchor.start, anchor.end) !== anchor.quote)) {
        throw new Error('원문과 주석 위치가 일치하지 않아요.');
      }
      if (previous.annotations.length >= 20_000 && !stored) throw new Error('주석을 20,000개까지 저장할 수 있어요.');
      const updated = { ...note, updatedAt: now() };
      return { ...previous, annotations: stored ? previous.annotations.map((item) => item.id === note.id ? updated : item) : [...previous.annotations, updated] };
    });
    closeForm();
    report('주석을 저장했어요.');
  }

  async function removeNote() {
    if (!draft) return;
    await commit((previous) => ({ ...previous, annotations: previous.annotations.filter((note) => note.id !== draft.id),
      reviews: previous.reviews.filter((item) => item.annotationId !== draft.id) }));
    closeForm();
    report('주석을 삭제했어요.');
  }

  const actionLabel = linkIndex === null ? '주석 추가' : '이 위치에 연결';
  const detached = notes.filter((note) => note.anchors.some((anchor) => !anchor.attached));
  const rows = candidates.length ? notes.filter((note) => candidates.includes(note.id)) : visible;
  const activeFilter = Object.values(filter).some(Boolean);
  const channel = filter.categoryId || data.categories.find((category) => category.details.some((detail) => detail.id === filter.detailId))?.id;
  const scope = data.scopes.find((item) => item.id === passage.scopeId);

  const noteFormId = 'annotation-form';
  const saveAction = draft && <Button type="submit" form={noteFormId} variant="primary"><Save size={15} />주석 저장</Button>;
  const panel = <>
    {candidates.length > 1 && <div className="overlap-notes"><h3><Layers2 size={16} />겹친 주석 {candidates.length}개</h3>
      <div className="overlap-buttons">{rows.map((note) => <Button variant={draft?.id === note.id ? 'primary' : 'secondary'} key={note.id}
        onClick={() => editNote(note, false, candidates)}>
        {'#' + numbers.get(note.id)} {data.categories.find((category) => category.id === note.primaryCategoryId)?.label}
      </Button>)}</div>
    </div>}
    {draft ? <NoteEditor key={draft.id} draft={draft} isNew={isNew} categories={data.categories} sentences={sentences}
      source={passage.text} records={data.reviews.filter((item) => item.annotationId === draft.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))}
      update={setDraft} save={saveNote} remove={removeNote} formId={noteFormId}
      reselect={(index) => { setLinkIndex(index); setPanelOpen(false); forget(); }}
      addSentence={(sentence) => {
        const anchor = makeAnchor(passage.text, sentence, sentences);
        if (draft.anchors.some((item) => item.attached && item.start === anchor.start && item.end === anchor.end)) { report('이미 연결된 문장이에요.'); return; }
        setDraft({ ...draft, anchors: [...draft.anchors, anchor] });
      }} /> : <>
      {detached.length > 0 && !candidates.length && <div className="unresolved-list"><h3>위치 확인 필요 · {detached.length}개</h3>
        <p>원문이 바뀐 부분은 주석을 열고 새 위치를 선택하세요.</p>
        {detached.filter((note) => !rows.some((item) => item.id === note.id)).map((note) => <Button variant="ghost" key={note.id}
          onClick={() => editNote(note)}>{note.anchors.find((anchor) => !anchor.attached)?.quote.slice(0, 60)}</Button>)}</div>}
      {rows.length ? <ul className="reader-notes">{rows.map((note) => {
        const category = data.categories.find((item) => item.id === note.primaryCategoryId);
        return <li key={note.id}><button type="button" className="reader-note" onClick={() => editNote(note, true, candidates)}>
          <span className="reader-note-top"><span className="small-number">#{numbers.get(note.id)}</span>{category && <CategoryChip category={category} />}
            <ChevronRight size={15} /></span>
          <strong lang="en">{note.anchors[0].quote}</strong>
          <span className="reader-note-bottom"><StatePill state={note.state} />{note.anchors.some((anchor) => !anchor.attached) && <span className="unresolved-text">위치 확인 필요</span>}</span>
        </button></li>;
      })}</ul> : <Empty title={activeFilter ? '조건에 맞는 주석이 없어요' : '아직 주석이 없어요'}
        text={activeFilter ? '필터를 바꿔 다른 주석을 표시할 수 있어요.' : '원문에서 단어나 문장을 선택해 주석을 추가하세요.'} />}
    </>}
  </>;

  return <div className="main-content reader-page">
    <div className="reader-topline">
      <Button variant="ghost" onClick={close}><ArrowLeft size={17} />지문 라이브러리</Button>
      <div className="reader-top-actions">
        <Button onClick={() => print(passage.id)}><FileDown size={17} /><span>PDF 출력</span></Button>
        <div className="popup-anchor">
          <Button aria-expanded={menuOpen} aria-label="지문 관리" onClick={() => setMenuOpen(!menuOpen)}><Settings2 size={17} /><span>지문 관리</span></Button>
          {menuOpen && <div className="popup">
            <Button variant="ghost" onClick={() => { setMenuOpen(false); setEditingPassage(passage); }}><Pencil size={17} />지문 수정</Button>
            <Button variant="ghost" onClick={async () => {
              setMenuOpen(false);
              const id = uid();
              try {
                await commit((previous) => {
                  const stamp = now();
                  const current = previous.documents.find((item) => item.id === passage.id);
                  if (!current) throw new Error('복제할 지문이 없어요.');
                  const copies: Annotation[] = previous.annotations.filter((note) => note.documentId === passage.id)
                    .map((note) => ({ ...note, id: uid(), documentId: id, state: 'unlearned', createdAt: stamp, updatedAt: stamp }));
                  if (previous.documents.length >= 3000 || previous.annotations.length + copies.length > 20_000) throw new Error('저장할 수 있는 항목 수를 초과했어요.');
                  return { ...previous, documents: [...previous.documents, { ...current, id, title: current.title.slice(0, 195) + ' (복제)', createdAt: stamp, updatedAt: stamp }],
                    annotations: [...previous.annotations, ...copies] };
                });
                open(id); report('지문과 주석을 복제했어요.');
              } catch (error) { reportError(report, error); }
            }}><Copy size={17} />지문 복제</Button>
            <Button variant="ghost" className="delete-icon" onClick={() => { setMenuOpen(false); setDeleting(true); }}><Trash2 size={17} />지문 삭제</Button>
          </div>}
        </div>
      </div>
    </div>
    <header className="reader-title">
      <div className="eyebrow"><BookOpen size={15} />{scope?.title ?? passage.subject ?? '영어 지문'}</div>
      <h1 lang="en">{passage.title}</h1>
      {passageSource(passage) && passageSource(passage) !== scope?.title && <p>{passageSource(passage)}</p>}
    </header>
    <div className="reader-toolbar">
      <div className="reader-view-tools">
        <Button className="pen-mode-toggle" aria-pressed={penMode} onClick={() => {
          if (penMode) cancelPen();
          else { forget(); setViewOpen(false); setPenMode(true); }
        }}><PenLine size={18} /><span>펜 선택</span></Button>
        <Button className="keyboard-select" aria-label="키보드로 범위 선택" title="키보드로 범위 선택"
          onClick={() => { if (penMode) cancelPen(); setKeyboardOpen(true); }}><Keyboard size={17} /><span>범위 선택</span></Button>
        <div className="popup-anchor reader-view-options">
          <Button aria-label="표시 설정" title="표시 설정" aria-expanded={viewOpen} className={activeFilter ? 'is-active' : ''}
            onClick={() => setViewOpen(!viewOpen)}><SlidersHorizontal size={17} /><span>보기</span></Button>
          {viewOpen && <div className="popup">
            <Button variant="ghost" aria-expanded={filterOpen} onClick={() => { setViewOpen(false); setFilterOpen(!filterOpen); }}>
              <Filter size={16} />표시 필터{activeFilter ? ' 적용 중' : ''}
            </Button>
            <Button variant="ghost" aria-pressed={data.display.sentenceNumbers} onClick={async () => {
              try { await commit((previous) => ({ ...previous, display: { ...previous.display, sentenceNumbers: !previous.display.sentenceNumbers } })); }
              catch (error) { reportError(report, error); }
              setViewOpen(false);
            }}><Hash size={16} />문장 번호</Button>
          </div>}
        </div>
      </div>
      <div className="reader-note-tools">
        <Button className="toolbar-add" variant="primary" disabled={!pending || penMode} onPointerDown={(event) => { if (event.pointerType === 'mouse') event.preventDefault(); }}
          onClick={() => { if (choiceRef.current) finishRange(choiceRef.current); }}><Plus size={18} />{actionLabel}</Button>
        <Button aria-expanded={panelOpen} aria-label={panelOpen ? '주석 패널 접기' : '주석 패널 열기'}
          title={panelOpen ? '주석 패널 접기' : '주석 패널 열기'} onClick={() => setPanelOpen(!panelOpen)}>
          {narrow ? <List size={17} /> : panelOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
          <span className="note-count-label">주석 {visible.length}</span>
        </Button>
      </div>
    </div>
    {penMode && <div className="pen-hint" role="status"><PenLine size={16} />S Pen이나 손가락으로 글자 위를 끌어 보세요.</div>}
    {filterOpen && <FilterFields filter={filter} onChange={setFilter} data={data} hideDocument compact />}
    {linkIndex !== null && <div className="link-banner" role="status"><TextQuote size={17} />원문에서 새 범위를 선택하고 ‘이 위치에 연결’을 누르세요.
      <Button variant="ghost" onClick={() => { setLinkIndex(null); setPanelOpen(true); forget(); }}>취소</Button></div>}
    <div className={'reader-grid ' + (panelOpen && !narrow ? 'with-panel' : '')}>
      <section className="reader-paper" aria-label="영어 원문" style={{ '--reading-size': data.display.fontSize + 'px' } as React.CSSProperties}>
        <div className="paper-heading"><span>원문</span><span>{activeFilter ? visible.length + ' / ' + notes.length + '개 주석 표시' : '주석 ' + notes.length + '개'}</span></div>
        <article className={'source-text font-' + data.display.font + (penMode ? ' pen-active' : '')} lang="en"
          ref={root} data-testid="source-text" aria-label="영어 원문 텍스트"
          onPointerDown={startPen} onPointerMove={movePen} onPointerUp={endPen}
          onPointerCancel={(event) => { if (stroke.current?.pointerId === event.pointerId) cancelPen(); }}
          onLostPointerCapture={(event) => { if (stroke.current?.pointerId === event.pointerId) cancelPen(); }}
          onContextMenu={(event) => { if (penMode) event.preventDefault(); }}
          onClick={(event) => {
            if (!(event.target as HTMLElement).closest('.annotation-mark') && globalThis.getSelection()?.isCollapsed) remember(null);
          }}>
          {parts.map((part) => {
            const top = part.notes.find((note) => note.id === draft?.id) ?? part.notes[0];
            const category: Category | undefined = top && data.categories.find((item) => item.id === (channel || top.primaryCategoryId));
            const sentence = sentencePoints.get(part.start);
            const ids = part.notes.map((note) => note.id);
            const quote = passage.text.slice(part.start, part.end);
            let marker: string | undefined;
            if (top && category && quote.trim()) {
              const start = top.anchors.some((anchor) => anchor.attached && anchor.start === part.start);
              const multiple = part.notes.length > 1 && part.notes.some((note) => note.anchors.some((anchor) => anchor.attached && anchor.start === part.start));
              if (multiple) marker = '+' + (ids.length - 1);
              else if (start && category.mark === 'number') marker = String(numbers.get(top.id));
              else if (start && category.mark === 'mark') marker = '•';
            }
            return <span key={part.start} data-text-start={part.start} data-text-end={part.end} data-sentence={sentence}
              data-marker={marker}
              data-overlap={ids.length > 1 ? ids.length : undefined}
              className={category ? 'annotation-mark mark-' + category.mark + (draft?.id && ids.includes(draft.id) ? ' active-mark' : '') : undefined}
              style={category ? colorStyle(category) : undefined}
              role={category && quote.trim() ? 'button' : undefined} tabIndex={category && quote.trim() ? 0 : undefined}
              aria-label={category && quote.trim() ? quote + ' · ' + (ids.length > 1 ? '겹친 주석 ' + ids.length + '개' : category.label + ' 주석') : undefined}
              onClick={category ? (event) => handleMark(event, ids) : undefined}
              onKeyDown={category ? (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                forget();
                if (ids.length === 1) {
                  const note = notes.find((item) => item.id === ids[0]);
                  if (note) editNote(note);
                } else { setDraft(undefined); setCandidates(ids); setPanelOpen(true); }
              } : undefined}>{quote}</span>;
          })}
        </article>
      </section>
      {!narrow && panelOpen && <aside className="reader-panel" aria-label={draft ? '주석 편집' : '지문 주석'}>
        <div className="panel-heading"><h2>{draft ? (isNew ? '새 주석' : '주석 편집') : '지문 주석'}</h2>
          {draft ? <div className="panel-actions">{saveAction}<Button variant="ghost" className="icon-button" aria-label="주석 목록" onClick={closeForm}><X size={18} /></Button></div> : <span className="count">{visible.length}개</span>}</div>
        <div className="panel-scroll">{panel}</div>
      </aside>}
    </div>
    {narrow && panelOpen && <Modal title={draft ? isNew ? '새 주석' : '주석 편집' : '지문 주석'} actions={saveAction} onClose={() => setPanelOpen(false)}>
      <div className="mobile-panel-body">{panel}</div>
    </Modal>}
    {narrow && pending && !panelOpen && !penMode && <div className="selection-dock">
      <span>{passage.text.slice(pending.start, pending.end)}</span>
      <Button variant="primary" onClick={() => { if (choiceRef.current) finishRange(choiceRef.current); }}><Plus size={17} />{actionLabel}</Button>
      <Button variant="ghost" className="icon-button" aria-label="선택 취소" onClick={forget}><X size={17} /></Button>
    </div>}
    {keyboardOpen && <KeyboardRange source={passage.text} close={() => setKeyboardOpen(false)} action={actionLabel}
      select={(range) => { setKeyboardOpen(false); finishRange(range); }} />}
    {editingPassage && <PassageForm initial={editingPassage} title="지문 수정" scopes={data.scopes} close={() => setEditingPassage(undefined)}
      save={async (updated) => {
        let count = 0;
        await commit((previous) => {
          const stored = previous.documents.find((item) => item.id === passage.id);
          if (!stored || stored.updatedAt !== editingPassage.updatedAt || stored.text !== editingPassage.text) throw new Error('지문이 바뀌었어요. 다시 열고 수정해 주세요.');
          if (updated.scopeId && !previous.scopes.some((scope) => scope.id === updated.scopeId)) throw new Error('시험 범위를 다시 선택해 주세요.');
          const annotations = rebaseDocument(previous.annotations, passage.id, stored.text, updated.text);
          count = annotations.filter((note) => note.documentId === passage.id && note.anchors.some((anchor) => !anchor.attached)).length;
          return { ...previous, annotations, documents: previous.documents.map((item) => item.id === passage.id ? updated : item) };
        });
        if (passage.text !== updated.text) { closeForm(); forget(); if (!narrow || count) setPanelOpen(true); }
        setEditingPassage(undefined);
        report(count ? '지문을 저장했어요. 주석 ' + count + '개의 위치를 확인해 주세요.' : '지문을 수정했어요.');
      }} />}
    {deleting && <Modal title="지문 삭제" onClose={() => setDeleting(false)}><div className="modal-body">
      <p>‘{passage.title}’과 이 지문에 달린 주석 및 복습 기록을 삭제할까요?</p><div className="form-actions">
        <Button onClick={() => setDeleting(false)} disabled={deletingBusy}>취소</Button>
        <Button variant="danger" disabled={deletingBusy} onClick={async () => {
          setDeletingBusy(true);
          try {
            await commit((previous) => {
              const removed = new Set(previous.annotations.filter((note) => note.documentId === passage.id).map((note) => note.id));
              return { ...previous, documents: previous.documents.filter((item) => item.id !== passage.id), annotations: previous.annotations.filter((note) => !removed.has(note.id)),
                reviews: previous.reviews.filter((record) => !removed.has(record.annotationId)) };
            });
            close(); report('지문을 삭제했어요.');
          } catch (error) { setDeletingBusy(false); reportError(report, error); }
        }}>지문 삭제</Button>
      </div></div></Modal>}
  </div>;
}

function KeyboardRange({ source, select, close, action }: { source: string; select: (range: Range) => void; close: () => void; action: string }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [selection, setSelection] = useState<Range | null>(null);
  const update = (target: HTMLTextAreaElement) => {
    const range = textareaRange(source, target.selectionStart, target.selectionEnd);
    setSelection(source.slice(range.start, range.end).trim() ? range : null);
  };
  return <Modal title="원문 범위 선택" onClose={close} wide><div className="modal-body">
    <p>Shift와 방향키 또는 드래그로 범위를 선택하세요.</p>
    <textarea ref={input} className="passage-input keyboard-source" aria-label="범위를 선택할 원문" aria-readonly="true"
      rows={10} lang="en" autoFocus inputMode="none" value={source}
      onBeforeInput={(event) => event.preventDefault()} onPaste={(event) => event.preventDefault()}
      onCut={(event) => { event.preventDefault(); const element = event.currentTarget;
        event.clipboardData.setData('text/plain', element.value.slice(element.selectionStart, element.selectionEnd)); }}
      onDrop={(event) => event.preventDefault()} onChange={() => {}}
      onSelect={(event) => update(event.currentTarget)} onKeyUp={(event) => update(event.currentTarget)}
      onPointerUp={(event) => update(event.currentTarget)} />
    <div className="form-actions"><Button onClick={close}>취소</Button><Button variant="primary" disabled={!selection}
      onClick={() => { if (selection) select(selection); }}><Plus size={17} />{action}</Button></div>
  </div></Modal>;
}
