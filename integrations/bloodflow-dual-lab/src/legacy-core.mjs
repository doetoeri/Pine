// Extracted from the 5.1-model script in BLOODFLOW_5_2_Material3.html. See docs/PROVENANCE.md.
const nf=(n,d=1)=>Number(n).toFixed(d);
const primeGeometry=()=>{}; // Geometry rendering is handled by the cached GIS adapter.
const rng=seed=>{let a=seed>>>0;return()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}};
function poisson(r,l){if(!l)return 0;let n=0;while(l>0){const c=Math.min(l,25),bound=Math.exp(-c);let k=0,p=1;do{k++;p*=r()}while(p>bound);n+=k-1;l-=c}return n}
class Heap{
 constructor(){this.arr=[];this.seq=0}
 less(a,b){return a.at<b.at||(a.at===b.at&&a.seq<b.seq)}
 push(at,type,info={}){const a=this.arr,x={at,type,info,seq:this.seq++};a.push(x);let i=a.length-1;while(i){let j=(i-1)>>1;if(!this.less(x,a[j]))break;a[i]=a[j];i=j}a[i]=x}
 pop(){const a=this.arr;if(!a.length)return null;const x=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let j=i*2+1;if(j+1<a.length&&this.less(a[j+1],a[j]))j++;if(!this.less(a[j],last))break;a[i]=a[j];i=j}a[i]=last}return x}
 peek(){return this.arr[0]||null}
 get size(){return this.arr.length}
}
const BIO_REFERENCE={storage:[2,6],transport:[2,10]};
const BOXTau={low:1.6,medium:4,high:8};
const LEAK={low:.05,medium:.015,high:.005};
function compartmentTemperature(c,elapsed){
 const env=c.ambient,set=4;
 if(c.cooling==='dooropen')return env;
 if(c.cooling==='active')return set+LEAK[c.insulation]*(env-set);
 const tau=BOXTau[c.insulation];return env+(set-env)*Math.exp(-Math.max(0,elapsed)/tau);
}
function storageTemperature(c){return c.storage==='regulated'?4:c.storage==='unstable'?9.5:c.ambient}
function thermalStep(start,target,dt,tau){return target+(start-target)*Math.exp(-dt/tau)}
// Fully deterministic first-order lumped thermal model. Parameters are assumptions, not measured equipment specifications.
function integratePack(u,end,c,record=true){
 if(end<=u.thermalAt+1e-8)return;
 let now=u.thermalAt;let lastRecorded=u.trace.length?u.trace[u.trace.length-1].h:-1e10;
 while(now<end-1e-8){
  let dt=Math.min(.25,end-now),next=now+dt;
  let stage=u.status==='truck'?'transport':'storage';
  let target=stage==='transport'?compartmentTemperature(u.shipping,(now+dt*.5)-u.modeSince):storageTemperature(c);
  const prev=u.temperature,after=thermalStep(prev,target,dt,u.tau);
  const [lo,hi]=BIO_REFERENCE[stage];
  // Trapezoidal degree-hour exposure, using a 15-minute integration step.
  const lowDose=dt*(Math.max(0,lo-prev)+Math.max(0,lo-after))/2;
  const highDose=dt*(Math.max(0,prev-hi)+Math.max(0,after-hi))/2;
  u.doseLow+=lowDose;u.doseHigh+=highDose;
  if(lowDose+highDose>1e-10){u.outHours+=dt;u.review=true;u.reviewReason='참고 온도 구간 이탈 기록'}
  u.temperature=after;u.minimum=Math.min(u.minimum,after);u.maximum=Math.max(u.maximum,after);
  if(stage==='transport')u.transitHours+=dt;else u.storageHours+=dt;
  now=next;
  if(record&&(now-lastRecorded>=.95||now>=end-1e-7)){
   u.trace.push({h:+now.toFixed(3),t:+after.toFixed(4),stage});lastRecorded=now;
   if(u.trace.length>220)u.trace.splice(1,u.trace.length-220);
  }
 }
 u.thermalAt=end;
}
function createBioUnit(id,created,source,r,ready=false){
 const t=4+(r()-.5)*.6;
 return{id,kind:'RBC',bloodType:['A+','B+','O+','AB+','A-','B-','O-','AB-'][Math.floor(r()*8)],created,expiry:created+24*28,
 status:ready?'ready':'queue',node:source,temperature:t,minimum:t,maximum:t,tau:.55+r()*.75,
 modeSince:created,thermalAt:created,shipping:null,storageHours:0,transitHours:0,doseLow:0,doseHigh:0,outHours:0,review:false,reviewReason:'',note:'',
 trace:[{h:created,t:+t.toFixed(4),stage:'storage'}],events:[{h:created,text:'가상 혈액제제 생성'}]};
}
let dualObserver=null;
function touch(u,t,c){if(u?.dual&&dualObserver)return dualObserver(u,t,c);if(u&&['queue','ready','truck','review'].includes(u.status))integratePack(u,t,c)}
function changing(u,text,t){u.events.push({h:+t.toFixed(2),text});if(u.events.length>60)u.events.shift()}

