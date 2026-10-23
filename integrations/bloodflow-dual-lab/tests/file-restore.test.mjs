import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setImmediate as flush,setTimeout as delay} from 'node:timers/promises';
import {LabClient} from '../src/client.mjs';
import {StateFileReader,MAX_STATE_FILE_BYTES} from '../src/file-restore.mjs';
import {DualWorld} from '../src/engine.mjs';
import {runExperiment} from '../src/experiments.mjs';
import {Rooms} from '../server/rooms.mjs';

const data=Object.fromEntries(['facilities','routes','nationwide'].map(k=>[k,JSON.parse(fs.readFileSync(new URL('../public/data/'+k+'.json',import.meta.url)))]));
const result=runExperiment({},data,{experiment:'A',days:1,repeats:2});
function payload(network='incheon',time=0){const world=new DualWorld({network},data);world.advance(time);return {format:'BLOODFLOW-LAB-FILE-1',snapshot:world.snapshot(),notes:{hypothesis:'Old file hypothesis',engineering:'File engineering',biology:'File biology'},result:structuredClone(result)};}
const file=raw=>new File([JSON.stringify(raw)],'study.json',{type:'application/json'});
function gatedFile(raw){let resolve,reject,reads=0;const gate=new Promise((a,b)=>{resolve=a;reject=b;}),f=file(raw);f.text=()=>{reads++;return gate;};return {file:f,release:()=>resolve(JSON.stringify(raw)),reject:()=>reject(Error('Late synthetic file error')),get reads(){return reads;}};}
const snapshot=c=>JSON.stringify({world:c.world.snapshot(),notes:c.notes,result:c.result,version:c.version,revision:c.revision,logs:c.logs});
async function fixture(t,options={}){
 const keys=['window','location','WebSocket','localStorage','sessionStorage'],old=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)])),directory=fs.mkdtempSync(path.join(os.tmpdir(),'bf-file-read-')),rooms=new Rooms(data,directory),room=rooms.create({network:'nationwide'}),clients=[],readers=[];
 class Socket{
  constructor(){this.readyState=1;this.sent=[];}
  deliver(m){if(this.readyState===1)this.onmessage?.({data:JSON.stringify(m)});}
  send(raw){const m=JSON.parse(raw);this.sent.push(m);if(m.type==='heartbeat')return;
   if(m.type==='join'){const socket=this;this.peer=rooms.join({get readyState(){return socket.readyState;},send(text){const m=JSON.parse(text);if(m.type==='ack'&&socket.holdAck)return;queueMicrotask(()=>socket.deliver(m));},close(){socket.close();}},m.experimentId,m.role,m.token);}
   else try{rooms.command(this.peer,m);}catch(error){queueMicrotask(()=>this.deliver({type:'error',eventId:m.eventId,error:error.message}));}
  }
  close(){if(this.readyState===3)return;this.readyState=3;rooms.leave(this.peer);this.onclose?.();}
 }
 Object.assign(globalThis,{window:{BLOODFLOW_RUNTIME:{}},location:{origin:'http://lab.test',protocol:'http:'},WebSocket:Socket,localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{getItem:()=>null,setItem(){}}});
 const make=(config={})=>{const c=new LabClient(data,config);c.initializing=false;c.ready=true;clients.push(c);const reader=new StateFileReader(c,options);readers.push(reader);return {c,reader};};
 const join=async(c,role='engineering',target=room)=>{c.join(target.code,role,target.tokens[role]);c.socket.onopen();await flush();assert.equal(c.ready,true);};
 t.after(async()=>{for(const r of readers)r.dispose();for(const c of clients){c.reconnect=false;clearTimeout(c.reconnectTimer);clearTimeout(c.joinTimer);for(const k of ['loop','saveLoop','watch'])clearInterval(c[k]);c.socket?.close();}rooms.close();await flush();for(const [k,d]of old)if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];fs.rmSync(directory,{recursive:true,force:true});});
 return {make,join,rooms,room};
}

test('a selected file restores an unchanged solo study through the existing validated command',async t=>{
 const {make}=await fixture(t),{c,reader}=make(),raw=payload('nationwide',6);c.world.advance(12);
 assert.equal(await reader.read(file(raw),reader.prepare()),true);assert.equal(reader.status.kind,'complete');assert.equal(c.world.t,6);assert.equal(c.world.c.network,'nationwide');assert.deepEqual(c.result,raw.result);assert.equal(c.notes.biology,'File biology');assert.equal(c.world.verify().passed,true);assert.equal(c.logs.at(-1).action,'restore');
 const legacy=payload('incheon',3).snapshot;assert.equal(await reader.read(file(legacy),reader.prepare()),true);assert.equal(c.world.t,3);assert.equal(c.result,null);assert.equal(c.notes.engineering,'File engineering');
});

