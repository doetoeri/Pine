import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {Rooms} from '../server/rooms.mjs';
import {runExperiment} from '../src/experiments.mjs';

const data=Object.fromEntries(['facilities','routes','nationwide'].map(k=>[k,JSON.parse(fs.readFileSync(new URL('../public/data/'+k+'.json',import.meta.url)))]));
const plan={experiment:'A',days:1,repeats:2,seed:20261021},result=runExperiment({},data,plan);
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bf-persistence-')),workers=[];
 class FakeWorker extends EventEmitter{
  constructor(){super();this.messages=[];workers.push(this);}
  postMessage(m){if(this.rejectPost)throw Error('Synthetic pause delivery failure');this.messages.push(m);}
  terminate(){this.terminated=true;this.emit('exit',0);}
 }
 const rooms=new Rooms(data,directory,{workerFactory:()=>new FakeWorker()}),r=rooms.create();r.world.advance(6);r.notes.engineering='산업공학 기존 해석';r.notes.biology='생명과학 기존 해석';r.result=structuredClone(result);rooms.persist(r);
 const file=path.join(directory,r.code+'.json'),events={engineering:[],biology:[]},peers={};
 for(const role of Object.keys(events))peers[role]=rooms.join({readyState:1,send:raw=>events[role].push(JSON.parse(raw)),close(){}},r.code,role,r.tokens[role]);
 const message=(type,props={},role='engineering',id=randomUUID())=>({type,...props,eventId:id,experimentId:r.code,expectedRevision:r.revision,clientId:'persistence-test',clientSequence:(r.lastSequences[role+':persistence-test']??0)+1});
 const command=(type,props={},role='engineering')=>{const m=message(type,props,role);rooms.command(peers[role],m);return m;};
 const block=()=>fs.mkdirSync(file+'.tmp'),unblock=()=>{if(fs.existsSync(file+'.tmp')&&fs.statSync(file+'.tmp').isDirectory())fs.rmdirSync(file+'.tmp');};
 t.after(()=>{unblock();rooms.close();fs.rmSync(directory,{recursive:true,force:true});});
 return {directory,rooms,r,file,events,peers,message,command,workers,block,unblock};
}
const lastState=messages=>messages.filter(x=>x.type==='state').at(-1);
function sameResearch(f){for(const messages of Object.values(f.events)){const state=lastState(messages);assert.equal(state.world.t,f.r.world.t);assert.deepEqual(state.notes,f.r.notes);assert.deepEqual(state.result,f.r.result);assert.deepEqual(state.storage,f.r.storage);}assert.equal(f.r.world.verify().passed,true);}

test('a real write failure broadcasts the applied notes to both roles and acknowledges memory-only application once',t=>{
 const f=fixture(t),saved=fs.readFileSync(f.file,'utf8');f.block();const m=f.command('notes',{patch:{engineering:'파일 저장 실패 중의 새 해석'}});sameResearch(f);
 const ack=f.events.engineering.find(x=>x.type==='ack'&&x.eventId===m.eventId);assert.equal(ack.storageSaved,false);assert.equal(ack.version,f.r.version);assert.equal(f.r.storage.kind,'blocked');assert.match(f.r.storage.message,/EISDIR/);assert.equal(f.r.notes.biology,'생명과학 기존 해석');assert.equal(fs.readFileSync(f.file,'utf8'),saved);
 const revision=f.r.revision,logs=f.r.logs.length;f.rooms.command(f.peers.engineering,m);assert.equal(f.r.revision,revision);assert.equal(f.r.logs.length,logs);assert.equal(f.events.engineering.at(-1).duplicate,true);assert.equal(f.events.engineering.at(-1).storageSaved,false);
 const wrongRole=f.message('notes',{patch:{engineering:'권한 밖 변경'}},'biology');assert.throws(()=>f.rooms.command(f.peers.biology,wrongRole),/역할/);
});

