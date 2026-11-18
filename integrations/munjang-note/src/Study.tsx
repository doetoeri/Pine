import { useMemo, useState } from 'react';
import { ArrowRight, BookOpen, ChevronRight, Copy, Eye, Filter, Flag, Layers2, RotateCcw, X } from 'lucide-react';
import {
  applyReview, emptyFilter, GRADE_LABELS, groupByType, learningAnswer, locationLabel, matchingNotes, passageSource,
  PRIORITIES, PRIORITY_LABELS, reviewHistory, reviewOrder, STATES, STATE_LABELS,
  type Annotation, type CategoryGroup, type Grade, type Workspace,
} from './model';
import type { Commit } from './storage';
import { buildConfusionPrompt, copyText } from './study-prompt';
import { Button, CategoryChip, Empty, FilterFields, Modal, PageIntro, SearchBox, StatePill, reportError, type Report } from './ui';

type Jump = (documentId: string, noteId: string) => void;
const grouping = [['type', '유형별'], ['document', '지문별'], ['state', '학습 상태별'], ['priority', '중요도별']] as const;

export function Study({ data, jump, print, report }: { data: Workspace; jump: Jump; print: (filter: typeof emptyFilter) => void; report: Report }) {
  const [filter, setFilter] = useState({ ...emptyFilter });
  const [group, setGroup] = useState<typeof grouping[number][0]>('type');
  const [filterOpen, setFilterOpen] = useState(false);
  const [manualCopy, setManualCopy] = useState('');
  const notes = useMemo(() => matchingNotes(data.annotations, filter, data), [data, filter]);
  const groups: CategoryGroup[] = group === 'type' ? groupByType(notes, data.categories, filter) :
    group === 'document' ? data.documents.map((item) => ({ key: item.id, label: item.title, notes: notes.filter((note) => note.documentId === item.id) })) :
      group === 'state' ? STATES.map((state) => ({ key: state, label: STATE_LABELS[state], notes: notes.filter((note) => note.state === state) })) :
        [...PRIORITIES].reverse().map((priority) => ({ key: priority, label: PRIORITY_LABELS[priority], notes: notes.filter((note) => note.priority === priority) }));
  const docs = useMemo(() => new Map(data.documents.map((document) => [document.id, document])), [data.documents]);
  return <div className="main-content study-page">
    <PageIntro title="유형별 모아보기">
      <Button onClick={() => print(filter)} disabled={!notes.length}>PDF<ArrowRight size={16} /></Button>
      <Button variant="primary" title="지금 보이는 주석으로 AI 질문 만들기" disabled={!notes.length} onClick={async () => {
        const message = buildConfusionPrompt(data, notes);
        if (await copyText(message)) report('주석 ' + notes.length + '개의 AI 질문을 복사했어요.');
        else setManualCopy(message);
      }}><Copy size={17} />AI 프롬프트 복사</Button>
    </PageIntro>
    <div className="study-tools">
      <SearchBox value={filter.query} onChange={(query) => setFilter({ ...filter, query })} placeholder="표현이나 메모 검색" />
      <Button aria-expanded={filterOpen} aria-controls="study-filters" onClick={() => setFilterOpen(!filterOpen)}>
        <Filter size={16} />필터{Object.entries(filter).some(([key, value]) => key !== 'query' && value) ? ' 적용 중' : ''}
      </Button>
    </div>
    {filterOpen && <div id="study-filters"><FilterFields filter={filter} onChange={setFilter} data={data} /></div>}
    <div className="study-results-heading">
      <div className="segmented" aria-label="주석 묶는 기준">{grouping.map(([key, label]) =>
        <Button key={key} variant="ghost" aria-pressed={group === key} onClick={() => setGroup(key)}>{label}</Button>)}</div>
      <span className="count">{notes.length}개 주석</span>
    </div>
    {notes.length === 0 && <Empty title="조건에 맞는 주석이 없어요" text="필터를 바꾸거나 지문에 새 주석을 달아 보세요." />}
    <div className="study-groups">{groups.filter((item) => item.notes.length).map((item) =>
      <section className="study-group" aria-labelledby={'group-' + item.key} key={item.key}>
        <header>
          {item.category && <CategoryChip category={item.category} />}
          <h2 id={'group-' + item.key}>{item.label}</h2><span className="count">{item.notes.length}</span>
        </header>
        <ul>{item.notes.map((note) => {
          const document = docs.get(note.documentId);
          const category = data.categories.find((category) => category.id === note.primaryCategoryId);
          const excerpt = note.fields.takeaway ? '구분 방법 · ' + note.fields.takeaway
            : note.fields.comparison ? '헷갈리는 표현 · ' + note.fields.comparison
              : learningAnswer(note)[0]?.[1] || note.fields.memo || note.fields.confusion;
          return <li key={note.id}><button className="study-row" type="button" onClick={() => jump(note.documentId, note.id)}>
            <span className="study-row-content">
              <strong lang="en">{note.anchors.map((anchor) => anchor.quote).join(' · ')}</strong>
              {excerpt && <span className="study-excerpt">{excerpt}</span>}
              <small><BookOpen size={14} aria-hidden="true" />{document?.title} · {locationLabel(note.anchors[0])}</small>
            </span>
            <span className="study-row-aside">{group !== 'type' && category && <CategoryChip category={category} />}<StatePill state={note.state} /></span>
            <ChevronRight size={17} aria-hidden="true" />
          </button></li>;
        })}</ul>
      </section>)}</div>
    {manualCopy && <Modal title="AI 프롬프트" onClose={() => setManualCopy('')} wide>
      <div className="modal-body field-stack">
        <p>내용을 복사해 원하는 AI 채팅에 붙여넣으세요.</p>
        <textarea className="prompt-copy-text" rows={9} readOnly autoFocus aria-label="복사할 AI 프롬프트" value={manualCopy}
          onFocus={(event) => event.currentTarget.select()} />
      </div>
    </Modal>}
  </div>;
}

