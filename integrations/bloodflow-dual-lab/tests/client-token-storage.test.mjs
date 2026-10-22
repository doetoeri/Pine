import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {LabClient} from '../src/client.mjs';

const data=Object.fromEntries(['facilities','routes','nationwide'].map(k=>[k,JSON.parse(fs.readFileSync(new URL('../public/data/'+k+'.json',import.meta.url)))]));
function fixture(t){
 const keys=['window','location','WebSocket','localStorage'],old=Object.fromEntries(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)])),policy={denyRead:false,denyWrite:false,reads:0,writes:0,removes:0},storage=new Map(),sockets=[],notices=[];
 class Socket{
  constructor(){this.readyState=0;this.sent=[];sockets.push(this);}
  open(){this.readyState=1;this.onopen?.();}
  send(text){this.sent.push(JSON.parse(text));}
  message(message){this.onmessage?.({data:JSON.stringify(message)});}
  close(){this.readyState=3;this.onclose?.();}
 }
 Object.assign(globalThis,{window:{BLOODFLOW_RUNTIME:{}},location:{origin:'http://lab.test',protocol:'http:'},WebSocket:Socket,localStorage:{
  getItem(key){policy.reads++;if(policy.denyRead)throw new DOMException('Synthetic denied read','SecurityError');return storage.get(key)??null;},
  setItem(key,value){policy.writes++;if(policy.denyWrite)throw new DOMException('Synthetic full store','QuotaExceededError');storage.set(key,value);},
  removeItem(key){policy.removes++;storage.delete(key);}
 }});
 const c=new LabClient(data);c.initializing=false;c.ready=true;c.world.advance(6);c.notes.engineering='보존할 연구 기록';c.addEventListener('notice',e=>notices.push(e.detail));
 t.after(()=>{c.reconnect=false;clearTimeout(c.reconnectTimer);clearTimeout(c.joinTimer);for(const k of ['loop','saveLoop','watch'])clearInterval(c[k]);for(const [k,descriptor]of Object.entries(old))if(descriptor)Object.defineProperty(globalThis,k,descriptor);else delete globalThis[k];});
 return {c,policy,storage,sockets,notices};
}
function synchronize(c,{code='ABC123',role='engineering',token='confirmed-role-token',hours=12}={}){
 if(c.socket.readyState!==1)c.socket.open();c.socket.message({type:'joined',experimentId:code,role,token});c.socket.message({type:'state',experimentId:code,authorityId:'server-1',version:1,revision:0,world:{t:hours},notes:{engineering:'산업공학 해석',biology:'생명과학 해석'},peers:[role],running:false});
}

test('a blocked localStorage getter rejects a guarded join before changing the active solo research',async t=>{
 const {c,sockets}=fixture(t);c.running=true;c.availability={check:async()=>({ready:true})};const before=JSON.stringify(c.state),world=c.world;
 Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new DOMException('Synthetic blocked access','SecurityError');}});
 let failure;try{await c.joinAvailable('ABC123','biology');}catch(error){failure=error;}
 assert.ok(failure);assert.equal(c.mode,'solo');assert.equal(c.ready,true);assert.equal(c.running,true);assert.equal(c.world,world);assert.equal(JSON.stringify(c.state),before);assert.equal(sockets.length,0);assert.match(failure.message,/접속 정보.*읽|저장소.*읽/);
});

test('a token read failure cannot disconnect a working shared room or discard its pending commands',t=>{
 const {c,policy,sockets}=fixture(t);c.join('ABC123','engineering','explicit-role-token');synchronize(c);c.command('notes',{patch:{engineering:'아직 응답 대기 중'}});
 const socket=c.socket,before=JSON.stringify(c.state),pending=[...c.pending.keys()];policy.denyRead=true;assert.throws(()=>c.join('DEF456','biology'));
 assert.equal(c.socket,socket);assert.equal(socket.readyState,1);assert.equal(c.code,'ABC123');assert.equal(c.role,'engineering');assert.equal(c.ready,true);assert.equal(JSON.stringify(c.state),before);assert.deepEqual([...c.pending.keys()],pending);assert.equal(sockets.length,1);c.command('step',{hours:6});assert.equal(socket.sent.at(-1).type,'step');
});

