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

test('real LabClients retain ordered actions with rejected session writes, socket reconnect and server restart',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bf-sequence-network-')),port=await freePort(),base='http://127.0.0.1:'+port,keys=['window','location','localStorage','sessionStorage'],old=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)])),tokens=new Map(),clients=[];let server=await start(port,directory),denyGetter=false;
 Object.assign(globalThis,{window:{BLOODFLOW_RUNTIME:{}},location:{origin:base,protocol:'http:'},localStorage:{getItem:k=>tokens.get(k)??null,setItem:(k,v)=>tokens.set(k,v)}});
 Object.defineProperty(globalThis,'sessionStorage',{configurable:true,get(){if(denyGetter)throw new DOMException('Synthetic session getter rejection','SecurityError');return {getItem:k=>k==='bf-client-id'?'copied-native-checkpoint':null,setItem(){throw new DOMException('Synthetic session write rejection','QuotaExceededError');}};}});
 t.after(async()=>{for(const c of clients){c.reconnect=false;clearTimeout(c.reconnectTimer);clearTimeout(c.joinTimer);for(const key of ['loop','saveLoop','watch'])clearInterval(c[key]);c.socket?.close();}await stop(server);for(const [key,descriptor] of old)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];fs.rmSync(directory,{recursive:true,force:true});});
 const response=await fetch(base+'/bloodflow/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,201);const created=await response.json();
 for(const role of ['engineering','biology']){const c=new LabClient(data);clients.push(c);c.initializing=false;c.join(created.experimentId,role,created.tokens[role]);await waitFor(()=>c.ready);}
 const [a,b]=clients;assert.equal(a.clientId,b.clientId);assert.notEqual(a.commandClientId,b.commandClientId);let hours=0;
 for(const c of [a,a,b,b]){hours+=6;c.command('step',{hours:6});await waitFor(()=>a.state.world.t===hours&&b.state.world.t===hours&&c.pending.size===0);}
 assert.equal(hours,24);a.command('notes',{patch:{engineering:'실제 통신에서 보존한 산업공학 해석'}});await waitFor(()=>b.state.notes.engineering==='실제 통신에서 보존한 산업공학 해석'&&a.pending.size===0);b.command('notes',{patch:{biology:'실제 통신에서 보존한 생명과학 해석'}});await waitFor(()=>a.state.notes.biology==='실제 통신에서 보존한 생명과학 해석'&&b.pending.size===0);
 const socket=a.socket,id=a.commandClientId;socket.close();await waitFor(()=>a.socket!==socket&&a.ready);assert.equal(a.commandClientId,id);a.command('step',{hours:6});await waitFor(()=>a.state.world.t===30&&b.state.world.t===30&&a.pending.size===0);
 denyGetter=true;b.command('step',{hours:6});await waitFor(()=>a.state.world.t===36&&b.state.world.t===36&&b.pending.size===0);b.command('notes',{patch:{biology:'세션 읽기도 거절된 뒤 보존한 생명과학 해석'}});await waitFor(()=>a.state.notes.biology==='세션 읽기도 거절된 뒤 보존한 생명과학 해석'&&b.pending.size===0);
 const notes=a.state.notes,authority=a.authorityId;await stop(server);server=null;await waitFor(()=>!a.ready&&!b.ready);server=await start(port,directory);await waitFor(()=>a.ready&&b.ready&&a.authorityId!==authority);assert.equal(a.state.world.t,36);assert.deepEqual(a.state.notes,notes);assert.deepEqual(b.state.notes,notes);assert.equal(a.commandClientId,id);
 a.command('step',{hours:6});await waitFor(()=>a.state.world.t===42&&b.state.world.t===42&&a.pending.size===0);assert.deepEqual(a.state.notes,notes);assert.equal(b.pending.size,0);
 const saved=JSON.parse(fs.readFileSync(path.join(directory,created.experimentId+'.json'))),restored=prepareResearchRestore(saved,data);assert.equal(restored.world.t,42);assert.equal(restored.world.verify().passed,true);assert.deepEqual(restored.notes,notes);assert.ok(Object.values(saved.lastSequences).every(Number.isSafeInteger));assert.equal(Object.keys(saved.lastSequences).length,2);
});
