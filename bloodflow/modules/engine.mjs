import {World as LegacyWorld,rng,poisson,Heap,setDualObserver} from './legacy-core.mjs';
import {PRODUCTS,BLOOD_TYPES,compatible,observe} from './biology.mjs';
import {geographyConfig,allowedSource} from './geography.mjs';
setDualObserver(observe);
export const DEFAULTS={network:'incheon',redistribution:'A',seed:20261021,safetyDays:3,policy:'FEFO',volatility:.35,delay:1,reviewPeriod:6,product:'MIX',compatibility:'compatible',shelfFraction:1,excursion:'none',agitation:true,sharing:true,scenario:'normal',lab:1,hours:1,cooling:'active',ambient:30,insulation:'high',storage:'regulated',routeMode:'road'};
export function validateConfig(input={},data){
 const c={...DEFAULTS,...input};
 const num=(k,lo,hi)=>{if(typeof c[k]!=='number'||!Number.isFinite(c[k])||c[k]<lo||c[k]>hi)throw Error('잘못된 실험 조건: '+k)};
 num('seed',0,4294967295);if(!Number.isInteger(c.seed))throw Error('난수 시드는 정수여야 합니다.');
 num('lab',.1,10);num('hours',.01,48);num('ambient',-40,60);if(c.routeMode!=='road')throw Error('저장된 도로 경로 모드를 사용하세요.');
 num('safetyDays',.25,20);num('volatility',0,1.5);num('delay',1,12);num('reviewPeriod',1,24);num('shelfFraction',.05,1);
 for(const [k,arr] of Object.entries({policy:['FEFO','FIFO'],product:['MIX','RBC','PLT','FFP'],compatibility:['compatible','identical'],excursion:['none','transport','storage'],scenario:['normal','crisis']}))if(!arr.includes(c[k]))throw Error('잘못된 범주: '+k);
 if(typeof c.agitation!=='boolean'||typeof c.sharing!=='boolean')throw Error('조건은 참/거짓이어야 합니다.');
 if(!['incheon','nationwide'].includes(c.network)||!['A','B','C'].includes(c.redistribution))throw Error('공급망 범위·전국 정책을 확인하세요.');
 if(data)Object.assign(c,geographyConfig(data,c.network));
 const expected=c.network==='nationwide'?100:4;
 if(!Array.isArray(c.realNodes)||c.realNodes.length!==expected||!c.realNodes.some(n=>n.type==='center')||!c.realNodes.some(n=>n.type==='hospital')||c.realNodes.some(n=>!['center','hospital'].includes(n.type)||!Number.isFinite(n.lat)||!Number.isFinite(n.lon))||!Array.isArray(c.roadHours)||c.roadHours.length!==expected||c.roadHours.some(row=>!Array.isArray(row)||row.length!==expected||row.some(n=>!Number.isFinite(n)||n<0)))throw Error('기관과 완전한 이동시간 행렬이 필요합니다.');
 const centers=c.realNodes.filter(n=>n.type==='center').length;
 if(c.realNodes.slice(0,centers).some(n=>n.type!=='center'))throw Error('공급 거점을 먼저 정렬하세요.');
 if(c.network==='nationwide'&&(!Array.isArray(c.regions)||c.regions.length!==17||c.realNodes.some(n=>!c.regions.some(r=>r.id===n.regionId))))throw Error('17개 고정 연구권역 구성이 잘못되었습니다.');
 return c;
}
function hashKey(seed,key){let h=seed>>>0;for(const ch of key){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
function randomFor(seed,key){return rng(hashKey(seed,key))}
function productFor(c,r){return c.product==='MIX'?(['RBC','RBC','RBC','PLT','PLT','FFP'][Math.floor(r()*6)]):c.product}
function statusActive(u){return ['ready','queue','truck','review'].includes(u.status)}
export class DualWorld extends LegacyWorld{
 constructor(input={},data){
  const c=validateConfig(input,data);super(c);
  for(let i=0;i<this.nodes.length;i++)Object.assign(this.nodes[i],Object.fromEntries(['regionId','supplyGroup','virtual','verification','baselineId','addr','officialSource','uid'].filter(k=>k in c.realNodes[i]).map(k=>[k,c.realNodes[i][k]])));
  this.inventoryArea=0;this.inventoryAt=0;this.monitorAt=0;this.transportTotal=0;this.deliveredShipments=0;this.demandFingerprint=2166136261;
  this.requestLog=[];this.initialCreated=this.metrics.created;this.reviewDecisions=[];this.lastPolicyAt=-Infinity;
  for(let h=this.nc;h<this.nodes.length;h++)for(let j=0;j<12;j++)this.newUnit(h,0,true);
  this.initialCreated=this.metrics.created;this.stockHighWater=this.stockCount();this.archivedCount=0;
  this.activeIds=new Set([...this.units.values()].filter(statusActive).map(u=>u.id));
  this.transferLog=[];this.flowTotals={};this.unitKilometers=0;this.costUnits=0;
  this.nodeMetrics=this.nodes.map(()=>({created:0,expired:0,quality:0,rejected:0,exported:0,imported:0,arrivedImports:0}));
  for(const u of this.units.values())this.nodeMetrics[u.node].created++;
  this.regionDaily=Object.fromEntries((c.regions??[]).map(r=>[r.id,this.nodes.filter(n=>n.type==='hospital'&&n.regionId===r.id).reduce((a,n)=>a+n.dem*2.4,0)]));
  if(c.network==='nationwide')for(const n of this.nodes.slice(0,this.nc))n.capacity=Math.ceil((this.regionDaily[n.regionId]??28)*2);
  this.sourceOrder=this.nodes.map(h=>this.nodes.slice(0,this.nc).filter(n=>c.network!=='nationwide'||allowedSource(n,h,c.redistribution,c.regions)).sort((a,b)=>(c.network==='nationwide'?Number(b.regionId===h.regionId)-Number(a.regionId===h.regionId):0)||this.travelHours(a.id,h.id)-this.travelHours(b.id,h.id)));

  const rebuilt=new Heap();for(const e of this.events.arr)if(e.type!=='day')rebuilt.push(e.at,e.type,e.info);rebuilt.push(3,'day');this.events=rebuilt;this.lastPolicyAt=0;
  this.events.push(.5,'monitor');this.replenish();
 }
 newUnit(node,time,ready=false){
  const id='BF-DUAL-'+String(++this.uid).padStart(7,'0'),r=randomFor(this.c.seed,'unit:'+this.uid),kind=productFor(this.c,r),p=PRODUCTS[kind];
  const initial=ready&&time===0,age=initial?r()*p.lifeHours*.85:0;
  const created=time-age,expiry=time+(p.lifeHours-age)*this.c.shelfFraction;
  const u={dual:true,id,kind,bloodType:BLOOD_TYPES[Math.floor(r()*8)],created,manufactured:created,expiry,status:ready?'ready':'queue',node,
   temperature:p.set,minimum:p.set,maximum:p.set,tau:1,modeSince:time,thermalAt:time,shipping:null,storageHours:0,transitHours:0,doseLow:0,doseHigh:0,outHours:0,review:false,reviewReason:'',note:'',trace:[{h:time,t:p.set,stage:'storage',synthetic:true}],events:[{h:time,text:initial?'동일 시드 초기 가상 재고':'가상 입고·검사 대기'}]};
  this.units.set(id,u);this.activeIds?.add(id);if(this.nodeMetrics)this.nodeMetrics[node].created++;this.metrics.created++;this.nodes[node][ready?'stock':'queue'].push(id);this.events.push(expiry,'expire',{id});return u;
 }
 finalize(u){
  this.activeIds?.delete(u.id);
  if(this.c.network==='nationwide'){if(this.units.delete(u.id))this.archivedCount=(this.archivedCount??0)+1;return;}
  // Completed packs retain audit summaries; active packs keep detailed traces.
  const compact={};for(const k of ['dual','id','kind','bloodType','created','manufactured','expiry','status','node','review','reviewReason','minimum','maximum','outHours','temperature'])compact[k]=u[k];
  compact.terminalAt=this.t;compact.trace=u.trace?.length>1?[u.trace[0],u.trace.at(-1)]:u.trace;compact.events=u.events?.slice(-3);this.units.set(u.id,compact);
 }
 discard(u,reason){
  if(!u||!statusActive(u))return;const node=u.node??u.originNode;
  if(this.nodeMetrics&&this.nodeMetrics[node]&&['expired','quality','rejected'].includes(reason))this.nodeMetrics[node][reason]++;
  super.discard(u,reason);if(!statusActive(u))this.finalize(u);
 }
 activeUnits(){return this.activeIds?[...this.activeIds].map(id=>this.units.get(id)).filter(Boolean):[...this.units.values()].filter(statusActive);}
 centerFor(h){if(this.c.network!=='nationwide')return super.centerFor(h);return this.nodes.slice(0,this.nc).filter(n=>n.regionId===h.regionId).sort((a,b)=>this.travelHours(h.id,a.id)-this.travelHours(h.id,b.id))[0];}


 gate(u){
  if(!u||u.status!=='ready')return false;
  if(u.expiry<=this.t){this.discard(u,'expired');return false;}
  observe(u,this.t,this.c);
  if(u.review){this.hold(u);return false;}return true;
 }
 hold(u){
  if(!u||!['ready','queue','truck'].includes(u.status))return;
  if(u.status==='truck')return; // Kept inside vehicle, then quarantined on arrival.
  const n=this.nodes[u.node];n.stock=n.stock.filter(x=>x!==u.id);n.queue=n.queue.filter(x=>x!==u.id);if(!n.review.includes(u.id))n.review.push(u.id);
  u.status='review';this.metrics.review++;u.events.push({h:this.t,text:'가상 기록 검토 보류: '+u.reviewReason});
 }
 take(node,number,kind,recipient){
  const candidates=node.stock.slice().map(x=>this.get(x)).filter(u=>u&&(!kind||u.kind===kind)&&(!recipient||compatible(u.kind,u.bloodType,recipient,this.c.compatibility)))
   .sort((a,b)=>(recipient?Number(b.bloodType===recipient)-Number(a.bloodType===recipient):0)||(this.c.policy==='FIFO'?a.created-b.created:a.expiry-b.expiry)||a.id.localeCompare(b.id));
  const ids=[];for(const u of candidates){if(ids.length>=number)break;if(this.gate(u))ids.push(u.id);}
  const set=new Set(ids);node.stock=node.stock.filter(id=>!set.has(id));return ids;
 }
 travelHours(a,b){if(a===b)return 0;return this.c.roadHours?.[a]?.[b]*this.c.delay;}
 dispatch(from,to,ids){
  const eligible=ids.length>0&&new Set(ids).size===ids.length&&ids.every(id=>{const u=this.get(id);return u?.status==='ready'&&u.node===from.id&&!u.review&&u.expiry>this.t+this.travelHours(from.id,to.id)});
  const truck=this.trucks.find(t=>!t.busy&&t.at===from.id);
  if(!eligible||!truck||ids.length>truck.capacity||!Number.isFinite(this.travelHours(from.id,to.id))){for(const id of ids)if(this.get(id)?.status==='ready'&&this.get(id)?.node===from.id&&!from.stock.includes(id))from.stock.push(id);return false;}
  if(truck)truck.departedWithCargo=ids.length;
  const ok=super.dispatch(from,to,ids);
  if(ok){
   if(this.c.network==='nationwide')truck.returnCenter=from.type==='center'?from.id:this.centerFor(from)?.id;
   for(const id of ids)this.get(id).originNode=from.id;
   if(this.c.network==='nationwide'){
    const km=this.c.roadHours[from.id][to.id]*60; // explicitly named proxy units; not road distance
    this.unitKilometers+=km*ids.length;this.costUnits+=20+km*.6;
    if(from.regionId!==to.regionId){this.nodeMetrics[from.id].exported+=ids.length;this.nodeMetrics[to.id].imported+=ids.length;const k=from.regionId+'>'+to.regionId;this.flowTotals[k]=(this.flowTotals[k]??0)+ids.length;this.transferLog.push({at:this.t,from:from.regionId,to:to.regionId,units:ids.length,vehicle:truck.id,arrival:truck.arrival,estimated:from.baselineId===undefined||to.baselineId===undefined});if(this.transferLog.length>160)this.transferLog.shift();}
   }
  }
  if(!ok)for(const id of ids)if(!from.stock.includes(id))from.stock.push(id);return ok;
 }
 arrival(tr){
  for(const id of [...tr.load]){const u=this.get(id);if(u?.expiry<=this.t)this.discard(u,'expired');}
  if(this.c.network==='nationwide'&&tr.from!==null&&tr.to!==null&&this.nodes[tr.from].regionId!==this.nodes[tr.to].regionId)this.nodeMetrics[tr.to].arrivedImports+=tr.load.length;
  const duration=this.t-tr.departure,loaded=tr.departedWithCargo??tr.load.length;super.arrival(tr);
  if(loaded){this.transportTotal+=duration;this.deliveredShipments++;}
 }
 replenish(){
  if(this.c.network==='nationwide')return this.replenishNational();
  const kinds=this.c.product==='MIX'?['RBC','PLT','FFP']:[this.c.product],weights={RBC:.5,PLT:1/3,FFP:1/6};
  for(const h of this.nodes.slice(this.nc)){
   const inbound=this.trucks.filter(t=>t.busy&&t.to===h.id).flatMap(t=>t.load).map(id=>this.get(id)).filter(u=>u?.status==='truck');
   const projected={};for(const k of kinds)for(const bt of BLOOD_TYPES)projected[k+bt]=0;
   for(const u of [...h.stock.map(id=>this.get(id)),...inbound])if(u?.status==='ready'||u?.status==='truck')projected[u.kind+u.bloodType]=(projected[u.kind+u.bloodType]||0)+1;
   const targets=Object.fromEntries(kinds.map(k=>[k,Math.max(1,Math.ceil(h.dem*2.4*this.c.safetyDays*(this.c.product==='MIX'?weights[k]:1)))]));
   const sources=this.c.network==='nationwide'?this.sourceOrder[h.id]:[...this.nodes.slice(0,this.nc),...(this.c.sharing?this.nodes.slice(this.nc).filter(n=>n!==h&&n.stock.length>Math.ceil(n.dem*2.4*(this.c.safetyDays+1))):[])];
   for(const n of sources){
    const tr=this.trucks.find(t=>!t.busy&&t.at===n.id);if(!tr)continue;
    if(this.c.network==='nationwide'&&n.regionId!==h.regionId&&n.stock.length<=Math.ceil((this.regionDaily[n.regionId]??0)*.5))continue;
    const travel=this.travelHours(n.id,h.id);if(!Number.isFinite(travel))continue;
    const ids=[];
    const reserve=this.c.network==='nationwide'&&n.regionId!==h.regionId?Math.ceil((this.regionDaily[n.regionId]??0)*.5):0;
    const cap=Math.min(tr.capacity,Math.max(0,n.stock.length-reserve));
    while(ids.length<cap){
     const pool=n.stock.map(id=>this.get(id)).filter(u=>u&&!ids.includes(u.id)&&kinds.includes(u.kind)&&u.expiry>this.t+travel&&BLOOD_TYPES.reduce((sum,bt)=>sum+(projected[u.kind+bt]||0),0)<targets[u.kind]);
     pool.sort((a,b)=>((targets[b.kind]/8-(projected[b.kind+b.bloodType]||0))-(targets[a.kind]/8-(projected[a.kind+a.bloodType]||0)))||(this.c.policy==='FIFO'?a.created-b.created:a.expiry-b.expiry)||a.id.localeCompare(b.id));
     const u=pool.find(u=>this.gate(u));if(!u)break;ids.push(u.id);projected[u.kind+u.bloodType]++;
    }
    const selected=new Set(ids);n.stock=n.stock.filter(id=>!selected.has(id));
    if(this.dispatch(n,h,ids)&&n.type==='hospital')this.metrics.interhospital+=ids.length;
    if(this.c.network==='nationwide'&&ids.length)break;
   }
  }
 }

 replenishNational(){
  const kinds=this.c.product==='MIX'?['RBC','PLT','FFP']:[this.c.product],weights={RBC:.5,PLT:1/3,FFP:1/6},bins=new Map();
  for(const source of this.nodes.slice(0,this.nc)){
   const byType=new Map();for(const id of source.stock){const u=this.get(id);if(!u||u.status!=='ready')continue;const key=u.kind+u.bloodType;if(!byType.has(key))byType.set(key,[]);byType.get(key).push(u);}
   for(const list of byType.values())list.sort((a,b)=>(this.c.policy==='FIFO'?a.created-b.created:a.expiry-b.expiry)||a.id.localeCompare(b.id));bins.set(source.id,byType);
  }
  const inbound=new Map();for(const tr of this.trucks)if(tr.busy&&tr.load.length){if(!inbound.has(tr.to))inbound.set(tr.to,[]);inbound.get(tr.to).push(...tr.load);}
  for(const h of this.nodes.slice(this.nc)){
   const projected={},totals=Object.fromEntries(kinds.map(k=>[k,0]));for(const k of kinds)for(const bt of BLOOD_TYPES)projected[k+bt]=0;
   for(const id of [...h.stock,...(inbound.get(h.id)??[])]){const u=this.get(id);if(u&&['ready','truck'].includes(u.status)&&!u.review){projected[u.kind+u.bloodType]=(projected[u.kind+u.bloodType]??0)+1;totals[u.kind]=(totals[u.kind]??0)+1;}}
   const targets=Object.fromEntries(kinds.map(k=>[k,Math.max(1,Math.ceil(h.dem*2.4*this.c.safetyDays*(this.c.product==='MIX'?weights[k]:1)))]));
   if(kinds.every(k=>totals[k]>=targets[k]))continue;
   for(const source of this.sourceOrder[h.id]){
    const tr=this.trucks.find(t=>!t.busy&&t.at===source.id);if(!tr)continue;
    const reserve=source.regionId!==h.regionId?Math.ceil((this.regionDaily[source.regionId]??0)*.5):0;
    const cap=Math.min(tr.capacity,Math.max(0,source.stock.length-reserve));if(!cap)continue;
    const travel=this.travelHours(source.id,h.id),byType=bins.get(source.id),selected=[];
    while(selected.length<cap){
     let best=null;
     for(const k of kinds){if(totals[k]>=targets[k])continue;for(const bt of BLOOD_TYPES){const list=byType.get(k+bt);if(!list?.length)continue;
      while(list.length&&list[0].status!=='ready')list.shift();
      const index=list.findIndex(u=>u.status==='ready'&&u.expiry>this.t+travel);if(index<0)continue;
      const u=list[index],score=targets[k]/8-projected[k+bt],sort=this.c.policy==='FIFO'?u.created:u.expiry;
      if(!best||score>best.score||score===best.score&&sort<best.sort)best={u,list,index,score,sort};
     }}
     if(!best)break;best.list.splice(best.index,1);if(!this.gate(best.u))continue;
     selected.push(best.u.id);projected[best.u.kind+best.u.bloodType]++;totals[best.u.kind]++;
    }
    if(selected.length){const ids=new Set(selected);source.stock=source.stock.filter(id=>!ids.has(id));this.dispatch(source,h,selected);break;}
   }
  }
 }

 pulse(){
  const slot=Math.round(this.t/6),day=Math.floor(this.t/24),before={...this.metrics};
  for(let i=0;i<this.nc;i++){
   const rr=randomFor(this.c.seed,'supply:'+slot+':'+i);
   const base=this.c.network==='nationwide'?(this.regionDaily[this.nodes[i].regionId]??28)/4*(.48+(i*7%11)/10):7;
   const lambda=this.c.network==='nationwide'&&this.nodes[i].regionId==='28'?base/2:base;
   const count=poisson(rr,lambda);
   for(let j=0;j<count;j++)this.newUnit(i,this.t,false);
   const n=this.nodes[i],capacity=Math.max(1,Math.ceil(n.capacity/4));
   for(const id of n.queue.filter(id=>!this.get(id).testing).slice(0,capacity)){
    const u=this.get(id);u.testing=true;u.events.push({h:this.t,text:'가상 검사 시작 · 고정 2시간 지연'});this.events.push(this.t+2,'testReady',{id});
   }
  }
  for(const h of this.nodes.slice(this.nc)){
   const rr=randomFor(this.c.seed,'demand:'+slot+':'+h.id),vr=randomFor(this.c.seed,'volatility:'+day+':'+h.id);
   const z=Math.sqrt(-2*Math.log(Math.max(1e-12,vr())))*Math.cos(2*Math.PI*vr()),s=this.c.volatility;
   const multiplier=Math.exp(s*z-s*s/2),surge=this.c.scenario==='crisis'&&(this.c.network==='nationwide'?['11','41','28'].includes(h.regionId):h.id===1)&&this.t>=24&&this.t<72?3:1;
   const count=poisson(rr,h.dem*2.4/4*multiplier*surge);
   for(let j=0;j<count;j++){
    const kr=randomFor(this.c.seed,'request:'+slot+':'+h.id+':'+j),kind=productFor(this.c,kr),bloodType=BLOOD_TYPES[Math.floor(kr()*8)];
    for(const ch of `${slot}:${h.id}:${j}:${kind}:${bloodType};`){this.demandFingerprint^=ch.charCodeAt(0);this.demandFingerprint=Math.imul(this.demandFingerprint,16777619)>>>0;}
    this.metrics.requested++;
    const ids=this.take(h,1,kind,bloodType);
    if(ids.length){const u=this.get(ids[0]);u.status='served';u.node=null;u.events.push({h:this.t,text:'적합성 검토를 거친 모의 공급'});this.metrics.served++;h.served++;this.finalize(u);}
    else{this.metrics.unmet++;h.short++;}
    this.requestLog.push({h:this.t,node:h.id,kind,bloodType,fulfilled:ids.length===1});
   }
  }
  if(this.requestLog.length>2000)this.requestLog.splice(0,this.requestLog.length-2000);
  if(this.t-this.lastPolicyAt>=this.c.reviewPeriod-1e-8){this.replenish();this.lastPolicyAt=this.t;}
  this.history.push({day:this.t/24,h:this.t,requested:this.metrics.requested-before.requested,served:this.metrics.served-before.served,unmet:this.metrics.unmet-before.unmet,expired:this.metrics.expired-before.expired,stock:this.stockCount()});
  if(this.history.length>1500)this.history.shift();this.day=Math.floor(this.t/24)+1;
  if(this.c.network==='nationwide'&&slot%4===0){const rebuilt=new Heap();for(const e of this.events.arr.slice().sort((a,b)=>a.at-b.at||a.seq-b.seq))if(e.type!=='expire'||this.units.has(e.info.id))rebuilt.push(e.at,e.type,e.info);this.events=rebuilt;}
  if(slot%4===0)this.log('가상 '+day+'일 · 수요 '+this.metrics.requested+' · 부족 '+this.metrics.unmet+' · 만료 '+this.metrics.expired);
  this.events.push(this.t+6,'day');
 }
 integrateTo(t){if(t>this.inventoryAt){this.inventoryArea+=this.stockCount()*(t-this.inventoryAt);this.inventoryAt=t;}}
 processEvent(e){
  this.integrateTo(e.at);
  if(e.type==='return'&&this.c.network==='nationwide'){
   this.t=e.at;const tr=this.trucks[e.info.truck];if(!tr||tr.busy)return;
   const target=Number.isInteger(tr.returnCenter)?this.nodes[tr.returnCenter]:this.centerFor(this.nodes[tr.at]);
   if(!target||target.id===tr.at)return;tr.busy=true;tr.from=tr.at;tr.to=target.id;tr.departure=this.t;tr.arrival=this.t+this.travelHours(tr.at,target.id);this.events.push(tr.arrival,'returnArrive',{truck:tr.id});return;
  }
  if(e.type==='day'){this.t=e.at;this.pulse();return;}
  if(e.type==='testReady'){
   this.t=e.at;const u=this.get(e.info.id);if(!u||u.status!=='queue')return;
   if(u.expiry<=this.t){this.discard(u,'expired');return;}observe(u,this.t,this.c);if(u.review){this.hold(u);return;}
   const n=this.nodes[u.node];n.queue=n.queue.filter(id=>id!==u.id);n.stock.push(u.id);u.status='ready';u.testing=false;u.events.push({h:this.t,text:'모의 검사 완료 · 실제 검사 정확도 모형 아님'});return;
  }
  if(e.type==='monitor'){
   this.t=e.at;if(this.c.network!=='nationwide'||this.c.excursion!=='none'||!this.c.agitation||Math.abs(this.t/6-Math.round(this.t/6))<1e-8)for(const u of this.activeUnits()){observe(u,this.t,this.c);if(u.review)this.hold(u);}
   if(this.t-this.lastPolicyAt>=this.c.reviewPeriod-1e-8){this.replenish();this.lastPolicyAt=this.t;}
   this.events.push(this.t+.5,'monitor');return;
  }
  super.processEvent(e);
 }
 advance(target,max=400000){
  if(typeof target!=='number'||!Number.isFinite(target)||target<this.t||target>24*366)throw Error('가상 시간 범위를 확인하세요.');
  let n=0;while(this.events.size&&this.events.peek().at<=target&&n<max){this.processEvent(this.events.pop());n++;}
  if(n>=max&&this.events.peek()?.at<=target)throw Error('사건 처리 한도를 초과했습니다.');
  this.integrateTo(target);this.t=target;return n;
 }
 resolveReview(id,decision,note){
  const u=this.get(id);if(!u||u.status!=='review')throw Error('보류된 제제를 선택하세요.');
  if(typeof note!=='string'||note.trim().length<8||note.length>500)throw Error('가상 검토 근거를 8–500자로 기록하세요.');
  if(decision!=='release'&&decision!=='exclude')throw Error('검토 결정을 확인하세요.');
  if(decision==='exclude')this.discard(u,'quality');
  else{
   if(u.expiry<=this.t)throw Error('만료 제제는 해제할 수 없습니다.');
   const n=this.nodes[u.node];n.review=n.review.filter(x=>x!==id);n.stock.push(id);u.status='ready';u.review=false;u.reviewReason='';u.thermalAt=this.t;
  }
  const d={id,at:this.t,decision,note:note.trim(),synthetic:true};this.reviewDecisions.push(d);if(this.reviewDecisions.length>200)this.reviewDecisions.shift();u.events.push({h:this.t,text:'가상 검토 '+decision+': '+note});return d;
 }
 verify(){
  let errors=0,active=0;const seen=new Map();
  const visit=(id,kind,node)=>{const u=this.get(id);seen.set(id,(seen.get(id)||0)+1);if(!u||u.status!==kind||(kind!=='truck'&&u.node!==node))errors++;};
  for(const n of this.nodes){for(const [key,kind] of [['stock','ready'],['queue','queue'],['review','review']])for(const id of n[key])visit(id,kind,n.id);}
  for(const tr of this.trucks)for(const id of tr.load)visit(id,'truck',null);
  for(const u of this.units.values()){if(statusActive(u)){active++;if(seen.get(u.id)!==1)errors++;}else if(seen.has(u.id))errors++;}
  const m=this.metrics,balance=m.created-active-m.served-m.expired-m.rejected-m.quality;
  return {active,balance,errors,passed:balance===0&&errors===0};
 }
 summary(){
  const m=this.metrics;return {...m,network:this.c.network,costUnits:this.costUnits??0,regionalTransfers:Object.values(this.flowTotals??{}).reduce((a,b)=>a+b,0),timeHours:this.t,initialInventory:this.initialCreated,receipts:m.created-this.initialCreated,available:this.stockCount(),held:this.activeUnits().filter(u=>u.status==='review'||u.review&&u.status==='truck').length,inTransit:this.trucks.reduce((s,t)=>s+t.load.length,0),
   shortageRate:m.requested?m.unmet/m.requested:null,wasteRate:m.created?(m.expired+m.quality+m.rejected)/m.created:null,averageInventory:this.t?this.inventoryArea/this.t:this.stockCount(),meanTransportHours:this.deliveredShipments?this.transportTotal/this.deliveredShipments:null,demandFingerprint:this.demandFingerprint,verification:this.verify()};
 }
 regionalSummary(){
  if(this.c.network!=='nationwide')return [];
  const result=this.c.regions.map(r=>({...r,available:0,queue:0,held:0,requested:0,unmet:0,served:0,created:0,expired:0,quality:0,rejected:0,exported:0,imported:0,arrivedImports:0,expiring:0,products:{RBC:0,PLT:0,FFP:0}})),byId=new Map(result.map(r=>[r.id,r]));
  for(const n of this.nodes){const r=byId.get(n.regionId);r.available+=n.stock.length;r.queue+=n.queue.length;r.held+=n.review.length;r.requested+=n.served+n.short;r.unmet+=n.short;r.served+=n.served;for(const [k,v] of Object.entries(this.nodeMetrics[n.id]))r[k]+=v;}
  for(const u of this.activeUnits())if(u.node!==null){const r=byId.get(this.nodes[u.node].regionId);if(u.status==='ready'){r.products[u.kind]++;if(u.expiry-this.t<=24)r.expiring++;}}
  for(const r of result){r.shortageRate=r.requested?r.unmet/r.requested:null;const regionalReceipts=r.created+r.arrivedImports;r.wasteRate=regionalReceipts?(r.expired+r.quality+r.rejected)/regionalReceipts:null;r.coverageDays=this.regionDaily[r.id]?r.available/this.regionDaily[r.id]:null;}
  return result;
 }
 snapshot(){
  const fields=['c','nodes','trucks','uid','t','day','failureUntil','metrics','logLines','history','inventoryArea','inventoryAt','monitorAt','transportTotal','deliveredShipments','demandFingerprint','requestLog','initialCreated','reviewDecisions','lastPolicyAt','archivedCount','transferLog','flowTotals','unitKilometers','costUnits','nodeMetrics'];
  return {format:'BLOODFLOW-DUAL-1',...Object.fromEntries(fields.map(k=>[k,this[k]])),lastPolicyAt:Number.isFinite(this.lastPolicyAt)?this.lastPolicyAt:-1e6,events:{arr:this.events.arr,seq:this.events.seq},units:[...this.units.values()]};
 }
 static restore(s,data){
  if(s?.format!=='BLOODFLOW-DUAL-1'||!Array.isArray(s.units)||s.units.length>150000||!Array.isArray(s.events?.arr)||s.events.arr.length>350000)throw Error('지원하지 않거나 너무 큰 실험 파일입니다.');
  if(new Set(s.units.map(u=>u?.id)).size!==s.units.length||s.metrics?.created!==s.units.length+(s.archivedCount??0)||!Number.isInteger(s.archivedCount??0)||(s.archivedCount??0)<0||!Number.isSafeInteger(s.uid)||s.uid!==s.metrics?.created)throw Error('생성 수량 또는 식별자가 일치하지 않습니다.');
  const allowedStates=['ready','queue','truck','review','served','expired','rejected','quality'];
  if(s.units.some(u=>!u||u.dual!==true||typeof u.id!=='string'||!/^BF-DUAL-[0-9]{7}$/.test(u.id)||!PRODUCTS[u.kind]||!BLOOD_TYPES.includes(u.bloodType)||!allowedStates.includes(u.status)||!Number.isFinite(u.created)||!Number.isFinite(u.expiry)||u.expiry<u.created||typeof u.review!=='boolean'||!Array.isArray(u.trace)||u.trace.length>80||u.trace.some(p=>!Number.isFinite(p.h)||!Number.isFinite(p.t))))throw Error('제제 식별자·형식·온도 기록이 잘못되었습니다.');
  if(!Array.isArray(s.nodes)||s.nodes.length!==(s.c?.network==='nationwide'?100:4)||s.nodes.some((n,i)=>n.id!==i||typeof n.name!=='string'||n.name.length>200||!Number.isFinite(n.lat)||!Number.isFinite(n.lon)||['stock','queue','review'].some(k=>!Array.isArray(n[k])))||!Array.isArray(s.trucks)||s.trucks.length>65||s.trucks.some((tr,i)=>tr.id!==i||!Number.isInteger(tr.at)||tr.at<0||tr.at>=s.nodes.length||!Array.isArray(tr.load)||!Number.isInteger(tr.capacity)||tr.capacity<1||tr.capacity>48))throw Error('시설·차량 상태 형식이 잘못되었습니다.');
  const authoritative=validateConfig(s.c,data);
  for(let i=0;i<s.nodes.length;i++){const node=s.nodes[i],expected=authoritative.realNodes[i];
   if(node.name!==expected.name||node.type!==expected.type||node.lat!==expected.lat||node.lon!==expected.lon||(authoritative.network==='nationwide'&&(node.regionId!==expected.regionId||node.virtual!==expected.virtual||node.baselineId!==expected.baselineId)))throw Error('저장된 기관·권역·좌표가 설치된 지리 자료와 일치하지 않습니다.');
  }
  const countKeys=['created','served','requested','unmet','expired','rejected','quality','review','shipments','interhospital'];
  if(countKeys.some(k=>!Number.isSafeInteger(s.metrics?.[k])||s.metrics[k]<0)||s.metrics.requested!==s.metrics.served+s.metrics.unmet||!Number.isFinite(s.inventoryArea)||s.inventoryArea<0||!Number.isFinite(s.initialCreated)||s.initialCreated<0||s.initialCreated>s.metrics.created)throw Error('수요·재고·통계 집계 형식이 잘못되었습니다.');
  if(s.trucks.some(tr=>typeof tr.busy!=='boolean'||tr.busy&&(!Number.isInteger(tr.from)||!Number.isInteger(tr.to)||tr.from<0||tr.to<0||tr.from>=s.nodes.length||tr.to>=s.nodes.length||!Number.isFinite(tr.departure)||!Number.isFinite(tr.arrival)||tr.departure>s.t||tr.arrival<s.t)))throw Error('차량 운행 시각·목적지가 잘못되었습니다.');
  if(s.events.arr.some(e=>['arrival','return','returnArrive','doorClose'].includes(e.type)&&(!Number.isInteger(e.info?.truck)||e.info.truck<0||e.info.truck>=s.trucks.length)))throw Error('미래 운송 사건이 잘못되었습니다.');
  const w=new DualWorld(authoritative);for(const k of Object.keys(w))if(k in s&&!['events','units','r','nc','nh','c'].includes(k))w[k]=structuredClone(s[k]);

  w.units=new Map(s.units.map(u=>[u.id,structuredClone(u)]));w.events=new Heap();w.events.arr=structuredClone(s.events.arr);w.events.seq=s.events.seq;w.activeIds=new Set([...w.units.values()].filter(statusActive).map(u=>u.id));
  if(!Number.isFinite(w.t)||w.t<0||w.t>24*366||w.events.arr.some(e=>!Number.isFinite(e.at)||e.at<w.t-1e-7||!['day','monitor','expire','arrival','return','returnArrive','doorClose','testReady'].includes(e.type)))throw Error('저장된 시각·사건이 잘못되었습니다.');
  w.nodeMetrics=w.nodeMetrics.map(n=>({arrivedImports:0,...n}));
  if(w.c.network==='nationwide'){
   if(!w.flowTotals||typeof w.flowTotals!=='object'||Array.isArray(w.flowTotals)||Object.entries(w.flowTotals).some(([key,value])=>!Number.isSafeInteger(value)||value<0||key.split('>').length!==2||key.split('>').some(id=>!w.c.regions.some(r=>r.id===id))))throw Error('권역 간 운송 집계가 잘못되었습니다.');
   if(w.nodeMetrics.length!==w.nodes.length||w.nodeMetrics.some(n=>Object.values(n).some(v=>!Number.isSafeInteger(v)||v<0)))throw Error('권역별 집계가 잘못되었습니다.');
   for(const key of ['created','expired','quality','rejected'])if(w.nodeMetrics.reduce((sum,n)=>sum+n[key],0)!==w.metrics[key])throw Error('권역별 집계와 전국 총량이 다릅니다.');
  }
  if(w.events.arr.some((e,i)=>!Number.isSafeInteger(e.seq)||e.seq<0||i>0&&w.events.less(e,w.events.arr[(i-1)>>1])))throw Error('미래 사건 순서가 잘못되었습니다.');
  w.sourceOrder=w.sourceOrder.map(list=>list.map(n=>w.nodes[n.id]));
  if(!w.verify().passed)throw Error('재고 보존 검증에 실패한 저장 파일입니다.');return w;
 }
}
export const METRIC_DEFINITIONS={
 shortageRate:'부족량 ÷ 요청량. 요청량이 0이면 미정의. 각 6시간 수요 시점에 미충족 수요는 이월하지 않는다.',
 wasteRate:'(유효기간 만료 + 모의 품질 제외 + 모의 검사 제외) ÷ (초기 재고 + 기간 중 입고). 보류 재고는 폐기에 포함하지 않는다.',
 averageInventory:'시설 내 공급 가능 재고의 시간 적분 ÷ 관측 시간. 검사 대기·보류·운송 중 재고는 제외한다.',
 meanTransportHours:'완료된 유상 운송 구간 소요시간 합 ÷ 완료된 적재 운송 횟수. 빈 차 복귀 제외.',
 conservation:'생성 총량 = 현재 활성 물품 + 공급 완료 + 만료 + 품질 제외 + 검사 제외. 운송·보류 물품도 활성 재고에 한 번 포함한다.'
};
