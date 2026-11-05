import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createHash,randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {setTimeout as delay} from 'node:timers/promises';
import {Rooms} from '../server/rooms.mjs';
import {runExperiment} from '../src/experiments.mjs';
import {validateStoredResult} from '../src/research-state.mjs';

const data=Object.fromEntries(['facilities','routes','nationwide'].map(k=>[k,JSON.parse(fs.readFileSync(new URL('../public/data/'+k+'.json',import.meta.url)))]));
const plan={experiment:'A',days:1,repeats:2,seed:20261021},previous=runExperiment({},data,plan);
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const research=r=>createHash('sha256').update(JSON.stringify(canonical({world:r.world.snapshot(),notes:r.notes,result:r.result}))).digest('hex');
function fixture(t,{native=false,exitCode}={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bf-server-compute-')),workers=[],settings={constructFailure:false,postFailure:false};
 class FakeWorker extends EventEmitter{
  constructor(){super();this.messages=[];workers.push(this);}
  postMessage(message){if(settings.postFailure)throw new DOMException('Synthetic server cloning failure','DataCloneError');this.messages.push(message);}
  terminate(){this.terminated=true;this.emit('exit',0);}
 }
 const workerFactory=()=>{
  if(settings.constructFailure)throw Error('Synthetic server worker creation failure');
  if(exitCode!==undefined){const w=new Worker("require('node:worker_threads').parentPort.once('message',()=>process.exit("+exitCode+"));",{eval:true,execArgv:[]});workers.push(w);return w;}
  return new FakeWorker();
 };
 const rooms=new Rooms(data,directory,native?{}:{workerFactory}),r=rooms.create();r.world.advance(6);r.notes.engineering='산업공학 해석 보존';r.notes.biology='생명과학 해석 보존';r.result=structuredClone(previous);rooms.persist(r);
 const events={engineering:[],biology:[]},peers={};
 for(const role of Object.keys(events))peers[role]=rooms.join({readyState:1,send:raw=>events[role].push(JSON.parse(raw)),close:()=>{}},r.code,role,r.tokens[role]);
 const command=(type,props={},role='engineering',id=randomUUID())=>rooms.command(peers[role],{type,...props,eventId:id,experimentId:r.code,expectedRevision:r.revision});
 const managers=[rooms];t.after(()=>{for(const manager of managers)manager.close();for(const w of workers)w.terminate();fs.rmSync(directory,{recursive:true,force:true});});
 return {rooms,r,peers,events,command,settings,workers,directory,managers};
}
function assertFailure(f,before){
 const {rooms,r,events,directory}=f;assert.equal(r.job,null);assert.equal(research(r),before);assert.equal(r.running,false);assert.match(r.computeIssue,/공통 반복 계산/);
 for(const role of Object.keys(events)){const state=events[role].filter(x=>x.type==='state').at(-1);assert.equal(state.job,null);assert.equal(state.computeIssue,r.computeIssue);assert.equal(state.world.t,6);assert.deepEqual(state.notes,r.notes);assert.deepEqual(state.result,r.result);}
 const log=r.logs.filter(x=>x.action==='compute-error').at(-1);assert.ok(log.eventId);assert.ok(log.at);assert.equal(log.h,6);assert.ok(['engineering','biology'].includes(log.role));
 const saved=JSON.parse(fs.readFileSync(path.join(directory,r.code+'.json')));assert.equal(saved.computeIssue,r.computeIssue);assert.deepEqual(saved.result,r.result);assert.deepEqual(saved.notes,r.notes);assert.equal(rooms.publicState(r).computeIssue,r.computeIssue);
}
async function waitForJob(r){const start=Date.now();while(r.job&&Date.now()-start<10000)await delay(10);assert.equal(r.job,null);}

for(const phase of ['constructFailure','postFailure'])test('shared compute '+phase+' clears only the failed job and permits manual retry',t=>{
 const f=fixture(t),before=research(f.r);f.settings[phase]=true;assert.throws(()=>f.command('compute',{plan}),/공통 반복 계산/);assertFailure(f,before);if(phase==='postFailure')assert.equal(f.workers[0].terminated,true);
 f.settings[phase]=false;f.command('compute',{plan});assert.equal(f.r.computeIssue,'');f.r.job.worker.emit('message',{type:'result',result:previous});assert.equal(f.r.job,null);assert.equal(f.r.computeIssue,'');assert.deepEqual(f.r.result,previous);
});

for(const code of [0,7])test('a real server worker exit '+code+' without a result releases both peers',async t=>{
 const f=fixture(t,{exitCode:code}),before=research(f.r);f.command('compute',{plan});await waitForJob(f.r);assertFailure(f,before);assert.match(f.r.computeIssue,new RegExp('종료 코드: '+code));
});

for(const event of ['error','messageerror'])test('shared worker '+event+' preserves both interpretations and the previous result',t=>{
 const f=fixture(t),before=research(f.r);f.command('compute',{plan},'biology');const worker=f.r.job.worker;worker.emit(event,Error('Synthetic shared worker '+event));assertFailure(f,before);assert.equal(worker.terminated,true);
});

for(const result of [null,{format:'BLOODFLOW-PAIRED-1'}])test('shared incomplete terminal result cannot replace valid research: '+(result?'malformed':'empty'),t=>{
 const f=fixture(t),before=research(f.r);f.command('compute',{plan});f.r.job.worker.emit('message',{type:'result',result});assertFailure(f,before);assert.deepEqual(validateStoredResult(f.r.result,data),previous);
});

test('cancelled server worker events and termination cannot affect a newer job',t=>{
 const f=fixture(t);f.command('compute',{plan});const old=f.r.job.worker;f.command('cancel-compute');assert.equal(f.r.computeIssue,'');f.command('compute',{plan},'biology');const current=f.r.job.worker;
 old.emit('error',Error('late'));old.emit('messageerror',Error('late'));old.emit('exit',7);old.emit('message',{type:'result',result:null});assert.equal(f.r.job.worker,current);assert.equal(f.r.computeIssue,'');assert.equal(current.terminated,undefined);current.emit('message',{type:'progress',progress:.5});assert.equal(f.r.job.progress,.5);current.emit('message',{type:'result',result:previous});assert.equal(f.r.job,null);assert.equal(f.r.computeIssue,'');assert.equal(f.r.logs.filter(x=>x.action==='compute-error').length,0);
});

for(const action of ['pause-compute','resume-compute','disconnect'])test('postMessage failure during '+action+' cannot leave a locked room or escape disconnect handling',t=>{
 const f=fixture(t),before=research(f.r);f.command('compute',{plan});f.settings.postFailure=true;
 if(action==='disconnect')assert.doesNotThrow(()=>f.rooms.leave(f.peers.engineering));else assert.throws(()=>f.command(action),/공통 반복 계산/);
 if(action==='disconnect')f.events.engineering=f.events.biology;assertFailure(f,before);assert.equal(f.workers[0].terminated,true);
});

for(const [experiment,role]of [['A','engineering'],['N','biology']])test('real shared '+experiment+' worker completes unchanged statistics for '+role+' without false exit errors',async t=>{
 const f=fixture(t,{native:true}),world=JSON.stringify(f.r.world.snapshot()),expected=runExperiment(f.r.world.c,data,{...plan,experiment});const id=randomUUID();f.command('compute',{plan:{...plan,experiment}},role,id);await waitForJob(f.r);await delay(15);
 assert.equal(f.r.computeIssue,'');assert.equal(f.r.logs.filter(x=>x.action==='compute-error').length,0);assert.deepEqual({...f.r.result,createdAt:expected.createdAt},expected);assert.equal(JSON.stringify(f.r.world.snapshot()),world);assert.equal(f.r.world.verify().passed,true);assert.equal(f.r.notes.engineering,'산업공학 해석 보존');assert.equal(f.r.notes.biology,'생명과학 해석 보존');
 for(const messages of Object.values(f.events))assert.deepEqual(messages.filter(x=>x.type==='state').at(-1).result,f.r.result);
 const before=f.r.version;f.command('compute',{plan:{...plan,experiment}},role,id);assert.equal(f.r.job,null);assert.equal(f.r.version,before);
});

test('shared compute failure notice and prior study survive disk reload and clear on explicit retry',async t=>{
 const f=fixture(t),before=research(f.r);f.command('compute',{plan});f.r.job.worker.emit('error',Error('Synthetic persisted failure'));assertFailure(f,before);
 const reloaded=new Rooms(data,f.directory);f.managers.push(reloaded);const r=reloaded.rooms.get(f.r.code);assert.equal(research(r),before);assert.equal(r.computeIssue,f.r.computeIssue);assert.equal(r.job,null);assert.equal(r.running,false);
 const messages=[],role='biology',peer=reloaded.join({readyState:1,send:raw=>messages.push(JSON.parse(raw)),close:()=>{}},r.code,role,r.tokens[role]);assert.equal(messages.at(-1).computeIssue,r.computeIssue);
 reloaded.command(peer,{type:'compute',plan,eventId:randomUUID(),experimentId:r.code,expectedRevision:r.revision});await waitForJob(r);assert.equal(r.computeIssue,'');assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory,r.code+'.json'))).computeIssue,'');
});
