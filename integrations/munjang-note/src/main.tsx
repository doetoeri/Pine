import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BookOpenText, Check, CircleAlert, FileDown, HardDrive, Layers3, PanelLeftClose, PanelLeftOpen, Settings as SettingsIcon, X } from 'lucide-react';
import { Library } from './Library';
import { Reader } from './Reader';
import { Study } from './Study';
import { Settings, type InstallPrompt } from './Settings';
import { ExportPage } from './ExportPage';
import { emptyFilter, type Filter } from './model';
import { useWorkspace } from './storage';
import { Button, Empty, type Report } from './ui';
import './styles.css';

const nav = [
  { key: 'library', label: '지문 라이브러리', short: '지문', icon: BookOpenText },
  { key: 'notes', label: '모아보기', short: '모아보기', icon: Layers3 },
  { key: 'print', label: 'PDF 출력', short: 'PDF', icon: FileDown },
  { key: 'settings', label: '설정', short: '설정', icon: SettingsIcon },
] as const;

function routeFromHash() {
  const [part, query = ''] = (location.hash.slice(1) || 'library').split('?');
  const [page, id = ''] = part.split('/');
  return { page: page === 'review' ? 'notes' : page, id, query, params: new URLSearchParams(query) };
}

function App() {
  const { data, commit, error } = useWorkspace();
  const [route, setRoute] = useState(routeFromHash);
  const [railPreference, setRailPreference] = useState<boolean | null>(() => {
    try {
      const item = localStorage.getItem('munjang-note:rail-collapsed');
      return item === null ? null : item === 'true';
    } catch { return null; }
  });
  const railCollapsed = railPreference ?? route.page === 'reader';
  const [toast, setToast] = useState<{ text: string; error: boolean }>();
  const toastTimer = useRef<number | undefined>(undefined);
  const installPrompt = useRef<InstallPrompt | null>(null);
  const [installAvailable, setInstallAvailable] = useState(false);

  const report: Report = useCallback((text, error = false) => {
    window.clearTimeout(toastTimer.current);
    setToast({ text, error });
    toastTimer.current = window.setTimeout(() => setToast(undefined), error ? 9000 : 4800);
  }, []);

  useEffect(() => {
    const onRoute = () => { setRoute(routeFromHash()); window.scrollTo(0, 0); };
    const onInstall = (event: Event) => {
      event.preventDefault();
      installPrompt.current = event as InstallPrompt;
      setInstallAvailable(true);
    };
    const installed = () => { installPrompt.current = null; setInstallAvailable(false); };
    window.addEventListener('hashchange', onRoute);
    window.addEventListener('beforeinstallprompt', onInstall);
    window.addEventListener('appinstalled', installed);
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register(new URL('./sw.js', location.href)).catch(() => {
        // The online workspace stays available if the browser disallows service workers.
      });
    }
    return () => {
      window.removeEventListener('hashchange', onRoute);
      window.removeEventListener('beforeinstallprompt', onInstall);
      window.removeEventListener('appinstalled', installed);
      window.clearTimeout(toastTimer.current);
    };
  }, []);

  function open(id: string, note = '') {
    try { localStorage.setItem('munjang-note:last-read', id); } catch { /* UI preference */ }
    location.hash = 'reader/' + id + (note ? '?note=' + encodeURIComponent(note) : '');
  }

  function print(mode: 'passages' | 'types', filter: Partial<Filter>) {
    const params = new URLSearchParams({ mode });
    for (const [key, value] of Object.entries(filter)) if (value) params.set(key, value);
    location.hash = 'print?' + params.toString();
  }

  const active = route.page === 'reader' ? 'library' : route.page;
  const passage = data?.documents.find((item) => item.id === route.id);
  const printFilter = Object.fromEntries(Object.keys(emptyFilter).map((key) => [key, route.params.get(key) ?? ''])) as Filter;
  const printMode = route.params.get('mode');

  return <div className={'app-shell' + (railCollapsed ? ' rail-collapsed' : '')}>
    <a href="#main" className="skip-link" onClick={(event) => { event.preventDefault(); document.getElementById('main')?.focus(); }}>본문으로 이동</a>
    <aside className="app-rail">
      <div className="rail-header">
        <a className="brand" href="#library" aria-label="문장노트 홈">
          <img src="./icons/icon-192.png" width={40} height={40} alt="" />
          <span><strong>문장노트</strong><small>영어 지문 학습</small></span>
        </a>
        <Button variant="ghost" className="icon-button rail-toggle" aria-label={railCollapsed ? '사이드바 펼치기' : '사이드바 접기'}
          title={railCollapsed ? '사이드바 펼치기' : '사이드바 접기'} aria-expanded={!railCollapsed} aria-controls="main-navigation"
          onClick={() => {
            const next = !railCollapsed;
            setRailPreference(next);
            try { localStorage.setItem('munjang-note:rail-collapsed', String(next)); } catch { /* Keep the current view. */ }
          }}>{railCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</Button>
      </div>
      <nav id="main-navigation" className="app-nav" aria-label="주 메뉴">
        {nav.map(({ key, label, short, icon: Icon }) => <a key={key} href={'#' + key} className={active === key ? 'active' : ''}
          aria-label={label} title={label} aria-current={active === key ? 'page' : undefined}><Icon size={20} strokeWidth={1.8} aria-hidden="true" />
          <span className="nav-label">{label}</span><span className="nav-short" aria-hidden="true">{short}</span></a>)}
      </nav>
      <a href="#settings" className="storage-badge"><HardDrive size={17} aria-hidden="true" /><span><strong>기기에 저장</strong><small>백업은 설정에서</small></span><span className="live-dot" aria-hidden="true" /></a>
    </aside>
    <main id="main" tabIndex={-1}>
      {error ? <div className="main-content"><Empty title="저장 공간을 열 수 없어요" text={error}>
        <Button onClick={() => location.reload()}>다시 열기</Button></Empty></div> :
        !data ? <div className="main-content loading" role="status">학습 공간을 여는 중…</div> :
          route.page === 'reader' ? passage ? <Reader key={passage.id} document={passage} data={data} commit={commit} report={report}
            requestedNote={route.params.get('note') ?? ''} close={() => { location.hash = 'library'; }}
            print={(documentId) => print('passages', { documentId })} /> :
            <div className="main-content"><Empty title="지문을 찾을 수 없어요"><Button onClick={() => { location.hash = 'library'; }}>라이브러리 열기</Button></Empty></div> :
            route.page === 'notes' ? <Study data={data} jump={open} commit={commit} report={report} print={(filter) => print('types', filter)} /> :
                route.page === 'settings' ? <Settings data={data} commit={commit} report={report} installAvailable={installAvailable} install={async () => {
                  const pending = installPrompt.current;
                  if (!pending) return;
                  await pending.prompt();
                  if ((await pending.userChoice).outcome === 'accepted') setInstallAvailable(false);
                  installPrompt.current = null;
                }} /> :
                  route.page === 'print' ? <ExportPage key={route.query} data={data} commit={commit} report={report} initialFilter={printFilter}
                    initialMode={printMode === 'passages' || printMode === 'types' ? printMode : undefined} /> :
                    <Library data={data} commit={commit} report={report} open={open} />}
    </main>
    {toast && <div className={'toast ' + (toast.error ? 'toast-error' : '')} role={toast.error ? 'alert' : 'status'}>
      {toast.error ? <CircleAlert size={19} /> : <Check size={19} />}<span>{toast.text}</span>
      <Button variant="ghost" className="icon-button" aria-label="알림 닫기" onClick={() => setToast(undefined)}><X size={16} /></Button>
    </div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
