/* Shared deterministic engine: browser + Node CLI + Python API/optimizer. EUR billions, MW, people. */
export type Climate = 'low'|'high'|'stress';
export type PolicyKind = 'dike'|'barrier'|'drainage'|'hardening'|'grid'|'greenCity'|'transport'|'relocate'|'nature';
export interface Region {id:string;i:number;name:string;population:number;homes:number;homeValue:number;areaKm2:number;lon:number;lat:number;economicPerCapita:number;sampleCount:number;defenceNAP:number;housingCapacity:number}
export interface Cell {id:number;r:number;z:number;spill:number;area:number}
export interface Facility {id:string;name:string;lon:number;lat:number;region:number;kind:string;elevationSample:number|null;source:string;shutdownDepth:number}
export interface Dataset {version:string;regions:Region[];cells:Cell[];edges:number[][];facilities:Facility[];climate:Record<string,Record<string,{median:number;lower:number;upper:number}>>;meta:Record<string,any>}
export interface Policy {id:string;kind:PolicyKind;region:number;start:number;destination?:number;people?:number;delay?:number;end?:number;budget?:number;name?:string}
export interface PolicySpec {ko:string;en:string;design:number;build:number;cost:number;maintenance:number;boost:number;life:number;carbonKt:number;uncertainty:string}
export const CATALOG:Record<PolicyKind,PolicySpec>={
 dike:{ko:'제방 증고',en:'Raise dike',design:3,build:7,cost:1.2,maintenance:.012,boost:1.2,life:60,carbonKt:95,uncertainty:'비용·보호높이 ±40% · 가정'},
 barrier:{ko:'방조제 확충',en:'Storm barrier',design:5,build:10,cost:2.8,maintenance:.028,boost:1.8,life:75,carbonKt:200,uncertainty:'비용·효과 ±50% · 가정'},
 drainage:{ko:'배수시설 증설',en:'Drainage',design:2,build:4,cost:.32,maintenance:.008,boost:.35,life:35,carbonKt:20,uncertainty:'깊이 감소 0.35m · 가정'},
 hardening:{ko:'전력시설 방수 보강',en:'Power hardening',design:2,build:3,cost:.24,maintenance:.004,boost:.8,life:35,carbonKt:18,uncertainty:'지역 공급 가용성 개선 · 가정'},
 grid:{ko:'송전 우회·이중화',en:'Grid redundancy',design:3,build:5,cost:.55,maintenance:.006,boost:1,life:45,carbonKt:35,uncertainty:'인접지역 송전 용량 2배 · 가정'},
 greenCity:{ko:'친환경 신도시',en:'Green settlement',design:4,build:8,cost:3.2,maintenance:.015,boost:60000,life:80,carbonKt:900,uncertainty:'6만 명 수용·운영 탄소 절감 · 가정'},
 transport:{ko:'교통망 보강',en:'Transport resilience',design:3,build:6,cost:.6,maintenance:.009,boost:.5,life:50,carbonKt:70,uncertainty:'지역 물류 손실 50% 감소 · 가정'},
 relocate:{ko:'단계적 주민 이주',en:'Planned relocation',design:2,build:4,cost:.9,maintenance:0,boost:30000,life:100,carbonKt:45,uncertainty:'완료 연도에 최대 3만 명 이전 · 가정'},
 nature:{ko:'생태 기반 해안 보호',en:'Nature-based coast',design:2,build:6,cost:.4,maintenance:.006,boost:.45,life:40,carbonKt:-20,uncertainty:'보호 높이 환산 0.45m · 가정'},
};
export const complete=(p:Policy)=>p.end??(p.start+CATALOG[p.kind].design+CATALOG[p.kind].build+(p.delay||0));
export const policyCost=(p:Policy)=>p.budget??CATALOG[p.kind].cost;
export interface Config {climate:Climate;quantile:'median'|'lower'|'upper';seed:number;extraSubsidence:number;budget:number;annualBudget:number;minSeverity:number;stormScale:number}
export const DEFAULT_CONFIG:Config={climate:'high',quantile:'median',seed:2100,extraSubsidence:0,budget:40,annualBudget:3,minSeverity:2,stormScale:1};
export interface RegionalState {population:number;exposed:number;affected:number;fraction:number;depth:number;productionLoss:number;assetDamage:number;shortage:number;output:number;protected:boolean;movedOut:number;movedIn:number;capacity:number}
export interface Frame {year:number;slr:number;low:number;high:number;waterNAP:number;storm:number;regions:RegionalState[];population:number;exposed:number;affected:number;migrated:number;assetDamage:number;productionLoss:number;investment:number;maintenance:number;cost:number;cumulative:number;shortageMW:number;outageHours:number;carbonKt:number;output:number;active:number;building:number;facilityFailures:string[]}
export interface ModelEvent {id:string;year:number;kind:string;severity:number;region:number;title:string;en:string;cause:string;causeEn:string;demo:boolean;value:number;policyId?:string}
export interface Run {frames:Frame[];events:ModelEvent[];plan:Policy[];errors:string[];fingerprint:string}
export function seaLevel(data:Dataset,year:number,climate:Climate,q:'median'|'lower'|'upper'='median'){
 // Annual interpolation is an assumption; only 2050 / 2100 anchors are official.
 const table=data.climate[climate==='stress'?'high':climate];
 const v2050=table['2050'][q]; const v2100=climate==='stress'?2.5:table['2100'][q];
 if(year<=2050)return .003*(2026-2005)+(v2050-.003*(2026-2005))*(year-2026)/24;
 return v2050+(v2100-v2050)*(year-2050)/50;
}
export function random01(year:number,seed:number){let x=(Math.imul(year,1597334677)^seed)>>>0;x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296}
export function storm(year:number,config:Config){const u=random01(year,config.seed);return (1+Math.pow(u,4)*2.4)*config.stormScale}
export function active(p:Policy,year:number){return year>=complete(p)&&year<complete(p)+CATALOG[p.kind].life}
export function planErrors(data:Dataset,plan:Policy[],cfg:Config){
 const errors:string[]=[];const seen=new Set<string>(); let total=0; const annual=new Map<number,number>();
 for(const p of plan){
  if(seen.has(p.id))errors.push('중복 정책 ID / duplicate policy ID');seen.add(p.id);
  if(!CATALOG[p.kind]||!data.regions[p.region]||!Number.isInteger(p.start)||p.start<2026||!Number.isFinite(p.delay??0)||(p.delay??0)<0||!Number.isInteger(complete(p))||complete(p)<=p.start||complete(p)>2100){errors.push('정책 위치·기간 오류 / invalid location or dates');continue}
  if(!Number.isFinite(policyCost(p))||policyCost(p)<=0){errors.push('정책 투자비는 양수여야 합니다 / invalid cost');continue}
  const spec=CATALOG[p.kind];total+=policyCost(p);
  for(let y=p.start;y<complete(p);y++)annual.set(y,(annual.get(y)||0)+policyCost(p)/(complete(p)-p.start));
  if(p.kind==='relocate'){
   if(p.destination===undefined||p.destination===p.region||!data.regions[p.destination])errors.push('유효한 이주 도착지를 선택하세요 / invalid destination');
   else if(!plan.some(v=>v.kind==='greenCity'&&v.region===p.destination&&complete(v)<=complete(p)))errors.push('이주 전에 도착지 신도시가 완공되어야 합니다 / housing prerequisite');
   if((p.people??30000)<=0||(p.people??30000)>30000)errors.push('이주 규모는 1~30,000명 / migration capacity');
  }
 }
 if(total>cfg.budget+1e-8)errors.push('총 자본예산 초과 / total capital budget exceeded');
 if([...annual.values()].some(v=>v>cfg.annualBudget+1e-8))errors.push('연간 자본예산 초과 / annual capital budget exceeded');
 return errors;
}
// Dinic maximum flow. Nodes represent municipalities; edges are hypothetical transport capacity.
export function maxFlow(n:number,edges:number[][],generation:number[],demand:number[],boost:number[]){
 type E={to:number;rev:number;cap:number};const g:E[][]=Array.from({length:n+2},()=>[]);const source=n,sink=n+1;
 function add(a:number,b:number,c:number){g[a].push({to:b,rev:g[b].length,cap:c});g[b].push({to:a,rev:g[a].length-1,cap:0})}
 for(let i=0;i<n;i++){add(source,i,generation[i]);add(i,sink,demand[i])}
 for(const [i,j] of edges){const cap=Math.min(demand[i],demand[j])*.45*(1+Math.max(boost[i],boost[j]));add(i,j,cap);add(j,i,cap)}
 const demandEdges=g.map((es,i)=>i<n?es.find(e=>e.to===sink):undefined);let total=0;
 for(let iteration=0;iteration<1000;iteration++){
  const level=Array(n+2).fill(-1);level[source]=0;const queue=[source];for(let k=0;k<queue.length;k++)for(const e of g[queue[k]])if(e.cap>1e-7&&level[e.to]<0){level[e.to]=level[queue[k]]+1;queue.push(e.to)}
  if(level[sink]<0)break;const it=Array(n+2).fill(0);
  const dfs=(u:number,f:number):number=>{if(u===sink)return f;for(;it[u]<g[u].length;it[u]++){const e=g[u][it[u]];if(e.cap>1e-7&&level[e.to]===level[u]+1){const take=dfs(e.to,Math.min(f,e.cap));if(take>1e-7){e.cap-=take;g[e.to][e.rev].cap+=take;return take}}}return 0};
  for(let f=dfs(source,1e12);f>1e-7;f=dfs(source,1e12))total+=f;
 }
 return {flow:total,shortage:demandEdges.slice(0,n).map(e=>e?.cap||0)};
}
export function simulate(data:Dataset,plan:Policy[],cfg:Config=DEFAULT_CONFIG):Run{
 const errors=planErrors(data,plan,cfg); if(errors.length)return {frames:[],events:[],plan,errors,fingerprint:''};
 const frames:Frame[]=[],events:ModelEvent[]=[];const n=data.regions.length;
 const cellsByRegion:Cell[][]=Array.from({length:n},()=>[]);data.cells.forEach(c=>cellsByRegion[c.r].push(c));
 const pop=data.regions.map(r=>r.population),movedOut=Array(n).fill(0),movedIn=Array(n).fill(0),capacity=Array(n).fill(0);
 let cumulative=0,migrated=0,carbon=0;const emitted=new Set<string>(); const done=new Set<string>();
 const emit=(e:ModelEvent)=>{if(!emitted.has(e.id)){emitted.add(e.id);events.push(e)}};
 for(let year=2026;year<=2100;year++){
  let investment=0,maintenance=0;const protection=Array(n).fill(0),drain=Array(n).fill(0),hard=Array(n).fill(0),grid=Array(n).fill(0),transport=Array(n).fill(0);
  // Capacity first, then relocation, independent of plan array ordering.
  for(const p of plan.filter(v=>v.kind==='greenCity'))if(year===complete(p)&&!done.has(p.id)){capacity[p.region]+=60000;done.add(p.id)}
  for(const p of plan){
   const s=CATALOG[p.kind],end=complete(p),r=p.region;
   if(year>=p.start&&year<end){investment+=policyCost(p)/(end-p.start);carbon+=s.carbonKt/(end-p.start)}
   if(active(p,year)){
    maintenance+=s.maintenance;
    if(['dike','barrier','nature'].includes(p.kind))protection[r]+=s.boost;
    if(p.kind==='drainage')drain[r]+=.35;
    if(p.kind==='hardening')hard[r]=.8;
    if(p.kind==='grid')grid[r]=1;
    if(p.kind==='transport')transport[r]=.5;
    if(p.kind==='greenCity')carbon-=6; // kt CO2e/year, illustrative operational reduction
   }
   if(year===end&&p.kind==='relocate'&&!done.has(p.id)){
    const d=p.destination!;const people=Math.min(p.people??30000,pop[r],capacity[d]);
    pop[r]-=people;pop[d]+=people;capacity[d]-=people;movedOut[r]+=people;movedIn[d]+=people;migrated+=people;done.add(p.id);
   }
   if(year===p.start||year===end){const finish=year===end;
    emit({id:`policy:${p.id}:${finish?'finish':'start'}`,year,kind:finish?'complete':'start',severity:2,region:r,title:`${s.ko} ${finish?'준공':'착수'}`,en:`${s.en} ${finish?'completed':'started'}`,cause:finish?'이 연도부터 시설 효과 적용':'설계·인허가·공사 기간에는 보호 효과 없음',causeEn:finish?'Protection begins this year.':'No protection during permitting and construction.',demo:false,value:policyCost(p),policyId:p.id})}
  }
  const slr=seaLevel(data,year,cfg.climate,cfg.quantile),lo=seaLevel(data,year,cfg.climate,'lower'),hi=seaLevel(data,year,cfg.climate,'upper');
  const surge=storm(year,cfg),water=(data.meta.baseMeanSeaNAP||0)+slr+surge;
  const regions:RegionalState[]=data.regions.map((r,i)=>{
   const cs=cellsByRegion[i];let exposure=0,af=0,depth=0;
   // Constant existing defence performance assumes continued maintenance; not a surveyed dike height.
   const gate=r.defenceNAP+protection[i];
   for(const c of cs){const z=c.z-(year-2026)*cfg.extraSubsidence/1000;
    if(z<water)exposure++;
    const wet=water>gate && water>=c.spill-(year-2026)*cfg.extraSubsidence/1000;
    const d=wet?Math.max(0,(water-z)*.35-drain[i]):0;
    if(d>.1){af++;depth+=d}
   }
   const frac=cs.length?af/cs.length:0;const mean=af?depth/af:0;const output=pop[i]*r.economicPerCapita/1e9;
   const assets=r.homes*r.homeValue/1e9*1.3; // housing + 30% infrastructure proxy, no national asset census
   return {population:pop[i],exposed:pop[i]*(cs.length?exposure/cs.length:0),affected:pop[i]*frac,fraction:frac,depth:mean,productionLoss:output*frac*(30/365)*(1-transport[i]),assetDamage:assets*frac*Math.min(.6,mean*.12),shortage:0,output,protected:protection[i]>0,movedOut:movedOut[i],movedIn:movedIn[i],capacity:capacity[i]};
  });
  const demand=pop.map(p=>p*.0006);const generation=regions.map((r,i)=>demand[i]*1.25*Math.max(0,1-r.fraction*(hard[i]? .35:1.4)));
  const flow=maxFlow(n,data.edges,generation,demand,grid);
  let outageHours=0;
  for(let i=0;i<n;i++){
   regions[i].shortage=flow.shortage[i];const ratio=demand[i]?flow.shortage[i]/demand[i]:0;
   regions[i].productionLoss+=regions[i].output*(1-regions[i].fraction)*ratio*72/8760;
   outageHours=Math.max(outageHours,ratio*72);
  }
  const sum=(k:keyof RegionalState)=>regions.reduce((s,r)=>s+Number(r[k]),0);
  const assetDamage=sum('assetDamage'),productionLoss=sum('productionLoss'),cost=assetDamage+productionLoss+investment+maintenance;
  cumulative+=cost;
  const failures=data.facilities.filter(f=>f.kind!=='defence'&&regions[f.region].depth>f.shutdownDepth+(hard[f.region]&&f.kind==='power'?.8:0)).map(f=>f.id);
  const frame:Frame={year,slr,low:lo,high:hi,waterNAP:water,storm:surge,regions,population:pop.reduce((a,b)=>a+b,0),exposed:sum('exposed'),affected:sum('affected'),migrated,assetDamage,productionLoss,investment,maintenance,cost,cumulative,shortageMW:flow.shortage.reduce((a,b)=>a+b,0),outageHours,carbonKt:carbon,output:sum('output'),active:plan.filter(p=>active(p,year)).length,building:plan.filter(p=>p.start<=year&&complete(p)>year).length,facilityFailures:failures};
  frames.push(frame);
  for(let i=0;i<n;i++){
   const r=regions[i],prev=frames[frames.length-2]?.regions[i];const name=data.regions[i].name;
   if(r.affected>=10000&&(!prev||prev.affected<10000))emit({id:`flood:${year}:${i}`,year,kind:'flood',severity:r.affected>100000?3:2,region:i,title:`${name} · 침수 영향 임계치 초과`,en:`${name} · flood threshold exceeded`,cause:'가정 폭풍수위가 방재 한계를 넘어 연결된 저지대로 유입되는 간이모형 결과',causeEn:'Assumed storm water exceeds a hypothetical defence gate; connected lowland cells become exposed.',demo:false,value:r.affected});
   if(r.shortage>10&&(!prev||prev.shortage<=10))emit({id:`power:${year}:${i}`,year,kind:'power',severity:3,region:i,title:`${name} · 공급 부족`,en:`${name} · supply shortfall`,cause:'대체 공급 경로를 계산한 뒤에도 수요를 충족하지 못한 지역 수송모형 결과',causeEn:'Illustrative transport network cannot meet demand after alternative supply is routed.',demo:false,value:r.shortage});
  }
  for(const fid of failures)if(!frames[frames.length-2]?.facilityFailures.includes(fid)){
   const f=data.facilities.find(v=>v.id===fid)!;emit({id:`facility:${year}:${fid}`,year,kind:'facility',severity:3,region:f.region,title:`${f.name} · 가동 중단 가정`,en:`${f.name} · modelled outage`,cause:'도시 평균 침수 깊이를 이용한 취약성 예시. 실제 시설의 침수 또는 운영 예측이 아님.',causeEn:'Regional mean depth proxy, not an operational forecast for this facility.',demo:false,value:regions[f.region].depth});
  }
  if(productionLoss>2&&(!frames[frames.length-2]||frames[frames.length-2].productionLoss<=2))emit({id:`economy:${year}`,year,kind:'economy',severity:3,region:regions.reduce((a,b,i)=>b.productionLoss>regions[a].productionLoss?i:a,0),title:'연간 생산 손실 €2B 초과',en:'Annual output loss exceeds €2B',cause:'실제 GDP 대신 인구당 경제활동 대체지표로 계산한 가정값',causeEn:'Modelled economic activity proxy, not reported regional GDP.',demo:false,value:productionLoss});
  if(frame.building&&frame.affected>100000)emit({id:`construction-flood:${year}`,year,kind:'construction-flood',severity:3,region:regions.reduce((a,b,i)=>b.affected>regions[a].affected?i:a,0),title:'공사 중 홍수 영향 발생',en:'Flood impact during construction',cause:'완공 전 정책에는 보호 효과가 적용되지 않음. 공사 지연은 편집기에서 별도 설정.',causeEn:'Unfinished projects provide no protection. Delay can be specified in the editor.',demo:false,value:frame.affected});
 }
 events.sort((a,b)=>a.year-b.year||b.severity-a.severity||a.id.localeCompare(b.id));
 return {frames,events,plan,errors:[],fingerprint:`${cfg.seed}:${cfg.climate}:${cfg.quantile}:${cfg.stormScale}:${cfg.extraSubsidence}`};
}
export function defaultPlan(data:Dataset):Policy[]{
 const find=(name:string)=>data.regions.findIndex(r=>r.name===name);
 return ['Rotterdam','Amsterdam',"'s-Gravenhage",'Dordrecht','Haarlemmermeer','Almere'].map((name,k)=>({id:`initial-${k}`,kind:(k===4?'hardening':'dike') as PolicyKind,region:find(name),start:2030+Math.floor(k/3)*5})).filter(p=>p.region>=0);
}
export function comparisonEvents(run:Run,base:Run):ModelEvent[]{
 if(!run.plan.length)return run.events;
 const extra:ModelEvent[]=[];let crossed=false;
 for(let i=0;i<run.frames.length;i++){
  if(!crossed&&base.frames[i].cumulative>run.frames[i].cumulative&&run.frames[i].investment===0&&i>0){crossed=true;extra.push({id:'payback',year:run.frames[i].year,kind:'payback',severity:2,region:run.plan[0].region,title:'누적 편익이 누적 비용 초과',en:'Cumulative benefits exceed costs',cause:'동일 기후 입력 A와 비교한 비할인 누적 총비용 교차',causeEn:'Undiscounted cumulative total cost crossover with identical climate inputs.',demo:false,value:base.frames[i].cumulative-run.frames[i].cumulative})}
 }
 return [...run.events,...extra].sort((a,b)=>a.year-b.year||b.severity-a.severity||a.id.localeCompare(b.id));
}
