import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setImmediate as flush} from 'node:timers/promises';
import {LabClient} from '../src/client.mjs';
import {Rooms} from '../server/rooms.mjs';

const data=Object.fromEntries(['facilities','routes','nationwide'].map(k=>[k,JSON.parse(fs.readFileSync(new URL('../public/data/'+k+'.json',import.meta.url)))]));
async function fixture(t,mode='normal'){
 const keys=['window','location','WebSocket','localStorage','sessionStorage'],old=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)])),directory=fs.mkdtempSync(path.join(os.tmpdir(),'bf-client-sequence-')),rooms=new Rooms(data,directory),room=rooms.create(),clients=[],sockets=[],store=new Map([['bf-client-id','copied-checkpoint-id']]),tokens=new Map(),access={mode,sequenceReads:0,sequenceWrites:0};
 class Socket{
  constructor(){this.readyState=1;this.sent=[];sockets.push(this);}
  send(raw){
   const m=JSON.parse(raw);this.sent.push(m);
   if(m.type==='heartbeat')return;
   if(m.type==='join'){
    const socket=this;this.peer=rooms.join({get readyState(){return socket.readyState;},send(text){const value=JSON.parse(text);if(socket.holdAck&&value.type==='ack')return;queueMicrotask(()=>{if(socket.readyState===1)socket.onmessage?.({data:text});});},close(){socket.close();}},m.experimentId,m.role,m.token);
   }else try{rooms.command(this.peer,m);}catch(error){queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'error',eventId:m.eventId,error:error.message})}));}
  }
  close(){if(this.readyState===3)return;this.readyState=3;rooms.leave(this.peer);this.onclose?.();}
 }
 const storage={getItem(k){if(k.startsWith('bf-sequence:'))access.sequenceReads++;if(['read','read-write'].includes(access.mode))throw new DOMException('Synthetic session read denied','SecurityError');return store.get(k)??null;},setItem(k,v){if(k.startsWith('bf-sequence:'))access.sequenceWrites++;if(['write','read-write'].includes(access.mode))throw new DOMException('Synthetic session write denied','QuotaExceededError');store.set(k,String(v));}};
 Object.assign(globalThis,{window:{BLOODFLOW_RUNTIME:{}},location:{origin:'http://lab.test',protocol:'http:'},WebSocket:Socket,localStorage:{getItem:k=>tokens.get(k)??null,setItem:(k,v)=>tokens.set(k,v)}});
 Object.defineProperty(globalThis,'sessionStorage',{configurable:true,get(){if(access.mode==='getter')throw new DOMException('Synthetic session getter denied','SecurityError');return storage;}});
 const makeClient=async(role='engineering',target=room)=>{const c=new LabClient(data);clients.push(c);c.initializing=false;c.join(target.code,role,target.tokens[role]);c.socket.onopen();await flush();assert.equal(c.ready,true);return c;};
 t.after(async()=>{for(const c of clients){c.reconnect=false;clearTimeout(c.reconnectTimer);clearTimeout(c.joinTimer);for(const name of ['loop','saveLoop','watch'])clearInterval(c[name]);c.socket?.close();}rooms.close();await flush();for(const [key,descriptor] of old)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];fs.rmSync(directory,{recursive:true,force:true});});
 return {rooms,room,clients,sockets,store,access,makeClient};
}

for(const mode of ['getter','read','write','read-write','legacy-corrupt','legacy-stale'])test('shared commands continue exactly once with session storage '+mode,async t=>{
 const f=await fixture(t,mode);
 const oldSequence=mode==='legacy-corrupt'?'NaN':mode==='legacy-stale'?'999999999999999999999':null;
 if(oldSequence!==null)f.store.set('bf-sequence:'+f.room.code+':engineering',oldSequence);
 const c=await f.makeClient();c.command('step',{hours:6});await flush();c.command('step',{hours:6});await flush();
 assert.equal(f.room.world.t,12);assert.equal(c.state.world.t,12);assert.equal(c.pending.size,0);assert.equal(f.room.world.verify().passed,true);
 const commands=c.socket.sent.filter(m=>m.type==='step');assert.deepEqual(commands.map(m=>m.clientSequence),[1,2]);assert.equal(new Set(commands.map(m=>m.eventId)).size,2);assert.equal(f.room.logs.filter(m=>m.action==='step').length,2);assert.equal(f.access.sequenceReads,0);assert.equal(f.access.sequenceWrites,0);
 if(oldSequence!==null)assert.equal(f.store.get('bf-sequence:'+f.room.code+':engineering'),oldSequence);
});

