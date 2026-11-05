import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {DualWorld,DEFAULTS} from '../src/engine.mjs';
import {validatePlan} from '../src/experiments.mjs';
import {DEFAULT_NOTES,prepareResearchRestore,validateStoredResult} from '../src/research-state.mjs';
import {viewOf} from '../src/view.mjs';
export const PERMISSIONS={engineering:['network','redistribution','safetyDays','policy','volatility','delay','reviewPeriod','sharing','scenario','seed'],biology:['product','compatibility','shelfFraction','excursion','agitation','seed']};
const safe=(s,n)=>typeof s==='string'&&s.length<=n;
export class Rooms{
 constructor(data,directory,{workerFactory=url=>new Worker(url)}={}){this.authorityId=randomUUID();this.data=data;this.directory=directory;this.workerFactory=workerFactory;this.rooms=new Map();fs.mkdirSync(directory,{recursive:true});this.load();}
 load(){for(const file of fs.readdirSync(this.directory).filter(f=>/^[A-Z0-9]{6}\.json$/.test(f))){try{const s=JSON.parse(fs.readFileSync(path.join(this.directory,file),'utf8')),restored=prepareResearchRestore(s,this.data),savedAt=fs.statSync(path.join(this.directory,file)).mtime.toISOString();this.rooms.set(s.code,{...s,...restored,storage:{kind:'saved',savedAt,savedVersion:s.version,message:''},computeIssue:typeof s.computeIssue==='string'?s.computeIssue.slice(0,800):'',running:false,mode:'LIVE',speed:1,peers:new Set(),job:null,seen:new Map(s.seen??[]),lastSequences:s.lastSequences??{}});}catch(e){console.error('Room restore failed:',file,e.message);}}}
 persist(r){
  const file=path.join(this.directory,r.code+'.json'),previous=r.storage??{savedAt:null,savedVersion:null},at=new Date().toISOString();
  try{
   const logs=previous.kind==='blocked'?[...r.logs,{eventId:randomUUID(),at,h:r.world.t,role:'server',action:'storage-recovered',note:'서버 파일 저장 복구 · 시간과 계산은 자동 재개하지 않음'}].slice(-200):r.logs.slice(-200);
   const s={code:r.code,tokens:r.tokens,version:r.version,revision:r.revision,notes:r.notes,logs,result:r.result,computeIssue:r.computeIssue??'',seen:[...r.seen].slice(-150),lastSequences:r.lastSequences,snapshot:r.world.snapshot()};
   fs.writeFileSync(file+'.tmp',JSON.stringify(s),{mode:0o600});fs.renameSync(file+'.tmp',file);
   r.logs=logs;r.storage={kind:'saved',savedAt:at,savedVersion:r.version,message:''};return true;
  }catch(error){
   // Never replace the last complete file or turn an applied command into a silent, deduped error.
   try{fs.unlinkSync(file+'.tmp');}catch{}
   const code=/^[A-Z0-9_]{1,24}$/.test(error?.code??'')?error.code:'WRITE_FAILED';
   r.storage={...previous,kind:'blocked',message:'서버 파일 저장에 실패했습니다 ('+code+'). 현재 연구는 서버 메모리에만 있습니다.'};r.running=false;
   if(previous.kind!=='blocked'){r.logs.push({eventId:randomUUID(),at,h:r.world.t,role:'server',action:'storage-error',note:r.storage.message});if(r.logs.length>200)r.logs.shift();}
   if(r.job&&!r.job.paused){const job=r.job;job.paused=true;try{job.worker.postMessage({type:'pause'});}catch(e){job.fail(e);}}
   return false;
  }
 }
 saveAll(){for(const r of this.rooms.values()){r.version++;this.persist(r);this.broadcast(r);}}
 create(config={}){if(this.rooms.size>=12)throw Error('실험실 수 한도에 도달했습니다.');let code;do{code=randomBytes(5).toString('hex').slice(0,6).toUpperCase();}while(this.rooms.has(code));const r={code,world:new DualWorld(config,this.data),tokens:{engineering:randomBytes(24).toString('hex'),biology:randomBytes(24).toString('hex')},version:0,revision:0,notes:{...DEFAULT_NOTES},logs:[],result:null,computeIssue:'',peers:new Set(),seen:new Map(),lastSequences:{},running:false,mode:'LIVE',speed:1,job:null};if(!this.persist(r))throw Error(r.storage.message+' 실험실을 생성하지 않았습니다. 서버 저장소를 확인하세요.');this.rooms.set(code,r);return r;}
 authenticate(code,token){const r=this.rooms.get(code);if(!r)return null;const role=Object.keys(r.tokens).find(k=>r.tokens[k]===token);return role?{room:r,role}:null;}
 publicState(r){return {type:'state',protocolVersion:2,authorityId:this.authorityId,experimentId:r.code,eventId:randomUUID(),version:r.version,revision:r.revision,timestamp:new Date().toISOString(),running:r.running,mode:r.mode,speed:r.speed,world:viewOf(r.world),notes:r.notes,logs:r.logs.slice(-80),result:r.result,computeIssue:r.computeIssue??'',storage:r.storage,peers:[...r.peers].map(p=>p.role),job:r.job?{progress:r.job.progress,plan:r.job.plan,paused:!!r.job.paused}:null};}
 send(p,value){if(p.socket.readyState===1)p.socket.send(JSON.stringify(value));}
 broadcast(r){const text=JSON.stringify(this.publicState(r));for(const p of r.peers)if(p.socket.readyState===1)p.socket.send(text);}
 join(socket,code,role,token){
  const r=this.rooms.get(code);if(!r||!PERMISSIONS[role])throw Error('실험실 코드 또는 역할을 확인하세요.');
  // The room code is an educational-room invitation, not proof of identity.
  if(token&&token!==r.tokens[role])throw Error('역할 토큰이 일치하지 않습니다.');
  if(r.peers.size>=8)throw Error('접속 기기 수 한도에 도달했습니다.');
  const peer={socket,role,room:r,count:0,window:Date.now()};r.peers.add(peer);this.send(peer,{type:'joined',experimentId:code,role,token:r.tokens[role]});this.broadcast(r);return peer;
 }
 leave(p){if(!p)return;const r=p.room;r.peers.delete(p);r.running=false;if(r.job){const job=r.job;job.paused=true;try{job.worker.postMessage({type:'pause'});}catch(error){job.fail(error);}}r.version++;r.logs.push({eventId:randomUUID(),at:new Date().toISOString(),h:r.world.t,role:p.role,action:'disconnect',note:'연결 해제: 서버 세계 일시정지'});this.persist(r);this.broadcast(r);}
 startCompute(r,p,plan){
  r.running=false;r.computeIssue='';let worker;
  const finish=(result,issue='')=>{
   if(worker&&r.job?.worker!==worker)return;
   r.job=null;worker?.terminate();if(result)r.result=result;r.computeIssue=issue;r.version++;
   r.logs.push({eventId:randomUUID(),at:new Date().toISOString(),h:r.world.t,role:p.role,action:issue?'compute-error':'compute-complete',note:issue||'동일 시드 짝지은 실험 완료'});if(r.logs.length>200)r.logs.shift();
   this.persist(r);this.broadcast(r);
  };
  const fail=error=>finish(null,'공통 반복 계산을 완료하지 못했습니다. '+String(error?.message??error??'계산 작업의 응답이 없습니다.').slice(0,400)+' 이전 결과와 두 해석을 유지했습니다. 조건과 서버를 확인한 뒤 직접 다시 시작하세요.');
  try{
   worker=this.workerFactory(new URL('../src/compute-worker.mjs',import.meta.url));r.job={worker,plan,progress:0,fail};
   worker.on('message',msg=>{if(r.job?.worker!==worker)return;try{
    if(msg.type==='error'){fail(msg.error);return;}
    if(msg.type==='result'){if(msg.result==null)throw Error('완료된 계산 결과가 없습니다.');finish(validateStoredResult(msg.result,this.data));return;}
    if(msg.type==='progress')r.job.progress=msg.progress;if(msg.type==='paused')r.job.paused=msg.paused;r.version++;this.broadcast(r);
   }catch(error){fail(error);}});
   worker.on('error',fail);worker.on('messageerror',()=>fail(Error('계산 작업에서 보낸 자료를 읽을 수 없습니다.')));
   worker.on('exit',code=>fail(Error('계산 결과를 받기 전에 작업이 종료됐습니다. 종료 코드: '+code)));
   worker.postMessage({config:r.world.c,data:this.data,plan});
  }catch(error){fail(error);throw Error(r.computeIssue);}
 }
 command(p,m){
  const r=p.room;if(Date.now()-p.window>60000){p.window=Date.now();p.count=0;}if(++p.count>120)throw Error('명령이 너무 많습니다. 잠시 후 다시 시도하세요.');
  if(!m||!safe(m.eventId,100)||m.eventId.length<8||m.experimentId!==r.code||!safe(m.type,40))throw Error('올바른 실험 메시지가 아닙니다.');
  const key=p.role+':'+m.eventId;
  if(r.seen.has(key)){this.send(p,{...r.seen.get(key),duplicate:true});return;}
  const sequenceKey=safe(m.clientId,80)&&Number.isSafeInteger(m.clientSequence)&&m.clientSequence>0?p.role+':'+m.clientId:null;
  if(sequenceKey&&m.clientSequence<=(r.lastSequences[sequenceKey]??0)){this.send(p,{type:'ack',eventId:m.eventId,experimentId:r.code,version:r.version,revision:r.revision,duplicate:true});return;}
  if(m.type==='export'){this.send(p,{type:'export',eventId:m.eventId,snapshot:r.world.snapshot(),notes:r.notes,result:r.result});return;}
  if(r.storage?.kind==='blocked'&&(['configure','review','restore','step','compute','resume-compute'].includes(m.type)||(m.type==='clock'&&m.running)))throw Error('서버 파일 저장을 복구한 뒤 시간·조건·반복 계산을 진행하세요. 현재 연구 JSON은 계속 보관할 수 있습니다.');
  const edits=['configure','notes','review','restore'];
  if(edits.includes(m.type)&&m.expectedRevision!==r.revision){this.send(p,{type:'conflict',eventId:m.eventId,error:'다른 연구자가 조건을 변경했습니다. 최신 조건을 확인한 뒤 다시 적용하세요.'});this.send(p,this.publicState(r));return;}
  if(r.job&&['configure','restore','review','compute'].includes(m.type))throw Error('반복 계산을 중단한 뒤 조건을 변경하세요.');
  if(m.type==='configure'){
   if(!m.patch||typeof m.patch!=='object'||Array.isArray(m.patch)||Object.keys(m.patch).some(k=>!PERMISSIONS[p.role].includes(k)))throw Error('이 역할에서 변경할 수 없는 조건입니다.');
   r.world=new DualWorld({...r.world.c,...m.patch},this.data);r.running=false;r.computeIssue='';r.revision++;
  }else if(m.type==='notes'){
   const allowed=p.role==='engineering'?['question','hypothesis','engineering','limitations','improvements']:['question','hypothesis','biology','limitations','improvements'];
   if(!m.patch||typeof m.patch!=='object'||Object.keys(m.patch).some(k=>!allowed.includes(k)||!safe(m.patch[k],6000)))throw Error('해석 기록 또는 역할을 확인하세요.');
   r.notes={...r.notes,...m.patch};r.revision++;
  }else if(m.type==='review'){
   if(p.role!=='biology')throw Error('생명과학 역할에서 검토 기록을 작성하세요.');r.world.resolveReview(m.id,m.decision,m.note);r.revision++;
  }else if(m.type==='restore'){
   if(r.running)throw Error('일시정지 후 복원하세요.');const restored=prepareResearchRestore(m,this.data,r.notes,{role:p.role});for(const key of [...PERMISSIONS.engineering,...PERMISSIONS.biology])if(!PERMISSIONS[p.role].includes(key)&&JSON.stringify(restored.world.c[key])!==JSON.stringify(r.world.c[key]))throw Error('다른 역할의 조건을 바꾸는 복원은 허용하지 않습니다.');
   // The world is already bound to installed geography. Commit only after all checks succeed.
   Object.assign(r,restored);r.computeIssue='';r.revision++;
  }else if(m.type==='clock'){
   if(!['LIVE','TIMELAPSE','COMPUTE'].includes(m.mode)||![1,6,24,96,240].includes(m.speed)||typeof m.running!=='boolean')throw Error('시간 모드·속도를 확인하세요.');
   r.mode=m.mode;r.speed=m.speed;r.running=m.running;
  }else if(m.type==='step'){
   if(!Number.isFinite(m.hours)||m.hours<=0||m.hours>24)throw Error('한 번에 24시간 이내로 진행하세요.');r.running=false;r.world.advance(r.world.t+m.hours);
  }else if(m.type==='compute'){
   this.startCompute(r,p,validatePlan(m.plan));
  }else if(m.type==='pause-compute'||m.type==='resume-compute'){if(!r.job)throw Error('진행 중인 반복 실험이 없습니다.');const job=r.job;job.paused=m.type==='pause-compute';try{job.worker.postMessage({type:job.paused?'pause':'resume'});}catch(error){job.fail(error);throw Error(r.computeIssue);}
  }else if(m.type==='cancel-compute'){const job=r.job;r.job=null;r.computeIssue='';job?.worker.terminate();}
  else if(m.type==='save'){/* Both roles may explicitly retry server persistence. */}
  else throw Error('지원하지 않는 명령입니다.');
  if(sequenceKey)r.lastSequences[sequenceKey]=m.clientSequence;
  r.version++;const ack={type:'ack',eventId:m.eventId,experimentId:r.code,version:r.version,revision:r.revision,timestamp:new Date().toISOString(),storageSaved:true};r.seen.set(key,ack);while(r.seen.size>150)r.seen.delete(r.seen.keys().next().value);
  r.logs.push({eventId:m.eventId,at:ack.timestamp,h:r.world.t,role:p.role,action:m.type});if(r.logs.length>200)r.logs.shift();ack.storageSaved=this.persist(r);ack.version=r.version;this.send(p,ack);this.broadcast(r);
 }
 tick(seconds){for(const r of this.rooms.values())if(r.running&&r.peers.size){try{r.world.advance(Math.min(24*365,r.world.t+seconds*r.speed/60));if(r.world.t>=24*365)r.running=false;r.version++;this.broadcast(r);}catch(e){r.running=false;r.logs.push({action:'clock-error',note:e.message});this.broadcast(r);}}}
 close(){for(const r of this.rooms.values()){const job=r.job;r.job=null;job?.worker.terminate();r.running=false;this.persist(r);for(const p of r.peers)p.socket.close();}}
}
