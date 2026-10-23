import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setImmediate as flush,setTimeout as delay} from 'node:timers/promises';
import {LabClient} from '../src/client.mjs';
import {Rooms} from '../server/rooms.mjs';

const data=Object.fromEntries(['facilities','routes','nationwide'].map(k=>[k,JSON.parse(fs.readFileSync(new URL('../public/data/'+k+'.json',import.meta.url)))]));
async function fixture(t,options={}){
 const keys=['window','location','WebSocket','localStorage','sessionStorage'],old=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)])),directory=fs.mkdtempSync(path.join(os.tmpdir(),'bf-export-')),rooms=new Rooms(data,directory),room=rooms.create(),clients=[],sockets=[],storage=new Map(),policy={denyRead:false};
 class Socket{
  constructor(){this.readyState=1;this.sent=[];this.held=[];sockets.push(this);}
  deliver(m){if(this.readyState===1)this.onmessage?.({data:JSON.stringify(m)});}
  release(id){const i=this.held.findIndex(m=>m.eventId===id);assert.ok(i>=0);const [m]=this.held.splice(i,1);this.deliver(m);return m;}
  send(text){const m=JSON.parse(text);if(this.failSend&&m.type==='export')throw Error('Synthetic send failure');this.sent.push(m);if(m.type==='heartbeat')return;
   if(m.type==='join'){const socket=this;this.peer=rooms.join({get readyState(){return socket.readyState;},send(text){const m=JSON.parse(text);if(m.type==='export')socket.held.push(m);else if(m.type==='ack'&&socket.holdAck){}else queueMicrotask(()=>socket.deliver(m));},close(){socket.close();}},m.experimentId,m.role,m.token);}else rooms.command(this.peer,m);
  }
  close(){if(this.readyState===3)return;this.readyState=3;rooms.leave(this.peer);this.onclose?.();}
 }
 Object.assign(globalThis,{window:{BLOODFLOW_RUNTIME:{}},location:{origin:'http://lab.test',protocol:'http:'},WebSocket:Socket,localStorage:{getItem(k){if(policy.denyRead)throw Error('Synthetic blocked credential read');return storage.get(k)??null;},setItem:(k,v)=>storage.set(k,v)},sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}});
 const c=new LabClient(data,{},options),results=[],legacy=[],notices=[];clients.push(c);c.initializing=false;c.ready=true;c.addEventListener('export-result',e=>results.push(e.detail));c.addEventListener('export',e=>legacy.push(e.detail));c.addEventListener('notice',e=>notices.push(e.detail));
 const join=async(role='engineering',target=room)=>{c.join(target.code,role,target.tokens[role]);c.socket.onopen();await flush();assert.equal(c.ready,true);};
 t.after(async()=>{for(const c of clients){c.cancelExports('Test cleanup');c.reconnect=false;clearTimeout(c.reconnectTimer);clearTimeout(c.joinTimer);for(const k of ['loop','saveLoop','watch'])clearInterval(c[k]);c.socket?.close();}rooms.close();await flush();for(const [key,d] of old)if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];fs.rmSync(directory,{recursive:true,force:true});});
 return {c,rooms,room,sockets,results,legacy,notices,policy,join};
}

test('solo state and inventory exports keep the unchanged legacy file and carry their own request kind',async t=>{
 const {c,results,legacy}=await fixture(t);c.world.advance(6);const before=structuredClone(c.world.snapshot()),version=c.version,sequence=c.commandSequence;
 for(const kind of ['state','inventory']){const id=c.command('export',{exportKind:kind});assert.equal(results.at(-1).requestId,id);assert.equal(results.at(-1).kind,kind);assert.equal(results.at(-1).file,legacy.at(-1));assert.deepEqual(Object.keys(legacy.at(-1)).sort(),['format','notes','result','snapshot']);assert.equal(legacy.at(-1).format,'BLOODFLOW-LAB-FILE-1');assert.equal(legacy.at(-1).snapshot.t,6);}
 assert.equal(c.exports.size,0);assert.equal(c.pending.size,0);assert.equal(c.commandSequence,sequence);assert.equal(c.version,version);assert.deepEqual(c.world.snapshot(),before);
});

test('out-of-order shared replies route to the original kinds and do not change world, revision, logs or command sequence',async t=>{
 const {c,room,results,legacy,join}=await fixture(t);await join();c.command('step',{hours:6});await flush();const before=structuredClone(room.world.snapshot()),revision=room.revision,logs=room.logs.length,sequence=c.commandSequence;
 const inventory=c.command('export',{exportKind:'inventory'}),state=c.command('export');assert.notEqual(inventory,state);assert.equal(c.exports.size,2);const stateMessage=c.socket.release(state),inventoryMessage=c.socket.release(inventory);
 assert.deepEqual(results.map(x=>[x.requestId,x.kind]),[[state,'state'],[inventory,'inventory']]);assert.equal(c.exports.size,0);assert.equal(legacy.length,2);assert.deepEqual(results[0].file.snapshot,stateMessage.snapshot);assert.deepEqual(results[1].file.snapshot,inventoryMessage.snapshot);assert.equal(c.pending.size,0);assert.equal(c.commandSequence,sequence);assert.equal(room.revision,revision);assert.equal(room.logs.length,logs);assert.deepEqual(room.world.snapshot(),before);assert.equal(room.world.verify().passed,true);assert.ok(c.socket.sent.filter(x=>x.type==='export').every(x=>x.clientSequence===undefined&&x.exportKind===undefined));
});

