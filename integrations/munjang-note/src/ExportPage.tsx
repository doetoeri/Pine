import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { BookOpenText, ChevronLeft, ChevronRight, Download, FileDown, FileText, Layers3, NotebookPen, SlidersHorizontal } from 'lucide-react';
import { emptyFilter, matchingNotes, type ExportSettings, type Filter, type Workspace } from './model';
import type { GeneratedPDF } from './pdf';
import { download, type Commit } from './storage';
import { Button, Field, FilterFields, PageIntro, reportError, type Report } from './ui';

const modes = [
  { id: 'passages', name: '지문별 분석집', icon: BookOpenText },
  { id: 'types', name: '혼동 유형별 정리집', icon: Layers3 },
  { id: 'quiz', name: '복습 시험지', icon: NotebookPen },
] as const;
type Loaded = { pdf: GeneratedPDF; data: Workspace; key: string };

export function ExportPage({ data, commit, report, initialFilter = emptyFilter, initialMode }: {
  data: Workspace; commit: Commit; report: Report; initialFilter?: Filter; initialMode?: ExportSettings['mode'];
}) {
  const [options, setOptions] = useState<ExportSettings>(() => ({ ...data.exportSettings, mode: initialMode ?? data.exportSettings.mode }));
  const [filter, setFilter] = useState({ ...initialFilter });
  const [excludedDocuments, setExcludedDocuments] = useState(new Set<string>());
  const [excludedNotes, setExcludedNotes] = useState(new Set<string>());
  const [loaded, setLoaded] = useState<Loaded>();
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const docs = useMemo(() => data.documents.filter((item) => !filter.documentId || filter.documentId === item.id)
    .sort((a, b) => a.title.localeCompare(b.title)), [data.documents, filter.documentId]);
  const selectedDocs = docs.filter((item) => !excludedDocuments.has(item.id));
  const docIds = new Set(selectedDocs.map((item) => item.id));
  const notes = matchingNotes(data.annotations, filter, data).filter((note) => options.mode !== 'passages' || docIds.has(note.documentId));
  const selectedNotes = notes.filter((note) => !excludedNotes.has(note.id));
  const key = JSON.stringify([options, filter, selectedDocs.map((item) => item.id), selectedNotes.map((item) => item.id)]);
  const preview = loaded?.data.documents === data.documents && loaded.data.annotations === data.annotations &&
    loaded.data.categories === data.categories && loaded.key === key ? loaded.pdf : undefined;
  const activeMode = modes.find((item) => item.id === options.mode) ?? modes[0];
  const any = options.mode === 'passages' ? selectedDocs.length > 0 : selectedNotes.length > 0;
  const title = activeMode.name;
  const set = <K extends keyof ExportSettings,>(property: K, value: ExportSettings[K]) => setOptions((previous) => ({ ...previous, [property]: value }));

  async function output(save: boolean) {
    if (busyRef.current || !any) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const pdf = preview ?? await (async () => {
        const engine = await import('./pdf');
        if (options.mode === 'quiz' && !engine.quizItems(data, selectedNotes).length) {
          throw new Error('빈칸으로 만들 수 있는 위치가 없어요. 주석에 복습 질문이나 해설을 적어 주세요.');
        }
        return engine.generatePDF(data, selectedDocs, selectedNotes, options, undefined, filter);
      })();
      if (!preview) { setLoaded({ pdf, data, key }); setPage(0); }
      if (save) {
        const filename = '문장노트_' + title.replaceAll(' ', '_') + '.pdf';
        download(new Blob([pdf.bytes], { type: 'application/pdf' }), filename);
        report('PDF ' + pdf.pages.length + '쪽을 다운로드했어요.');
      }
      if (JSON.stringify(data.exportSettings) !== JSON.stringify(options)) {
        try { await commit((previous) => ({ ...previous, exportSettings: options })); }
        catch (error) { reportError(report, error); }
      }
    } catch (error) { reportError(report, error); }
    finally { busyRef.current = false; setBusy(false); }
  }

  function toggle(id: string, group: 'notes' | 'documents', checked: boolean) {
    const change = group === 'notes' ? setExcludedNotes : setExcludedDocuments;
    change((previous) => {
      const items = new Set(previous);
      if (checked) items.delete(id);
      else items.add(id);
      return items;
    });
  }

  const checks: Array<[keyof Pick<ExportSettings, 'color' | 'explanations' | 'numbers' | 'pages' | 'titles' | 'sources' | 'memo'>, string]> = [
    ['color', '컬러 인쇄'], ['explanations', '해설 포함'], ['numbers', '주석 번호'], ['pages', '페이지 번호'],
    ['titles', '지문 제목'], ['sources', '출처 표시'], ['memo', '메모 공간 추가'],
  ];

  return <div className="main-content export-page">
    <PageIntro context="학습 자료" title="PDF 출력" subtitle="표시할 지문과 주석을 고른 뒤 A4 자료로 저장하세요.">
      <Button variant="primary" onClick={() => output(true)} disabled={!any || busy}><Download size={18} />PDF 다운로드</Button>
    </PageIntro>
    <div className="export-modes" aria-label="PDF 출력 모드">{modes.map(({ id, name, icon: Icon }) =>
      <Button variant="secondary" aria-pressed={options.mode === id} key={id} onClick={() => set('mode', id)}><Icon size={18} />{name}</Button>)}</div>
    <div className="export-grid">
      <div className="export-controls">
        <section className="export-card" aria-labelledby="print-range-title">
          <h2 id="print-range-title"><FileText size={18} />출력 범위</h2>
          <details className="form-details print-filter"><summary>지문과 주석 필터</summary>
            <FilterFields data={data} filter={filter} onChange={setFilter} />
            {filter.query && <div className="print-search-context">검색어 ‘{filter.query}’ 적용 중 <Button variant="ghost"
              onClick={() => setFilter({ ...filter, query: '' })}>검색어 지우기</Button></div>}
          </details>
          {options.mode === 'passages' && <details className="form-details"><summary>지문 선택 ({selectedDocs.length}/{docs.length})</summary>
            <Choices items={docs.map((item) => ({ id: item.id, label: item.title }))} excluded={excludedDocuments}
              all={() => setExcludedDocuments(new Set())} none={() => setExcludedDocuments(new Set(docs.map((item) => item.id)))}
              toggle={(id, checked) => toggle(id, 'documents', checked)} />
          </details>}
          <details className="form-details"><summary>주석 선택 ({selectedNotes.length}/{notes.length})</summary>
            <Choices items={notes.map((item) => ({ id: item.id, label: item.anchors[0].quote }))} excluded={excludedNotes}
              all={() => setExcludedNotes(new Set())} none={() => setExcludedNotes(new Set(notes.map((item) => item.id)))}
              toggle={(id, checked) => toggle(id, 'notes', checked)} />
          </details>
          <p>{options.mode === 'passages' ? '지문 ' + selectedDocs.length + '개 · ' : ''}주석 {selectedNotes.length}개 선택</p>
        </section>
        <section className="export-card" aria-labelledby="print-settings-title">
          <h2 id="print-settings-title"><SlidersHorizontal size={18} />용지와 표시</h2>
          <div className="form-grid">
            <Field label="용지"><input readOnly value="A4" /></Field>
            <Field label="방향"><select value={options.orientation} onChange={(event) => set('orientation', event.target.value as ExportSettings['orientation'])}>
              <option value="portrait">세로</option><option value="landscape">가로</option></select></Field>
            <Field label="글자 크기"><select value={options.size} onChange={(event) => set('size', Number(event.target.value))}>
              {Array.from({ length: 14 }, (_, i) => <option key={i} value={9 + i}>{9 + i} pt</option>)}</select></Field>
            <Field label="줄 간격"><select value={options.lineSpacing} onChange={(event) => set('lineSpacing', Number(event.target.value))}>
              {[...new Set([1.2, 1.4, 1.65, 1.8, 2, 2.2, 2.4, options.lineSpacing])].sort((a, b) => a - b).map((value) => <option key={value} value={value}>{value.toFixed(value === 1.65 ? 2 : 1)} 배</option>)}</select></Field>
            <Field label="문단 간격"><input type="number" min={4} max={32} value={options.paragraphSpacing}
              onChange={(event) => set('paragraphSpacing', Math.min(32, Math.max(4, Math.round(Number(event.target.value)))))} /></Field>
            <Field label="여백 (mm)"><input type="number" min={12} max={32} value={options.margin}
              onChange={(event) => set('margin', Math.min(32, Math.max(12, Math.round(Number(event.target.value)))))} /></Field>
          </div>
          <Field label="강조 표시"><select value={options.marks} onChange={(event) => set('marks', event.target.value as ExportSettings['marks'])}>
            <option value="full">형광펜과 밑줄 포함</option><option value="underline">밑줄만 표시</option></select></Field>
          <div className="print-checks">{checks.map(([item, label]) => <label className="plain-check" key={item}>
            <input type="checkbox" checked={options[item]} onChange={(event) => set(item, event.target.checked)} />{label}</label>)}</div>
          {options.mode === 'quiz' && <div className="quiz-options">
            <Field label="정답 배치"><select value={options.answerMode} onChange={(event) => set('answerMode', event.target.value as ExportSettings['answerMode'])}>
              <option value="none">문제지만 출력</option><option value="inline">문제 아래에 정답</option><option value="separate">별도 페이지에 정답</option>
            </select></Field>
            <label className="plain-check"><input type="checkbox" checked={options.answerSpace}
              onChange={(event) => set('answerSpace', event.target.checked)} />답안 작성 공간</label>
          </div>}
        </section>
      </div>
      <section className="preview-panel" aria-labelledby="preview-title">
        <header className="preview-top"><h2 id="preview-title">미리보기</h2>
          <Button onClick={() => output(false)} disabled={!any || busy}><FileDown size={16} />{busy ? 'PDF 만드는 중…' : '미리보기 생성'}</Button>
        </header>
        {preview ? <>
          <div className="preview-frame"><PDFPreview pdf={preview} page={page} /></div>
          <div className="preview-nav">
            <Button variant="ghost" className="icon-button" aria-label="이전 페이지" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft size={20} /></Button>
            <span aria-live="polite">{page + 1} / {preview.pages.length}쪽</span>
            <Button variant="ghost" className="icon-button" aria-label="다음 페이지" disabled={page + 1 >= preview.pages.length} onClick={() => setPage(page + 1)}><ChevronRight size={20} /></Button>
          </div>
        </> : <div className="preview-placeholder">
          <div className="preview-sample" aria-hidden="true"><FileText size={43} strokeWidth={1.35} /><span>A4</span></div>
          <h3>{title}</h3><p>{any ? '페이지 나눔과 표시를 확인하려면 미리보기를 생성하세요.' : '출력할 지문 또는 주석을 선택하세요.'}</p>
        </div>}
      </section>
    </div>
  </div>;
}

