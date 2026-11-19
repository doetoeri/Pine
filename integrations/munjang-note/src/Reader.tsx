import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import {
  ArrowLeft, BookOpen, ChevronRight, ChevronsUpDown, FileDown, Keyboard, Layers2, List, PanelRightClose,
  PanelRightOpen, PenLine, Pencil, Plus, Save, Settings2, Trash2, X,
} from 'lucide-react';
import {
  makeAnchor, newNote, now, passageSource, rebaseDocument, sentenceRanges, unclassifiedCategory,
  type Annotation, type Category, type Passage, type Range, type Workspace,
} from './model';
import { acceptsPenStroke, markedParts, offsetAtPoint, readSelection, showSourceRange, sourceRangeBetween, textareaRange, topAtSourceOffset } from './ranges';
import { PassageForm } from './Library';
import { NoteEditor } from './NoteEditor';
import { Button, CategoryChip, Empty, Modal, colorStyle, reportError, type Report } from './ui';
import type { Commit } from './storage';

export type ReaderProps = {
  data: Workspace; document: Passage; requestedNote: string; commit: Commit; report: Report;
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

export function Reader({ data, document: passage, requestedNote, commit, report, close, print }: ReaderProps) {
  const root = useRef<HTMLElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const readingPosition = useRef<{ start: number; top: number } | undefined>(undefined);
  const choiceRef = useRef<Range | null>(null);
  const originalNote = useRef<Annotation | undefined>(undefined);
  const revisionText = useRef(passage.text);
  const lastSource = useRef(passage.text);
  const stroke = useRef<{ pointerId: number; start: number; end: number; hit: string[] } | null>(null);
  const lastStroke = useRef(-Infinity);
  const narrow = useNarrowReader();
  const [panelOpen, setPanelOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [penMode, setPenMode] = useState(() => {
    try { return localStorage.getItem('munjang-note:s-pen') === 'true'; } catch { return false; }
  });
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
  const categories = data.categories.length < 30 && !data.categories.some((item) => item.id === unclassifiedCategory.id)
    ? [...data.categories, unclassifiedCategory] : data.categories;
  const defaultType = categories.find((category) => category.id === unclassifiedCategory.id)?.id ?? categories[0].id;
  const numbers = useMemo(() => new Map(notes.map((note, index) => [note.id, index + 1])), [notes]);
  const sentencePoints = useMemo(() => data.display.sentenceNumbers ? new Map(sentences.map((sentence) => [sentence.start, sentence.number])) : new Map<number, number>(),
    [data.display.sentenceNumbers, sentences]);
  const draftAnchors = draft?.anchors;
  const draftRanges = useMemo(() => (draftAnchors ?? []).filter((anchor) =>
    anchor.attached && passage.text.slice(anchor.start, anchor.end) === anchor.quote), [passage.text, draftAnchors]);
  const parts = useMemo(() => markedParts(passage.text, notes, [
    ...sentencePoints.keys(), ...draftRanges.flatMap((anchor) => [anchor.start, anchor.end]),
  ]), [passage.text, notes, sentencePoints, draftRanges]);

  function remember(range: Range | null) {
    choiceRef.current = range;
    setPending((previous) => previous?.start === range?.start && previous?.end === range?.end ? previous : range);
  }

  function forget() {
    globalThis.getSelection()?.removeAllRanges();
    remember(null);
  }

  function holdPosition(start?: number) {
    if (narrow || start === undefined || !root.current) return;
    const top = topAtSourceOffset(root.current, start);
    if (top !== undefined && top > 65 && top < window.innerHeight - 20) readingPosition.current = { start, top };
  }

  useLayoutEffect(() => {
    const position = readingPosition.current;
    readingPosition.current = undefined;
    if (!position || !root.current) return;
    const top = topAtSourceOffset(root.current, position.start);
    if (top !== undefined) window.scrollBy(0, top - position.top);
  }, [panelOpen]);

  function editNote(note: Annotation, scroll = false, overlap: string[] = []) {
    if (!panelOpen && !scroll) holdPosition(note.anchors.find((anchor) => anchor.attached)?.start);
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
      if (!root.current || penMode) return;
      const selected = readSelection(root.current, passage.text, globalThis.getSelection());
      if (selected) remember(selected);
    }
    globalThis.document.addEventListener('selectionchange', read);
    globalThis.document.addEventListener('pointerup', read);
    return () => {
      globalThis.document.removeEventListener('selectionchange', read);
      globalThis.document.removeEventListener('pointerup', read);
    };
  }, [passage.text, penMode]);

  useLayoutEffect(() => {
    if (lastSource.current === passage.text) return;
    lastSource.current = passage.text;
    clearStroke();
  }, [passage.text]);

  function finishRange(range: Range) {
    const anchor = makeAnchor(passage.text, range, sentences);
    if (linkIndex !== null && revisionText.current !== passage.text) {
      report('원문이 바뀌었어요. 주석을 다시 열고 위치를 확인해 주세요.', true);
      forget();
      return;
    }
    if (!anchor.quote.trim()) return;
    if (!panelOpen) holdPosition(range.start);
    if (linkIndex !== null && draft) {
      setDraft({ ...draft, anchors: draft.anchors.map((oldAnchor, index) => index === linkIndex ? anchor : oldAnchor) });
      setLinkIndex(null);
    } else if (draft && isNew && revisionText.current === passage.text) {
      setDraft({ ...draft, anchors: [anchor] });
    } else {
      originalNote.current = undefined;
      revisionText.current = passage.text;
      setDraft(newNote(passage.id, anchor, defaultType));
      setIsNew(true);
      setCandidates([]);
    }
    setPanelOpen(true);
    forget();
  }

  function clearStroke() {
    const active = stroke.current;
    stroke.current = null;
    if (active && root.current?.hasPointerCapture(active.pointerId)) root.current.releasePointerCapture(active.pointerId);
    forget();
  }

  function togglePen() {
    clearStroke();
    const enabled = !penMode;
    setPenMode(enabled);
    try { localStorage.setItem('munjang-note:s-pen', String(enabled)); } catch { /* Keep the current session preference. */ }
  }

  useEffect(() => {
    if (!penMode) return;
    const area = surface.current;
    function escape(event: KeyboardEvent) { if (event.key === 'Escape' && stroke.current) clearStroke(); }
    function guardScroll(event: TouchEvent) {
      if (stroke.current || (event.target instanceof Element && event.target.closest('.reader-paper'))) {
        if (event.cancelable) event.preventDefault();
      }
    }
    globalThis.document.addEventListener('keydown', escape);
    area?.addEventListener('touchmove', guardScroll, { passive: false, capture: true });
    return () => {
      globalThis.document.removeEventListener('keydown', escape);
      area?.removeEventListener('touchmove', guardScroll, true);
    };
  }, [penMode]);

  function startPen(event: PointerEvent<HTMLElement>) {
    if (!penMode || stroke.current || !acceptsPenStroke(event.pointerType, event.button)) return;
    const start = offsetAtPoint(event.currentTarget, event.clientX, event.clientY);
    if (start === null) return;
    event.preventDefault();
    forget();
    const hit = (event.target as Element).closest<HTMLElement>('[data-note-ids]')?.dataset.noteIds?.split(' ') ?? [];
    stroke.current = { pointerId: event.pointerId, start, end: start, hit };
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
    if (selected) finishRange(selected);
    else if (active.hit.length > 0) openMarks(active.hit);
    else forget();
  }

  function handleMark(event: MouseEvent, ids: string[]) {
    if (penMode || performance.now() - lastStroke.current < 250 || event.detail > 1) return;
    if (!root.current || readSelection(root.current, passage.text, globalThis.getSelection())) return;
    openMarks(ids);
  }

  function openMarks(ids: string[]) {
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
    if (panelOpen) holdPosition(draft?.anchors[0].start);
    setDraft(undefined);
    setIsNew(false);
    setLinkIndex(null);
    setCandidates([]);
    setPanelOpen(false);
  }

  async function saveNote(note: Annotation) {
    const previousNote = originalNote.current;
    await commit((previous) => {
      const latest = previous.documents.find((item) => item.id === passage.id);
      if (!latest || latest.text !== revisionText.current) throw new Error('원문이 바뀌었어요. 지문을 다시 열고 위치를 확인해 주세요.');
      const stored = previous.annotations.find((item) => item.id === note.id);
      if (previousNote && (!stored || stored.updatedAt !== previousNote.updatedAt ||
          JSON.stringify(stored.anchors) !== JSON.stringify(previousNote.anchors))) throw new Error('다른 화면에서 주석이 바뀌었어요. 주석을 다시 열어 주세요.');
      const savedCategories = note.tags.some((tag) => tag.categoryId === unclassifiedCategory.id) &&
          !previous.categories.some((item) => item.id === unclassifiedCategory.id) && previous.categories.length < 30
        ? [...previous.categories, unclassifiedCategory] : previous.categories;
      if (note.tags.some((tag) => !savedCategories.some((category) => category.id === tag.categoryId &&
          (!tag.detailId || category.details.some((detail) => detail.id === tag.detailId))))) throw new Error('현재 분류에 있는 유형을 다시 선택해 주세요.');
      if (note.anchors.some((anchor) => anchor.attached && latest.text.slice(anchor.start, anchor.end) !== anchor.quote)) {
        throw new Error('원문과 주석 위치가 일치하지 않아요.');
      }
      if (previous.annotations.length >= 20_000 && !stored) throw new Error('주석을 20,000개까지 저장할 수 있어요.');
      const updated = { ...note, updatedAt: now() };
      return { ...previous, categories: savedCategories, annotations: stored ? previous.annotations.map((item) => item.id === note.id ? updated : item) : [...previous.annotations, updated] };
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
  const rows = candidates.length ? notes.filter((note) => candidates.includes(note.id)) : [...notes].reverse()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
    {draft ? <NoteEditor key={draft.id} draft={draft} isNew={isNew} categories={categories}
      update={setDraft} save={saveNote} remove={removeNote} formId={noteFormId}
      reselect={(index) => {
        holdPosition(draft.anchors[index].start);
        setLinkIndex(index); setPanelOpen(false); forget();
      }} /> : <>
      {detached.length > 0 && !candidates.length && <div className="unresolved-list"><h3>위치 확인 필요 · {detached.length}개</h3>
        <p>원문 위치를 다시 선택할 주석이 있어요.</p></div>}
      {rows.length ? <ul className="reader-notes">{rows.map((note) => {
        const category = data.categories.find((item) => item.id === note.primaryCategoryId);
        return <li key={note.id}><button type="button" className="reader-note" onClick={() => editNote(note, true, candidates)}>
          <span className="reader-note-top"><span className="small-number">#{numbers.get(note.id)}</span>{category && <CategoryChip category={category} />}
            <ChevronRight size={15} /></span>
          <strong lang="en">{note.anchors[0].quote}</strong>
          {note.fields.comparison.trim() && <span className="reader-note-question">{note.fields.comparison}</span>}
          {note.anchors.some((anchor) => !anchor.attached) && <span className="unresolved-text">위치 확인 필요</span>}
        </button></li>;
      })}</ul> : <Empty title="아직 주석이 없어요" text="원문에서 궁금한 표현을 선택해 보세요." />}
    </>}
  </>;

  return <div className="main-content reader-page">
    <div className="reader-topline">
      <Button variant="ghost" onClick={close}><ArrowLeft size={17} />지문 목록</Button>
      <div className="reader-top-actions">
        <Button aria-label="PDF 출력" title="PDF 출력" onClick={() => print(passage.id)}><FileDown size={17} /><span>PDF 출력</span></Button>
        <Button aria-label="지문 수정" onClick={() => setEditingPassage(passage)}><Pencil size={17} /><span>지문 수정</span></Button>
        <div className="popup-anchor">
          <Button className="icon-button" aria-expanded={menuOpen} aria-label="지문 옵션" onClick={() => setMenuOpen(!menuOpen)}><Settings2 size={17} /></Button>
          {menuOpen && <div className="popup">
            <Button variant="ghost" onClick={() => { setMenuOpen(false); clearStroke(); setKeyboardOpen(true); }}><Keyboard size={17} />키보드로 범위 선택</Button>
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
        <Button className="pen-mode-toggle" aria-pressed={penMode}
          title={penMode ? '왼쪽 띠에서 손가락으로 스크롤' : '펜으로 그어 주석을 추가하기'} onClick={togglePen}>
          <PenLine size={18} /><span>S Pen {penMode ? '켜짐' : '선택'}</span>
        </Button>
      </div>
      <div className="reader-note-tools">
        {!narrow && pending && !penMode && <Button className="toolbar-add" variant="primary"
          onPointerDown={(event) => { if (event.pointerType === 'mouse') event.preventDefault(); }}
          onClick={() => { if (choiceRef.current) finishRange(choiceRef.current); }}><Plus size={18} />{actionLabel}</Button>}
        {linkIndex !== null ? <>
          <span className="retarget-hint" role="status">{penMode ? '새 범위를 그으세요' : '새 범위를 선택하세요'}</span>
          <Button aria-label="범위 다시 선택 취소" onClick={() => { setLinkIndex(null); setPanelOpen(true); forget(); }}>취소</Button>
        </> : <Button aria-expanded={panelOpen} aria-label={panelOpen ? '주석 패널 접기' : '주석 패널 열기'}
          title={panelOpen ? '주석 패널 접기' : '주석 패널 열기'} onClick={() => {
            if (panelOpen) holdPosition(draft?.anchors[0].start);
            setPanelOpen(!panelOpen);
          }}>
          {narrow ? <List size={17} /> : panelOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
          <span className="note-count-label">주석 {notes.length}</span>
        </Button>}
      </div>
    </div>
    <div className={'reader-grid ' + (panelOpen && !narrow ? 'with-panel' : '')}>
      <div ref={surface} className={'reader-surface' + (penMode ? ' palm-guard' : '')}>
        {penMode && <div className="pen-scroll-rail" aria-label="손가락 스크롤 구역" title="손가락으로 위아래 스크롤">
          <span><ChevronsUpDown size={16} />스크롤</span>
        </div>}
        <section className="reader-paper" aria-label="영어 원문" style={{ '--reading-size': data.display.fontSize + 'px' } as React.CSSProperties}
          onPointerDownCapture={(event) => {
            if (penMode && event.pointerType === 'touch') { event.preventDefault(); event.stopPropagation(); }
          }}
          onContextMenu={(event) => { if (penMode) event.preventDefault(); }}>
        <article className={'source-text font-' + data.display.font + (penMode ? ' pen-active' : '')} lang="en"
          ref={root} data-testid="source-text" aria-label="영어 원문 텍스트"
          onPointerDown={startPen} onPointerMove={movePen} onPointerUp={endPen}
          onPointerCancel={(event) => { if (stroke.current?.pointerId === event.pointerId) clearStroke(); }}
          onLostPointerCapture={(event) => { if (stroke.current?.pointerId === event.pointerId) clearStroke(); }}
          onClick={(event) => {
            if (!(event.target as HTMLElement).closest('.annotation-mark') && globalThis.getSelection()?.isCollapsed) remember(null);
          }}>
          {parts.map((part) => {
            const top = part.notes.find((note) => note.id === draft?.id) ?? part.notes[0];
            const category: Category | undefined = top && data.categories.find((item) => item.id === top.primaryCategoryId);
            const sentence = sentencePoints.get(part.start);
            const ids = part.notes.map((note) => note.id);
            const quote = passage.text.slice(part.start, part.end);
            const inDraft = draftRanges.some((range) => range.start <= part.start && part.end <= range.end);
            let marker: string | undefined;
            if (top && category && quote.trim()) {
              const start = top.anchors.some((anchor) => anchor.attached && anchor.start === part.start);
              const multiple = part.notes.length > 1 && part.notes.some((note) => note.anchors.some((anchor) => anchor.attached && anchor.start === part.start));
              if (multiple) marker = '+' + (ids.length - 1);
              else if (start && category.mark === 'number') marker = String(numbers.get(top.id));
              else if (start && category.mark === 'mark') marker = '•';
            }
            return <span key={part.start} data-text-start={part.start} data-text-end={part.end} data-sentence={sentence}
              data-marker={marker} data-note-ids={ids.length ? ids.join(' ') : undefined}
              data-overlap={ids.length > 1 ? ids.length : undefined}
              className={[category && 'annotation-mark mark-' + category.mark, inDraft && 'draft-range'].filter(Boolean).join(' ') || undefined}
              style={category ? colorStyle(category) : undefined}
              role={category && quote.trim() ? 'button' : undefined} tabIndex={category && quote.trim() ? 0 : undefined}
              aria-label={category && quote.trim() ? quote + ' · ' + (ids.length > 1 ? '겹친 주석 ' + ids.length + '개' : category.label + ' 주석') : undefined}
              onClick={category ? (event) => handleMark(event, ids) : undefined}
              onKeyDown={category ? (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                forget();
                openMarks(ids);
              } : undefined}>{quote}</span>;
          })}
        </article>
        </section>
      </div>
      {!narrow && panelOpen && <aside className="reader-panel" aria-label={draft ? '주석 편집' : '지문 주석'}>
        <div className="panel-heading"><h2>{draft ? (isNew ? '새 주석' : '주석 편집') : '지문 주석'}</h2>
          {draft ? <div className="panel-actions">{saveAction}<Button variant="ghost" className="icon-button" aria-label="주석 닫기" onClick={closeForm}><X size={18} /></Button></div> : <span className="count">{notes.length}개</span>}</div>
        <div className="panel-scroll">{panel}</div>
      </aside>}
    </div>
    {narrow && panelOpen && <Modal title={draft ? isNew ? '새 주석' : '주석 편집' : '지문 주석'} actions={saveAction} onClose={closeForm}>
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
        if (passage.text !== updated.text) { closeForm(); forget(); if (count) setPanelOpen(true); }
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
