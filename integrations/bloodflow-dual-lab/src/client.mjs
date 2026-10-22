const eventId=()=>globalThis.crypto?.randomUUID?.()??Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');
import {DualWorld} from './engine.mjs';
import {viewOf} from './view.mjs';
import {validatePlan} from './experiments.mjs';
import {CollaborationAvailability,resolveServerBase,createSharedRoom} from './collaboration-availability.mjs';
import {openStateDatabase,readCheckpoint,writeCheckpoint,STORAGE_TIMEOUT_MS} from './solo-storage.mjs';
const sessionRead=k=>{try{return sessionStorage.getItem(k);}catch{return null;}};
const sessionWrite=(k,v)=>{try{sessionStorage.setItem(k,v);}catch{}};
const serverBase=resolveServerBase;
export class LabClient extends EventTarget{
 constructor(data,initialConfig={}, {storageTimeoutMs=STORAGE_TIMEOUT_MS}={}){super();this.storageTimeoutMs=storageTimeoutMs;this.autosaveAllowed=false;this.storageStatus={kind:'checking',message:'기기 저장 자료 확인 중'};this.data=data;this.mode='solo';this.role='local';this.ready=false;this.initializing=true;this.version=0;this.revision=0;this.running=false;this.speed=1;this.clockMode='LIVE';this.world=new DualWorld(initialConfig,data);this.notes={question:'혈액 부족과 혈액제제 폐기 문제를 함께 줄이기 위한 공급관리 개선 방안',hypothesis:'',engineering:'',biology:'',limitations:'',improvements:''};this.result=null;this.logs=[];this.pending=new Map();this.clientId=sessionRead('bf-client-id')??eventId();sessionWrite('bf-client-id',this.clientId);this.job=null;this.lastStateAt=Date.now();this.connection='단독 연구';this.loop=setInterval(()=>this.tick(),1000);this.saveLoop=setInterval(()=>this.autosave(),10000);this.watch=setInterval(()=>{if(this.mode==='shared'&&this.ready&&Date.now()-this.lastStateAt>5500){this.ready=false;this.connection='연결 확인 중 · 조작 잠금';this.emit();this.socket?.close();}},1000);}
 emit(){this.dispatchEvent(new Event('change'));}
 error(message){this.dispatchEvent(new CustomEvent('notice',{detail:message}));}
 get state(){if(this.mode==='shared')return this.sharedState;return {version:this.version,revision:this.revision,world:viewOf(this.world),notes:this.notes,result:this.result,logs:this.logs,job:this.job?{progress:this.job.progress,plan:this.job.plan,paused:!!this.job.paused}:null,running:this.running,speed:this.speed,mode:this.clockMode,peers:[]};}
 storageChanged(status){this.storageStatus=status;this.dispatchEvent(new Event('storage'));}
 async db(){
  if(this._db)return this._db;
  if(!this._dbPending)this._dbPending=openStateDatabase({timeoutMs:this.storageTimeoutMs}).then(db=>{this._db=db;db.onversionchange=()=>{db.close();if(this._db===db)this._db=null;};db.onclose=()=>{if(this._db===db)this._db=null;};return db;}).finally(()=>{this._dbPending=null;});
  return this._dbPending;
 }
 async restoreAutosave(){
  try{
   const network=this.world.c.network,saved=await readCheckpoint(await this.db(),this.clientId,network,{timeoutMs:this.storageTimeoutMs});
   if(saved!=null){
    if(typeof saved!=='object'||Array.isArray(saved)||(saved.snapshot?.c?.network??'incheon')!==network)throw Error('자동 저장 자료의 공급망 범위가 일치하지 않습니다.');
    const world=DualWorld.restore(saved.snapshot,this.data),notes={...this.notes};
    if(saved.notes!=null){if(typeof saved.notes!=='object'||Array.isArray(saved.notes))throw Error('자동 저장 연구 기록의 형식이 올바르지 않습니다.');for(const key of Object.keys(notes))if(key in saved.notes){if(typeof saved.notes[key]!=='string'||saved.notes[key].length>6000)throw Error('자동 저장 연구 기록의 형식이 올바르지 않습니다.');notes[key]=saved.notes[key];}}
    if(this.mode==='solo'&&this.initializing){this.world=world;this.notes=notes;this.result=saved.result??null;this.running=false;this.connection='단독 연구 · 자동 저장 복원';}
   }
   this.autosaveAllowed=true;this.storageChanged({kind:'ready',restored:saved!=null,message:'기기 저장 자료 확인 완료'});
  }catch(error){
   this.autosaveAllowed=false;this.connection='단독 연구 · 파일 저장 필요';this.storageChanged({kind:'blocked',message:'자동 저장 복원 불가: '+error.message});this.error(this.storageStatus.message);
  }finally{this.initializing=false;if(this.mode==='solo')this.ready=true;this.emit();}
 }
 async autosave(){
  if(this.mode!=='solo'||this.initializing||!this.autosaveAllowed)return;
  if(this._autosavePending){this._autosaveQueued=true;return this._autosavePending;}
  this.storageChanged({kind:'saving',message:'자동 저장 중'});
  this._autosavePending=(async()=>{
   try{
    // Snapshot fields contain mutable engine references; copy before waiting for the database.
    const record=structuredClone({snapshot:this.world.snapshot(),notes:this.notes,result:this.result});
    await writeCheckpoint(await this.db(),this.clientId,record,{timeoutMs:this.storageTimeoutMs});this.savedAt=Date.now();
    if(!this._autosaveQueued){this.storageChanged({kind:'ready',message:'자동 저장 완료'});this.dispatchEvent(new Event('saved'));}
   }catch(error){this.autosaveAllowed=false;this.storageChanged({kind:'blocked',message:'자동 저장 불가: '+error.message});this.error(this.storageStatus.message);}
  })().finally(()=>{this._autosavePending=null;const queued=this._autosaveQueued;this._autosaveQueued=false;if(queued&&this.autosaveAllowed&&this.mode==='solo')this.autosave();});
  return this._autosavePending;
 }
 tick(){if(this.mode==='solo'&&this.running){try{this.world.advance(Math.min(24*365,this.world.t+this.speed/60));this.version++;if(this.world.t>=24*365)this.running=false;this.emit();}catch(e){this.running=false;this.error(e.message);}}
  // Application heartbeat prevents silently running disconnected shared clients.
  if(this.mode==='shared'&&this.socket?.readyState===1)this.socket.send(JSON.stringify({type:'heartbeat',experimentId:this.code}));
 }
 async checkServer(options){this.availability??=new CollaborationAvailability();return this.serverAvailability=await this.availability.check(options);}
 async requireServer(){const status=await this.checkServer();if(!status.ready)throw Error(status.message);}
 async joinAvailable(code,role){if(!/^[A-F0-9]{6}$/.test(code))throw Error('실험실 코드는 영문·숫자 6자리입니다.');if(!['engineering','biology'].includes(role))throw Error('연구 역할을 선택하세요.');await this.requireServer();return this.join(code,role);}
 async create(role='engineering'){if(this.initializing)throw Error('자동 저장 복원이 끝난 뒤 접속하세요.');if(!['engineering','biology'].includes(role))throw Error('연구 역할을 선택하세요.');await this.requireServer();const config=Object.fromEntries(Object.entries(this.state?.world?.c??{}).filter(([key])=>!['realNodes','roadHours','regions'].includes(key)));const v=await createSharedRoom(config,role);return this.join(v.experimentId,role,v.tokens[role]);}
 join(code,role,token){if(this.initializing)throw Error('자동 저장 복원이 끝난 뒤 접속하세요.');if(!/^[A-F0-9]{6}$/.test(code))throw Error('실험실 코드는 영문·숫자 6자리입니다.');if(!['engineering','biology'].includes(role))throw Error('연구 역할을 선택하세요.');
  this.reconnect=false;clearTimeout(this.reconnectTimer);const previous=this.socket;this.socket=null;previous?.close();this.pending.clear();
  this.running=false;this.mode='shared';this.ready=false;this.role=role;this.code=code;this.sharedState=null;this.authorityId=null;this.reconnectAttempt=0;this.reconnect=true;this.token=token??localStorage.getItem('bf-token:'+code+':'+role)??'';this.connection='공통 서버 연결 중';this.connect();this.emit();
 }
 connect(){if(!this.reconnect)return;const base=serverBase(),protocol=base.protocol==='https:'?'wss:':'ws:';const socket=new WebSocket(protocol+'//'+base.host+'/bloodflow/ws');this.socket=socket;
  socket.onopen=()=>socket.send(JSON.stringify({type:'join',experimentId:this.code,role:this.role,token:this.token}));
  socket.onmessage=e=>{if(this.socket!==socket)return;try{const m=JSON.parse(e.data);if(m.type==='joined'){this.token=m.token;localStorage.setItem('bf-token:'+this.code+':'+this.role,m.token);}
   else if(m.type==='state'){
    if(this.authorityId!==m.authorityId){if(this.authorityId){this.pending.clear();this.error('서버 재시작 감지: 마지막 서버 저장 상태로 복구했습니다. 대기 조작을 취소했으며 일시정지 상태를 확인하세요.');}this.authorityId=m.authorityId;this.sharedState=null;}
    if(this.sharedState&&m.version<this.sharedState.version)return;if(this.sharedState&&m.version===this.sharedState.version&&m.world.t!==this.sharedState.world.t){this.error('상태 버전 불일치: 서버에 다시 연결합니다.');socket.close();return;}this.sharedState=m;this.reconnectAttempt=0;this.ready=true;this.lastStateAt=Date.now();this.connection='동기화됨 · '+this.code;this.emit();
    for(const p of this.pending.values())if(!p.sent){socket.send(JSON.stringify(p.message));p.sent=true;}
   }else if(m.type==='heartbeat'){this.lastStateAt=Date.now();}
   else if(m.type==='ack'){const sent=this.pending.get(m.eventId)?.message;this.pending.delete(m.eventId);this.dispatchEvent(new CustomEvent('ack',{detail:sent}));}
   else if(m.type==='conflict'){this.pending.delete(m.eventId);this.error(m.error);}
   else if(m.type==='error'){if(m.eventId)this.pending.delete(m.eventId);this.error(m.error);}
   else if(m.type==='export'){this.dispatchEvent(new CustomEvent('export',{detail:{format:'BLOODFLOW-LAB-FILE-1',snapshot:m.snapshot,notes:m.notes,result:m.result}}));}
  }catch(e){this.error('메시지를 복구할 수 없습니다: '+e.message);}};
  socket.onerror=()=>{};socket.onclose=()=>{if(this.socket!==socket)return;this.ready=false;this.connection='연결 끊김 · 시간·조건 조작 잠금';for(const p of this.pending.values())p.sent=false;this.emit();if(this.reconnect)this.reconnectTimer=setTimeout(()=>this.connect(),Math.min(15000,1000*2**Math.min(4,this.reconnectAttempt++)));};
 }
 leave(){this.reconnect=false;clearTimeout(this.reconnectTimer);this.socket?.close();this.socket=null;this.pending.clear();this.mode='solo';this.role='local';this.sharedState=null;this.world=new DualWorld({},this.data);this.running=false;this.ready=true;this.connection='새 단독 연구 · 일시정지';this.emit();}
 command(type,props={}){
  if(this.initializing)throw Error('자동 저장 복원이 끝난 뒤 조작하세요.');
  if(this.mode==='solo'&&this.job&&['configure','restore','review','compute'].includes(type))throw Error('반복 계산을 중단한 뒤 조건을 변경하세요.');
  if(this.mode==='shared'){
   if(!this.ready||this.socket?.readyState!==1)throw Error('연결 복구 후 서버의 최신 상태를 확인하세요.');
   const seqKey='bf-sequence:'+this.code+':'+this.role,clientSequence=Number(sessionRead(seqKey)||0)+1;sessionWrite(seqKey,String(clientSequence));const id=eventId(),message={type,...props,eventId:id,clientId:this.clientId,clientSequence,experimentId:this.code,expectedVersion:this.sharedState.version,expectedRevision:this.sharedState.revision,timestamp:new Date().toISOString()};
   if(type!=='export')this.pending.set(id,{message,sent:true});this.socket.send(JSON.stringify(message));return;
  }
  if(type==='configure'){this.world=new DualWorld({...this.world.c,...props.patch},this.data);this.running=false;this.revision++;}
  else if(type==='clock'){this.clockMode=props.mode;this.speed=props.speed;this.running=props.running;}
  else if(type==='step'){this.running=false;this.world.advance(this.world.t+props.hours);}
  else if(type==='notes'){this.notes={...this.notes,...props.patch};this.revision++;}
  else if(type==='review'){this.world.resolveReview(props.id,props.decision,props.note);this.revision++;}
  else if(type==='restore'){if(this.running)throw Error('일시정지 후 복원하세요.');this.world=DualWorld.restore(props.snapshot,this.data);if(props.notes)this.notes=props.notes;if(props.result)this.result=props.result;this.revision++;}
  else if(type==='export'){this.dispatchEvent(new CustomEvent('export',{detail:{format:'BLOODFLOW-LAB-FILE-1',snapshot:this.world.snapshot(),notes:this.notes,result:this.result}}));return;}
  else if(type==='compute'){this.compute(props.plan);return;}
  else if(type==='pause-compute'||type==='resume-compute'){if(!this.job)throw Error('진행 중인 반복 실험이 없습니다.');this.job.paused=type==='pause-compute';this.worker.postMessage({type:this.job.paused?'pause':'resume'});}
  else if(type==='cancel-compute'){this.worker?.terminate();this.worker=null;this.job=null;}
  else throw Error('지원하지 않는 명령입니다.');
  this.version++;this.logs.push({at:new Date().toISOString(),h:this.world.t,role:'local',action:type,eventId:eventId()});if(this.logs.length>100)this.logs.shift();this.autosave();this.emit();
 }
 compute(raw){if(this.job)throw Error('이미 반복 실험이 진행 중입니다.');const plan=validatePlan(raw);this.running=false;this.job={plan,progress:0};
  const url=window.BLOODFLOW_MODULES?.['compute-worker.mjs']??new URL('./compute-worker.mjs',import.meta.url).href;const worker=new Worker(url,{type:'module'});this.worker=worker;
  worker.onmessage=e=>{if(this.worker!==worker)return;const m=e.data;if(m.type==='progress')this.job.progress=m.progress;if(m.type==='paused')this.job.paused=m.paused;
   if(m.type==='result'||m.type==='error'){if(m.result)this.result=m.result;if(m.error)this.error(m.error);worker.terminate();this.worker=null;this.job=null;this.autosave();}this.emit();};
  worker.onerror=e=>{this.job=null;this.worker=null;this.error('반복 계산을 실행하지 못했습니다. '+e.message);worker.terminate();this.emit();};worker.postMessage({config:this.world.c,data:this.data,plan});this.emit();
 }
}