test('local time, notes and configuration changes cancel an in-flight file without another restore',async t=>{
 const {make}=await fixture(t);
 for(const change of [c=>c.command('step',{hours:6}),c=>c.command('notes',{patch:{engineering:'New interpretation'}}),c=>c.command('configure',{patch:{network:'nationwide'}})]){
  const {c,reader}=make(),gate=gatedFile(payload()),pending=reader.read(gate.file,reader.prepare());change(c);const after=snapshot(c);
  assert.equal(await pending,false);assert.equal(reader.status.kind,'canceled');gate.release();await flush();assert.equal(snapshot(c),after);assert.equal(c.world.verify().passed,true);
 }
});

test('another researcher changing common notes during file reading cannot be overwritten by a fresh revision',async t=>{
 const {make,join,room}=await fixture(t),a=make(),b=make();await join(a.c);await join(b.c,'biology');a.c.command('step',{hours:12});await flush();
 const gate=gatedFile(payload('nationwide')),sequence=a.c.commandSequence,pending=a.reader.read(gate.file,a.reader.prepare());
 b.c.command('notes',{patch:{hypothesis:'New peer hypothesis',biology:'New peer biology'}});await flush();const before=structuredClone(room.world.snapshot());
 assert.equal(await pending,false);gate.release();await flush();assert.equal(room.world.t,12);assert.deepEqual(room.world.snapshot(),before);assert.equal(room.notes.hypothesis,'New peer hypothesis');assert.equal(room.notes.biology,'New peer biology');assert.equal(room.logs.some(x=>x.action==='restore'),false);assert.equal(a.c.commandSequence,sequence);assert.equal(room.world.verify().passed,true);
});

test('both roles can manually reselect a valid file and receive the existing server acknowledgement',async t=>{
 const {make,join,room}=await fixture(t),a=make(),b=make();await join(a.c);await join(b.c,'biology');
 a.c.command('notes',{patch:{engineering:'Confirmed engineering'}});await flush();b.c.command('notes',{patch:{biology:'Confirmed biology'}});await flush();
 for(const [active,other,role] of [[a,b,'engineering'],[b,a,'biology']]){
  const preserved=room.notes[role==='engineering'?'biology':'engineering'],raw=payload('nationwide',6);
  assert.equal(await active.reader.read(file(raw),active.reader.prepare()),true);await flush();assert.equal(active.reader.status.kind,'complete');assert.equal(active.c.pending.size,0);assert.equal(other.c.state.world.t,6);assert.equal(room.notes[role],'File '+role);assert.equal(room.notes[role==='engineering'?'biology':'engineering'],preserved);assert.deepEqual(room.result,raw.result);
 }
 assert.equal(room.logs.filter(x=>x.action==='restore').length,2);
});

test('room/role changes, solo return and leaving then returning to the same solo world invalidate old selections',async t=>{
 const {make,join,rooms}=await fixture(t),{c,reader}=make();
 let intent=reader.prepare();await join(c);c.leave();assert.equal(await reader.read(file(payload()),intent),false);assert.equal(c.world.t,0);
 await join(c);for(const role of ['biology','engineering']){const gate=gatedFile(payload('nationwide')),p=reader.read(gate.file,reader.prepare());await join(c,role,rooms.create({network:'nationwide'}));assert.equal(await p,false);gate.release();await flush();assert.equal(c.state.world.t,0);}
 const gate=gatedFile(payload('nationwide')),p=reader.read(gate.file,reader.prepare());c.leave();assert.equal(await p,false);gate.release();await flush();assert.equal(c.mode,'solo');assert.equal(c.logs.some(x=>x.action==='restore'),false);
});

test('disconnect cancels the read while a mutating command still replays exactly once',async t=>{
 const {make,join,room}=await fixture(t),{c,reader}=make();await join(c);const gate=gatedFile(payload('nationwide')),p=reader.read(gate.file,reader.prepare());
 c.socket.holdAck=true;c.command('step',{hours:6});await flush();c.socket.close();clearTimeout(c.reconnectTimer);c.connect();c.socket.onopen();await flush();gate.release();
 assert.equal(await p,false);assert.equal(c.ready,true);assert.equal(c.pending.size,0);assert.equal(room.world.t,6);assert.equal(room.logs.filter(x=>x.action==='step').length,1);assert.equal(room.logs.filter(x=>x.action==='restore').length,0);
});

test('a server authority change invalidates the file even when room, role, time and revision match',async t=>{
 const {make,join,room}=await fixture(t),{c,reader}=make();await join(c);const gate=gatedFile(payload('nationwide')),p=reader.read(gate.file,reader.prepare());c.socket.deliver({...c.state,authorityId:'replacement-server'});assert.equal(await p,false);gate.release();await flush();assert.equal(room.logs.some(x=>x.action==='restore'),false);
});