test('duplicate kinds and invalid formats are rejected before another request is sent',async t=>{
 const {c,join}=await fixture(t);await join();const first=c.command('export'),sent=c.socket.sent.length;assert.throws(()=>c.command('export'),/같은 형식/);for(const kind of ['csv',{},2])assert.throws(()=>c.command('export',{exportKind:kind}),/지원하지/);assert.equal(c.socket.sent.length,sent);assert.equal(c.exports.size,1);c.socket.release(first);c.command('export');assert.equal(c.exports.size,1);
});

test('timeout releases only its request; a late reply cannot become the result of a new request',async t=>{
 const {c,results,notices,join}=await fixture(t,{exportTimeoutMs:25});await join();const expired=c.command('export',{exportKind:'inventory'});await delay(45);assert.equal(c.exports.size,0);assert.match(c.exportIssue,/직접 다시/);assert.equal(notices.length,1);assert.equal(c.socket.sent.filter(x=>x.type==='export').length,1);
 const current=c.command('export',{exportKind:'inventory'});c.socket.release(expired);assert.equal(results.length,0);assert.equal(c.exports.size,1);c.socket.release(current);assert.equal(results.length,1);assert.equal(results[0].requestId,current);assert.equal(results[0].kind,'inventory');assert.equal(c.exports.size,0);await delay(35);assert.equal(notices.length,1);
});

test('duplicate, unknown and missing response IDs cannot generate or consume an export',async t=>{
 const {c,results,join}=await fixture(t);await join();const id=c.command('export'),m=c.socket.held[0];c.socket.deliver({...m,eventId:'unknown-id'});c.socket.deliver({...m,eventId:undefined});assert.equal(results.length,0);assert.equal(c.exports.size,1);c.socket.release(id);c.socket.deliver(m);assert.equal(results.length,1);assert.equal(c.exports.size,0);
});

test('connection loss cancels read requests without replaying them and still preserves exactly-once mutation replay',async t=>{
 const {c,room,results,join}=await fixture(t);await join();const old=c.socket,id=c.command('export');old.holdAck=true;const step=c.command('step',{hours:6});await flush();assert.equal(c.pending.size,1);old.close();assert.equal(c.exports.size,0);assert.match(c.exportIssue,/연결/);clearTimeout(c.reconnectTimer);c.connect();c.socket.onopen();await flush();assert.equal(c.ready,true);assert.equal(c.socket.sent.some(m=>m.type==='export'),false);assert.equal(c.socket.sent.find(m=>m.type==='step').eventId,step);assert.equal(c.pending.size,0);old.deliver(old.held[0]);assert.equal(results.length,0);const current=c.command('export');c.socket.release(current);assert.equal(results[0].requestId,current);assert.notEqual(current,id);assert.equal(room.world.t,6);assert.equal(room.logs.filter(x=>x.action==='step').length,1);
});

test('room changes and solo return cancel old exports without replacing the previous solo study',async t=>{
 const {c,rooms,results,join}=await fixture(t);c.world.advance(12);c.notes.engineering='prior solo';await join();const old=c.socket;c.command('export');await join('biology',rooms.create());assert.equal(c.exports.size,0);old.onmessage({data:JSON.stringify(old.held[0])});assert.equal(results.length,0);const active=c.socket;c.command('export');c.leave();assert.equal(c.exports.size,0);active.onmessage({data:JSON.stringify(active.held[0])});assert.equal(results.length,0);assert.equal(c.world.t,12);assert.equal(c.notes.engineering,'prior solo');assert.equal(c.ready,true);
});

test('authority change on the same connection invalidates old read replies',async t=>{
 const {c,room,results,join}=await fixture(t);await join();const id=c.command('export');c.socket.deliver({...c.state,authorityId:'different-server-authority'});assert.equal(c.exports.size,0);assert.match(c.exportIssue,/서버/);c.socket.release(id);assert.equal(results.length,0);assert.equal(c.state.world.t,room.world.t);
});

test('a correlated command error releases only the failed format and retains the other pending export',async t=>{
 const {c,results,join}=await fixture(t);await join();const state=c.command('export'),inventory=c.command('export',{exportKind:'inventory'});c.socket.deliver({type:'error',eventId:state,error:'Synthetic export refusal'});assert.equal(c.exports.size,1);assert.match(c.exportIssue,/refusal/);c.socket.release(state);assert.equal(results.length,0);c.socket.release(inventory);assert.equal(results[0].kind,'inventory');assert.equal(c.exports.size,0);assert.equal(c.ready,true);
});

test('synchronous send failure releases its timer/request and permits a manual retry',async t=>{
 const {c,join}=await fixture(t);await join();c.socket.failSend=true;assert.throws(()=>c.command('export'),/전송하지/);assert.equal(c.exports.size,0);assert.equal(c.pending.size,0);assert.equal(c.commandSequence,0);c.socket.failSend=false;const id=c.command('export');c.socket.release(id);assert.equal(c.exports.size,0);
});

test('a blocked credential read preserves the current pending export and its original connection',async t=>{
 const {c,results,policy,join}=await fixture(t);await join();const id=c.command('export'),socket=c.socket;policy.denyRead=true;assert.throws(()=>c.join('ABC123','biology'),/읽을 수 없어/);assert.equal(c.socket,socket);assert.equal(c.exports.size,1);socket.release(id);assert.equal(results.length,1);assert.equal(results[0].requestId,id);
});
