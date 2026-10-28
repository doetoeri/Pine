import {useMemo,useState,type FormEvent} from 'react';
import {CATALOG,complete,defaultPlan,planErrors,policyCost,type Dataset,type Policy,type PolicyKind} from './model';
import {configFor,type Mode} from './progressive';
import {useScene,type PolicySide,type Side} from './store';
import {money} from './format';
import {examplePolicy,policyStatus,policyEffect,STATUS_TEXT} from './examplePolicy';
interface Props {data:Dataset;side:Side;value:PolicySide;mode:Mode;selected:number}
export function PolicyEditor({data,side,value,mode,selected}:Props){
 const update=useScene(s=>s.updateSide);
 const [editing,setEditing]=useState<string|null>(null),[kind,setKind]=useState<PolicyKind>('dike');
 const [region,setRegion]=useState(selected>=0?selected:data.regions.findIndex(r=>r.name==='Rotterdam')),[start,setStart]=useState(2030),[end,setEnd]=useState(2040),[cost,setCost]=useState(1.2);
 const [destination,setDestination]=useState(data.regions.findIndex(r=>r.name==='Apeldoorn')),[count,setCount]=useState(30000),[error,setError]=useState('');
 const label=side==='left'?'A':'B',year=useScene(s=>Math.floor(s.currentYear)),example=useMemo(()=>examplePolicy(data),[data]);
 function commit(plan:Policy[],patch:Partial<PolicySide>={}){
  const errors=planErrors(data,plan,{...configFor(mode),budget:patch.budget??value.budget,annualBudget:patch.annualBudget??value.annualBudget});
  if(errors.length){setError(errors.join(' · '));return false}
  update(side,{...patch,name:patch.name??(plan.length&&value.name==='현행 유지'?'사용자 정책':value.name),policySet:plan});
  if(plan.length)useScene.getState().set({temporary:true,difference:true,policyAreas:true});
  setError('');return true;
 }
 function submit(e:FormEvent){
  e.preventDefault();const p:Policy={id:editing??`${side}-${crypto.randomUUID()}`,kind,region,start,end,budget:cost,...(kind==='relocate'?{destination,people:count}:{})};
  if(commit(editing?value.policySet.map(q=>q.id===editing?p:q):[...value.policySet,p]))setEditing(null);
 }
 function edit(p:Policy){setEditing(p.id);setKind(p.kind);setRegion(p.region);setStart(p.start);setEnd(complete(p));setCost(policyCost(p));setDestination(p.destination??destination);setCount(p.people??30000);setError('')}
 return <div className="policy-editor" data-testid={`editor-${side}`}>
  <label>정책안 이름<input aria-label={`${label} 정책안 이름`} maxLength={30} value={value.name} onChange={e=>update(side,{name:e.target.value})}/></label>
  <div className="field-pair"><label>총 예산 (억 유로)<input aria-label={`${label} 총 예산`} type="number" min="1" step="1" value={value.budget*10} onChange={e=>{const n=e.currentTarget.valueAsNumber;if(Number.isFinite(n)&&n>0)commit(value.policySet,{budget:n/10})}}/></label><label>연간 한도 (억 유로)<input aria-label={`${label} 연간 예산`} type="number" min=".1" step=".1" value={value.annualBudget*10} onChange={e=>{const n=e.currentTarget.valueAsNumber;if(Number.isFinite(n)&&n>0)commit(value.policySet,{annualBudget:n/10})}}/></label></div>
  <p className="editor-note">이 브라우저에 A/B를 별도로 자동 저장합니다. 정책을 바꿔도 연도·카메라는 유지됩니다.</p>
  <section className="example-policy"><h3>{example.name}</h3><p>기준 시연에서 침수 영향 면적이 큰 100개 지자체에 해안 보호(2034), 제방(2036), 방조제(2041), 제방 갱신(2096)을 적용합니다. 총 400개 정책입니다.</p><p>자본비 {money(example.policySet.reduce((n,p)=>n+policyCost(p),0))} · 총 한도 {money(example.budget)} / 연 {money(example.annualBudget)}. 공식 권고·최적해가 아닌 모형용 예시입니다.</p><p>방재 실패 시연 · 2100년에서 비교하세요. 적용은 연도·기후를 유지하며, 계산된 침수를 보도록 잠재 위험 레이어를 끕니다. 2100년 결과가 전 기간의 안전을 뜻하지 않습니다.</p><button type="button" className="primary" onClick={()=>{if(commit(example.policySet,example)){useScene.getState().set({potential:false});setEditing(null)}}}>모범 정책 적용</button></section>
  <form onSubmit={submit} className="policy-form"><h3>{editing?'정책 수정':'정책 추가'}</h3>
   <label>정책 유형<select aria-label="정책 유형" value={kind} onChange={e=>{const k=e.target.value as PolicyKind;setKind(k);setEnd(Math.min(2100,start+CATALOG[k].design+CATALOG[k].build));setCost(CATALOG[k].cost)}}>{Object.entries(CATALOG).map(([k,v])=><option key={k} value={k}>{v.ko}</option>)}</select></label>
   <label>위치<select aria-label="정책 위치" value={region} onChange={e=>setRegion(Number(e.target.value))}>{data.regions.map(r=><option key={r.id} value={r.i}>{r.name}</option>)}</select></label>
   <div className="field-pair"><label>착공 연도<input aria-label="착공 연도" type="number" required min="2026" max="2099" value={start} onChange={e=>setStart(e.currentTarget.valueAsNumber)}/></label><label>준공 연도<input aria-label="준공 연도" type="number" required min={start+1} max="2100" value={end} onChange={e=>setEnd(e.currentTarget.valueAsNumber)}/></label></div>
   <label>정책 투자비 (억 유로)<input aria-label="정책 투자비" type="number" required min=".01" step=".01" value={cost*10} onChange={e=>setCost(e.currentTarget.valueAsNumber/10)}/></label>
   {kind==='relocate'&&<><label>이주 도착지<select aria-label="이주 도착지" value={destination} onChange={e=>setDestination(Number(e.target.value))}>{data.regions.map(r=><option key={r.id} value={r.i}>{r.name}</option>)}</select></label><label>이주 인원<input aria-label="이주 인원" type="number" min="1" max="30000" required value={count} onChange={e=>setCount(e.currentTarget.valueAsNumber)}/></label><p className="editor-note">도착지에 친환경 신도시가 먼저 준공되어야 합니다. 최대 3만 명.</p></>}
   <p className="editor-note">{CATALOG[kind].uncertainty}. 완공 전 보호 효과 없음. 투자비는 지출만 바꾸며 보호 높이를 임의로 키우지 않습니다.</p>
   {error&&<p className="form-error" role="alert">{error}</p>}
   <button className="primary" type="submit">{editing?'정책 수정 저장':'정책 추가'}</button>{editing&&<button type="button" onClick={()=>setEditing(null)}>수정 취소</button>}
  </form>
  <div className="policy-list" data-testid={`policies-${side}`} data-count={value.policySet.length}>{value.policySet.length===0?<p>새 정책 없음 · 기존 가정 방재 유지</p>:value.policySet.map(p=><article key={p.id}><b>{CATALOG[p.kind].ko} <em className={`policy-status ${policyStatus(p,year)}`}>{STATUS_TEXT[policyStatus(p,year)]}</em></b><span>{data.regions[p.region].name} · {p.start} → {complete(p)}</span><span>{money(policyCost(p))} · 효력 {complete(p)}~{complete(p)+CATALOG[p.kind].life-1}</span><span>{policyEffect(p)}</span><div><button type="button" aria-label={`${CATALOG[p.kind].ko} 수정`} onClick={()=>edit(p)}>수정</button><button type="button" aria-label={`${CATALOG[p.kind].ko} 삭제`} onClick={()=>commit(value.policySet.filter(q=>q.id!==p.id))}>삭제</button></div></article>)}</div>
  <div className="editor-actions"><button type="button" onClick={()=>commit(defaultPlan(data),{name:'기본 방재 정책'})}>기본 정책 불러오기</button><button type="button" onClick={()=>{commit([]);setEditing(null)}}>정책 목록 비우기</button></div>
 </div>;
}