export function Review({ data, jump, report, commit }: { data: Workspace; jump: Jump; report: Report; commit: Commit }) {
  const [filter, setFilter] = useState({ ...emptyFilter });
  const [weak, setWeak] = useState(false);
  const [session, setSession] = useState<string[]>();
  const [result, setResult] = useState<Grade[]>([]);
  const [step, setStep] = useState(0);
  const history = useMemo(() => reviewHistory(data.reviews), [data.reviews]);
  const errors = useMemo(() => new Set([...history].filter(([, records]) => records.filter((record) => record.grade !== 'correct').length >= 2).map(([id]) => id)),
    [history]);
  const found = matchingNotes(data.annotations, filter, data).filter((note) => !weak || errors.has(note.id));
  const ordered = reviewOrder(found, history);
  const note = session && data.annotations.find((note) => note.id === session[step]);
  const done = session && step >= session.length;
  const correct = result.filter((item) => item === 'correct').length;

  return <div className="main-content review-page">
    <PageIntro context="인출 연습" title="복습" subtitle="답을 보기 전에 뜻이나 규칙, 판별 근거를 말해 보세요.">
      {session && <Button onClick={() => setSession(undefined)}><X size={17} />{done ? '복습 설정' : '복습 그만하기'}</Button>}
    </PageIntro>
    {!session && <>
      <FilterFields filter={filter} onChange={setFilter} data={data} />
      <div className="review-setup">
        <label className="plain-check"><input type="checkbox" checked={weak} onChange={(event) => setWeak(event.target.checked)} /><Flag size={16} />기억나지 않음·헷갈림을 2회 이상 기록한 주석</label>
        <div className="review-start"><div><strong>{ordered.length}</strong>개 카드 <span>· 복습 기록 {data.reviews.length}회</span></div>
          <Button variant="primary" disabled={!ordered.length} onClick={() => { setSession(ordered.map((note) => note.id)); setStep(0); setResult([]); }}>
            복습 시작<ArrowRight size={18} /></Button></div>
      </div>
      {ordered.length === 0 && <Empty title="복습할 주석이 없어요" text="필터를 바꾸거나 지문에 주석을 달아 보세요." />}
      {ordered.length > 0 && <section className="review-queue"><h2><Layers2 size={19} />복습 순서</h2>
        <ul>{ordered.slice(0, 8).map((note) => <li key={note.id}>
          <button className="review-queue-row" type="button" onClick={() => jump(note.documentId, note.id)}>
            <strong lang="en">{note.anchors[0].quote}</strong><span>{history.get(note.id)?.length ?? 0}회 복습</span><ChevronRight size={17} />
          </button>
        </li>)}</ul></section>}
    </>}
    {session && done && <section className="review-summary">
      <RotateCcw size={28} aria-hidden="true" /><h2>복습을 마쳤어요</h2>
      <p>자기평가 {result.length}개 · 정확히 기억함 {correct}개</p>
      <Button variant="primary" onClick={() => setSession(undefined)}>복습 목록으로<ArrowRight size={17} /></Button>
    </section>}
    {session && !done && (note ? <ReviewCard key={note.id} note={note} data={data} index={step} total={session.length} jump={jump}
      skip={() => setStep(step + 1)} grade={async (grade) => {
        try {
          await commit((previous) => {
            const active = previous.annotations.find((item) => item.id === note.id);
            if (!active || active.updatedAt !== note.updatedAt) throw new Error('카드 내용이 바뀌었어요. 답을 확인한 뒤 다시 평가해 주세요.');
            if (previous.reviews.length >= 100_000) throw new Error('복습 기록의 저장 한도에 도달했어요.');
            return applyReview(previous, note.id, grade);
          });
          setResult((previous) => [...previous, grade]); setStep(step + 1);
        } catch (error) { reportError(report, error); }
      }} /> : <Empty title="주석이 삭제되었어요"><Button onClick={() => setStep(step + 1)}>다음 카드</Button></Empty>)}
  </div>;
}