test('two clients with copied checkpoint identity cannot suppress each other under the same role',async t=>{
 const f=await fixture(t),a=await f.makeClient(),b=await f.makeClient();assert.equal(a.clientId,b.clientId);assert.notEqual(a.commandClientId,b.commandClientId);
 for(const c of [a,b,a,b]){c.command('step',{hours:6});await flush();}
 assert.equal(f.room.world.t,24);assert.equal(a.state.world.t,24);assert.equal(b.state.world.t,24);assert.equal(a.pending.size+b.pending.size,0);assert.equal(f.room.logs.filter(m=>m.action==='step').length,4);assert.equal(f.room.world.verify().passed,true);
});

test('losing session storage mid-study does not reset the command sequence or silently drop later notes',async t=>{
 const f=await fixture(t),c=await f.makeClient();c.command('step',{hours:6});await flush();f.access.mode='read-write';c.command('step',{hours:6});await flush();c.command('notes',{patch:{engineering:'기록이 차단돼도 전달되는 산업공학 해석'}});await flush();f.access.mode='normal';f.store.set('bf-sequence:'+f.room.code+':engineering','0');c.command('step',{hours:6});await flush();
 assert.equal(f.room.world.t,18);assert.equal(c.state.notes.engineering,'기록이 차단돼도 전달되는 산업공학 해석');assert.deepEqual(c.socket.sent.filter(m=>!['join','heartbeat'].includes(m.type)).map(m=>m.clientSequence),[1,2,3,4]);assert.equal(c.pending.size,0);assert.equal(f.access.sequenceReads,0);assert.equal(f.access.sequenceWrites,0);
});

test('a lost acknowledgement replays the same identity, sequence and event after reconnect without advancing the simulation twice',async t=>{
 const f=await fixture(t,'read-write'),c=await f.makeClient(),first=c.socket;first.holdAck=true;c.command('step',{hours:6});await flush();const original=first.sent.find(m=>m.type==='step');assert.equal(f.room.world.t,6);assert.equal(c.pending.size,1);
 first.close();assert.equal(c.ready,false);clearTimeout(c.reconnectTimer);c.connect();c.socket.onopen();await flush();const replay=c.socket.sent.find(m=>m.type==='step');assert.deepEqual(replay,original);assert.equal(c.pending.size,0);assert.equal(f.room.world.t,6);assert.equal(f.room.logs.filter(m=>m.action==='step').length,1);
 c.command('step',{hours:6});await flush();assert.equal(f.room.world.t,12);assert.equal(c.socket.sent.findLast(m=>m.type==='step').clientSequence,2);assert.equal(f.room.world.verify().passed,true);
});

test('a new page instance starts a fresh command identity while retaining its checkpoint identity',async t=>{
 const f=await fixture(t),a=await f.makeClient();a.command('step',{hours:6});await flush();a.command('step',{hours:6});await flush();a.reconnect=false;a.socket.close();
 const b=await f.makeClient();assert.equal(a.clientId,b.clientId);assert.notEqual(a.commandClientId,b.commandClientId);b.command('step',{hours:6});await flush();assert.equal(f.room.world.t,18);assert.equal(b.socket.sent.find(m=>m.type==='step').clientSequence,1);assert.equal(b.pending.size,0);
});

test('invalid in-memory ordering cannot send a mutating command and still permits research JSON export',async t=>{
 const f=await fixture(t),c=await f.makeClient();const before=c.socket.sent.length;
 for(const value of [NaN,Infinity,-1,1.5,Number.MAX_SAFE_INTEGER]){c.commandSequence=value;assert.throws(()=>c.command('step',{hours:6}),/연구 JSON/);assert.equal(c.socket.sent.length,before);assert.equal(c.pending.size,0);}
 let exported;c.addEventListener('export',event=>exported=event.detail);c.command('export');await flush();assert.equal(exported.snapshot.t,0);assert.deepEqual(exported.notes,f.room.notes);assert.equal(c.socket.sent.at(-1).clientSequence,undefined);assert.equal(f.room.world.t,0);
});
