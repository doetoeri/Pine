import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Download, HardDrive, Pencil, Plus, Smartphone, Trash2, Upload, X } from 'lucide-react';
import {
  blankWorkspace, buildBackup, defaultCategories, MARK_LABELS, MARKS, now, parseBackup, uid,
  type Category, type DisplaySettings, type Workspace,
} from './model';
import { download, type Commit } from './storage';
import { Button, CategoryChip, Field, Modal, PageIntro, reportError, type Report } from './ui';

export interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function Settings({ data, commit, report, installAvailable, install }: {
  data: Workspace; commit: Commit; report: Report; installAvailable: boolean; install: () => Promise<void>;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [restore, setRestore] = useState<Workspace>();
  const [clearing, setClearing] = useState(false);
  const [category, setCategory] = useState<Category>();
  const [busy, setBusy] = useState(false);
  const exportBackup = () => {
    const filename = '문장노트_백업_' + new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }) + '.json';
    download(new Blob([buildBackup(data)], { type: 'application/json;charset=utf-8' }), filename);
    report('JSON 백업을 다운로드했어요.');
  };
  async function change<K extends keyof DisplaySettings>(key: K, value: DisplaySettings[K]) {
    try { await commit((previous) => ({ ...previous, display: { ...previous.display, [key]: value } })); }
    catch (error) { reportError(report, error); }
  }
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = '';
    if (!selected) return;
    try {
      if (selected.size > 36_000_000) throw new Error('읽을 수 있는 백업 크기를 초과했어요.');
      setRestore(parseBackup(await selected.text()));
    } catch (error) { reportError(report, error); }
  }
  return <div className="main-content settings-page">
    <PageIntro context="학습 환경" title="설정" />
    <section className="settings-card" aria-labelledby="reading-settings-title">
      <h2 id="reading-settings-title">원문 보기</h2>
      <div className="form-grid">
        <Field label="영문 글꼴"><select value={data.display.font} onChange={(event) => change('font', event.target.value as DisplaySettings['font'])}>
          <option value="serif">세리프</option><option value="sans">산세리프</option>
        </select></Field>
        <Field label="원문 글자 크기"><select value={data.display.fontSize} onChange={(event) => change('fontSize', Number(event.target.value))}>
          {Array.from({ length: 17 }, (_, i) => <option key={i} value={16 + i}>{16 + i} px</option>)}
        </select></Field>
      </div>
      <label className="plain-check"><input type="checkbox" checked={data.display.sentenceNumbers} onChange={(event) => change('sentenceNumbers', event.target.checked)} />문장 번호 표시</label>
      <p className={'font-preview font-' + data.display.font} lang="en" style={{ fontSize: data.display.fontSize }}>Small details change how we read.</p>
    </section>
    <section className="settings-card" aria-labelledby="category-settings-title">
      <div className="settings-heading"><div><h2 id="category-settings-title">유형과 표시</h2><p>색상, 강조 모양, 세부 유형을 편집하세요.</p></div>
        <Button disabled={data.categories.length >= 30} onClick={() => setCategory({ id: uid(), label: '', color: '#734d97', mark: 'underline', details: [] })}><Plus size={17} />유형 추가</Button></div>
      <ul className="settings-list">{data.categories.map((item) => <li key={item.id}><span><CategoryChip category={item} />
        <small>{MARK_LABELS[item.mark]} · 세부 유형 {item.details.length}개</small></span>
        <Button aria-label={item.label + ' 편집'} onClick={() => setCategory(item)}><Pencil size={15} />편집</Button></li>)}</ul>
    </section>
    <section className="settings-card" aria-labelledby="backup-title">
      <div className="settings-heading"><div><h2 id="backup-title"><HardDrive size={20} />데이터 백업</h2>
        <p>지문, 주석, 복습 기록은 현재 브라우저에 저장돼요. 다른 기기로 옮기려면 JSON을 다운로드하세요.</p></div></div>
      <div className="backup-actions">
        <Button variant="primary" onClick={exportBackup}><Download size={17} />JSON 다운로드</Button>
        <Button onClick={() => file.current?.click()}><Upload size={17} />JSON 불러오기</Button>
        <input className="sr-only" ref={file} type="file" accept=".json,application/json" aria-label="백업 JSON 파일" onChange={upload} tabIndex={-1} />
      </div>
      <Button variant="ghost" className="delete-icon" onClick={() => setClearing(true)}><Trash2 size={16} />전체 데이터 삭제</Button>
    </section>
    <section className="settings-card" aria-labelledby="install-title">
      <h2 id="install-title"><Smartphone size={20} />홈 화면에서 열기</h2>
      <p>Chrome 메뉴에서 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 선택할 수 있어요. 앱을 처음 연 뒤에는 오프라인에서도 학습할 수 있어요.</p>
      {installAvailable && <Button onClick={install}>앱 설치</Button>}
    </section>
    {category && <CategoryEditor current={category} data={data} commit={commit} close={() => setCategory(undefined)} report={report} />}
    {restore && <Modal title="JSON 백업 복원" onClose={() => setRestore(undefined)}><div className="modal-body">
      <p>지문 {restore.documents.length}개, 주석 {restore.annotations.length}개, 복습 기록 {restore.reviews.length}회를 확인했어요.</p>
      <p>복원하면 이 브라우저의 현재 지문, 주석, 복습 기록, 설정이 백업 파일 내용으로 바뀝니다.</p>
      <Button onClick={exportBackup}><Download size={16} />현재 데이터 먼저 백업</Button>
      <div className="form-actions"><Button onClick={() => setRestore(undefined)} disabled={busy}>취소</Button>
        <Button variant="primary" disabled={busy} onClick={async () => {
          setBusy(true);
          try { await commit(() => restore); setRestore(undefined); report('백업을 복원했어요.'); }
          catch (error) { reportError(report, error); } finally { setBusy(false); }
        }}>백업 복원</Button></div>
    </div></Modal>}
    {clearing && <Modal title="전체 데이터 삭제" onClose={() => setClearing(false)}><div className="modal-body">
      <p>이 브라우저에 저장한 지문, 주석과 복습 기록을 모두 삭제하고 설정을 초기화할까요?</p>
      <Button onClick={exportBackup}><Download size={16} />현재 데이터 백업</Button>
      <div className="form-actions"><Button onClick={() => setClearing(false)} disabled={busy}>취소</Button>
        <Button variant="danger" disabled={busy} onClick={async () => {
          setBusy(true);
          try { await commit(() => blankWorkspace()); setClearing(false); report('저장한 데이터를 삭제했어요.'); }
          catch (error) { reportError(report, error); } finally { setBusy(false); }
        }}>전체 데이터 삭제</Button></div>
    </div></Modal>}
  </div>;
}