function Choices({ items, excluded, all, none, toggle }: {
  items: Array<{ id: string; label: string }>; excluded: Set<string>; all: () => void; none: () => void;
  toggle: (id: string, checked: boolean) => void;
}) {
  return <><div className="choice-actions"><Button variant="ghost" onClick={all}>전체 선택</Button><Button variant="ghost" onClick={none}>전체 해제</Button></div>
    <div className="choice-list">{items.map((item) => <label className="plain-check" key={item.id}>
      <input type="checkbox" checked={!excluded.has(item.id)} onChange={(event) => toggle(item.id, event.target.checked)} />
      <span>{item.label}</span>
    </label>)}</div></>;
}

function PDFPreview({ pdf, page }: { pdf: GeneratedPDF; page: number }) {
  const { width, height, pages } = pdf;
  const contents = pages[page] ?? pages[0];
  return <div className="pdf-paper" style={{ aspectRatio: width + ' / ' + height }} aria-label={'PDF ' + (page + 1) + '쪽'}>
    {contents.text.map((item, i) => <span key={i} className={item.mark ? 'mark-' + item.mark : ''}
      style={{ left: item.x / width * 100 + '%', top: (height - item.y - item.size * 1.07) / height * 100 + '%',
        fontSize: item.size / width * 100 + 'cqw', '--category': item.color, color: item.ink } as CSSProperties}>{item.text}</span>)}
    {contents.rules.map((rule, i) => <div key={i} className="preview-rule"
      style={{ left: rule.x / width * 100 + '%', top: (height - rule.y) / height * 100 + '%', width: rule.width / width * 100 + '%' }} />)}
  </div>;
}
