import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {LabClient} from '../src/client.mjs';
import {prepareResearchRestore} from '../src/research-state.mjs';
const root=path.resolve(new URL('..',import.meta.url).pathname),data=Object.fromEntries(['facilities','routes','nationwide'].map(k=>[k,JSON.parse(fs.readFileSync(path.join(root,'public/data/'+k+'.json')))]));
const waitFor=(fn,ms=8000)=>new Promise((resolve,reject)=>{const start=Date.now(),tick=()=>{try{if(fn())return resolve();if(Date.now()-start>ms)return reject(Error('Shared command state timeout'));setTimeout(tick,15);}catch(error){reject(error);}};tick();});
async function freePort(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const port=s.address().port;await new Promise(resolve=>s.close(resolve));return port;}
async function start(port,directory){const child=spawn(process.execPath,['server/server.mjs','--port',String(port)],{cwd:root,env:{...process.env,HOST:'127.0.0.1',BLOODFLOW_DATA:directory},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',s=>log+=s);child.stderr.on('data',s=>log+=s);await waitFor(()=>{if(child.exitCode!==null)throw Error('Server exited: '+log);return log.startsWith('BLOODFLOW:');});return child;}
async function stop(child){if(!child||child.exitCode!==null)return;const done=once(child,'exit');child.kill('SIGTERM');await done;}

test('native two-role collaboration returns each researcher to an independent complete solo study',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bf-solo-return-network-')),port=await freePort(),base='http://127.0.0.1:'+port,keys=['window','location','localStorage','sessionStorage'],old=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)])),tokens=new Map(),session=new Map(),clients=[];let server=await start(port,directory);
 Object.assign(globalThis,{window:{BLOODFLOW_RUNTIME:{}},location:{origin:base,protocol:'http:'},localStorage:{getItem:k=>tokens.get(k)??null,setItem:(k,v)=>tokens.set(k,v)},sessionStorage:{getItem:k=>session.get(k)??null,setItem:(k,v)=>session.set(k,v)}});
 t.after(async()=>{for(const c of clients){c.reconnect=false;clearTimeout(c.reconnectTimer);clearTimeout(c.joinTimer);for(const k of ['loop','saveLoop','watch'])clearInterval(c[k]);c.socket?.close();}await stop(server);for(const [key,d] of old)if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];fs.rmSync(directory,{recursive:true,force:true});});
 const before=[];
 for(const [network,hours,kind] of [['incheon',6,'A'],['nationwide',12,'N']]){
  const c=new LabClient(data,{network,seed:40321});clients.push(c);c.initializing=false;c.ready=true;c.command('step',{hours});c.command('notes',{patch:{engineering:network+' solo engineering',biology:network+' solo biology'}});c.result=JSON.parse(fs.readFileSync(path.join(root,'examples/experiment-'+kind+'.json')));before.push({world:c.world,snapshot:structuredClone(c.world.snapshot()),notes:structuredClone(c.notes),result:structuredClone(c.result)});
 }
 const [a,b]=clients;await a.create('engineering');await waitFor(()=>a.ready);const code=a.code;await b.joinAvailable(code,'biology');await waitFor(()=>b.ready);a.command('step',{hours:6});await waitFor(()=>a.state.world.t===6&&b.state.world.t===6&&a.pending.size===0);b.command('notes',{patch:{biology:'Shared biology stays in the room'}});await waitFor(()=>a.state.notes.biology==='Shared biology stays in the room'&&b.pending.size===0);
 const check=(c,initial,hours=initial.snapshot.t)=>{assert.equal(c.mode,'solo');assert.equal(c.ready,true);assert.equal(c.running,false);assert.ok(c.world===initial.world);assert.equal(c.world.t,hours);assert.equal(c.world.verify().passed,true);assert.deepEqual(c.notes,initial.notes);assert.deepEqual(c.result,initial.result);};
 a.leave();check(a,before[0]);assert.deepEqual(a.world.snapshot(),before[0].snapshot);assert.equal(b.mode,'shared');assert.equal(b.ready,true);b.command('step',{hours:6});await waitFor(()=>b.state.world.t===12&&b.pending.size===0);a.command('step',{hours:6});check(a,before[0],12);assert.equal(b.state.world.t,12);
 await a.joinAvailable(code,'engineering');await waitFor(()=>a.ready);assert.equal(a.state.world.t,12);assert.equal(a.state.notes.biology,'Shared biology stays in the room');a.leave();check(a,before[0],12);b.leave();check(b,before[1]);assert.deepEqual(b.world.snapshot(),before[1].snapshot);
 let exported;a.addEventListener('export',e=>exported=e.detail);a.command('export');assert.equal(exported.snapshot.t,12);assert.equal(exported.snapshot.c.network,'incheon');assert.deepEqual(exported.notes,before[0].notes);assert.deepEqual(exported.result,before[0].result);
 const shared=prepareResearchRestore(JSON.parse(fs.readFileSync(path.join(directory,code+'.json'))),data);assert.equal(shared.world.t,12);assert.equal(shared.notes.biology,'Shared biology stays in the room');assert.equal(shared.world.verify().passed,true);assert.equal(shared.result,null);
});
