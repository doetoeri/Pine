/* ALTERWAY browser research engine. Adapted from scenario2040/candidate2040/research_optimizer.
   Arrival/departure identities, directed transfers and unavailable time edges are preserved. */
function createAlterwayEngine(){
'use strict';
const VERSION='tablet-1.1.0';
const PERIODS={peak:{label:'출퇴근',hours:6,share:.50,start:7},day:{label:'낮 시간',hours:9,share:.35,start:10},evening:{label:'저녁',hours:3,share:.15,start:21}};
const clone=o=>JSON.parse(JSON.stringify(o));
const finite=(x,min=0)=>typeof x==='number'&&Number.isFinite(x)&&x>=min;
function defaults(data){return {schema:'alterway-experiment-v1',name:'고1 수학 · 영등포–야탑 장거리 연결선',revision:0,headway:6,headways:{},period:'all',demandFactor:1,budget:4500000000000,unitCost:106435000000,speed:40,dwell:30,walk:180,trainKmCost:10000,layover:600,transferFilters:{official:true,diagram:true},transferEdits:{},extraTransfers:[],disabledEdges:[],edgeEdits:{},disabledLines:[],disabledStations:[],stationEdits:{},addedStations:{},routes:clone(data.initialB),generatorVersion:2,minKm:.55,maxKm:3.8,maxLength:45,maxDetour:1.7,maxCandidates:8,maxRoutes:1,minSavingRatio:1.3,minStops:18,maxStops:26,alignment:1.25,requireAccess:true,seed:20401024};}
function upgradeConfig(original){const c=clone(original);c.extraTransfers??=[];if(c.generatorVersion!==2){c.generatorVersion=2;c.minStops=7;c.maxStops=12;c.minKm=.6;c.maxKm=3;c.maxLength=Math.max(.1,Math.min(c.maxLength||20,c.budget/c.unitCost));c.revision=(c.revision||0)+1;}return c;}
function hav(a,b){if(!a||!b||!finite(a.lat,-90)||!finite(b.lat,-90)||!finite(a.lon,-180)||!finite(b.lon,-180))return NaN;const r=Math.PI/180;let z=Math.sin((b.lat-a.lat)*r/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin((b.lon-a.lon)*r/2)**2;return 6371*2*Math.asin(Math.sqrt(Math.min(1,z)));}
function stations(data,c){return Object.fromEntries(Object.entries({...data.stations,...c.addedStations}).map(([k,s])=>[k,{...s,...c.stationEdits[k]}]));}
function routeMetrics(r,ss,c){let seg=r.geometry?r.stops.slice(1).map((b,i)=>hav(ss[r.stops[i]],ss[b])*(c.alignment||1.25)):r.segments;seg=seg||[];const length=seg.reduce((a,b)=>a+b,0),chord=hav(ss[r.stops[0]],ss[r.stops.at(-1)]);return {segments:seg,length,cost:r.fixedCost||Math.round(length*c.unitCost/1e6)*1e6,detour:chord>0?length/(c.alignment||1.25)/chord:Infinity};}
function validate(c,data){if(!c||c.schema!=='alterway-experiment-v1')throw Error('지원하지 않는 실험 파일입니다.');const n=(k,lo,hi)=>{if(!finite(c[k],lo)||c[k]>hi)throw Error(k+' 값의 범위를 확인해 주세요.');};n('headway',1,60);n('demandFactor',.05,10);n('budget',0,1e15);n('unitCost',1,1e13);n('speed',1,300);n('dwell',0,600);n('walk',0,3600);n('trainKmCost',0,1e7);n('alignment',1,3);n('minKm',.1,100);n('maxKm',.1,200);n('maxLength',.1,500);n('maxCandidates',1,24);n('maxRoutes',1,8);n('minStops',7,30);n('maxStops',7,30);if(!Number.isInteger(c.minStops)||!Number.isInteger(c.maxStops)||c.minStops>c.maxStops)throw Error('최소·최대 정차역 수를 7~30 사이 정수로 지정해 주세요.');n('maxDetour',1,5);n('minSavingRatio',1,10);if(c.minKm>c.maxKm)throw Error('최소 구간 길이가 최대보다 큽니다.');if(!['all',...Object.keys(PERIODS)].includes(c.period))throw Error('시간대가 잘못되었습니다.');
 const ss=stations(data,c);for(const [k,s] of Object.entries(ss)){if(s.lat!==null&&(!finite(s.lat,-90)||s.lat>90))throw Error('위도 범위 오류: '+k);if(s.lon!==null&&(!finite(s.lon,-180)||s.lon>180))throw Error('경도 범위 오류: '+k);}
 for(const t of c.extraTransfers||[]){if(!ss[t.a]||!ss[t.b]||t.a===t.b||!finite(t.seconds,.01))throw Error('사용자 환승 식별자·시간 오류');} const ids=new Set;for(const r of c.routes){if(ids.has(r.id))throw Error('노선 ID 중복');ids.add(r.id);if(!r.id||r.stops.length<2||r.stops.length>100||new Set(r.stops).size!==r.stops.length||r.stops.some(id=>!ss[id]))throw Error('노선 정차역을 확인해 주세요.');if(!finite(r.speed,1)||!finite(r.dwell)||!finite(r.walk))throw Error('노선 운행 가정 오류');const m=routeMetrics(r,ss,c);if(m.segments.length!==r.stops.length-1||m.segments.some(v=>!finite(v,.00001)))throw Error('좌표나 구간 길이가 없는 노선입니다.');}
 for(const x of Object.values(c.headways))if(!finite(x,1)||x>60)throw Error('배차는 1~60분입니다.');for(const x of Object.values(c.edgeEdits))if(!finite(x,.01))throw Error('구간 시간은 양수여야 합니다.');for(const x of Object.values(c.transferEdits))if(x.seconds!==undefined&&!finite(x.seconds,.01))throw Error('환승 시간은 양수여야 합니다.');return true;}
function headway(c,line,dir,period){return c.headways[line+'|'+dir+'@'+period]??c.headways[line+'@'+period]??c.headways['*@'+period]??c.headway;}
function transferActive(t,c){if(c.transferEdits[t.id]?.enabled!==undefined)return c.transferEdits[t.id].enabled;return t.category==='official'?c.transferFilters.official:t.category==='diagram'?c.transferFilters.diagram:false;}
function buildGraph(data,c,scenario='0',period='peak'){
 const ss=stations(data,c),disabledS=new Set(c.disabledStations),disabledL=new Set(c.disabledLines),disabledE=new Set(c.disabledEdges),tm=new Map([...data.transfers,...(c.extraTransfers||[])].map(t=>[t.id,t]));
 const states=[],index=new Map,byStation={},edges=[],adj=[],diagnostics={missingPhaseTransfers:[],transferPhaseEdges:0,skippedEdges:0,activeProposals:0};
 function state(s){if(index.has(s.id))return index.get(s.id);let i=states.length;index.set(s.id,i);states.push(s);adj.push([]);(byStation[s.station]??=[]).push(i);return i;}
 for(const s of data.states)if(!disabledS.has(s.station)&&!disabledL.has(s.line))state({...s});
 function add(e){let u=index.get(e.u),v=index.get(e.v);if(u===undefined||v===undefined||disabledE.has(e.id)){diagnostics.skippedEdges++;return;}if(!finite(e.seconds))return;let wait=e.kind==='transfer'?headway(c,states[v].line,states[v].direction,period)*30:0;const item={...e,ui:u,vi:v,wait,total:e.seconds+wait};let k=edges.length;edges.push(item);adj[u].push(k);if(e.kind==='transfer')diagnostics.transferPhaseEdges++;}
 const seen=new Set;
 for(const src of data.edges){let e={...src,seconds:c.edgeEdits[src.id]??src.seconds};if(e.kind==='transfer'){let t=tm.get(e.transfer);if(!t||!transferActive(t,c))continue;e.seconds=c.transferEdits[t.id]?.seconds??t.seconds;seen.add(t.id);}add(e);}
 for(const t of [...data.transfers,...(c.extraTransfers||[])]){if(!transferActive(t,c))continue;if(['proposal','review','user'].includes(t.category))diagnostics.activeProposals++;if(seen.has(t.id))continue;let aa=(byStation[t.a]||[]).filter(i=>states[i].phase==='arrive'),bb=(byStation[t.b]||[]).filter(i=>states[i].phase==='depart');if(!aa.length||!bb.length){diagnostics.missingPhaseTransfers.push(t.id);continue;}for(const u of aa)for(const v of bb)add({id:t.id+':overlay:'+u+'>'+v,u:states[u].id,v:states[v].id,a:t.a,b:t.b,line:null,kind:'transfer',grade:'E',seconds:c.transferEdits[t.id]?.seconds??t.seconds,transfer:t.id});}
 const routes=scenario==='B'?c.routes:[];
 for(const r of routes.filter(r=>r.enabled!==false)){
  if(r.stops.some(s=>disabledS.has(s)))continue;const m=routeMetrics(r,ss,c),pre={};for(const sid of r.stops)pre[sid]=[...(byStation[sid]||[])];
  const attachments=r.attachments||r.stops.map(s=>[s]);let pi=(i,d,p)=>r.id+'|'+i+'|'+d+'|'+p;
  for(const d of ['F','R'])for(let i=0;i<r.stops.length;i++)for(const p of ['arrive','depart'])state({id:pi(i,d,p),station:r.stops[i],line:r.id,direction:d,phase:p,custom:true});
  for(const d of ['F','R']){
   const order=r.stops.map((_,i)=>i);if(d==='R')order.reverse();
   for(const i of order){let sid=r.stops[i];add({id:pi(i,d,'dwell'),u:pi(i,d,'arrive'),v:pi(i,d,'depart'),a:sid,b:sid,line:r.id,kind:'dwell',grade:'E',seconds:r.dwell});
    if(r.access!==false){const targets=attachments[i]||[];for(const target of targets){let existing=pre[target]||byStation[target]||[];for(const idx of existing){const s=states[idx];if(s.line===r.id)continue;if(s.phase==='arrive')add({id:pi(i,d,'board')+':'+s.id,u:s.id,v:pi(i,d,'depart'),a:s.station,b:sid,line:r.id,kind:'transfer',grade:'E',seconds:r.walk});else add({id:pi(i,d,'alight')+':'+s.id,u:pi(i,d,'arrive'),v:s.id,a:sid,b:s.station,line:r.id,kind:'transfer',grade:'E',seconds:r.walk});}}
    }
   }
   for(let j=0;j<order.length-1;j++){let a=order[j],b=order[j+1];add({id:r.id+':rail:'+a+'>'+b,u:pi(a,d,'depart'),v:pi(b,d,'arrive'),a:r.stops[a],b:r.stops[b],line:r.id,kind:'rail',grade:'E',seconds:m.segments[Math.min(a,b)]/r.speed*3600});}
  }
 }
 for(const row of adj)row.sort((a,b)=>edges[a].id.localeCompare(edges[b].id));
 return {states,index,byStation,edges,adj,ss,scenario,period,diagnostics};
}
class Heap{constructor(){this.a=[];}push(v,c){const a=this.a;let i=a.length;a.push([v,c]);while(i){let p=(i-1)>>1;if(a[p][1]<=c)break;a[i]=a[p];i=p;}a[i]=[v,c];}pop(){let a=this.a,top=a[0],last=a.pop();if(a.length){let i=0;while(true){let l=i*2+1;if(l>=a.length)break;let r=l+1,j=r<a.length&&a[r][1]<a[l][1]?r:l;if(a[j][1]>=last[1])break;a[i]=a[j];i=j;}a[i]=last;}return top;}get length(){return this.a.length;}}
function dijkstra(g,c,origin){const n=g.states.length,d=new Float64Array(n).fill(Infinity),wait=new Float64Array(n),walk=new Float64Array(n),ride=new Float64Array(n),transfers=new Float64Array(n),historic=new Float64Array(n),est=new Float64Array(n),pred=new Int32Array(n).fill(-1),order=[],heap=new Heap;
 for(const i of g.byStation[origin]||[])if(g.states[i].phase==='depart'){let s=g.states[i],w=headway(c,s.line,s.direction,g.period)*30;d[i]=w;wait[i]=w;est[i]=w;heap.push(i,w);}
 while(heap.length){let [u,cost]=heap.pop();if(cost!==d[u])continue;order.push(u);for(const ix of g.adj[u]){let e=g.edges[ix],v=e.vi,newcost=cost+e.total;if(newcost+1e-8<d[v]){d[v]=newcost;pred[v]=ix;wait[v]=wait[u]+e.wait;walk[v]=walk[u]+(e.kind==='transfer'?e.seconds:0);ride[v]=ride[u]+(e.kind!=='transfer'?e.seconds:0);transfers[v]=transfers[u]+(e.kind==='transfer'?1:0);historic[v]=historic[u]+(e.grade==='H'?e.seconds:0);est[v]=est[u]+(e.grade==='E'?e.seconds:0)+e.wait;heap.push(v,newcost);}}}
 return {d,wait,walk,ride,transfers,historic,est,pred,order};}
function target(g,tree,sid){let best=-1,cost=Infinity;for(const i of g.byStation[sid]||[])if(g.states[i].phase==='arrive'&&tree.d[i]<cost){best=i;cost=tree.d[i];}return best;}
function periodList(c){return c.period==='all'?Object.entries(PERIODS):[[c.period,{...PERIODS[c.period],share:1}]];}
function demandRows(data,c){return data.od;}
function evaluateGraph(data,c,scenario,progress=()=>{},wantFlows=true){const rows=demandRows(data,c),n=rows.length,metrics={times:new Float64Array(n),wait:new Float64Array(n),walk:new Float64Array(n),ride:new Float64Array(n),transfers:new Float64Array(n),historic:new Float64Array(n),estimated:new Float64Array(n)},group=new Map;rows.forEach((r,i)=>{if(!group.has(r[0]))group.set(r[0],[]);group.get(r[0]).push(i);});let edgeFlows={},flowsByPeriod={},last,done=0;
 for(const [period,desc] of periodList(c)){
  let g=buildGraph(data,c,scenario,period);last=g;const periodFlows={};flowsByPeriod[period]=periodFlows;
  for(const [origin,indices] of group){let tree=dijkstra(g,c,origin),loads=wantFlows?new Float64Array(g.states.length):null;
   for(const j of indices){let r=rows[j],v=origin===r[1]?-2:target(g,tree,r[1]),share=desc.share;if(v===-2)continue;if(v<0){metrics.times[j]=Infinity;continue;}metrics.times[j]+=tree.d[v]/60*share;metrics.wait[j]+=tree.wait[v]/60*share;metrics.walk[j]+=tree.walk[v]/60*share;metrics.ride[j]+=tree.ride[v]/60*share;metrics.transfers[j]+=tree.transfers[v]*share;metrics.historic[j]+=tree.historic[v]/60*share;metrics.estimated[j]+=tree.est[v]/60*share;if(loads)loads[v]+=r[2]*c.demandFactor*share;}
   if(loads)for(let k=tree.order.length-1;k>=0;k--){let v=tree.order[k],eix=tree.pred[v];if(eix>=0&&loads[v]>0){let e=g.edges[eix];loads[e.ui]+=loads[v];if(e.kind==='rail'){let key=e.a+'>'+e.b;edgeFlows[key]=(edgeFlows[key]||0)+loads[v];periodFlows[key]=(periodFlows[key]||0)+loads[v];}}}
   if(++done%90===0)progress({stage:'OD 계산 '+scenario,done,total:group.size*periodList(c).length});
  }
 }
 return {...metrics,edgeFlows,flowsByPeriod,graphSummary:{nodes:last.states.length,edges:last.edges.length,...last.diagnostics}};
}
function operations(data,c,scenario){let g=buildGraph(data,c,scenario,'peak'),groups={};for(const e of g.edges)if(e.kind==='rail'){const s=g.states[e.ui],key=s.line+'|'+s.direction,km=hav(g.ss[e.a],g.ss[e.b])*(c.alignment||1.25);let row=groups[key]??={id:key,line:s.line,direction:s.direction,seconds:0,km:0,segments:0,estimatedKm:0};row.seconds+=e.seconds;row.km+=Number.isFinite(km)?km:e.seconds/3600*c.speed;row.estimatedKm+=Number.isFinite(km)?0:1;row.segments++;}for(const e of g.edges)if(e.kind==='dwell'){const s=g.states[e.ui];if(groups[s.line+'|'+s.direction])groups[s.line+'|'+s.direction].seconds+=e.seconds;}
 let rows=[],cost=0,departures=0,km=0,fleet=0;for(const r of Object.values(groups)){let round=r.seconds*2+c.layover,serviceCost=0,dep=0,maxFleet=0;for(const [p,desc] of Object.entries(PERIODS)){let h=headway(c,r.line,r.direction,p),count=Math.floor(desc.hours*60/h);dep+=count;serviceCost+=count*r.km*c.trainKmCost;maxFleet=Math.max(maxFleet,Math.ceil(round/(h*60)));}rows.push({...r,roundMinutes:round/60,fleet:maxFleet,departures:dep,cost:serviceCost});cost+=serviceCost;departures+=dep;km+=dep*r.km;fleet+=maxFleet;}
 // Directional counts are separate proxy circuits; they are NOT real rolling-stock rosters.
 return {cost,departures,km,fleet,rows,model:'방향별 가용 구간 합계 × 2 + 회차 10분의 독립 가상 왕복 계통. 분기·미완성 시간자료를 포함한 차량 수 대리치; 실제 소요 편성 수 아님.'};}
function compare(data,c,progress=()=>{}){validate(c,data);let t0=Date.now(),raw={};for(const s of ['0','B'])raw[s]=evaluateGraph(data,c,s,progress,true);const n=data.od.length,common=new Uint8Array(n),weights=data.od.map(r=>r[2]*c.demandFactor);let commonQ=0,commonN=0,eligible=0;for(let i=0;i<n;i++){eligible+=weights[i];if(['0','B'].every(s=>Number.isFinite(raw[s].times[i]))){common[i]=1;commonQ+=weights[i];commonN++;}}
 let summary={};const ss=stations(data,c);for(const s of ['0','B']){let x=raw[s],tot=0,w=0,walk=0,ride=0,tr=0,reachable=0,reachN=0,newQ=0,hist=0,estimated=0;for(let i=0;i<n;i++){let q=weights[i];if(Number.isFinite(x.times[i])){reachable+=q;reachN++;if(!Number.isFinite(raw['0'].times[i]))newQ+=q;}if(common[i]){tot+=q*x.times[i];w+=q*x.wait[i];walk+=q*x.walk[i];ride+=q*x.ride[i];tr+=q*x.transfers[i];hist+=q*x.historic[i];estimated+=q*x.estimated[i];}}
 let routes=s==='A'?data.routesA:s==='B'?c.routes:[],cost=routes.filter(r=>r.enabled!==false).reduce((v,r)=>v+routeMetrics(r,ss,c).cost,0);summary[s]={scenario:s,total:tot,mean:commonQ?tot/commonQ:null,wait:commonQ?w/commonQ:null,walk:commonQ?walk/commonQ:null,ride:commonQ?ride/commonQ:null,transfers:commonQ?tr/commonQ:null,historicalPercent:tot?hist/tot*100:0,estimatedPercent:tot?estimated/tot*100:0,reachable,reachN,unreachable:eligible-reachable,newReachable:newQ,cost,budgetOK:cost<=c.budget,coverage:eligible?reachable/eligible*100:0,rawCoverage:reachable/(data.meta.coverage.raw_annual_people/366*c.demandFactor)*100,operations:operations(data,c,s),graph:x.graphSummary};}
 for(const s of ['0','B']){summary[s].saving=summary['0'].total-summary[s].total;summary[s].savingPercent=summary['0'].total?summary[s].saving/summary['0'].total*100:0;}
 return {schema:'alterway-result-v1',engine:VERSION,status:'provisional_pending_joint_approval',inputRevision:c.revision,summary,commonQ,commonN,eligible,eligibleN:n,excludedRawDemand:(data.meta.coverage.raw_annual_people-data.meta.coverage.eligible_annual_people)/366*c.demandFactor,rawDaily:data.meta.coverage.raw_annual_people/366*c.demandFactor,equalBudget:summary.B.budgetOK,budget:c.budget,flowScope:'각 시나리오에서 연결 가능한 OD의 경로 배정; 용량·혼잡·대기행렬 미모형화',period:c.period,periodModel:PERIODS,elapsedMs:Date.now()-t0,flows:Object.fromEntries(Object.entries(raw).map(([s,r])=>[s,r.edgeFlows])),flowsByPeriod:Object.fromEntries(Object.entries(raw).map(([s,r])=>[s,r.flowsByPeriod])),odTimes:Object.fromEntries(Object.entries(raw).map(([s,r])=>[s,Array.from(r.times,x=>Number.isFinite(x)?x:null)])),commonMask:Array.from(common)};}
function journey(data,c,scenario,origin,destination,period='peak'){const g=buildGraph(data,c,scenario,period);if(origin===destination)return {seconds:0,wait:0,walk:0,transfers:0,steps:[]};let tree=dijkstra(g,c,origin),v=target(g,tree,destination);if(v<0||!Number.isFinite(tree.d[v]))return {seconds:null,steps:[],reason:'자료 부족 또는 미연결'};let end=v,path=[];while(tree.pred[v]>=0&&path.length<g.states.length){let e=g.edges[tree.pred[v]];path.push(e);v=e.ui;}return {seconds:tree.d[end],wait:tree.wait[end],walk:tree.walk[end],transfers:tree.transfers[end],ride:tree.ride[end],initialWait:tree.d[v],steps:path.reverse().map(e=>({id:e.id,a:e.a,b:e.b,line:e.line||g.states[e.vi].line,kind:e.kind,seconds:e.seconds,wait:e.wait,grade:e.grade,source:e.source,ref:e.ref}))};}
/* Mission06 endpoint screening extended with a bounded geographic beam search.
   Every returned route satisfies the requested stop count; no two-stop fallback. */
function generate(data,c,progress=()=>{}){
 validate(c,data);
 const g=buildGraph(data,c,'0','peak'),ids=Object.keys(g.byStation).filter(s=>g.ss[s]?.lat!==null&&g.ss[s]?.lon!==null).sort(),N=ids.length,
  ss=g.ss,idx=new Map(ids.map((id,i)=>[id,i])),mass=new Float64Array(N),pair=new Map,reasons={},reject=k=>reasons[k]=(reasons[k]||0)+1,
  minStops=c.minStops,maxStops=c.maxStops,limitKm=Math.min(c.maxLength,c.budget/c.unitCost),chordLimit=limitKm/c.alignment,
  method='Mission06 종점 수요·시간 선별 + 방향·역 간격·회전각·우회율을 지키는 중간역 연속 탐색. 요청 정차역 수를 반드시 충족. 유한 탐색 대리지표이며 OD 효과·건설 타당성·전역 최적성의 증거가 아님.';
 const empty=message=>({routes:[],reasons,pairs:N*(N-1)/2,totalPassing:0,searchedSeeds:0,minStops,maxStops,limitKm,message,method,matrixNotReused:true});
 if((minStops-1)*c.minKm>chordLimit+1e-8)return empty('최소 '+minStops+'개 역과 역 간격을 지키려면 최소 '+((minStops-1)*c.minKm*c.alignment).toFixed(1)+'km가 필요하지만 현재 예산·길이 상한은 '+limitKm.toFixed(1)+'km입니다. 최소 역 간격을 줄이거나 상한을 검토해 주세요.');
 if(N<minStops)return empty('현재 시간자료와 좌표가 있는 서로 다른 역이 부족합니다.');
 for(const [a,b,q0] of data.od){const i=idx.get(a),j=idx.get(b),q=q0*c.demandFactor;if(i!==undefined)mass[i]+=q;if(j!==undefined)mass[j]+=q;if(i!==undefined&&j!==undefined)pair.set(i+','+j,(pair.get(i+','+j)||0)+q);}
 const distances=[],geo=[];let maxMass=Math.max(...mass,1);const massScore=Array.from(mass,x=>Math.log1p(x)/Math.log1p(maxMass)),names=ids.map(id=>ss[id].name.replace(/\s/g,'')),points=ids.map(id=>[(ss[id].lon-127)*88.2,(ss[id].lat-37.5)*111.2]);
 for(let i=0;i<N;i++){
  const tree=dijkstra(g,c,ids[i]),row=new Float64Array(N).fill(Infinity),km=new Float64Array(N);
  for(let j=0;j<N;j++){const v=target(g,tree,ids[j]);if(v>=0)row[j]=tree.d[v]/60;km[j]=hav(ss[ids[i]],ss[ids[j]]);}
  distances.push(row);geo.push(km);if(i%80===0)progress({stage:'현재 망 시간·역 간 거리 계산',done:i,total:N});
 }
 const direct=new Set(data.links.map(l=>[l.a,l.b].sort().join('~'))),near=ids.map((id,i)=>ids.map((_,j)=>j).filter(j=>geo[i][j]<=.5)),parallel=new Set;
 // Near records are used only to reject duplicate construction, never to authorize a transfer.
 for(const l of data.links){const a=idx.get(l.a),b=idx.get(l.b);if(a===undefined||b===undefined)continue;for(const i of near[a])for(const j of near[b])parallel.add(Math.min(i,j)+','+Math.max(i,j));}
 const neighbor=ids.map((_,i)=>ids.map((_,j)=>j).filter(j=>j!==i&&names[i]!==names[j]&&geo[i][j]>=c.minKm-1e-8&&geo[i][j]<=c.maxKm+1e-8));
 const seeds=[];
 for(let i=0;i<N;i++)for(let j=i+1;j<N;j++){
  const km=geo[i][j];if(km<Math.max(2,(minStops-1)*c.minKm*.55)||km>chordLimit){reject('종점 길이 범위');continue;}
  if(neighbor[i].length===0||neighbor[j].length===0){reject('종점 주변 중간역 부족');continue;}
  const old=Math.min(distances[i][j],distances[j][i]),directTime=km*c.alignment/c.speed*60+(minStops-2)*c.dwell/60+c.headway/2,
   support=(pair.get(i+','+j)||0)+(pair.get(j+','+i)||0)+.01*(mass[i]+mass[j]);
  if(!Number.isFinite(old)||support<=0||old<=directTime||old/(km/c.speed*60)<c.minSavingRatio){reject('종점 시간·수요 선별');continue;}
  seeds.push({a:i,b:j,km,score:support*(old-directTime)/Math.max(1,km*c.alignment)});
 }
 seeds.sort((a,b)=>b.score-a.score||ids[a.a].localeCompare(ids[b.a])||ids[a.b].localeCompare(ids[b.b]));
 // Spatial buckets prevent a single high-flow hub from exhausting the bounded search.
 const chosen=[],buckets=new Map;for(const seed of seeds){const a=points[seed.a],b=points[seed.b],key=[Math.floor(a[0]/4),Math.floor(a[1]/4),Math.floor(b[0]/4),Math.floor(b[1]/4)].join(',');let n=buckets.get(key)||0;if(n>=3)continue;buckets.set(key,n+1);chosen.push(seed);if(chosen.length>=Math.min(288,96+Math.max(0,minStops-7)*32))break;}
 if(!chosen.length)return empty('현재 조건에서 시간 단축 가능성이 있는 종점을 찾지 못했습니다. 역 간격·길이·예산 조건을 검토해 주세요.');
 const pool=[],seen=new Set,beamWidth=12,branchWidth=8;
 function sig(stops){const a=stops.map(i=>ids[i]).join('~'),b=[...stops].reverse().map(i=>ids[i]).join('~');return a<b?a:b;}
 function make(path){
  const signature=sig(path),stops=path.map(i=>ids[i]),segments=path.slice(1).map((j,i)=>geo[path[i]][j]*c.alignment),length=segments.reduce((a,b)=>a+b,0),chord=geo[path[0]][path.at(-1)];
  let newSegments=0,newKm=0,cum=[0];for(let i=0;i<segments.length;i++){cum.push(cum.at(-1)+segments[i]);if(!parallel.has(Math.min(path[i],path[i+1])+','+Math.max(path[i],path[i+1]))){newSegments++;newKm+=segments[i];}}
  if(newSegments<2||newKm/Math.max(.001,length)<.2){reject('기존 노선 복제 비율');return;}
  let score=0;for(let i=0;i<path.length;i++)for(let j=i+1;j<path.length;j++){const a=path[i],b=path[j],old=Math.min(distances[a][b],distances[b][a]),estimated=(cum[j]-cum[i])/c.speed*60+(j-i-1)*c.dwell/60+2*c.walk/60+c.headway/2,support=(pair.get(a+','+b)||0)+(pair.get(b+','+a)||0)+.01*(mass[a]+mass[b])/Math.max(1,path.length-1);if(Number.isFinite(old))score+=support*Math.max(0,old-estimated);}
  const r={id:'AUTO7:'+signature,name:ss[stops[0]].name+'–'+ss[stops.at(-1)].name+' 연결선',stops,segments,length,cost:Math.round(length*c.unitCost/1e6)*1e6,detour:chord?length/c.alignment/chord:Infinity,speed:c.speed,dwell:c.dwell,walk:c.walk,color:'#d63354',geometry:true,access:c.requireAccess,enabled:true,origin:'중간역 연속 탐색 v2 · 미검증 E',generatorVersion:2,score:score/Math.max(1,length),newSegments,stopCount:stops.length};
  if(r.cost>c.budget||length>c.maxLength+1e-8||r.detour>c.maxDetour+1e-8){reject('완성 노선 예산·우회율');return;}if(seen.has(signature))return;seen.add(signature);pool.push(r);
 }
 for(let si=0;si<chosen.length;si++){
  const seed=chosen[si],a=seed.a,b=seed.b,A=points[a],B=points[b],dx=B[0]-A[0],dy=B[1]-A[1],den=dx*dx+dy*dy,
   projection=i=>((points[i][0]-A[0])*dx+(points[i][1]-A[1])*dy)/den,
   lateral=i=>Math.abs((points[i][0]-A[0])*dy-(points[i][1]-A[1])*dx)/Math.sqrt(den),targetCount=minStops+si%(maxStops-minStops+1);
  let beam=[{path:[a],km:0,quality:0,mass:massScore[a],proj:0}];
  for(let count=2;count<=maxStops&&beam.length;count++){
   const next=[];
   for(const state of beam){
    const last=state.path.at(-1),previous=state.path.at(-2),options=[];
    for(const j of neighbor[last]){
     if(state.path.includes(j)||state.path.some(i=>names[i]===names[j]))continue;
     if(j===b&&count<minStops)continue;
     const p=projection(j),step=geo[last][j],km=state.km+step,toEnd=geo[j][b],left=maxStops-count;
     if(p<=state.proj+Math.min(.02,c.minKm/seed.km*.2)||p>1.03||lateral(j)>Math.max(1.2,seed.km*.35))continue;
     if(km+toEnd>chordLimit+1e-8||(km+toEnd)/seed.km>c.maxDetour+1e-8)continue;
     if(j!==b&&(left<1||toEnd>left*c.maxKm+1e-8))continue;
     if(j!==b&&state.path.some(i=>geo[i][j]<Math.min(.35,c.minKm*.75)))continue;
     let turn=0;if(previous!==undefined){const u=points[previous],v=points[last],w=points[j],vx=v[0]-u[0],vy=v[1]-u[1],wx=w[0]-v[0],wy=w[1]-v[1];turn=Math.abs(Math.atan2(vx*wy-vy*wx,vx*wx+vy*wy))*180/Math.PI;if(turn>75)continue;}
     const ideal=Math.max(c.minKm,Math.min(c.maxKm,geo[last][b]/Math.max(1,targetCount-state.path.length))),quality=state.mass/(count-1)+massScore[j]*.3-Math.abs(step-ideal)/Math.max(.5,ideal)*.3-turn/75*.15-km/Math.max(.1,chordLimit)*.08;
     options.push({path:[...state.path,j],km,quality,mass:state.mass+massScore[j],proj:p});
    }
    options.sort((x,y)=>y.quality-x.quality||ids[x.path.at(-1)].localeCompare(ids[y.path.at(-1)]));
    // Keep valid endpoints independently of beam truncation, so count constraints are exact.
    for(const x of options)if(x.path.at(-1)===b)make(x.path);
    next.push(...options.filter(x=>x.path.at(-1)!==b).slice(0,branchWidth));
   }
   next.sort((x,y)=>y.quality-x.quality||sig(x.path).localeCompare(sig(y.path)));const byTip=new Map;
   beam=[];for(const x of next){const key=x.path.at(-1),n=byTip.get(key)||0;if(n>=2)continue;byTip.set(key,n+1);beam.push(x);if(beam.length>=beamWidth)break;}
  }
  if(si%8===0)progress({stage:minStops+'~'+maxStops+'개 역을 잇는 연속 노선 탐색',done:si,total:chosen.length});
 }
 pool.sort((a,b)=>b.score-a.score||b.stops.length-a.stops.length||a.id.localeCompare(b.id));
 const selected=[],segmentSets=new Map;
 for(const r of pool){const segments=new Set(r.stops.slice(1).map((s,i)=>[r.stops[i],s].sort().join('~')));let duplicate=false;for(const x of selected){const other=segmentSets.get(x.id),intersection=[...segments].filter(x=>other.has(x)).length;if(intersection/Math.min(segments.size,other.size)>=.8){duplicate=true;break;}}if(duplicate)continue;selected.push(r);segmentSets.set(r.id,segments);if(selected.length>=c.maxCandidates)break;}
 return {routes:selected,reasons,pairs:N*(N-1)/2,totalPassing:pool.length,searchedSeeds:chosen.length,minStops,maxStops,limitKm,method,matrixNotReused:true,message:selected.length?'':('현재 조건을 모두 만족하는 '+minStops+'~'+maxStops+'개 역 노선을 찾지 못했습니다. 최소 역 간격을 줄이거나 최대 역 간격을 늘리고 예산·길이·우회율 조건을 검토해 주세요. 정차역 수는 임의로 줄이지 않았습니다.')};
}
function optimizeRoutes(data,c,candidates,progress=()=>{}){validate(c,data);let base=evaluateGraph(data,{...c,routes:[]},'0',()=>{},false),mask=base.times.map(v=>Number.isFinite(v)?1:0),cache=new Map,traces=[],ss=stations(data,c),byId=new Map(candidates.map(r=>[r.id,r]));
 function cost(rs){return rs.reduce((s,r)=>s+routeMetrics(r,ss,c).cost,0);}function conflict(rs){let keys=new Set;for(const r of rs)for(let i=0;i<r.stops.length-1;i++){let key=[r.stops[i],r.stops[i+1]].sort().join('~');if(keys.has(key))return true;keys.add(key);}return false;}
 function objective(rs){let key=rs.map(r=>r.id).sort().join(';');if(cache.has(key))return cache.get(key);progress({stage:'실제 OD 재평가 · '+(cache.size+1)+'개 조합',done:cache.size,total:candidates.length*c.maxRoutes});let x=rs.length?evaluateGraph(data,{...c,routes:rs},'B',()=>{},false):base,total=0;for(let i=0;i<data.od.length;i++)if(mask[i]){if(!Number.isFinite(x.times[i]))return Infinity;total+=x.times[i]*data.od[i][2]*c.demandFactor;}cache.set(key,total);traces.push({routes:rs.map(r=>r.id),cost:cost(rs),total});return total;}
 let ref=objective([]),bestSingle={routes:[],total:ref,cost:0};for(const r of candidates){if(cost([r])>c.budget)continue;let value=objective([r]);if(value<bestSingle.total)bestSingle={routes:[r],total:value,cost:cost([r])};}
 let selected=[],current=ref;for(let round=0;round<c.maxRoutes;round++){let winner=null;for(const r of candidates){if(selected.some(x=>x.id===r.id))continue;let trial=[...selected,r];if(cost(trial)>c.budget||conflict(trial))continue;let value=objective(trial),gain=current-value,ratio=gain/Math.max(1,routeMetrics(r,ss,c).cost);if(gain>1e-6&&(!winner||ratio>winner.ratio))winner={r,value,ratio};}if(!winner)break;selected.push(winner.r);current=winner.value;}
 // 고1 경우의 수: 생성된 후보가 8개 이하이면 가능한 1~3개 노선 조합을 모두 비교한다.
 let exact=null;
 if(candidates.length<=8&&c.maxRoutes<=3){
  let winner={routes:[],total:ref,cost:0};
  function visit(start,chosen){
   if(chosen.length){let cc=cost(chosen);if(cc<=c.budget&&!conflict(chosen)){let v=objective(chosen);if(v<winner.total-1e-6)winner={routes:[...chosen],total:v,cost:cc};}}
   if(chosen.length>=c.maxRoutes)return;
   for(let j=start;j<candidates.length;j++){let next=[...chosen,candidates[j]];if(cost(next)<=c.budget&&!conflict(next))visit(j+1,next);}
  }
  visit(0,[]);exact=winner;
 }
 const multi={routes:selected,total:current,cost:cost(selected)},greedyBest=bestSingle.total<multi.total?bestSingle:multi,best=exact&&exact.total<greedyBest.total?exact:greedyBest;
 return {baseline:ref,single:bestSingle,multi,best,exact,traces,evaluations:cache.size,commonN:mask.reduce((a,b)=>a+b,0),method:exact?'생성된 최대 8개 후보에서 예산·구간 중복 조건을 만족하는 최대 3개 노선 조합을 경우의 수로 전수 비교. 생성되지 않은 노선까지 포함한 전역 최적해는 아님.':'고정된 현재 기준망 OD에서 재계산 · 최선 단일노선과 한계효과/비용 탐욕 선택 비교. 유한 후보의 전역 최적성 보장 없음.'};}
function optimizeHeadway(data,c,scenario,budget,progress=()=>{}){let trials=[];for(const h of [3,4,6,8,10,12,15,20]){let trial={...c,headway:h,headways:{}},op=operations(data,trial,scenario);progress({stage:'공통 배차 '+h+'분 민감도',done:trials.length,total:8});let value=null;if(op.cost<=budget){let r=evaluateGraph(data,trial,scenario,()=>{},false);value=0;for(let i=0;i<data.od.length;i++)if(Number.isFinite(r.times[i]))value+=r.times[i]*data.od[i][2]*c.demandFactor;}trials.push({headway:h,cost:op.cost,total:value,feasible:op.cost<=budget});}let feasible=trials.filter(t=>t.feasible&&t.total!==null).sort((a,b)=>a.total-b.total||a.cost-b.cost);return {trials,best:feasible[0]||null,scenario,model:'8개 공통 배차 후보의 정적 OD 비교. 적용 시 0/A/B에 공통 적용하며 기존 개별 배차 입력을 초기화. 실제 시간표·용량 제약·노선별 전역 최적화 아님.'};}
function trainServices(data,c,scenario,period='peak'){let g=buildGraph(data,c,scenario,period),groups={};g.edges.forEach((e,i)=>{if(e.kind!=='rail'||g.ss[e.a]?.lat===null||g.ss[e.b]?.lat===null)return;const s=g.states[e.ui],key=s.line+'|'+s.direction;(groups[key]??=[]).push(e);});let out=[];for(const [group,edges] of Object.entries(groups)){let remaining=new Set(edges.map(e=>e.id)),from={},incoming={};for(const e of edges){(from[e.a]??=[]).push(e);incoming[e.b]=(incoming[e.b]||0)+1;}edges.sort((a,b)=>(incoming[a.a]===1?1:0)-(incoming[b.a]===1?1:0)||a.id.localeCompare(b.id));let count=0;for(const e0 of edges){if(!remaining.has(e0.id))continue;let segs=[],e=e0,t=0;while(e&&remaining.has(e.id)){remaining.delete(e.id);segs.push({a:e.a,b:e.b,start:t,end:t+e.seconds,line:e.line});t+=e.seconds+30;const next=(from[e.b]||[]).filter(x=>remaining.has(x.id));e=next.length===1?next[0]:null;}if(segs.length){const s=g.states[e0.ui];out.push({id:group+'#'+(++count),line:s.line,direction:s.direction,segments:segs,duration:t,headway:headway(c,s.line,s.direction,period)*60});}}}return out;}
function trainPositions(services,seconds){let result=[];for(const s of services){if(s.duration<=0)continue;let max=Math.min(80,Math.ceil(s.duration/s.headway));for(let n=0;n<max;n++){let departure=Math.floor(seconds/s.headway)-n;if(departure<0)continue;let elapsed=seconds-departure*s.headway;if(elapsed>s.duration)continue;let seg=s.segments.find(x=>elapsed>=x.start&&elapsed<=x.end);if(seg)result.push({id:s.id+'·'+departure,line:s.line,service:s.id,a:seg.a,b:seg.b,fraction:(elapsed-seg.start)/(seg.end-seg.start)});}}return result;}
function resultCSV(result){const fields=['scenario','total','mean','wait','walk','transfers','cost','saving','coverage','rawCoverage','unreachable'];return '\ufeff'+[fields.join(','),...Object.values(result.summary).map(r=>fields.map(k=>r[k]??'').join(','))].join('\r\n');}
return {VERSION,PERIODS,defaults,upgradeConfig,hav,stations,routeMetrics,validate,headway,transferActive,buildGraph,dijkstra,target,evaluateGraph,compare,journey,generate,optimizeRoutes,operations,optimizeHeadway,trainServices,trainPositions,resultCSV};
}
if(typeof module!=='undefined')module.exports={createAlterwayEngine};