function CategoryEditor({ current, data, close, commit, report }: {
  current: Category; data: Workspace; close: () => void; commit: Commit; report: Report;
}) {
  const [draft, setDraft] = useState(current);
  const [detail, setDetail] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const exists = data.categories.some((item) => item.id === current.id);
  const attached = data.annotations.filter((note) => note.tags.some((tag) => tag.categoryId === current.id)).length;
  const custom = !defaultCategories.some((item) => item.id === current.id);
  function addDetail() {
    if (!detail.trim() || draft.details.length >= 300) return;
    if (draft.details.some((item) => item.label.trim() === detail.trim())) { setError('같은 이름의 세부 유형이 있어요.'); return; }
    setDraft({ ...draft, details: [...draft.details, { id: uid(), label: detail.trim() }] });
    setDetail('');
    setError('');
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const name = draft.label.trim();
    const details = draft.details.map((item) => ({ ...item, label: item.label.trim() }));
    if (!name || details.some((item) => !item.label)) { setError('유형 이름을 입력해 주세요.'); return; }
    if (new Set(details.map((item) => item.label)).size !== details.length) { setError('같은 이름의 세부 유형이 있어요.'); return; }
    setBusy(true);
    try {
      await commit((previous) => {
        if (previous.categories.some((item) => item.id !== draft.id && item.label === name)) throw new Error('같은 이름의 유형이 있어요.');
        if (exists && !previous.categories.some((item) => item.id === draft.id)) throw new Error('유형을 다시 열어 주세요.');
        if (!exists && previous.categories.length >= 30) throw new Error('유형은 30개까지 만들 수 있어요.');
        const next = { ...draft, label: name, details };
        const ids = new Set(details.map((item) => item.id));
        const annotations = previous.annotations.map((note) => {
          if (!note.tags.some((tag) => tag.categoryId === next.id && tag.detailId && !ids.has(tag.detailId))) return note;
          const tags = note.tags.map((tag) => tag.categoryId === next.id && tag.detailId && !ids.has(tag.detailId) ? { ...tag, detailId: '' } : tag);
          return { ...note, tags: [...new Map(tags.map((tag) => [tag.categoryId + ':' + tag.detailId, tag])).values()], updatedAt: now() };
        });
        return { ...previous, annotations, categories: exists ? previous.categories.map((item) => item.id === next.id ? next : item) : [...previous.categories, next] };
      });
      close(); report('유형 설정을 저장했어요.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '설정을 저장할 수 없어요.'); }
    finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true);
    try {
      await commit((previous) => {
        const categories = previous.categories.filter((item) => item.id !== current.id);
        if (!categories.length) throw new Error('유형은 한 개 이상 필요해요.');
        return { ...previous, categories, annotations: previous.annotations.map((note) => {
          if (!note.tags.some((tag) => tag.categoryId === current.id)) return note;
          const remaining = note.tags.filter((tag) => tag.categoryId !== current.id);
          const tags = remaining.length ? remaining : [{ categoryId: categories[0].id, detailId: '' }];
          return { ...note, tags, primaryCategoryId: note.primaryCategoryId === current.id ? tags[0].categoryId : note.primaryCategoryId, updatedAt: now() };
        }) };
      });
      close(); report('유형을 삭제했어요.');
    } catch (error) { reportError(report, error); } finally { setBusy(false); }
  }

  return <Modal title={exists ? '유형 편집' : '새 혼동 유형'} onClose={close} wide><form className="modal-body field-stack" onSubmit={save}>
    <Field label="대분류 이름"><input autoFocus value={draft.label} required maxLength={200} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></Field>
    <div className="form-grid">
      <Field label="표시 색상"><input type="color" value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value })} /></Field>
      <Field label="표시 형태"><select value={draft.mark} onChange={(event) => setDraft({ ...draft, mark: event.target.value as Category['mark'] })}>
        {MARKS.map((mark) => <option key={mark} value={mark}>{MARK_LABELS[mark]}</option>)}
      </select></Field>
    </div>
    <div><CategoryChip category={draft}>{draft.label || '유형 미리보기'}</CategoryChip></div>
    <div className="form-details">
      <h3>세부 유형</h3>
      <p className="field-hint">삭제한 세부 유형의 주석은 같은 대분류에 남아요.</p>
      <div className="scope-form">
        <Field label="새 세부 유형"><input maxLength={200} value={detail} onChange={(event) => setDetail(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addDetail(); } }} /></Field>
        <Button disabled={!detail.trim() || draft.details.length >= 300} onClick={addDetail}><Plus size={17} />추가</Button>
      </div>
      <ul className="detail-list">{draft.details.map((item, index) => <li key={item.id}>
        <input aria-label={'세부 유형 ' + (index + 1)} value={item.label} required maxLength={200}
          onChange={(event) => setDraft({ ...draft, details: draft.details.map((detail) => detail.id === item.id ? { ...detail, label: event.target.value } : detail) })} />
        <Button className="icon-button" variant="ghost" aria-label={item.label + ' 세부 유형 삭제'}
          onClick={() => setDraft({ ...draft, details: draft.details.filter((detail) => detail.id !== item.id) })}><X size={17} /></Button>
      </li>)}</ul>
    </div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {confirmDelete && <div className="inline-confirm"><p>이 유형을 삭제할까요? 이 유형만 달린 주석은 ‘{data.categories.find((item) => item.id !== current.id)?.label}’로 이동합니다. 연결된 주석 {attached}개.</p>
      <Button onClick={() => setConfirmDelete(false)} disabled={busy}>취소</Button><Button variant="danger" onClick={remove} disabled={busy}>유형 삭제</Button>
    </div>}
    <div className="form-actions">
      {exists && custom && data.categories.length > 1 && <Button variant="ghost" className="delete-icon" onClick={() => setConfirmDelete(true)}><Trash2 size={17} />유형 삭제</Button>}
      <Button onClick={close} disabled={busy}>취소</Button><Button variant="primary" type="submit" disabled={busy}>설정 저장</Button></div>
  </form></Modal>;
}