class World{
 constructor(c){
 this.c={...c};this.r=rng(c.seed);this.events=new Heap();this.nodes=[];this.trucks=[];this.units=new Map();this.uid=0;this.t=0;this.day=0;
 this.manualOps=false;this.logLines=[];this.history=[];this.failureUntil=0;this.metrics={created:0,served:0,requested:0,unmet:0,expired:0,rejected:0,quality:0,review:0,shipments:0,interhospital:0};
 if(!Array.isArray(c.realNodes)||!c.realNodes.length||!c.realNodes.some(n=>n.type==='center')||!c.realNodes.some(n=>n.type==='hospital'))throw Error('실제 혈액원·병원 데이터가 필요합니다.');
 this.nc=c.realNodes.filter(n=>n.type==='center').length;this.nh=c.realNodes.filter(n=>n.type==='hospital').length;
 this.nodes=c.realNodes.map((n,i)=>({id:i,osmId:n.osmId,name:n.name,type:n.type,lat:n.lat,lon:n.lon,x:n.lon*10000,y:n.lat*10000,source:n.source,stock:[],queue:[],review:[],storageSlots:n.type==='center'?120:48,capacity:n.type==='center'?Math.round(34*c.lab):0,dem:n.type==='hospital'?2.2+this.r()*1.8:0,received:0,served:0,short:0,downUntil:0}));
 const nt=Math.max(4,Math.min(65,Math.round(this.nc*6)));for(let i=0;i<nt;i++)this.trucks.push({id:i,at:i%this.nc,busy:false,from:null,to:null,departure:0,arrival:0,load:[],capacity:12,awaitUnload:false,doorOpen:false,doorCloseAt:0,coolingMode:c.cooling});
 const nc=this.nc,nh=this.nh;
 for(let i=0;i<nc;i++)for(let j=0;j<42;j++)this.newUnit(i,0,true);
 this.events.push(0,'day');this.log('OSM 실제 시설 위치: 혈액원 '+nc+' · 병원 '+nh+' / 모형 차량 '+nt);
 }
 log(msg){this.logLines.unshift({h:this.t,msg});if(this.logLines.length>80)this.logLines.pop()}
 newUnit(center,time,ready=false){let id='BF-RBC-'+String(++this.uid).padStart(7,'0');let u=createBioUnit(id,time,center,this.r,ready);this.units.set(id,u);this.metrics.created++;this.nodes[center][ready?'stock':'queue'].push(id);this.events.push(u.expiry,'expire',{id});return u}
 get(id){return this.units.get(id)}
 gate(u){if(!u||u.status!=='ready')return false;touch(u,this.t,this.c);if(u.review){let n=this.nodes[u.node];n.stock=n.stock.filter(id=>id!==u.id);n.review.push(u.id);u.status='review';this.metrics.review++;changing(u,'참고 온도 구간 이탈: 검토 대기',this.t);return false}return true}
 take(node,number){const candidates=node.stock.slice().sort((a,b)=>{const x=this.get(a),y=this.get(b);return this.c.policy==='FIFO'?x.created-y.created||a.localeCompare(b):x.expiry-y.expiry||a.localeCompare(b)});const taken=[];for(const id of candidates){if(taken.length>=number)break;let u=this.get(id);if(this.gate(u))taken.push(id)}if(taken.length){const ids=new Set(taken);node.stock=node.stock.filter(id=>!ids.has(id))}return taken}
 discard(u,reason){if(!u||['expired','rejected','quality','served'].includes(u.status))return;
 touch(u,Math.min(this.t,u.expiry),this.c);
 if(u.status==='truck'){for(let t of this.trucks)if(t.load.includes(u.id))t.load=t.load.filter(id=>id!==u.id)}
 else if(u.node!==null){let n=this.nodes[u.node];n.stock=n.stock.filter(x=>x!==u.id);n.queue=n.queue.filter(x=>x!==u.id);n.review=n.review.filter(x=>x!==u.id)}
 u.status=reason;u.node=null;this.metrics[reason]++;changing(u,reason==='expired'?'모형상 유효기간 종료':reason==='rejected'?'모의 검사 제외':'모의 품질 제외',this.t)
 }
 travelHours(a,b){if(a===b)return 0;if(this.c.routeMode==='road')return this.c.roadHours?.[a]?.[b]??Infinity;
 const x=this.nodes[a],y=this.nodes[b];return Math.hypot(x.x-y.x,x.y-y.y)}
 centerFor(h){let best=null,d=Infinity;for(let i=0;i<this.nc;i++){let c=this.nodes[i],di=this.travelHours(h.id,c.id);if(di<d){best=c;d=di}}return best}
 dispatch(from,to,ids){if(!ids.length)return false;const tr=this.trucks.find(t=>!t.busy&&t.at===from.id);if(!tr)return false;if(this.c.routeMode==='road'&&!Number.isFinite(this.travelHours(from.id,to.id)))return false;
 tr.busy=true;tr.from=from.id;tr.to=to.id;tr.departure=this.t;tr.arrival=this.t+(this.c.routeMode==='road'?this.travelHours(from.id,to.id):this.c.hours);tr.load=ids;
 const cooling=this.c.cooling==='active'&&this.failureUntil>this.t?'passive':this.c.cooling;
 for(const id of ids){const u=this.get(id);touch(u,this.t,this.c);u.status='truck';u.node=null;u.modeSince=this.t;u.shipping={ambient:this.c.ambient,cooling,insulation:this.c.insulation};changing(u,'운송 출발 '+from.name+' → '+to.name+' / '+cooling,this.t)}
 this.events.push(tr.arrival,'arrival',{truck:tr.id});this.metrics.shipments++;primeGeometry(this.nodes[from.id],this.nodes[to.id]);return true
 }
 // Manual logistics adds no fictional buildings: only the published facilities already in this world.
 manualLoad(nodeId,truckId,ids){
  const n=this.nodes[nodeId],tr=this.trucks[truckId];
  if(!n||!tr||tr.busy||tr.awaitUnload||tr.at!==nodeId)return {ok:false,message:'이 시설에 적재 가능한 정차 차량이 없습니다.'};
  if(!Array.isArray(ids)||!ids.length)return {ok:false,message:'냉장고에서 혈액팩을 먼저 선택하세요.'};
  const space=tr.capacity-tr.load.length;
  if(space<=0)return {ok:false,message:'차량 적재함이 가득 찼습니다.'};
  let moved=0;
  for(const id of ids.slice(0,space)){
   const u=this.get(id);if(!u||u.node!==nodeId||u.status!=='ready'||!n.stock.includes(id))continue;
   if(!this.gate(u))continue;
   n.stock.splice(n.stock.indexOf(id),1);
   touch(u,this.t,this.c);u.status='truck';u.node=null;u.modeSince=this.t;
   u.shipping={ambient:this.c.ambient,cooling:tr.doorOpen?'dooropen':tr.coolingMode,insulation:this.c.insulation};
   changing(u,'직접 적재: '+n.name+' → 차량 #'+(tr.id+1),this.t);
   tr.load.push(id);moved++;
  }
  if(moved)this.log('직접 적재 · '+n.name+' · 차량 #'+(tr.id+1)+' · '+moved+'팩');
  return {ok:moved>0,message:moved?moved+'팩을 차량에 적재했어. 목적지를 지정하고 출발할 수 있어.':'적재 불가: 혈액팩 상태 또는 참고 온도 이력 확인 필요'};
 }
 manualDepart(truckId,destId){
  const tr=this.trucks[truckId],dst=this.nodes[destId];
  if(!tr||!dst)return {ok:false,message:'차량과 목적지를 선택하세요.'};
  if(tr.busy||tr.awaitUnload)return {ok:false,message:'운행 중이거나 도착 화물 하역이 필요합니다.'};
  if(tr.at===destId)return {ok:false,message:'현재 차량이 있는 시설이야. 다른 목적지를 선택하세요.'};
  const from=tr.at,origin=this.nodes[from];
  const road=this.travelHours(from,destId);
  if(this.c.routeMode==='road'&&!Number.isFinite(road))return {ok:false,message:'도로 이동 행렬이 없어. 제어판에서 고정 운송시간으로 바꾸거나 도로 행렬을 먼저 준비하세요.'};
  const travel=this.c.routeMode==='road'?Math.max(.08,road):Math.max(.08,this.c.hours);
  tr.busy=true;tr.from=from;tr.to=destId;tr.departure=this.t;tr.arrival=this.t+travel;tr.manualTrip=true;
  for(const id of tr.load){const u=this.get(id);if(!u)continue;touch(u,this.t,this.c);changing(u,'수동 운행 출발: '+origin.name+' → '+dst.name,this.t)}
  this.events.push(tr.arrival,'arrival',{truck:tr.id});this.metrics.shipments++;
  primeGeometry(origin,dst);
  this.log('직접 출발 · 차량 #'+(tr.id+1)+' · '+origin.name+' → '+dst.name+' · '+tr.load.length+'팩');
  return {ok:true,message:'차량 #'+(tr.id+1)+' 운송 시작! 도착 예정: 가상 '+nf(travel,2)+'시간 후. 화면에서 시간을 진행해야 움직여.'};
 }
 manualUnload(truckId){
  const tr=this.trucks[truckId];
  if(!tr||tr.busy||!tr.awaitUnload)return {ok:false,message:'도착하여 하역을 기다리는 차량을 선택해야 해.'};
  const n=this.nodes[tr.at];let stored=0,review=0;const remaining=[];
  for(const id of tr.load){const u=this.get(id);if(!u||u.status!=='truck')continue;
   touch(u,this.t,this.c);
   if(!u.review&&n.stock.length>=n.storageSlots){remaining.push(id);continue}
   u.node=n.id;
   if(u.review){u.status='review';n.review.push(id);this.metrics.review++;review++;changing(u,'수동 하역: 온도 이력 검토 대기',this.t)}
   else{u.status='ready';n.stock.push(id);stored++;changing(u,'직접 하역: '+n.name+' 냉장고 입고',this.t)}n.received++;
  }
  tr.load=remaining;tr.awaitUnload=remaining.length>0;
  this.log('직접 하역 · '+n.name+' · 보관 '+stored+'팩 · 검토 '+review+'팩 · 적재함 잔여 '+remaining.length+'팩');
  const remainder=remaining.length?' 냉장고 공간이 부족해 '+remaining.length+'팩은 차량에 남아 있어.':' 차량은 다시 출발할 수 있어.';
  return {ok:true,message:'하역 결과: 보관 '+stored+'팩, 온도 이력 검토 '+review+'팩.'+remainder};
 }
 switchDoor(tr,open){
  if(!tr)return;
  for(const id of tr.load){const u=this.get(id);if(!u||u.status!=='truck')continue;
   touch(u,this.t,this.c);u.modeSince=this.t;
   if(!u.shipping)u.shipping={ambient:this.c.ambient,insulation:this.c.insulation,cooling:tr.coolingMode};
   u.shipping.cooling=open?'dooropen':tr.coolingMode;
   changing(u,open?'가상 차량 문 열림: 외기 영향 시작':'가상 차량 문 닫힘: 냉각 복귀',this.t);
  }
  tr.doorOpen=open;if(!open)tr.doorCloseAt=0;
 }
 manualDoor(truckId){
  const tr=this.trucks[truckId];if(!tr)return {ok:false,message:'차량을 선택하세요.'};
  if(tr.doorOpen)return {ok:false,message:'이미 문이 열려 있어. 가상 5분이 지나면 닫혀.'};
  this.switchDoor(tr,true);tr.doorCloseAt=this.t+5/60;
  this.events.push(tr.doorCloseAt,'doorClose',{truck:tr.id});this.log('직접 조작 · 차량 #'+(tr.id+1)+' 문 열기 5분');
  return {ok:true,message:'가상 차량 문을 열었어. 5분간 외기 영향이 온도 계산에 반영돼.'};
 }
 manualCooling(truckId){
  const tr=this.trucks[truckId];if(!tr)return {ok:false,message:'차량을 선택하세요.'};
  tr.coolingMode=tr.coolingMode==='active'?'passive':'active';
  if(!tr.doorOpen)this.switchDoor(tr,false);
  this.log('직접 조작 · 차량 #'+(tr.id+1)+' 냉각 '+tr.coolingMode);
  return {ok:true,message:'차량의 가상 냉각 모드를 '+(tr.coolingMode==='active'?'능동 제어':'수동 단열')+'로 변경했어.'};
 }
 arrival(tr){
  if(this.manualOps&&tr.manualTrip){
   const n=this.nodes[tr.to];tr.at=n.id;tr.busy=false;tr.from=null;tr.to=null;tr.manualTrip=false;
   tr.awaitUnload=tr.load.length>0;
   this.log('수동 운송 차량 #'+(tr.id+1)+' '+n.name+' 도착 · '+(tr.awaitUnload?'하역 대기 '+tr.load.length+'팩':'빈 차량 정차'));
   return;
  }
  let n=this.nodes[tr.to],counts=0,hold=0;
 for(const id of tr.load){let u=this.get(id);if(!u||u.status!=='truck')continue;touch(u,this.t,this.c);u.node=n.id;
 if(u.review){u.status='review';n.review.push(id);this.metrics.review++;hold++;changing(u,'도착: 온도 이력 검토 대기',this.t)}
 else{u.status='ready';n.stock.push(id);counts++;changing(u,'운송 도착: 가상 재고 편입',this.t)}
 n.received++}
 tr.load=[];tr.busy=false;tr.at=n.id;tr.from=null;tr.to=null;
 this.log(n.name+' 도착 · 재고 '+counts+' · 검토 '+hold);
 if(n.type==='hospital')this.events.push(this.t+1,'return',{truck:tr.id});
 }
 processEvent(e){this.t=e.at;
 if(e.type==='doorClose'){const tr=this.trucks[e.info.truck];if(tr&&tr.doorCloseAt===e.at){this.switchDoor(tr,false);this.log('차량 #'+(tr.id+1)+' 적재함 문 닫힘')}return}
 if(e.type==='expire'){const u=this.get(e.info.id);if(u&&['queue','ready','truck','review'].includes(u.status))this.discard(u,'expired');return}
 if(e.type==='arrival'){this.arrival(this.trucks[e.info.truck]);return}
 if(e.type==='return'&&this.manualOps)return;
 if(e.type==='return'){const t=this.trucks[e.info.truck];if(t.busy)return;let n=this.nodes[t.at];if(n.type==='center')return;let c=this.centerFor(n);if(!c||!Number.isFinite(this.travelHours(n.id,c.id)))return;t.busy=true;t.from=n.id;t.to=c.id;t.departure=this.t;t.arrival=this.t+(this.c.routeMode==='road'?this.travelHours(n.id,c.id):Math.max(1,this.c.hours*.75));this.events.push(t.arrival,'returnArrive',{truck:t.id});return}
 if(e.type==='returnArrive'){const t=this.trucks[e.info.truck];t.busy=false;t.at=t.to;t.from=null;t.to=null;return}
 if(e.type!=='day')return;
 const m=this.metrics,demBefore=m.requested,servedBefore=m.served,unmetBefore=m.unmet,expiredBefore=m.expired;
 for(let i=0;i<this.nc;i++){
 let n=this.nodes[i],incoming=poisson(this.r,28*(this.c.scenario==='surplus'?1.3:1));for(let j=0;j<incoming;j++)this.newUnit(i,this.t,false);
 if(n.downUntil>this.t)continue;
 let processing=n.queue.splice(0,Math.min(n.capacity,Math.max(0,n.storageSlots-n.stock.length)));for(const id of processing){let u=this.get(id);if(u.status!=='queue')continue;touch(u,this.t,this.c);
 if(this.r()<.025){this.discard(u,'rejected');continue}if(this.r()<.008){this.discard(u,'quality');continue}
 u.status='ready';n.stock.push(id);changing(u,'모의 검사 통과 (실제 검사 데이터 아님)',this.t);
 }
 }
 for(let i=this.nc;i<this.nodes.length;i++){
 let h=this.nodes[i],d=poisson(this.r,h.dem*(this.c.scenario==='shortage'?1.4:1));m.requested+=d;let taken=this.take(h,d);
 for(const id of taken){let u=this.get(id);touch(u,this.t,this.c);u.status='served';u.node=null;changing(u,'모의 수요 충족 처리',this.t)}
 m.served+=taken.length;m.unmet+=d-taken.length;h.served+=taken.length;h.short+=d-taken.length;
 }
 if(!this.manualOps){
 // Dispatch only eligible products. Delivery times are explicitly the experiment scenario's assumed hours.
 for(let i=this.nc;i<this.nodes.length;i++){
 let h=this.nodes[i],needed=Math.max(0,Math.ceil(h.dem*3)-h.stock.length);if(!needed)continue;
 let centers=this.nodes.slice(0,this.nc).sort((a,b)=>this.travelHours(a.id,h.id)-this.travelHours(b.id,h.id));
 for(const c of centers){if(needed<=0)break;let truck=this.trucks.find(t=>!t.busy&&t.at===c.id);if(!truck)continue;let ids=this.take(c,Math.min(needed,10));if(this.dispatch(c,h,ids))needed-=ids.length}
 if(needed>0&&this.c.sharing==='on'){
 let donors=this.nodes.slice(this.nc).filter(d=>d.id!==h.id&&d.stock.length>Math.ceil(d.dem*4));
 for(let donor of donors){if(needed<=0)break;if(!this.trucks.some(t=>!t.busy&&t.at===donor.id)||!Number.isFinite(this.travelHours(donor.id,h.id)))continue;
 let ids=this.take(donor,Math.min(needed,5,donor.stock.length-Math.ceil(donor.dem*3)));if(this.dispatch(donor,h,ids)){needed-=ids.length;m.interhospital+=ids.length}}
 }
 }
 }
 this.day++;
 this.history.push({day:this.day,served:m.served-servedBefore,requested:m.requested-demBefore,unmet:m.unmet-unmetBefore,expired:m.expired-expiredBefore,stock:this.stockCount()});
 if(this.history.length>10000)this.history.shift();if(this.day%5===1)this.log('Day '+this.day+' · 누적 충족 '+(m.requested?nf(m.served/m.requested*100):'0')+'%');
 this.events.push(this.t+24,'day');
 }
 advance(target,max=400000){let n=0;while(this.events.size&&this.events.peek().at<=target&&n<max){this.processEvent(this.events.pop());n++}this.t=Math.max(this.t,target);return n}
 stockCount(){return this.nodes.reduce((n,x)=>n+x.stock.length,0)}
 verify(){let errors=0,active=0;for(const u of this.units.values()){
 let has=['ready','queue','review','truck'].includes(u.status);if(has)active++;
 if(['ready','queue','review'].includes(u.status)&&!this.nodes[u.node]?.[u.status==='ready'?'stock':u.status].includes(u.id))errors++;
 if(u.status==='truck'&&!this.trucks.some(t=>t.load.includes(u.id)))errors++;
 }
 let m=this.metrics,balance=m.created-(active+m.served+m.expired+m.rejected+m.quality);
 return{active,balance,errors,passed:balance===0&&errors===0}
 }
}

export const setDualObserver=fn=>{dualObserver=fn};
export {rng,poisson,Heap,World,createBioUnit};
