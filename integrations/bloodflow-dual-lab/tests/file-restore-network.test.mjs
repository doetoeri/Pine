import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {LabClient} from '../src/client.mjs';
import {StateFileReader} from '../src/file-restore.mjs';
import {prepareResearchRestore} from '../src/research-state.mjs';
const root=path.resolve(new URL('..',import.meta.url).pathname),data=Object.fromEntries(['facilities','routes','nationwide'].map(k=>[k,JSON.parse(fs.readFileSync(path.join(root,'public/data/'+k+'.json')))]));
const waitFor=(fn,ms=8000)=>new Promise((resolve,reject)=>{const start=Date.now(),tick=()=>{try{if(fn())return resolve();if(Date.now()-start>ms)return reject(Error('Shared command state timeout: '+fn.toString()));setTimeout(tick,15);}catch(error){reject(error);}};tick();});
async function freePort(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const port=s.address().port;await new Promise(resolve=>s.close(resolve));return port;}
async function start(port,directory){const child=spawn(process.execPath,['server/server.mjs','--port',String(port)],{cwd:root,env:{...process.env,HOST:'127.0.0.1',BLOODFLOW_DATA:directory},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',s=>log+=s);child.stderr.on('data',s=>log+=s);await waitFor(()=>{if(child.exitCode!==null)throw Error('Server exited: '+log);return log.startsWith('BLOODFLOW:');});return child;}
async function stop(child){if(!child||child.exitCode!==null)return;const done=once(child,'exit');child.kill('SIGTERM');await done;}

test('native roles cancel a delayed stale file, explicitly reselect it and preserve the other role on disk',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bf-file-network-')),port=await freePort(),base='http://127.0.0.1:'+port,keys=['window','location','localStorage','sessionStorage'],old=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)])),storage=new Map(),clients=[],readers=[];let server=await start(port,directory);
 Object.assign(globalThis,{window:{BLOODFLOW_RUNTIME:{}},location:{origin:base,protocol:'http:'},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}});
 t.after(async()=>{for(const r of readers)r.dispose();for(const c of clients){c.reconnect=false;clearTimeout(c.reconnectTimer);clearTimeout(c.joinTimer);for(const k of ['loop','saveLoop','watch'])clearInterval(c[k]);c.socket?.close();}await stop(server);for(const [key,d] of old)if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];fs.rmSync(directory,{recursive:true,force:true});});
 const response=await fetch(base+'/bloodflow/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:{network:'nationwide',seed:20261021}})});assert.equal(response.status,201);const created=await response.json();
 for(const role of ['engineering','biology']){const c=new LabClient(data);clients.push(c);c.initializing=false;readers.push(new StateFileReader(c));c.join(created.experimentId,role,created.tokens[role]);await waitFor(()=>c.ready);}
 const [a,b]=clients,[ar,br]=readers;a.command('step',{hours:6});await waitFor(()=>a.pending.size===0&&b.state.world.t===6);
 a.command('notes',{patch:{engineering:'Native engineering',hypothesis:'File hypothesis'}});await waitFor(()=>a.pending.size===0&&b.state.notes.hypothesis==='File hypothesis');
 b.command('notes',{patch:{biology:'Native biology'}});await waitFor(()=>b.pending.size===0&&a.state.notes.biology==='Native biology');
 b.command('compute',{plan:{experiment:'N',days:1,repeats:2,seed:20261021}});await waitFor(()=>a.state.result?.plan?.experiment==='N'&&b.state.result?.plan?.experiment==='N'&&!a.state.job&&!b.state.job&&b.pending.size===0,15000);
 let exported;a.addEventListener('export',e=>exported=e.detail,{once:true});a.command('export');await waitFor(()=>!!exported);const filename=path.join(directory,'selected-research.json');fs.writeFileSync(filename,JSON.stringify(exported));const bytes=fs.readFileSync(filename),fresh=()=>new File([bytes],'selected-research.json',{type:'application/json'});
 a.command('step',{hours:6});await waitFor(()=>a.pending.size===0&&b.state.world.t===12);const sequence=a.commandSequence;
 let release;const gate=new Promise(resolve=>release=resolve),delayed=fresh(),read=delayed.text.bind(delayed);delayed.text=async()=>{await gate;return read();};const pending=ar.read(delayed,ar.prepare());
 b.command('notes',{patch:{hypothesis:'Peer confirmed while file was reading'}});await waitFor(()=>b.pending.size===0&&a.state.notes.hypothesis==='Peer confirmed while file was reading');assert.equal(await pending,false);release();await Promise.resolve();assert.equal(a.commandSequence,sequence);assert.equal(a.state.world.t,12);assert.equal(a.state.logs.filter(x=>x.action==='restore').length,0);assert.deepEqual(a.state.result,exported.result);
 assert.equal(await ar.read(fresh(),ar.prepare()),true);await waitFor(()=>ar.status.kind==='complete'&&b.state.world.t===6&&a.pending.size===0);assert.equal(b.state.notes.biology,'Native biology');assert.equal(a.state.notes.hypothesis,'File hypothesis');
 a.command('notes',{patch:{engineering:'Keep latest engineering'}});await waitFor(()=>a.pending.size===0&&b.state.notes.engineering==='Keep latest engineering');
 assert.equal(await br.read(fresh(),br.prepare()),true);await waitFor(()=>br.status.kind==='complete'&&b.pending.size===0&&a.state.logs.filter(x=>x.action==='restore').length===2);
 assert.equal(a.state.notes.engineering,'Keep latest engineering');assert.equal(a.state.notes.biology,'Native biology');assert.deepEqual(a.state.result,exported.result);assert.equal(a.state.world.t,6);
 const saved=JSON.parse(fs.readFileSync(path.join(directory,created.experimentId+'.json'))),restored=prepareResearchRestore(saved,data);assert.equal(restored.world.verify().passed,true);assert.equal(restored.world.t,6);assert.deepEqual(restored.result,exported.result);assert.equal(restored.notes.engineering,'Keep latest engineering');assert.equal(restored.notes.biology,'Native biology');
});