test('blocked storage prevents world changes and automatic compute but allows both roles to export and retry',t=>{
 const f=fixture(t);f.block();f.rooms.saveAll();const before=JSON.stringify(f.r.world.snapshot());
 for(const [type,props] of [['step',{hours:6}],['configure',{patch:{safetyDays:4}}],['restore',{}],['review',{}],['compute',{plan}],['resume-compute',{}],['clock',{mode:'LIVE',speed:1,running:true}]])assert.throws(()=>f.command(type,props),/서버 파일 저장을 복구/);
 assert.equal(JSON.stringify(f.r.world.snapshot()),before);assert.equal(f.workers.length,0);
 for(const role of ['engineering','biology']){const m=f.command('export',{},role),exp=f.events[role].find(x=>x.eventId===m.eventId);assert.equal(exp.type,'export');assert.equal(exp.snapshot.t,6);assert.deepEqual(exp.notes,f.r.notes);assert.deepEqual(exp.result,result);assert.equal(exp.tokens,undefined);f.command('save',{},role);assert.equal(f.events[role].findLast(x=>x.type==='ack').storageSaved,false);}
 assert.equal(f.r.logs.filter(x=>x.action==='storage-error').length,1);sameResearch(f);
});

test('biology can restore persistence without resuming time; saved study and dedupe survive a new Rooms manager',t=>{
 const f=fixture(t);f.block();const note=f.command('notes',{patch:{biology:'미저장 생명과학 해석'}},'biology');f.unblock();f.command('save',{},'biology');sameResearch(f);assert.equal(f.r.storage.kind,'saved');assert.equal(f.r.storage.savedVersion,f.r.version);assert.equal(f.r.running,false);assert.ok(Number.isFinite(Date.parse(f.r.storage.savedAt)));
 const saved=JSON.parse(fs.readFileSync(f.file));assert.deepEqual(saved.notes,f.r.notes);assert.deepEqual(saved.result,f.r.result);assert.ok(saved.logs.some(x=>x.action==='storage-recovered'));
 const reloaded=new Rooms(data,f.directory),r=reloaded.rooms.get(f.r.code);t.after(()=>reloaded.close());assert.equal(r.storage.kind,'saved');assert.equal(r.world.t,6);assert.deepEqual(r.notes,f.r.notes);assert.deepEqual(r.result,result);
 const messages=[],peer=reloaded.join({readyState:1,send:s=>messages.push(JSON.parse(s)),close(){}},r.code,'biology',r.tokens.biology),revision=r.revision;reloaded.command(peer,note);assert.equal(r.revision,revision);assert.equal(messages.at(-1).duplicate,true);assert.equal(r.world.verify().passed,true);
});

test('periodic saves isolate a failed room, pause its clock once and recover without auto-resuming',t=>{
 const f=fixture(t),other=f.rooms.create();f.r.running=true;f.r.speed=240;f.block();f.rooms.saveAll();f.rooms.tick(60);assert.equal(f.r.world.t,6);assert.equal(f.r.running,false);assert.equal(f.r.storage.kind,'blocked');assert.equal(other.storage.kind,'saved');
 f.rooms.saveAll();assert.equal(f.r.logs.filter(x=>x.action==='storage-error').length,1);sameResearch(f);f.unblock();f.rooms.saveAll();assert.equal(f.r.storage.kind,'saved');assert.equal(f.r.running,false);assert.equal(f.r.logs.filter(x=>x.action==='storage-recovered').length,1);sameResearch(f);
});

test('failed first save does not register a room or consume the room limit',t=>{
 const f=fixture(t),write=fs.writeFileSync,mocked=t.mock.method(fs,'writeFileSync',(name,...args)=>{if(String(name).startsWith(f.directory))throw Object.assign(Error('private disk path must not reach a client'),{code:'ENOSPC'});return write(name,...args);});
 try{assert.throws(()=>f.rooms.create(),e=>/ENOSPC/.test(e.message)&&!e.message.includes('private disk'));assert.equal(f.rooms.rooms.size,1);}finally{mocked.mock.restore();}
 assert.ok(f.rooms.create().code);assert.equal(f.rooms.rooms.size,2);
});

