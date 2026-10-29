import {useEffect,useMemo,useRef,useState,type ButtonHTMLAttributes} from 'react';
import {BarChart3,Expand,Info,Layers,Map,Pause,Play,Settings2,Shield,SkipBack,SkipForward,SplitSquareHorizontal,X} from 'lucide-react';
import {MapView,type Camera} from './MapView';
import {CATALOG,type Dataset,type ModelEvent} from './model';
import {MODES,runProgressive,frameAt,riskAt,strongestDifferenceYear,type Mode,type ProgressiveFrame} from './progressive';
import {useScene,presentationAt,type Side,type ComparisonState} from './store';
import {PolicyEditor} from './PolicyEditor';
import {number as fmt,people,money,signed} from './format';
import {asset} from './paths';
import {examplePolicy,policySummary} from './examplePolicy';
import {DifferenceSummary} from './DifferenceSummary';
import {SmoothPanel} from './SmoothPanel';
import {MapMetrics} from './MapMetrics';
const national=():Camera=>{const u=Math.max(.75,Math.min(2,window.innerWidth/1920)),height=Math.max(260,window.innerHeight-480*u),width=Math.max(240,(window.innerWidth-100*u)/2);return {center:[5.25,52.05],zoom:Math.min(Math.log2(height/(512*.0135)),Math.log2(width/(512*.012))),pitch:0,bearing:0}};
function Button({children,chosen=false,className='',...rest}:ButtonHTMLAttributes<HTMLButtonElement>&{chosen?:boolean}){return <button type="button" className={`${chosen?'chosen':''} ${className}`} aria-pressed={chosen||undefined} {...rest}>{children}</button>}
const sideLabel=(side:Side)=>side==='left'?'A':'B';
const totalPower=(f:ProgressiveFrame)=>f.powerShortage.reduce((a,b)=>a+b,0);
export default function App(){
 const s=useScene(),[data,setData]=useState<Dataset|null>(null),[error,setError]=useState('');
 const [camera,setCamera]=useState<Camera>(national),[event,setEvent]=useState<ModelEvent|null>(null);
 const [resultsOpen,setResultsOpen]=useState(false),[layersOpen,setLayersOpen]=useState(false);
 const used=useRef(new Set<string>()),raf=useRef(0);
 useEffect(()=>{let h=window.innerHeight;const resize=()=>{const next=window.innerHeight;setCamera(c=>({...c,zoom:c.zoom+Math.log2(next/h)}));h=next};window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize)},[]);
 useEffect(()=>{const abort=new AbortController();fetch(asset('data/model.json'),{signal:abort.signal}).then(r=>{if(!r.ok)throw Error(String(r.status));return r.json()}).then(setData).catch(e=>{if(e.name!=='AbortError')setError(String(e))});return()=>abort.abort()},[]);
 const leftRun=useMemo(()=>data?runProgressive(data,s.climateScenario,s.left.policySet,{budget:s.left.budget,annualBudget:s.left.annualBudget}):null,[data,s.climateScenario,s.left.policySet,s.left.budget,s.left.annualBudget]);
 const rightRun=useMemo(()=>data?runProgressive(data,s.climateScenario,s.right.policySet,{budget:s.right.budget,annualBudget:s.right.annualBudget}):null,[data,s.climateScenario,s.right.policySet,s.right.budget,s.right.annualBudget]);
 const events=useMemo(()=>{const seen=new Set<number>();return [...(leftRun?.events||[]),...(rightRun?.events||[])].sort((a,b)=>a.year-b.year||b.severity-a.severity).filter(e=>{if(e.kind.startsWith('temporary-')&&!s.temporary)return false;if(seen.has(e.year))return false;seen.add(e.year);return true})},[leftRun,rightRun,s.temporary]);
 const live=useRef({events,data});live.current={events,data};
 useEffect(()=>{used.current.clear();setEvent(null)},[s.climateScenario,s.left.policySet,s.right.policySet]);
 function showEvent(e:ModelEvent){setResultsOpen(false);setLayersOpen(false);setEvent(e);s.set({currentYear:e.year,playing:false,presentation:false,selected:-1,panel:null});const r=data?.regions[e.region];if(r)setCamera({center:[r.lon,r.lat],zoom:8.1,pitch:0,bearing:0})}
 const showRef=useRef(showEvent);showRef.current=showEvent;
 useEffect(()=>{
  if(!s.playing||!data)return;let prev=performance.now(),drawAt=prev;const initial=useScene.getState(),epoch=Date.now()-(initial.presentationElapsed+initial.presentationCycle*600)*1000;
  const tick=(now:number)=>{
   const st=useScene.getState();if(!st.playing)return;
   if(now-drawAt>=32){const delta=Math.max(0,(now-prev)/1000);prev=now;drawAt=now;
    if(st.presentation){const total=(Date.now()-epoch)/1000;let elapsed=total,cycle=0;
     if(total>=600&&st.loop){cycle=Math.floor(total/600);elapsed=total%600}
     const point=presentationAt(elapsed);
     st.set({currentYear:point.year,climateScenario:point.mode,presentationElapsed:Math.min(600,elapsed),presentationCycle:cycle,playing:elapsed<600,presentation:elapsed<600});
    }else{
     let next=st.currentYear+Math.min(2,delta)*st.speed/4;
     const upcoming=st.autoPause?live.current.events.find(e=>e.year>st.currentYear&&e.year<=next&&!used.current.has(e.id)):undefined;
     if(upcoming){used.current.add(upcoming.id);showRef.current(upcoming);return}
     if(next>=2100&&st.loop){next=2026+(next-2100)%74;used.current.clear()}
     st.set({currentYear:Math.min(2100,next),playing:next<2100||st.loop});
    }
   }
   raf.current=requestAnimationFrame(tick);
  };raf.current=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf.current);
 },[s.playing,s.presentation,!!data]);
 function seek(year:number){s.set({currentYear:Math.max(2026,Math.min(2100,year)),playing:false,presentation:false,selected:-1});setEvent(null)}
 function resume(){if(event)used.current.add(event.id);setEvent(null);s.set({playing:true,selected:-1})}
 function play(){if(event){resume();return}const st=useScene.getState();s.set({playing:!st.playing,currentYear:st.currentYear>=2100?2026:st.currentYear,panel:null,selected:-1})}
 function navigate(direction:number){const time=useScene.getState().currentYear;const next=(direction>0?events:[...events].reverse()).find(e=>direction>0?e.year>time:e.year<time);if(next)showEvent(next)}
 function changeMode(mode:Mode){s.set({climateScenario:mode,presentation:false});setEvent(null)}
 function openPanel(panel:typeof s.panel){setResultsOpen(false);setLayersOpen(false);setEvent(null);s.set({panel:s.panel===panel?null:panel,selected:-1,playing:false,presentation:false})}
 function select(i:number){const r=data?.regions[i];if(!r)return;setResultsOpen(false);setLayersOpen(false);setEvent(null);s.set({selected:i,panel:null});setCamera({center:[r.lon,r.lat],zoom:8.4,pitch:0,bearing:0})}
 function toggleMapOnly(){setResultsOpen(false);setLayersOpen(false);setEvent(null);s.set({mapOnly:!useScene.getState().mapOnly,panel:null,selected:-1})}
 function applyExample(){if(!data)return;setResultsOpen(false);setLayersOpen(false);s.updateSide('right',examplePolicy(data));s.set({compare:true,potential:false,temporary:true,difference:true,policyAreas:true,panel:null,selected:-1,playing:false,presentation:false});setEvent(null)}
 function viewEffect(){if(!leftRun||!rightRun)return;seek(strongestDifferenceYear(leftRun,rightRun).year);s.set({temporary:true,difference:true,policyAreas:true,panel:null})}
 function focusDifference(){
  if(!data||!leftRun||!rightRun)return;const a=frameAt(leftRun,s.currentYear),b=frameAt(rightRun,s.currentYear),weights=data.regions.map((_,i)=>Math.abs(a.regionalArea[i]-b.regionalArea[i])+Math.abs(a.regionalTemporaryArea[i]-b.regionalTemporaryArea[i]));
  data.cells.forEach((c,i)=>weights[c.r]+=Math.abs(riskAt(leftRun,i,s.currentYear)-riskAt(rightRun,i,s.currentYear))*c.area);
  const index=weights.reduce((best,n,i)=>n>weights[best]?i:best,0);if(weights[index]<=0)return;
  const r=data.regions[index];setCamera({center:[r.lon,r.lat],zoom:8.3,pitch:0,bearing:0});s.set({selected:-1,panel:null,difference:true,temporary:true});setEvent(null);
 }
 function startPresentation(){setResultsOpen(false);setLayersOpen(false);used.current.clear();setEvent(null);s.set({presentation:true,presentationElapsed:0,presentationCycle:0,playing:true,climateScenario:'knmi',currentYear:2026,autoPause:false,potential:true,temporary:true,difference:true,policyAreas:true,compare:true,loop:true,panel:null,selected:-1});setCamera(national())}
 async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()}catch{setError('이 브라우저는 전체화면을 지원하지 않습니다.')}}
 const keys=useRef({play,navigate,seek,fullscreen,changeMode,toggleMapOnly});keys.current={play,navigate,seek,fullscreen,changeMode,toggleMapOnly};
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.target as HTMLElement)?.matches('input,select,textarea')||e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.code==='Space'){e.preventDefault();keys.current.play()}
  else if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const direction=e.key==='ArrowRight'?1:-1;e.shiftKey?keys.current.navigate(direction):keys.current.seek(Math.floor(useScene.getState().currentYear)+direction)}
  else if(e.key.toLowerCase()==='f')keys.current.fullscreen();
  else if(e.key.toLowerCase()==='m')keys.current.toggleMapOnly();
  else if(['1','2','3'].includes(e.key))keys.current.changeMode(({1:'knmi',2:'noadapt',3:'extreme'} as Record<string,Mode>)[e.key]);
  else if(e.key==='Escape'){setResultsOpen(false);setLayersOpen(false);setEvent(null);useScene.getState().set({panel:null,selected:-1,mapOnly:false});if(document.fullscreenElement)document.exitFullscreen().catch(()=>{})}
 };window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[]);
 function exportResult(){if(!leftRun||!rightRun||!data)return;const blob=new Blob([JSON.stringify({version:'0.4.0',climateScenario:s.climateScenario,currentYear:s.currentYear,meta:data.meta,left:{...s.left,results:leftRun.frames},right:{...s.right,results:rightRun.frames}},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='netherlands2100-comparison.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 if(!data||!leftRun||!rightRun)return <main className="boot"><h1>NETHERLANDS 2100</h1><p>{error||'실제 지형·항공영상과 A/B 모형을 준비합니다.'}</p>{error&&<Button onClick={()=>location.reload()}>다시 시도</Button>}</main>;
 if(leftRun.errors.length||rightRun.errors.length)return <main className="boot"><h1>저장된 정책 확인이 필요합니다.</h1><p>{[...leftRun.errors,...rightRun.errors].join(' · ')}</p><Button onClick={()=>{s.resetSide('left');s.resetSide('right')}}>유효하지 않은 정책 초기화</Button></main>;
 const comparison:ComparisonState={climateScenario:s.climateScenario,currentYear:s.currentYear,left:{...s.left,results:leftRun},right:{...s.right,results:rightRun}};
 const a=frameAt(leftRun,s.currentYear),b=frameAt(rightRun,s.currentYear),year=Math.floor(s.currentYear),drawer=!!s.panel||!!event||s.selected>=0;
 const rows:[string,ProgressiveFrame][]=[['A',a],['B',b]];
 const delta=[a.permanentArea-b.permanentArea,a.permanentPeople-b.permanentPeople,a.economicProxy-b.economicProxy,(a.base.assetDamage+a.base.productionLoss)-(b.base.assetDamage+b.base.productionLoss),a.policyInvestment-b.policyInvestment,totalPower(a)-totalPower(b)];
 const effect=strongestDifferenceYear(leftRun,rightRun);
 return <main className={`scene ${s.mapOnly?'map-only':''}`} data-testid="scene" data-map-only={s.mapOnly} data-results-open={resultsOpen} data-potential={s.potential} data-mode={s.climateScenario} data-year={year} data-area={b.permanentArea.toFixed(6)} data-presentation={s.presentation} data-elapsed={s.presentationElapsed.toFixed(2)} data-cycle={s.presentationCycle}>
  <header className="masthead">
   <div className="brand"><h1>바다를 피해서</h1><small>NETHERLANDS 2100 <span>기후와 선택의 지도</span></small></div>
   <div className="header-actions">
    <Button className="primary" onClick={applyExample}><Shield/>B 모범 정책</Button>
    <Button chosen={s.compare} aria-label="비교" onClick={()=>s.set({compare:!s.compare})}><SplitSquareHorizontal/>A/B 비교</Button>
    <Button chosen={resultsOpen} aria-label="비교 결과" onClick={()=>{setResultsOpen(!resultsOpen);setLayersOpen(false);s.set({panel:null,selected:-1});setEvent(null)}}><BarChart3/>비교 결과</Button>
    <Button aria-label="지도만 보기 (M)" onClick={toggleMapOnly}><Map/>지도만</Button>
    <Button className="icon-action" aria-label="출처와 가정" title="출처와 가정" onClick={()=>openPanel('sources')}><Info/></Button>
    <Button className="icon-action" aria-label="설정" title="발표 설정" onClick={()=>openPanel('settings')}><Settings2/></Button>
    <Button className="icon-action" aria-label="전체화면 (F)" title="전체화면 · F" onClick={fullscreen}><Expand/></Button>
   </div>
  </header>
  <section className={`workspace ${drawer?'with-drawer':''}`}>
   <div className={`map-stage ${s.compare?'split':''}`}>
    {(s.compare?(['left','right'] as Side[]):(['right'] as Side[])).map(side=>{const own=comparison[side],other=comparison[side==='left'?'right':'left'],f=side==='left'?a:b,status=policySummary(own.policySet,year);return <SmoothPanel key={side} className="map-half" clip aria-label={`정책안 ${sideLabel(side)}`}>
     <header className="map-title" data-testid={`summary-${side}`} data-policy-count={own.policySet.length} data-plan={JSON.stringify(own.policySet)} data-area={f.permanentArea.toFixed(6)} data-temporary-area={f.temporaryArea.toFixed(6)} data-people={f.permanentPeople.toFixed(6)} data-risk={f.riskIndex.toFixed(6)} data-investment={f.policyInvestment.toFixed(6)} data-camera={JSON.stringify(camera)}>
      <div className="map-title-row"><strong><i>{sideLabel(side)}</i><span>{own.name||'이름 없는 정책안'}</span></strong><Button aria-label={`정책 ${sideLabel(side)} 편집`} onClick={()=>openPanel(side)}><Shield/>{own.policySet.length}개 정책 · 편집</Button></div>
      <div className="map-summary"><span>영구 <b>{fmt(f.permanentArea)}km²</b></span><span>해일 <b>{fmt(f.temporaryArea)}km²</b></span><span>같은 기후 조건</span></div>
     </header>
     <div className="map-viewport"><MapView data={data} run={own.results} otherRun={s.compare?other.results:undefined} time={s.currentYear} camera={camera} onCamera={setCamera} onSelect={select} selected={s.selected} temporary={s.temporary} recovery={false} name={side} simple={s.simple} potential={s.potential} difference={s.difference&&s.compare} policyAreas={s.policyAreas}/>
      <div className="map-only-caption">{sideLabel(side)} · {own.name}</div>
      <div className="risk-readout" data-testid={`risk-${side}`} data-potential-area={f.potentialArea.toFixed(6)} data-pressure={f.riskIndex.toFixed(6)}><span>잠재 노출 지형 <b>{fmt(f.potentialArea)}km²</b></span><small>제방 미고려 조건 · 실제 침수 아님</small><span className="risk-extra">상대 압력 지수 {fmt(f.riskIndex,1)} · 확률 아님</span></div>
      {s.policyAreas&&own.policySet.length>0&&<div className="policy-legend" data-testid={`policy-status-${side}`}><b>{status.active?`${status.active}개 정책 효력 중`:status.building?'공사 중 · 보호 효과 전':status.planned?`${status.nextCompletion}년 첫 준공`:'정책 수명 종료'}</b><span>연두: 정책 적용 행정구역 · 실제 공사 위치 아님</span></div>}
     </div>
     <MapMetrics frame={f} baseline={a} side={side}/>
    </SmoothPanel>})}
   </div>
   {drawer&&<aside className="drawer" role="dialog" aria-label={s.panel||event?'발표 패널':'지역 정보'} data-testid="drawer"><header><h2>{s.panel==='left'?'정책 A':s.panel==='right'?'정책 B':s.panel==='sources'?'자료·모형의 한계':s.panel==='settings'?'발표 설정':event?'주요 이벤트':'선택한 지역'}</h2><Button aria-label="닫기" onClick={()=>{s.set({panel:null,selected:-1});setEvent(null)}}><X/></Button></header><div className="drawer-body">
    {(s.panel==='left'||s.panel==='right')&&<PolicyEditor key={s.panel} side={s.panel} value={s[s.panel]} data={data} mode={s.climateScenario} selected={s.selected}/>}
    {s.panel==='sources'&&<Sources/>}
    {s.panel==='settings'&&<>
     <label className="switch"><input type="checkbox" checked={s.autoPause} onChange={e=>s.set({autoPause:e.target.checked})}/>중요 이벤트 자동 정지</label>
     <label className="switch"><input type="checkbox" checked={s.loop} onChange={e=>s.set({loop:e.target.checked})}/>끝나면 자동 반복</label>
     <label className="switch"><input type="checkbox" checked={s.simple} onChange={e=>s.set({simple:e.target.checked})}/>간소화 물 표현</label>
     <p>10분 발표는 고배출 3분 → 저배출 3분 → 방재 실패 3분 → 결과 비교 1분 순서입니다. A/B 정책은 그대로 유지됩니다. 발표 중 정책 편집은 재생을 멈춥니다.</p>
     <Button className="primary" onClick={startPresentation}>10분 발표 시작</Button>
     <p className="keyboard">Space 재생·정지<br/>← / → 연도 이동<br/>Shift + ← / → 이벤트 이동<br/>1 / 2 / 3 기후 경로<br/>M 지도만 보기 · F 전체화면 · Esc 복귀</p>
     <Button onClick={exportResult}>A/B 계산 결과 JSON</Button>
    </>}
    {event&&!s.panel&&<section className="event-card" data-testid="event-panel"><span>{event.demo?'방재 실패 가정':'탐색 모형'} · {event.year}</span><h3>{event.title}</h3><p>{event.cause}</p><p>이벤트는 모형의 임계값 통과를 설명합니다. 관측된 실제 사건이 아닙니다.</p><Button className="primary" aria-label="계속 진행" onClick={resume}><Play/>계속 진행</Button><Button aria-label="이벤트 건너뛰기" onClick={resume}>건너뛰기</Button></section>}
    {s.selected>=0&&!s.panel&&!event&&<section className="place-panel"><h3>{data.regions[s.selected].name}</h3><p>A 모형 침수 {fmt(a.regionalArea[s.selected])}km²</p><p>B 모형 침수 {fmt(b.regionalArea[s.selected])}km²</p><Button onClick={()=>s.set({panel:'left',playing:false,presentation:false})}>이 지역에 A 정책</Button><Button onClick={()=>s.set({panel:'right',playing:false,presentation:false})}>이 지역에 B 정책</Button></section>}
   </div></aside>}
  </section>
  <section className="comparison-results" hidden={!resultsOpen} aria-label="A B 결과와 차이" data-testid="comparison-results">
   <div className="result-heading"><div><small>같은 기후, 다른 선택</small><h2>A/B 비교 결과</h2></div><Button aria-label="비교 결과 닫기" onClick={()=>setResultsOpen(false)}><X/></Button></div><DifferenceSummary a={a} b={b} left={s.left.policySet} right={s.right.policySet} year={year}/>
   <div className="result-toolbar"><strong>동일 기후 조건의 결과</strong><span>경제활동 노출 ≠ GDP 손실 · 피해·전력은 가정 모형</span><div><Button onClick={()=>s.copy('left','right')}>A → B 복제</Button><Button onClick={()=>s.copy('right','left')}>B → A 복제</Button><Button onClick={s.swap}>A ↔ B 교환</Button><Button onClick={()=>s.resetSide('left')}>A 초기화</Button><Button onClick={()=>s.resetSide('right')}>B 초기화</Button></div></div>
   <table><thead><tr><th>정책안</th><th>영구 침수 · 모형</th><th>영향 인구 · 추정</th><th>경제활동 노출</th><th>일시홍수 피해 · 모형</th><th>누적 정책 투자비</th><th>정전 영향 · 공급부족</th></tr></thead><tbody>
    {rows.map(([name,f])=><tr key={name} data-testid={`results-${name}`}><th>{name}</th><td>{fmt(f.permanentArea)}km²</td><td>{people(f.permanentPeople)}</td><td>{money(f.economicProxy)}</td><td>{money(f.base.assetDamage+f.base.productionLoss)}</td><td>{money(f.policyInvestment)}</td><td>{fmt(totalPower(f),1)}MW</td></tr>)}
    <tr className="delta" data-testid="results-delta"><th>A − B</th>{delta.map((n,i)=><td key={i}>{signed(n,[(v:number)=>`${fmt(v)}km²`,people,money,money,money,(v:number)=>`${fmt(v,1)}MW`][i])}</td>)}</tr>
   </tbody></table>
  </section>
  <div className="presentation-bar">
   <SmoothPanel className="timeline-dock" tone="blue" reverse aria-label="발표 조작">
    <section className="climate-ribbon" aria-label="공통 기후 조건">
     <nav className="scenario-buttons">{(Object.keys(MODES) as Mode[]).map((mode,i)=><Button key={mode} aria-label={`Scenario ${i+1}`} chosen={mode===s.climateScenario} onClick={()=>changeMode(mode)}><span>{i+1}</span>{MODES[mode].ko}</Button>)}</nav>
     <div className="map-actions">
      <Button aria-label="레이어와 이벤트" chosen={layersOpen} aria-expanded={layersOpen} onClick={()=>{setLayersOpen(!layersOpen);setResultsOpen(false);s.set({panel:null,selected:-1});setEvent(null)}}><Layers/>레이어·이벤트</Button>
      <Button data-testid="effect-year" data-year={effect.year} disabled={!effect.hasDifference} title="현재 기후에서 계산된 침수 영향 차이가 가장 큰 연도" onClick={viewEffect}>효과 큰 해 · {effect.year}년</Button>
      <Button onClick={focusDifference}>차이 지역 확대</Button>
      <Button aria-label="네덜란드 전체" onClick={()=>{setCamera(national());s.set({selected:-1})}}>전역</Button>
     </div>
    </section>
    <div className="timeline-bottom">
     <div className="play-controls"><Button aria-label="이전 이벤트" onClick={()=>navigate(-1)}><SkipBack/></Button><Button className="play primary" aria-label={s.playing?'일시정지':'재생'} onClick={play}>{s.playing?<Pause/>:<Play/>}</Button><Button aria-label="다음 이벤트" onClick={()=>navigate(1)}><SkipForward/></Button><div className="speed">{[1,2,4,8].map(speed=><Button key={speed} chosen={s.speed===speed} onClick={()=>s.set({speed,presentation:false})}>{speed}×</Button>)}</div></div>
     <div className="timeline-line"><input type="range" min="2026" max="2100" step=".01" value={s.currentYear} aria-label="연도 타임라인" onChange={e=>seek(Number(e.target.value))}/><div>{[2026,2040,2060,2080,2100].map(y=><Button key={y} onClick={()=>seek(y)}>{y}</Button>)}</div></div>
     <Button className="presentation-button" chosen={s.presentation} onClick={()=>s.presentation?s.set({presentation:false,playing:false}):startPresentation()}>{s.presentation?`발표 ${fmt(s.presentationElapsed/60,1)}/10분`:'10분 발표 시작'}</Button>
    </div>
    <div className="layer-controls" hidden={!layersOpen} data-testid="layer-panel">
     <header><strong>지도 레이어와 이벤트</strong><Button aria-label="레이어 닫기" onClick={()=>setLayersOpen(false)}><X/></Button></header>
     <label><input type="checkbox" aria-label="잠재 위험" checked={s.potential} onChange={e=>s.set({potential:e.target.checked})}/><i className="risk-key"/><span>잠재 위험<small>제방 미고려 지형 · 실제 침수 아님</small></span></label>
     <div className="legend-item"><i className="water-key"/><span>모형 영구 침수<small>계산된 침수 셀의 누적 이력</small></span></div>
     <label><input type="checkbox" aria-label="일시 홍수" checked={s.temporary} onChange={e=>s.set({temporary:e.target.checked})}/><i className="temporary-key"/><span>일시 홍수<small>해당 연도 해일에 따른 모형 침수</small></span></label>
     <label><input type="checkbox" aria-label="차이 강조" checked={s.difference} onChange={e=>s.set({difference:e.target.checked})}/><i className="difference-key"/><span>차이 강조<small>주황: 영향 ↑ · 보라: 영향 ↓</small></span></label>
     <label><input type="checkbox" aria-label="정책 구역" checked={s.policyAreas} onChange={e=>s.set({policyAreas:e.target.checked})}/><i className="policy-key"/><span>정책 적용 구역<small>실제 행정경계 · 공사 위치 아님</small></span></label>
     <nav>{['Rotterdam','Amsterdam'].map(name=><Button key={name} onClick={()=>{select(data.regions.findIndex(r=>r.name===name));setLayersOpen(false)}}>{name}</Button>)}</nav>
     <strong>주요 이벤트</strong><div className="event-markers" aria-label="이벤트 목록">{events.map(e=><Button key={e.id} className="event-marker" aria-label={`${e.year} 이벤트`} title={`${e.year} · ${e.title}`} onClick={()=>{setLayersOpen(false);showEvent(e)}}>{e.year}<span className="event-tooltip" role="tooltip">{e.title}</span></Button>)}</div>
    </div>
    {s.presentation&&<div className="presentation-status" role="status">{presentationAt(s.presentationElapsed).chapter} · {s.presentationCycle+1}회차 <progress max="600" value={s.presentationElapsed}/></div>}
   </SmoothPanel>
   <SmoothPanel className="year-card" tone="blue" aria-label="현재 연도와 해수면">
    <span className="year-label">시뮬레이션 연도</span><strong data-testid="current-year">{year}</strong>
    <div className="sea-level" data-testid="sea-level"><span>해수면 <b>+{fmt(a.slr,2)}m</b></span><small>1995–2014 대비</small></div>
   </SmoothPanel>
  </div>
  <p className="model-caption">{s.climateScenario==='extreme'?'방재 실패 시연 · 공식 전망 아님':'KNMI 해수면 앵커 · 침수는 탐색 모형'}<span>{s.difference?'주황: 상대 영향 ↑ · 보라: 상대 영향 ↓':s.potential?'청록 빗금: 잠재 노출 · 실제 침수 아님':'동일 해수면·해일 입력 · 영구 침수와 잠재 위험 구분'}</span></p>
  {s.mapOnly&&<div className="map-only-controls" data-testid="map-only-controls"><strong>{year}{event?' · 이벤트 정지':''}</strong><Button aria-label={s.playing?'지도 재생 정지':'지도 재생'} onClick={play}>{s.playing?<Pause/>:<Play/>}</Button><Button onClick={toggleMapOnly}>조작 보기 (M)</Button></div>}
  {error&&<div className="notice" role="alert">{error}<Button aria-label="안내 닫기" onClick={()=>setError('')}><X/></Button></div>}
 </main>;
}
function Sources(){return <div className="sources">
 <h3>실제 자료와 가정은 구분합니다</h3>
 <p>AHN/NAP 지형 · CBS 2024 인구 · Natural Earth 국경. 2025년 항공사진 © Samenwerkingsverband Beeldmateriaal / PDOK (CC BY 4.0), 주변 국가 NASA GIBS Blue Marble.</p>
 <h3>공식 기후 앵커 ≠ 공식 침수 예측</h3>
 <p>KNMI’23의 2050·2100 해수면 앵커 사이를 선형 보간합니다. NAP 관측 연결값은 미확보이므로 평균 해수면 0m NAP를 가정합니다. 분석 해상도는 약 2km이며 실제 제방·하천·시설 표고를 해석하지 못합니다.</p>
 <h3>잠재 위험은 실제 침수가 아닙니다</h3>
 <p>잠재 노출 지형은 기존 지형 고도와 연결 수위가 평균 해수면 이하인 셀의 합입니다. 제방이 없다는 조건의 지형 노출이며 침수 확률·실제 침수 면적이 아닙니다. 청록 빗금과 반투명 색으로 구별합니다.</p>
 <p>상대 압력 지수는 셀별 잠재 수심 ÷ (잠재 수심 + 2m + 양의 방어 여유)를 전체 분석 면적에 가중한 값입니다. 단위 없는 설명용 지수이며 확률이 아닙니다. 방어 여유는 지역 가정 방재 한계 − 평균 해수면의 면적 가중 평균이고 실제 조사된 제방 여유고가 아닙니다.</p>
 <h3>침수·경제·전력</h3>
 <p>모형 영구 침수는 조건을 충족한 셀의 누적 이력입니다. 일시 홍수는 같은 해일 입력으로 별도 계산하며 실제 관측 홍수가 아닙니다. 2035년 이후 방재·배수 기능 상실 및 2100년 +2.5m는 별도 극단 시연입니다.</p>
 <p>경제활동 노출은 CBS 인구 균등분포 × 1인당 55,000유로/년 대체지표입니다. GDP 손실액이 아닙니다. 일시홍수 피해액은 기존 모형의 자산·생산 손실 가정이며 영구 침수 피해 전부를 추정하지 않습니다. 전력 공급부족은 영구 침수와 해당 연도 해일 셀을 합한 가정 용량의 지역 인접망 최대유량 결과이며 실제 전력계통 예측이 아닙니다.</p>
 <h3>정책과 모범안</h3>
 <p>정책 구역은 모형이 효과를 적용하는 실제 행정경계입니다. 실제 제방·공사 위치 또는 보호 면적이 아닙니다. 연두 실선은 효력 중, 점선은 예정·공사이며 회색은 수명 종료입니다. 전국 방재 모범안은 정책 없는 방재 실패 시연의 2100년 침수 영향 면적 순으로 고른 100개 지자체에 해안 보호·제방·방조제·제방 갱신 400개를 적용합니다. 자본비 5,600억 유로이며 공식 권고나 최적해가 아닙니다. 준공 전·수명 종료 후에는 보호 효과가 없습니다.</p>
 <p>극단 시연은 지역에 활성 방어 정책이 있으면 영구 침수를 막는 단순한 가정을 사용합니다. 해일은 방어 높이와 별도로 비교합니다. 모범안의 2100년 결과는 실제 방재 성능이나 2026~2100년 내내 안전하다는 보장이 아닙니다. 지형·해수면·해일·정책 효과 계수는 바꾸지 않았습니다.</p>
 <h3>렌더링과 비교</h3>
 <p>A/B는 같은 해수면·해일·난수를 사용하고 정책만 독립적으로 계산합니다. 차이 강조는 영구 침수·표시 중인 해일 침수·상대 압력의 차이를 순서대로 표시하며 새로운 피해 면적을 추가하지 않습니다. 큰 침수 영향·인구 차이는 영구 침수와 겹치지 않는 해당 연도 해일 셀의 합이며 누적 발생 횟수가 아닙니다. 일시홍수 피해액은 기존 자산·생산 손실 모형에서 별도로 계산합니다. 경계의 미세한 흐림은 시각 효과이며 2km 해상도가 개선된 것이 아닙니다.</p>
 <a href="https://www.klimaatscenarios-data.knmi.nl/kerncijfers" target="_blank" rel="noreferrer">KNMI’23 원자료 ↗</a><a href="https://www.pdok.nl/ogc-webservices/-/article/pdok-luchtfoto-rgb-open-" target="_blank" rel="noreferrer">PDOK 항공사진 ↗</a>
 </div>}