function ReviewCard({ note, data, index, total, jump, skip, grade }: {
  note: Annotation; data: Workspace; index: number; total: number; jump: Jump; skip: () => void; grade: (grade: Grade) => Promise<void>;
}) {
  const [show, setShow] = useState(false);
  const [explained, setExplained] = useState(false);
  const [busy, setBusy] = useState(false);
  const category = data.categories.find((category) => category.id === note.primaryCategoryId);
  const document = data.documents.find((item) => item.id === note.documentId);
  const answer = learningAnswer(note);
  const prompt = note.fields.question.trim() || note.fields.confusion.trim() || (category?.id === 'vocab' ?
    '이 표현의 문맥상 뜻을 설명해 보세요.' : '이 표현을 어떻게 해석하거나 판별하는지 설명해 보세요.');
  return <section className="review-card" aria-label="복습 카드">
    <div className="review-card-top">{category && <CategoryChip category={category} />}
      <span>{index + 1} / {total}</span></div>
    <progress value={index + 1} max={total} aria-label="복습 진행률" />
    <h2 lang="en">{note.anchors.map((anchor) => anchor.quote).join(' · ')}</h2>
    <p className="review-prompt">{prompt}</p>
    <div className="review-source"><Button variant="ghost" onClick={() => jump(note.documentId, note.id)}><BookOpen size={16} />{document?.title ?? '원문에서 보기'}</Button>
      {document && <span>{passageSource(document)}</span>}</div>
    {!show && <div className="review-buttons"><Button onClick={skip}>건너뛰기</Button><Button variant="primary" onClick={() => setShow(true)}><Eye size={18} />정답 확인</Button></div>}
    {show && <div className="shown-answer">
      {answer.length ? <dl>{answer.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl> :
        <p>저장한 해설이 없어요. 원문에서 주석을 열어 해설을 추가할 수 있어요.</p>}
      {answer.length > 0 && <label className="plain-check"><input type="checkbox" checked={explained}
        onChange={(event) => setExplained(event.target.checked)} />답과 판단 근거를 혼자 설명했어요.</label>}
      <div className="grade-buttons">{(['forgot', 'uncertain', 'correct'] as const).map((item) =>
        <Button key={item} variant={item === 'correct' ? 'primary' : 'secondary'} disabled={busy || (item === 'correct' && !explained)}
          onClick={async () => { setBusy(true); try { await grade(item); } finally { setBusy(false); } }}>{GRADE_LABELS[item]}</Button>)}</div>
    </div>}
  </section>;
}
