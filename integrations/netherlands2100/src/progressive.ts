import {simulate,seaLevel,active,maxFlow,CATALOG,DEFAULT_CONFIG,type Dataset,type Frame,type Policy,type ModelEvent} from './model';
export type Mode='knmi'|'noadapt'|'extreme';
export const MODES={knmi:{ko:'KNMI 고배출',en:'KNMI anchors',badge:'KNMI · MODEL',description:'KNMI 고배출 앵커 + 가정 방재 유지. 실제 침수 예측 아님.'},noadapt:{ko:'KNMI 저배출',en:'KNMI low emissions',badge:'KNMI LOW · MODEL',description:'KNMI 저배출 앵커 + 가정 방재 유지. A/B 정책은 독립적으로 적용.'},extreme:{ko:'방재 실패 시연',en:'Defence-failure demo',badge:'DEMO · 공식 전망 아님',description:'2035년 이후 배수·방재 점진 상실, 2100년 +2.50m 가정. 실제 지형 유지.'}};
export interface ProgressiveFrame {year:number;slr:number;permanentArea:number;permanentPeople:number;temporaryArea:number;recoveryArea:number;economicProxy:number;regionalArea:number[];regionalPeople:number[];powerShortage:number[];potentialArea:number;riskIndex:number;defenceMargin:number;policyInvestment:number;base:Frame}
export interface ProgressiveRun {frames:ProgressiveFrame[];firstWet:Float32Array;recoveryYear:Float32Array;events:ModelEvent[];plan:Policy[];mode:Mode;areaDenominator:number;riskMasks:Float32Array[];errors:string[]}
export function configFor(mode:Mode){return {...DEFAULT_CONFIG,climate:mode==='extreme'?'stress' as const:mode==='noadapt'?'low' as const:'high' as const}}
export const clamp=(x:number)=>Math.min(1,Math.max(0,x));
export function visualWet(first:number,time:number){return first<2101?clamp((time-first)*2+.5):0}
export function runProgressive(data:Dataset,mode:Mode,plan:Policy[]=[],limits?:{budget:number;annualBudget:number}):ProgressiveRun{
 const actualPlan=plan;const cfg={...configFor(mode),...limits},base=simulate(data,actualPlan,cfg);
 if(base.errors.length)return {frames:[],firstWet:new Float32Array(),recoveryYear:new Float32Array(),events:[],plan:actualPlan,mode,areaDenominator:0,riskMasks:[],errors:base.errors};
 const n=data.cells.length,N=data.regions.length,firstWet=new Float32Array(n).fill(9999),recoveryYear=new Float32Array(n).fill(9999);
 const minZ=Array(N).fill(999),regionalLand=Array(N).fill(0);data.cells.forEach(c=>{minZ[c.r]=Math.min(minZ[c.r],c.z);regionalLand[c.r]+=c.area});
 const frames:ProgressiveFrame[]=[],events:ModelEvent[]=[],riskMasks:Float32Array[]=[];const seen=new Set<string>();const fired=new Set<string>();
 const emit=(e:ModelEvent)=>{if(!seen.has(e.id)){seen.add(e.id);events.push(e)}};
 const milestone=[100,500,1500,3000,6000,10000,15000];
 for(let year=2026;year<=2100;year++){
  const f=base.frames[year-2026],previous=frames.at(-1);const area=Array(N).fill(0),people=Array(N).fill(0),boost=Array(N).fill(0),drain=Array(N).fill(false);
  for(const p of actualPlan)if(active(p,year)){if(['dike','barrier','nature'].includes(p.kind))boost[p.region]+=CATALOG[p.kind].boost;if(p.kind==='drainage')drain[p.region]=true}
  let total=0,temporary=0,recovery=0,potentialArea=0,riskSum=0,marginSum=0;const riskMask=new Float32Array(n);
  for(let j=0;j<n;j++){
   const c=data.cells[j],r=c.r,baselineGate=data.regions[r].defenceNAP;
   // DEMO: progressive basin filling from actual regional floor, not altered terrain.
   // Final head cannot exceed the assumed external sea level. Spill still enforces coarse terrain connectivity.
   const progress=clamp((year-2035)/65),head=mode==='extreme'?Math.min(f.slr,minZ[r]-.15+(f.slr-minZ[r]+.15)*progress):f.slr;
   const previousHead=mode==='extreme'&&year>2026?Math.min(seaLevel(data,year-1,'stress'),minZ[r]-.15+(seaLevel(data,year-1,'stress')-minZ[r]+.15)*clamp((year-1-2035)/65)):head;
   const gateOpen=mode==='extreme'?year>=2035&&boost[r]<.1:f.slr>baselineGate+boost[r];
   const meanHead=(data.meta.baseMeanSeaNAP||0)+f.slr;
   const accessible=c.spill<=meanHead;
   // Conditional terrain exposure WITHOUT defences, not a flood forecast/probability.
   // Pressure index is depth/(depth+2m+assumed defence freeboard), dimensionless.
   const margin=baselineGate+boost[r]-meanHead;
   marginSum+=margin*c.area;
   if(accessible&&c.z<=meanHead){
    potentialArea+=c.area;
    const depth=Math.max(0,meanHead-c.z);
    riskMask[j]=depth/(depth+2+Math.max(0,margin));
    riskSum+=riskMask[j]*c.area;
   }
   const wet=gateOpen&&accessible&&c.z<=head;
   if(firstWet[j]>2100&&wet){
    const continuous=year>2026&&head>previousHead&&c.z>=previousHead?year-1+clamp((c.z-previousHead)/(head-previousHead)):year;
    firstWet[j]=Math.max(2026,continuous);
   }
   if(firstWet[j]<=year){total+=c.area;area[r]+=c.area;
    if(drain[r]&&boost[r]>.1&&recoveryYear[j]>2100)recoveryYear[j]=year;
    if(recoveryYear[j]<=year)recovery+=c.area;
   }
   // Temporary floods never modify the permanent ledger.
   const transient=f.waterNAP>baselineGate+boost[r]&&f.waterNAP>=c.spill&&Math.max(0,(f.waterNAP-c.z)*.35-(drain[r]?.35:0))>.1;
   if(transient&&firstWet[j]>year)temporary+=c.area;
  }
  for(let r=0;r<N;r++)people[r]=f.regions[r].population*(regionalLand[r]?area[r]/regionalLand[r]:0);
  const population=people.reduce((a,b)=>a+b,0);
  // Illustrative annual economic exposure at risk; not GDP loss or added to legacy cost accounting.
  const economic=people.reduce((v,p,r)=>v+p*data.regions[r].economicPerCapita/1e9,0);
  const demand=f.regions.map(r=>r.population*.0006),hard=Array(N).fill(false),grid=Array(N).fill(0);
  for(const p of actualPlan)if(active(p,year)){if(p.kind==='hardening')hard[p.region]=true;if(p.kind==='grid')grid[p.region]=1}
  const supply=demand.map((v,r)=>v*1.25*Math.max(0,1-(regionalLand[r]?area[r]/regionalLand[r]:0)*(hard[r]?.35:1.4)));
  const power=maxFlow(N,data.edges,supply,demand,grid).shortage;
  frames.push({year,slr:f.slr,permanentArea:total,permanentPeople:population,temporaryArea:temporary,recoveryArea:recovery,economicProxy:economic,regionalArea:area,regionalPeople:people,powerShortage:power,potentialArea,riskIndex:riskSum/regionalLand.reduce((a,b)=>a+b,0)*100,defenceMargin:marginSum/regionalLand.reduce((a,b)=>a+b,0),policyInvestment:(previous?.policyInvestment||0)+f.investment,base:f});
  riskMasks.push(riskMask);
  const demo=mode==='extreme';
  for(const m of milestone)if(total>=m&&!fired.has(`area-${m}`)){
   fired.add(`area-${m}`);const r=area.reduce((a,b,i)=>b>area[a]?i:a,0);
   emit({id:`permanent-area:${mode}:${m}`,year,kind:'permanent',severity:m>=3000?3:2,region:r,title:`영구 침수 ${m.toLocaleString()} km²`,en:`Permanent inundation ${m.toLocaleString()} km²`,cause:demo?'가정 방재·배수 상실과 점진적 유입. 실제 AHN 고도를 바꾸지 않은 시연입니다.':'공식 해수면 앵커와 가정 방재 한계의 탐색 결과입니다. 실제 홍수 예측이 아닙니다.',causeEn:'Assumed defence failure and gradual basin filling on unchanged AHN terrain; not an official forecast.',demo,value:total});
  }
  for(const name of ['Rotterdam','Amsterdam',"'s-Gravenhage",'Almere','Groningen']){
   const r=data.regions.findIndex(v=>v.name===name);if(r<0)continue;
   if(people[r]>=50000&&!fired.has(`city-${r}`)){fired.add(`city-${r}`);emit({id:`permanent-city:${mode}:${r}`,year,kind:'city',severity:3,region:r,title:`${name} · 5만 명 영향`,en:`${name} · 50,000 people exposed`,cause:'CBS 인구를 분석 셀 면적에 균등 배분한 영향 인구입니다. 실제 대피 인구가 아닙니다.',causeEn:'CBS population uniformly allocated over sampled land. Not observed evacuees.',demo,value:people[r]})}
  }
  for(const fac of data.facilities){if(fac.kind==='defence')continue;const r=fac.region;
   if((regionalLand[r]?area[r]/regionalLand[r]:0)>.2&&!fired.has('asset-'+fac.id)){fired.add('asset-'+fac.id);emit({id:`permanent-asset:${mode}:${fac.id}`,year,kind:'facility-permanent',severity:3,region:r,title:`${fac.name} · 중단 가정`,en:`${fac.name} · modelled interruption`,cause:'실제 OSM 위치. 지역 침수 비율 기반 예시이며 해당 시설의 실제 고장 예측이 아닙니다.',causeEn:'Real OSM location; regional exposure proxy, not a facility failure forecast.',demo,value:people[r]})}
  }
  for(let r=0;r<N;r++)if(power[r]>60&&!fired.has('perm-power-'+r)){fired.add('perm-power-'+r);emit({id:`permanent-power:${mode}:${r}`,year,kind:'power-permanent',severity:3,region:r,title:`${data.regions[r].name} · 전력 부족`,en:`${data.regions[r].name} · supply shortfall`,cause:'가정 용량의 지역 인접망에서 대체 공급 경로를 계산한 결과입니다. 실제 전력계통 예측이 아닙니다.',causeEn:'Maximum flow on an assumed-capacity regional graph, not the actual electricity grid.',demo,value:power[r]})}
  // Preserve the original model-driven facility/power/construction events, with explicit assumptions.
  for(const e of base.events.filter(e=>e.year===year&&['facility','power','start','complete','construction-flood','economy'].includes(e.kind))){
   const key=e.kind==='facility'?e.title:e.kind==='power'?`power:${e.region}`:e.id;
   if(e.kind==='power'&&e.value<60)continue;
   if((e.kind==='facility'||e.kind==='power')&&fired.has(key))continue;
   fired.add(key);emit({...e,kind:['start','complete'].includes(e.kind)?e.kind:'temporary-'+e.kind,demo,cause:MODES[mode].description+' '+e.cause});
  }
 }
 const priority=(e:ModelEvent)=>e.kind==='permanent'?90:e.kind==='city'?85:e.kind==='facility'?70:e.kind==='power'?60:40;
 events.sort((a,b)=>a.year-b.year||priority(b)-priority(a)||b.severity-a.severity||a.id.localeCompare(b.id));
 return {frames,firstWet,recoveryYear,events,plan:actualPlan,mode,riskMasks,areaDenominator:regionalLand.reduce((a,b)=>a+b,0),errors:[]};
}
export function eventStops(run:ProgressiveRun){const byYear=new Map<number,ModelEvent>();for(const e of run.events)if(!byYear.has(e.year))byYear.set(e.year,e);return [...byYear.values()]}
export function temporaryMask(data:Dataset,run:ProgressiveRun,year:number){
 const f=run.frames[Math.max(0,Math.min(74,Math.floor(year)-2026))].base;
 const boost=Array(data.regions.length).fill(0),drain=Array(data.regions.length).fill(0);
 for(const p of run.plan)if(active(p,Math.floor(year))){if(['dike','barrier','nature'].includes(p.kind))boost[p.region]+=CATALOG[p.kind].boost;if(p.kind==='drainage')drain[p.region]+=.35}
 return Float32Array.from(data.cells.map(c=>f.waterNAP>data.regions[c.r].defenceNAP+boost[c.r]&&f.waterNAP>=c.spill&&Math.max(0,(f.waterNAP-c.z)*.35-drain[c.r])>.1?1:0));
}

/** Smooth HUD interpolation; annual model outcomes and cell ledgers remain unchanged. */
export function frameAt(run:ProgressiveRun,time:number):ProgressiveFrame{
 const index=Math.max(0,Math.min(74,Math.floor(time)-2026)),a=run.frames[index],b=run.frames[Math.min(74,index+1)],t=clamp(time-Math.floor(time));
 const lerp=(x:number,y:number)=>x+(y-x)*t;
 const out={...a,year:time};
 for(const k of ['slr','permanentArea','permanentPeople','temporaryArea','recoveryArea','economicProxy','potentialArea','riskIndex','defenceMargin','policyInvestment'] as const)out[k]=lerp(a[k],b[k]);
 out.powerShortage=a.powerShortage.map((v,i)=>lerp(v,b.powerShortage[i]));
 return out;
}
export function riskAt(run:ProgressiveRun,index:number,time:number){
 const y=Math.max(0,Math.min(74,Math.floor(time)-2026)),t=clamp(time-Math.floor(time));
 return (run.riskMasks[y]?.[index]||0)*(1-t)+(run.riskMasks[Math.min(74,y+1)]?.[index]||0)*t;
}
