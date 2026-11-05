import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {LabClient} from '../src/client.mjs';

const data=Object.fromEntries(['facilities','routes','nationwide'].map(k=>[k,JSON.parse(fs.readFileSync(new URL('../public/data/'+k+'.json',import.meta.url)))]));
function fixture(t,options={}){
 const keys=['window','location','WebSocket','localStorage'],old=Object.fromEntries(keys.map(k=>[k,globalThis[k]])),sockets=[],storage=new Map(),notices=[];
 class Socket{
  constructor(){this.readyState=0;this.sent=[];sockets.push(this);}
  open(){this.readyState=1;this.onopen?.();}
  send(text){this.sent.push(JSON.parse(text));}
  message(message){this.onmessage?.({data:JSON.stringify(message)});}
  close(){this.readyState=3;this.onclose?.();}
 }
 Object.assign(globalThis,{window:{BLOODFLOW_RUNTIME:{}},location:{origin:'http://lab.test',protocol:'http:'},WebSocket:Socket,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}});
 const c=new LabClient(data,{},options);c.initializing=false;c.ready=true;c.world.advance(6);c.notes.engineering='단독 연구 기록';c.addEventListener('notice',e=>notices.push(e.detail));
 t.after(()=>{c.reconnect=false;clearTimeout(c.reconnectTimer);clearTimeout(c.joinTimer);for(const key of ['loop','saveLoop','watch'])clearInterval(c[key]);for(const [k,v]of Object.entries(old))if(v===undefined)delete globalThis[k];else globalThis[k]=v;});
 return {c,sockets,storage,notices};
}
function synchronize(socket,{code='ABC123',role='engineering',version=0,hours=12}={}){
 socket.message({type:'joined',experimentId:code,role,token:'test-token'});
 socket.message({type:'state',experimentId:code,authorityId:'server-1',version,revision:0,world:{t:hours},notes:{},peers:[role]});
}

test('no heartbeat before the first state; a legacy join rejection stays visible and stops automatic retries',t=>{
 const {c,sockets,notices}=fixture(t);const before=JSON.stringify(c.world.snapshot());c.join('ABC123','engineering');const socket=c.socket;socket.open();
 c.tick();c.tick();assert.deepEqual(socket.sent.map(m=>m.type),['join']);
 socket.message({type:'error',error:'실험실 코드 또는 역할을 확인하세요.'});
 assert.equal(c.ready,false);assert.equal(c.mode,'shared');assert.equal(c.reconnect,false);assert.equal(socket.readyState,3);assert.match(c.connectionIssue,/실험실 코드 또는 역할/);assert.match(c.connection,/접속 거절/);
 const issue=c.connectionIssue;socket.message({type:'error',error:'먼저 실험실에 접속하세요.'});socket.message({type:'state',version:99,world:{t:80}});c.tick();
 assert.equal(c.connectionIssue,issue);assert.equal(notices.length,1);assert.equal(c.sharedState,null);assert.equal(c.reconnectTimer,undefined);assert.equal(sockets.length,1);assert.equal(JSON.stringify(c.world.snapshot()),before);assert.equal(c.notes.engineering,'단독 연구 기록');assert.throws(()=>c.command('step',{hours:6}),/연결 복구/);
 c.join('DEF456','biology');const retry=c.socket;retry.open();synchronize(retry,{code:'DEF456',role:'biology'});assert.equal(c.ready,true);assert.equal(c.connectionIssue,'');assert.equal(c.role,'biology');assert.equal(c.state.world.t,12);c.tick();assert.equal(retry.sent.at(-1).type,'heartbeat');
});

test('an explicit join rejection after joined is terminal; an ordinary command error keeps the live connection',t=>{
 const {c}=fixture(t);c.join('ABC123','engineering');c.socket.open();synchronize(c.socket);c.command('notes',{patch:{engineering:'해석'}});const id=c.socket.sent.at(-1).eventId;
 c.socket.message({type:'error',eventId:id,error:'명령을 확인하세요.'});assert.equal(c.pending.size,0);assert.equal(c.ready,true);assert.equal(c.reconnect,true);assert.equal(c.connectionIssue,'');
 c.socket.message({type:'error',phase:'join',retryable:false,error:'역할 토큰이 일치하지 않습니다.'});assert.equal(c.ready,false);assert.equal(c.reconnect,false);assert.match(c.connectionIssue,/역할 토큰/);assert.equal(c.state.world.t,12);
});

for(const stage of ['opening','awaiting state'])test('a stalled '+stage+' connection is locked, timed out and eligible for backoff retry',async t=>{
 const {c,sockets}=fixture(t,{joinTimeoutMs:20});c.join('ABC123','engineering');const socket=c.socket;
 if(stage==='awaiting state'){socket.open();socket.message({type:'joined',experimentId:'ABC123',role:'engineering',token:'test-token'});}
 await delay(45);assert.equal(socket.readyState,3);assert.equal(c.ready,false);assert.equal(c.reconnect,true);assert.match(c.connectionIssue,/제한 시간/);assert.ok(c.reconnectTimer);assert.equal(sockets.length,1);assert.equal(c.world.t,6);assert.equal(c.mode,'shared');const sent=socket.sent.length;socket.onopen();assert.equal(socket.sent.length,sent);
});

test('switching rooms and leaving cancel handshake work; late old socket events cannot join or overwrite the new room',async t=>{
 const {c}=fixture(t,{joinTimeoutMs:30});c.join('ABC123','engineering');const old=c.socket;c.join('DEF456','biology');const current=c.socket;
 old.onopen();old.message({type:'error',phase:'join',retryable:false,error:'옛 연결 오류'});old.onclose();assert.equal(old.sent.length,0);assert.equal(c.socket,current);assert.equal(c.reconnect,true);
 current.open();synchronize(current,{code:'DEF456',role:'biology'});await delay(55);assert.equal(c.ready,true);assert.equal(current.readyState,1);assert.equal(c.connectionIssue,'');assert.equal(c.state.world.t,12);
 c.join('DEF456','biology');const pending=c.socket;c.leave();pending.onopen();await delay(55);assert.equal(c.mode,'solo');assert.equal(c.ready,true);assert.equal(c.reconnect,false);assert.equal(c.connectionIssue,'');assert.equal(pending.sent.length,0);
});

test('a temporary disconnect retries once after backoff and waits for fresh state before resending commands',async t=>{
 const {c,sockets}=fixture(t);c.join('ABC123','engineering');c.socket.open();synchronize(c.socket);c.command('notes',{patch:{engineering:'대기 기록'}});const id=c.socket.sent.at(-1).eventId;
 c.socket.close();assert.equal(c.ready,false);assert.equal(c.mode,'shared');assert.equal(c.pending.get(id).sent,false);assert.throws(()=>c.command('step',{hours:6}),/연결 복구/);
 await delay(1100);assert.equal(sockets.length,2);const retry=c.socket;retry.open();c.tick();assert.deepEqual(retry.sent.map(m=>m.type),['join']);assert.equal(c.ready,false);
 synchronize(retry,{version:1,hours:18});assert.equal(c.ready,true);assert.equal(c.state.world.t,18);assert.equal(c.pending.get(id).sent,true);assert.equal(retry.sent.filter(m=>m.eventId===id).length,1);assert.equal(c.connectionIssue,'');
});