test('rename failure preserves the complete prior file, cleans its temp file and redacts internal error text',t=>{
 const f=fixture(t),before=fs.readFileSync(f.file,'utf8'),rename=fs.renameSync,mocked=t.mock.method(fs,'renameSync',(from,to)=>{if(to===f.file)throw Object.assign(Error('private path / secret token'),{code:'EIO'});return rename(from,to);});
 try{f.command('notes',{patch:{engineering:'rename 뒤 재시도할 해석'}});assert.equal(fs.readFileSync(f.file,'utf8'),before);assert.equal(fs.existsSync(f.file+'.tmp'),false);assert.match(f.r.storage.message,/EIO/);assert.doesNotMatch(JSON.stringify(f.rooms.publicState(f.r).storage),/private|secret/);}finally{mocked.mock.restore();}
 f.command('save');assert.equal(JSON.parse(fs.readFileSync(f.file)).notes.engineering,'rename 뒤 재시도할 해석');
});

test('disconnect and shutdown cannot throw on disk failure; reconnect sees the same memory-only study',t=>{
 const f=fixture(t);f.block();assert.doesNotThrow(()=>f.rooms.leave(f.peers.engineering));assert.equal(lastState(f.events.biology).storage.kind,'blocked');
 const messages=[],peer=f.rooms.join({readyState:1,send:s=>messages.push(JSON.parse(s)),close(){}},f.r.code,'engineering',f.r.tokens.engineering);assert.equal(lastState(messages).storage.kind,'blocked');assert.deepEqual(lastState(messages).notes,f.r.notes);assert.equal(lastState(messages).world.t,6);assert.doesNotThrow(()=>f.rooms.close());assert.equal(f.r.running,false);assert.equal(f.r.job,null);assert.equal(f.rooms.authenticate(f.r.code,f.r.tokens.biology).role,'biology');assert.ok(peer);
});

test('storage failure pauses a compute worker once; recovery keeps it paused until a researcher resumes',t=>{
 const f=fixture(t);f.command('compute',{plan});const w=f.workers[0];f.block();f.rooms.saveAll();assert.equal(f.r.job.paused,true);assert.equal(w.messages.filter(m=>m.type==='pause').length,1);f.rooms.saveAll();assert.equal(w.messages.filter(m=>m.type==='pause').length,1);sameResearch(f);
 f.unblock();f.command('save',{},'biology');assert.equal(f.r.job.paused,true);assert.equal(f.r.storage.kind,'saved');f.command('resume-compute',{},'biology');assert.equal(f.r.job.paused,false);assert.equal(w.messages.at(-1).type,'resume');w.emit('message',{type:'result',result});assert.equal(f.r.job,null);assert.deepEqual(f.r.result,result);assert.equal(f.r.computeIssue,'');sameResearch(f);
});

test('a pause delivery error during failed save settles compute without recursion or losing the old result',t=>{
 const f=fixture(t);f.command('compute',{plan});f.workers[0].rejectPost=true;f.block();assert.doesNotThrow(()=>f.rooms.saveAll());assert.equal(f.r.job,null);assert.equal(f.r.storage.kind,'blocked');assert.match(f.r.computeIssue,/Synthetic pause delivery/);assert.deepEqual(f.r.result,result);sameResearch(f);
});

test('a valid terminal result during a disk outage remains visible and exportable without leaving a locked job',t=>{
 const f=fixture(t);f.command('compute',{plan});f.block();const next={...structuredClone(result),createdAt:new Date().toISOString()};assert.doesNotThrow(()=>f.workers[0].emit('message',{type:'result',result:next}));assert.equal(f.r.job,null);assert.equal(f.r.storage.kind,'blocked');assert.deepEqual(f.r.result,next);assert.equal(f.r.computeIssue,'');sameResearch(f);f.unblock();f.command('save');assert.deepEqual(JSON.parse(fs.readFileSync(f.file)).result,next);
});
