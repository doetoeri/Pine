import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setImmediate as flush} from 'node:timers/promises';
import {LabClient} from '../src/client.mjs';
import {DualWorld} from '../src/engine.mjs';
import {Rooms} from '../server/rooms.mjs';

const data=Object.fromEntries(['facilities','routes','nationwide'].map(k=>[k,JSON.parse(fs.readFileSync(new URL('../public/data/'+k+'.json',import.meta.url)))]));
const example=network=>JSON.parse(fs.readFileSync(new URL('../examples/experiment-'+(network==='nationwide'?'N':'A')+'.json',import.meta.url)));
async function fixture(t,network='incheon'){
 const keys=['window','location','WebSocket','localStorage','sessionStorage'],old=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)])),directory=fs.mkdtempSync(path.join(os.tmpdir(),'bf-solo-return-')),rooms=new Rooms(data,directory),room=rooms.create({network:network==='incheon'?'nationwide':'incheon'}),clients=[],storage=new Map();
 class Socket{
  constructor(){this.readyState=1;}
  send(raw){const m=JSON.parse(raw);if(m.type==='heartbeat')return;
   if(m.type==='join'){const socket=this;this.peer=rooms.join({get readyState(){return socket.readyState;},send(text){queueMicrotask(()=>{if(socket.readyState===1)socket.onmessage?.({data:text});});},close(){socket.close();}},m.experimentId,m.role,m.token);}
   else rooms.command(this.peer,m);
  }
  close(){if(this.readyState===3)return;this.readyState=3;rooms.leave(this.peer);this.onclose?.();}
 }
 Object.assign(globalThis,{window:{BLOODFLOW_RUNTIME:{}},location:{origin:'http://lab.test',protocol:'http:'},WebSocket:Socket,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}});
 const make=(config={})=>{const c=new LabClient(data,{network,seed:8123,...config});clients.push(c);c.initializing=false;c.ready=true;return c;};
 const c=make();c.command('step',{hours:12});c.command('notes',{patch:{engineering:'이 기기의 산업공학 해석',biology:'이 기기의 생명과학 해석',limitations:'단독 모형의 한계'}});c.result=example(network);c.clockMode='TIMELAPSE';c.speed=96;c.computeIssue='앞선 단독 계산의 복구 안내';
 t.after(async()=>{for(const c of clients){c.reconnect=false;clearTimeout(c.reconnectTimer);clearTimeout(c.joinTimer);for(const k of ['loop','saveLoop','watch'])clearInterval(c[k]);c.socket?.close();}rooms.close();await flush();for(const [key,d] of old)if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];fs.rmSync(directory,{recursive:true,force:true});});
 const join=async(role='engineering',target=room)=>{c.join(target.code,role,target.tokens[role]);c.socket.onopen();await flush();assert.equal(c.ready,true);};
 return {c,make,rooms,room,join};
}
const capture=c=>({world:c.world,snapshot:structuredClone(c.world.snapshot()),notes:structuredClone(c.notes),result:structuredClone(c.result),logs:structuredClone(c.logs),version:c.version,revision:c.revision,speed:c.speed,clockMode:c.clockMode,computeIssue:c.computeIssue});
function unchanged(c,before){assert.ok(c.world===before.world,'Pre-join solo world must keep its identity.');assert.deepEqual(c.world.snapshot(),before.snapshot);for(const k of ['notes','result','logs','version','revision','speed','clockMode','computeIssue'])assert.deepEqual(c[k],before[k],k);assert.equal(c.world.verify().passed,true);}

for(const network of ['incheon','nationwide'])for(const role of ['engineering','biology'])test('leaving '+role+' returns to the intact paused '+network+' solo study',async t=>{
 const {c,room,join}=await fixture(t,network),before=capture(c);c.running=true;await join(role);c.command('step',{hours:6});await flush();c.command('notes',{patch:{[role]:'공유 세계에서 작성한 해석'}});await flush();const shared=structuredClone(room.world.snapshot()),sharedNotes=structuredClone(room.notes);
 c.leave();unchanged(c,before);assert.equal(c.mode,'solo');assert.equal(c.role,'local');assert.equal(c.ready,true);assert.equal(c.running,false);assert.equal(c.reconnect,false);assert.equal(c.sharedState,null);assert.equal(c.pending.size,0);assert.equal(c.socket,null);assert.deepEqual(room.world.snapshot(),shared);assert.deepEqual(room.notes,sharedNotes);
 const control=DualWorld.restore(before.snapshot,data);control.advance(18);c.command('step',{hours:6});assert.deepEqual(c.world.snapshot(),control.snapshot());assert.deepEqual(room.world.snapshot(),shared);
});