test('a disconnect during an otherwise unchanged read cannot resume that file on reconnection',async t=>{
 const {make,join,room}=await fixture(t),{c,reader}=make();await join(c);const gate=gatedFile(payload('nationwide')),p=reader.read(gate.file,reader.prepare());
 c.socket.close();assert.equal(await p,false);assert.equal(reader.status.kind,'canceled');clearTimeout(c.reconnectTimer);c.connect();c.socket.onopen();await flush();gate.release();await flush();assert.equal(c.ready,true);assert.equal(room.world.t,0);assert.equal(room.logs.some(x=>x.action==='restore'),false);
});

test('a newer selection cancels an older read and its late rejection cannot replace the latest outcome',async t=>{
 const {make}=await fixture(t),{c,reader}=make(),first=gatedFile(payload('incheon',3)),old=reader.read(first.file,reader.prepare()),newer=reader.prepare();
 assert.equal(await old,false);assert.equal(await reader.read(file(payload('nationwide',6)),newer),true);const after=snapshot(c);first.reject();await flush();assert.equal(snapshot(c),after);assert.equal(reader.status.kind,'complete');assert.equal(c.logs.filter(x=>x.action==='restore').length,1);
});

test('a stalled read times out without applying its late body and the same file can be selected again',async t=>{
 const {make}=await fixture(t,{timeoutMs:20}),{c,reader}=make(),gate=gatedFile(payload()),before=snapshot(c);
 await assert.rejects(reader.read(gate.file,reader.prepare()),/시간이 초과/);assert.equal(reader.status.kind,'error');gate.release();await flush();assert.equal(snapshot(c),before);assert.equal(await reader.read(file(payload('incheon',6)),reader.prepare()),true);assert.equal(c.world.t,6);
});

test('bad size, JSON, read failure or invalid research result leaves the entire study untouched',async t=>{
 const {make}=await fixture(t),{c,reader}=make(),before=snapshot(c),badResult=payload();badResult.result.metrics.shortageRate.control.mean=.999;
 for(const f of [{size:MAX_STATE_FILE_BYTES+1,text:async()=>''},{size:NaN,text:async()=>''},new File(['{'],'broken.json'),{size:1,text:async()=>{throw Error('Synthetic disk read failure');}},file(badResult)]){
  await assert.rejects(reader.read(f,reader.prepare()));assert.equal(snapshot(c),before);assert.equal(reader.status.kind,'error');
 }
});

test('initialization, running computation/clock, disconnection and unconfirmed commands prevent selection',async t=>{
 const {make,join}=await fixture(t),{c,reader}=make();c.initializing=true;assert.throws(()=>reader.prepare());c.initializing=false;c.running=true;assert.throws(()=>reader.prepare());c.running=false;c.job={};assert.throws(()=>reader.prepare());c.job=null;c.ready=false;assert.throws(()=>reader.prepare());c.ready=true;
 await join(c);c.socket.holdAck=true;c.command('notes',{patch:{hypothesis:'Pending'}});await flush();assert.throws(()=>reader.prepare(),/대기 조작/);assert.equal(c.state.notes.hypothesis,'Pending');
});

test('periodic server saves do not cancel a valid read but changed results with the same timestamp do',async t=>{
 const {make,join,rooms}=await fixture(t),{c,reader}=make();await join(c);let gate=gatedFile(payload('nationwide')),p=reader.read(gate.file,reader.prepare());rooms.saveAll();await flush();gate.release();assert.equal(await p,true);await flush();assert.equal(reader.status.kind,'complete');
 c.leave();c.result=structuredClone(result);gate=gatedFile(payload());p=reader.read(gate.file,reader.prepare());const altered=runExperiment({},data,{experiment:'A',days:1,repeats:2,seed:12345});altered.createdAt=c.result.createdAt;c.result=altered;c.emit();gate.release();assert.equal(await p,false);assert.equal(c.result,altered);assert.equal(reader.status.kind,'canceled');
});

test('duplicate reads of one selection cannot submit two restores, and a server permission failure remains visible',async t=>{
 const {make,join,room}=await fixture(t),{c,reader}=make();let gate=gatedFile(payload()),intent=reader.prepare(),p=reader.read(gate.file,intent);assert.equal(await reader.read(gate.file,intent),false);gate.release();assert.equal(await p,true);assert.equal(gate.reads,1);assert.equal(c.logs.filter(x=>x.action==='restore').length,1);
 await join(c,'biology');const raw=payload('nationwide');raw.snapshot.c.safetyDays=7;assert.equal(await reader.read(file(raw),reader.prepare()),true);await flush();assert.equal(reader.status.kind,'error');assert.match(reader.status.message,/다른 역할/);assert.equal(room.logs.some(x=>x.action==='restore'),false);
});