test('a valid explicit token connects despite a write quota error and keeps a persistent memory-only warning',t=>{
 const {c,policy,notices}=fixture(t);policy.denyRead=true;policy.denyWrite=true;c.join('ABC123','engineering','explicit-role-token');synchronize(c);
 assert.equal(c.ready,true);assert.equal(c.state.world.t,12);assert.equal(c.token,'confirmed-role-token');assert.equal(policy.reads,0);assert.equal(policy.writes,1);assert.match(c.tokenStorageIssue,/현재 탭|메모리/);assert.equal(c.connectionIssue,'');assert.deepEqual(notices,[]);
 c.socket.message({type:'state',experimentId:'ABC123',authorityId:'server-1',version:2,revision:0,world:{t:18},notes:{},peers:['engineering']});assert.equal(c.state.world.t,18);assert.match(c.tokenStorageIssue,/현재 탭|메모리/);assert.equal(policy.writes,1);assert.equal(policy.removes,0);
});

test('a confirmed in-memory token permits same-room rejoin but is never reused for another role or room',t=>{
 const {c,policy}=fixture(t);policy.denyWrite=true;c.join('ABC123','engineering','explicit-role-token');synchronize(c);policy.denyRead=true;
 const live=c.socket;for(const [code,role]of [['ABC123','biology'],['DEF456','engineering']]){assert.throws(()=>c.join(code,role));assert.equal(c.socket,live);assert.equal(live.readyState,1);assert.equal(c.ready,true);}
 const reads=policy.reads;c.join('ABC123','engineering');c.socket.open();assert.equal(c.socket.sent[0].token,'confirmed-role-token');assert.equal(policy.reads,reads);synchronize(c);assert.equal(c.ready,true);assert.match(c.tokenStorageIssue,/현재 탭|메모리/);
});

test('a manual rejoin after storage recovers persists the confirmed token and clears only its storage warning',t=>{
 const {c,policy,storage}=fixture(t);policy.denyWrite=true;c.join('ABC123','biology','explicit-role-token');synchronize(c,{role:'biology'});assert.ok(c.tokenStorageIssue);
 policy.denyRead=true;policy.denyWrite=false;c.join('ABC123','biology');synchronize(c,{role:'biology',hours:18});assert.equal(c.ready,true);assert.equal(c.state.world.t,18);assert.equal(c.tokenStorageIssue,'');assert.equal(storage.get('bf-token:ABC123:biology'),'confirmed-role-token');assert.equal(policy.removes,0);
 c.leave();assert.equal(c.tokenStorageIssue,'');
});

for(const source of ['stored','memory'])test('a refused '+source+' token is retained; rejection never falls back to an empty invitation',t=>{
 const {c,policy,storage}=fixture(t);
 if(source==='memory'){policy.denyWrite=true;c.join('ABC123','engineering','explicit-role-token');synchronize(c);policy.denyRead=true;}
 else storage.set('bf-token:ABC123:engineering','refused-role-token');
 const expected=source==='memory'?'confirmed-role-token':'refused-role-token';c.join('ABC123','engineering');c.socket.open();assert.equal(c.socket.sent[0].token,expected);
 c.socket.message({type:'error',phase:'join',retryable:false,error:'역할 토큰이 일치하지 않습니다.'});assert.equal(c.ready,false);assert.equal(c.reconnect,false);assert.equal(policy.removes,0);assert.match(c.connectionIssue,/역할 토큰/);
 c.join('ABC123','engineering');c.socket.open();assert.equal(c.socket.sent[0].token,expected);assert.equal(policy.removes,0);
});
