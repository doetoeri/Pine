import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {Worker as Thread} from 'node:worker_threads';
import {setTimeout as delay} from 'node:timers/promises';
import {LabClient} from '../src/client.mjs';
import {runExperiment} from '../src/experiments.mjs';
import {validateStoredResult} from '../src/research-state.mjs';

const data=Object.fromEntries(['facilities','routes','nationwide'].map(k=>[k,JSON.parse(fs.readFileSync(new URL('../public/data/'+k+'.json',import.meta.url)))]));
const plan={experiment:'A',days:1,repeats:2,seed:20261021},result=runExperiment({},data,plan);
function fixture(t){
 const keys=['window','location','Worker','WebSocket','localStorage','fetch'],old=Object.fromEntries(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)])),workers=[],notices=[],counts={construct:0,postFailure:false,constructorFailure:false,health:0,roomPosts:0,sockets:0,saves:0};
 class Worker{
  constructor(){counts.construct++;if(counts.constructorFailure)throw new DOMException('Synthetic worker creation blocked','SecurityError');this.messages=[];workers.push(this);}
  postMessage(message){if(counts.postFailure)throw new DOMException('Synthetic worker cloning failure','DataCloneError');this.messages.push(message);}
  terminate(){this.terminated=true;}
  message(data){this.onmessage?.({data});}
 }
 Object.assign(globalThis,{window:{},location:{origin:'http://lab.test',protocol:'http:'},Worker,WebSocket:class{constructor(){this.readyState=0;counts.sockets++;}close(){this.readyState=3;}},localStorage:{getItem:()=>null,setItem:()=>{}},fetch:async()=>{counts.roomPosts++;return Response.json({experimentId:'ABC123',tokens:{engineering:'test-token',biology:'test-token'}});}});
 const c=new LabClient(data);c.initializing=false;c.ready=true;c.world.advance(6);c.notes.engineering='보존할 산업공학 해석';c.notes.biology='보존할 생명과학 해석';c.result=structuredClone(result);c.autosave=()=>{counts.saves++;};c.requireServer=async()=>{counts.health++;};c.addEventListener('notice',e=>notices.push(e.detail));
 t.after(()=>{c.reconnect=false;clearTimeout(c.reconnectTimer);clearTimeout(c.joinTimer);for(const key of ['loop','saveLoop','watch'])clearInterval(c[key]);for(const worker of workers)worker.terminate();for(const [key,descriptor]of Object.entries(old))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
 return {c,workers,counts,notices};
}
const research=c=>createHash('sha256').update(JSON.stringify({world:c.world.snapshot(),notes:c.notes,result:c.result})).digest('hex');
function completed(c){c.worker.message({type:'result',result:structuredClone(result)});}

test('worker construction failure releases the job, preserves research and permits an explicit retry',t=>{
 const {c,counts}=fixture(t),before=research(c);counts.constructorFailure=true;c.running=true;assert.throws(()=>c.command('compute',{plan}));assert.equal(c.job,null);assert.equal(c.worker,null);assert.equal(c.running,false);assert.equal(research(c),before);assert.equal(c.ready,true);assert.match(c.computeIssue,/반복 계산/);assert.equal(counts.construct,1);
 counts.constructorFailure=false;c.command('compute',{plan});assert.ok(c.job);assert.equal(c.computeIssue,'');completed(c);assert.equal(c.job,null);assert.deepEqual(validateStoredResult(c.result,data),result);assert.equal(c.world.t,6);
});

test('initial postMessage failure terminates the worker and never leaves a hidden locked job',t=>{
 const {c,workers,counts}=fixture(t),before=research(c);counts.postFailure=true;assert.throws(()=>c.command('compute',{plan}));assert.equal(c.job,null);assert.equal(c.worker,null);assert.equal(workers[0].terminated,true);assert.equal(research(c),before);assert.match(c.computeIssue,/Synthetic worker cloning failure/);
 counts.postFailure=false;c.command('compute',{plan});completed(c);assert.equal(c.computeIssue,'');assert.equal(c.job,null);
});

test('late events from a cancelled worker cannot clear or replace a newer computation',t=>{
 const {c}=fixture(t);c.command('compute',{plan});const old=c.worker;c.command('cancel-compute');c.command('compute',{plan});const current=c.worker;
 old.onerror({message:'late cancelled error'});old.onmessageerror?.({});old.message({type:'result',result:{invalid:true}});assert.equal(c.worker,current);assert.ok(c.job);assert.equal(current.terminated,undefined);assert.equal(c.computeIssue,'');current.message({type:'progress',progress:.5});assert.equal(c.job.progress,.5);completed(c);assert.equal(c.job,null);assert.deepEqual(c.result,result);
});

for(const event of ['error','messageerror'])test('an active worker '+event+' preserves the previous result and restores controls',t=>{
 const {c,notices}=fixture(t),before=research(c);c.command('compute',{plan});const worker=c.worker;
 if(event==='error')worker.onerror({message:'Synthetic running worker error'});else worker.onmessageerror?.({});
 assert.equal(c.job,null);assert.equal(c.worker,null);assert.equal(worker.terminated,true);assert.equal(research(c),before);assert.match(c.computeIssue,/반복 계산/);assert.equal(notices.length,1);assert.equal(c.ready,true);
});

for(const message of [{type:'error',error:'Synthetic experiment failure'},{type:'result',result:{format:'BLOODFLOW-PAIRED-1'}},{type:'result',result:null}])test('an unsuccessful terminal worker message does not overwrite the previous study: '+message.type+(message.type==='result'?(message.result?' malformed':' empty'):''),t=>{
 const {c}=fixture(t),before=research(c);c.command('compute',{plan});const worker=c.worker;worker.message(message);assert.equal(c.job,null);assert.equal(c.worker,null);assert.equal(worker.terminated,true);assert.equal(research(c),before);assert.ok(c.computeIssue);
});

for(const entry of ['join','joinAvailable','create'])test('active solo COMPUTE rejects '+entry+' before health, room creation or socket side effects',async t=>{
 const {c,counts}=fixture(t);c.command('compute',{plan});const worker=c.worker,before=research(c);
 if(entry==='join')assert.throws(()=>c.join('ABC123','engineering','test-token'),/반복 계산/);else await assert.rejects(entry==='create'?c.create('biology'):c.joinAvailable('ABC123','biology'),/반복 계산/);
 assert.equal(c.mode,'solo');assert.equal(c.worker,worker);assert.ok(c.job);assert.equal(worker.terminated,undefined);assert.equal(research(c),before);assert.equal(counts.health,0);assert.equal(counts.roomPosts,0);assert.equal(counts.sockets,0);c.command('cancel-compute');assert.equal(c.job,null);assert.equal(worker.terminated,true);
});

for(const experiment of ['A','N'])test('a real '+experiment+' compute worker preserves the live world and returns unchanged reproducible statistics',async t=>{
 const {c,workers}=fixture(t),before=JSON.stringify(c.world.snapshot()),expected=runExperiment(c.world.c,data,{...plan,experiment});
 globalThis.Worker=class{
  constructor(url){workers.push(this);this.thread=new Thread(new URL(url),{execArgv:[]});this.thread.on('message',data=>this.onmessage?.({data}));this.thread.on('error',error=>this.onerror?.(error));}
  postMessage(message){this.thread.postMessage(message);}
  terminate(){this.thread.terminate();}
 };
 c.command('compute',{plan:{...plan,experiment}});const started=Date.now();while(c.job&&Date.now()-started<10000)await delay(15);assert.equal(c.job,null);assert.equal(c.computeIssue,'');assert.equal(JSON.stringify(c.world.snapshot()),before);assert.equal(c.notes.engineering,'보존할 산업공학 해석');assert.equal(c.notes.biology,'보존할 생명과학 해석');
 assert.deepEqual({...c.result,createdAt:expected.createdAt},expected);assert.deepEqual(validateStoredResult(c.result,data),c.result);assert.equal(c.world.verify().passed,true);
});