test('returning during a pending handshake preserves the solo study and ignores late old socket events',async t=>{
 const {c,room}=await fixture(t,'nationwide'),before=capture(c);c.join(room.code,'biology',room.tokens.biology);const socket=c.socket;c.leave();socket.onopen();socket.onmessage?.({data:JSON.stringify({type:'state',authorityId:'late',version:99,world:{t:80}})});socket.onclose();await flush();unchanged(c,before);assert.equal(c.mode,'solo');assert.equal(c.ready,true);assert.equal(c.reconnect,false);assert.equal(c.running,false);assert.equal(c.connectionIssue,'');
});

test('repeated room and role changes return to the latest solo state rather than a stale first copy',async t=>{
 const {c,rooms,join}=await fixture(t);await join();c.leave();c.command('step',{hours:6});c.command('notes',{patch:{engineering:'단독 복귀 후 추가 해석'}});const before=capture(c);await join('biology',rooms.create({network:'nationwide'}));c.leave();unchanged(c,before);assert.equal(c.world.t,18);assert.equal(c.notes.engineering,'단독 복귀 후 추가 해석');
});

test('leave is a no-op in solo mode, including a running clock and a paused local computation',async t=>{
 const {c}=await fixture(t),before=capture(c);c.running=true;const job={plan:{experiment:'A'},paused:true};c.job=job;c.leave();unchanged(c,before);assert.equal(c.running,true);assert.equal(c.job,job);assert.equal(c.connection,'단독 연구');
});

test('returning cannot clear an existing storage failure or re-enable writes to a protected checkpoint',async t=>{
 const {c,join}=await fixture(t,'nationwide'),before=capture(c),status={kind:'blocked',message:'보호 중인 저장 자료'};c.storageStatus=status;c.autosaveAllowed=false;c.db=()=>{assert.fail('Blocked storage must not be opened by leaving a room.');};await join();c.leave();await c.autosave();unchanged(c,before);assert.equal(c.storageStatus,status);assert.equal(c.autosaveAllowed,false);assert.equal(c.running,false);
});

test('autosave and reload after returning keep the original network, world, notes and independent result',async t=>{
 const {c,make,join}=await fixture(t,'nationwide'),records=new Map();
 const db={transaction(){const staged=new Map();let pending=0;const tx={abort(){},objectStore(){return {get(key){return request(()=>structuredClone(records.get(key)));},put(value,key){return request(()=>staged.set(key,structuredClone(value)));}};}};const request=fn=>{const r={};pending++;queueMicrotask(()=>{r.result=fn();r.onsuccess?.();pending--;queueMicrotask(()=>{if(pending===0){for(const [k,v] of staged)records.set(k,v);tx.oncomplete?.();}});});return r;};return tx;}};
 c.db=async()=>db;c.autosaveAllowed=true;c.storageStatus={kind:'ready'};await c.autosave();const before=capture(c);await join();c.leave();await c.autosave();const saved=records.get('solo:'+c.clientId+':nationwide');assert.equal(saved.snapshot.t,before.snapshot.t);assert.equal(saved.snapshot.c.network,before.snapshot.c.network);assert.deepEqual(saved.snapshot,before.snapshot);assert.deepEqual(saved.notes,before.notes);assert.deepEqual(saved.result,before.result);assert.equal([...records.keys()].some(k=>k.endsWith(':incheon')),false);
 const reopened=make();reopened.db=async()=>db;reopened.initializing=true;await reopened.restoreAutosave();assert.deepEqual(reopened.world.snapshot(),before.snapshot);assert.deepEqual(reopened.notes,before.notes);assert.deepEqual(reopened.result,before.result);assert.equal(reopened.ready,true);assert.equal(reopened.running,false);assert.equal(reopened.world.verify().passed,true);
});
