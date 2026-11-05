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
const waitFor=(fn,ms=8000)=>new Promise((resolve,reject)=>{const start=Date.now(),tick=()=>{try{if(fn())return resolve();if(Date.now()-start>ms)return reject(Error('Shared command state timeout: '+fn.toString()));setTimeout(tick,15);}catch(error){reject(error);}};tick();});
async function freePort(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const port=s.address().port;await new Promise(resolve=>s.close(resolve));return port;}
async function start(port,directory){const child=spawn(process.execPath,['server/server.mjs','--port',String(port)],{cwd:root,env:{...process.env,HOST:'127.0.0.1',BLOODFLOW_DATA:directory},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',s=>log+=s);child.stderr.on('data',s=>log+=s);await waitFor(()=>{if(child.exitCode!==null)throw Error('Server exited: '+log);return log.startsWith('BLOODFLOW:');});return child;}
async function stop(child){if(!child||child.exitCode!==null)return;const done=once(child,'exit');child.kill('SIGTERM');await done;}

test('two native roles export correlated formats and restore the unchanged research file with computed results',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bf-export-network-')),port=await freePort(),base='http://127.0.0.1:'+port,keys=['window','location','localStorage','sessionStorage'],old=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)])),storage=new Map(),clients=[],received=[[],[]];let server=await start(port,directory);
 Object.assign(globalThis,{window:{BLOODFLOW_RUNTIME:{}},location:{origin:base,protocol:'http:'},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}});
 t.after(async()=>{for(const c of clients){c.cancelExports('Test cleanup');c.reconnect=false;clearTimeout(c.reconnectTimer);clearTimeout(c.joinTimer);for(const k of ['loop','saveLoop','watch'])clearInterval(c[k]);c.socket?.close();}await stop(server);for(const [key,d] of old)if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];fs.rmSync(directory,{recursive:true,force:true});});
 const response=await fetch(base+'/bloodflow/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:{network:'nationwide',seed:61234}})});assert.equal(response.status,201);const created=await response.json();
 for(const [i,role] of ['engineering','biology'].entries()){const c=new LabClient(data);clients.push(c);c.initializing=false;c.addEventListener('export-result',e=>received[i].push(e.detail));c.join(created.experimentId,role,created.tokens[role]);await waitFor(()=>c.ready);}
 const [a,b]=clients;a.command('step',{hours:12});await waitFor(()=>a.pending.size===0&&b.state.world.t===12);a.command('notes',{patch:{engineering:'Exported engineering interpretation'}});await waitFor(()=>a.pending.size===0&&b.state.notes.engineering==='Exported engineering interpretation');b.command('notes',{patch:{biology:'Exported biology interpretation'}});await waitFor(()=>b.pending.size===0&&a.state.notes.biology==='Exported biology interpretation');
 b.command('compute',{plan:{experiment:'N',days:1,repeats:2,seed:61234}});await waitFor(()=>a.state.result?.plan?.experiment==='N'&&!a.state.job&&!b.state.job&&b.pending.size===0);
 const sequence=[a.commandSequence,b.commandSequence],revision=a.state.revision,inventory=a.command('export',{exportKind:'inventory'}),state=a.command('export'),biology=b.command('export');await waitFor(()=>received[0].length===2&&received[1].length===1);
 const ai=received[0].find(x=>x.requestId===inventory),as=received[0].find(x=>x.requestId===state),bs=received[1][0];assert.equal(ai.kind,'inventory');assert.equal(as.kind,'state');assert.equal(bs.requestId,biology);assert.equal(bs.kind,'state');assert.equal(a.exports.size+b.exports.size,0);assert.deepEqual([a.commandSequence,b.commandSequence],sequence);assert.equal(a.state.revision,revision);assert.equal(a.state.world.t,12);assert.deepEqual(as.file,bs.file);assert.deepEqual(ai.file,as.file);assert.equal(as.file.format,'BLOODFLOW-LAB-FILE-1');assert.equal('requestId' in as.file,false);assert.equal('kind' in as.file,false);assert.deepEqual(as.file.result,a.state.result);assert.equal(as.file.result.pairs.length,2);
 const filename=path.join(directory,'exported-state.json');fs.writeFileSync(filename,JSON.stringify(as.file));const raw=JSON.parse(fs.readFileSync(filename)),restored=prepareResearchRestore(raw,data);assert.equal(restored.world.t,12);assert.equal(restored.world.c.network,'nationwide');assert.equal(restored.world.verify().passed,true);assert.deepEqual(restored.notes,a.state.notes);assert.deepEqual(restored.result,a.state.result);
 a.command('restore',{snapshot:raw.snapshot,notes:raw.notes,result:raw.result});await waitFor(()=>a.pending.size===0&&b.state.revision>revision);assert.equal(b.state.world.t,12);assert.deepEqual(b.state.result,raw.result);assert.equal(b.state.notes.biology,'Exported biology interpretation');
});
