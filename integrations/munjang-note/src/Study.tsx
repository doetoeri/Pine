import { useMemo, useState } from 'react';
import { ArrowRight, BookOpen, ChevronRight, Copy, Filter } from 'lucide-react';
import {
  emptyFilter, groupByType, learningAnswer, locationLabel, matchingNotes, type CategoryGroup, type Workspace,
} from './model';
import type { Commit } from './storage';
import { buildConfusionPrompt, copyText, currentAIAnswer } from './study-prompt';
import { AIImport } from './AIImport';
import { Button, CategoryChip, Empty, FilterFields, Modal, PageIntro, SearchBox, type Report } from './ui';

type Jump = (documentId: string, noteId: string) => void;
const grouping = [['type', '유형별'], ['document', '지문별']] as const;

export function Study({ data, jump, print, report, commit }: {
  data: Workspace; jump: Jump; print: (filter: typeof emptyFilter) => void; report: Report; commit: Commit;
}) {
  const [filter, setFilter] = useState({ ...emptyFilter });
  const [group, setGroup] = useState<typeof grouping[number][0]>('type');
  const [filterOpen, setFilterOpen] = useState(false);
  const [manualCopy, setManualCopy] = useState('');
  const notes = useMemo(() => matchingNotes(data.annotations, filter, data), [data, filter]);
  const groups: CategoryGroup[] = group === 'type' ? groupByType(notes, data.categories, filter) :
    data.documents.map((item) => ({ key: item.id, label: item.title, notes: notes.filter((note) => note.documentId === item.id) }));
  const docs = useMemo(() => new Map(data.documents.map((document) => [document.id, document])), [data.documents]);
  return <div className="main-content study-page">
    <PageIntro title="모아보기">
      <Button variant="primary" title="지금 보이는 주석으로 AI 질문 만들기" disabled={!notes.length} onClick={async () => {
        const message = buildConfusionPrompt(data, notes);
        if (await copyText(message)) report('AI 프롬프트를 복사했어요. AI에 붙여넣고 받은 JSON 파일을 불러오세요.');
        else setManualCopy(message);
      }}><Copy size={17} />AI 프롬프트 복사</Button>
      <AIImport commit={commit} report={report} />
      <Button onClick={() => print(filter)} disabled={!notes.length}>PDF<ArrowRight size={16} /></Button>
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
          const excerpt = note.fields.comparison || note.fields.question || note.fields.confusion || learningAnswer(note)[0]?.[1] || note.fields.memo;
          const ai = currentAIAnswer(note);
          return <li key={note.id}><button className="study-row" type="button" onClick={() => jump(note.documentId, note.id)}>
            <span className="study-row-content">
              <strong lang="en">{note.anchors.map((anchor) => anchor.quote).join(' · ')}</strong>
              {excerpt && <span className="study-excerpt">{excerpt}</span>}
              <small><BookOpen size={14} aria-hidden="true" />{document?.title} · {locationLabel(note.anchors[0])}</small>
            </span>
            <span className="study-row-aside">{group !== 'type' && category && <CategoryChip category={category} />}
              {ai && <span className="ai-status">AI 답변 있음</span>}</span>
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
