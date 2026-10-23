import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import net from 'node:net';import {spawn} from 'node:child_process';import {once} from 'node:events';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const waitFor=(condition,ms=6000)=>new Promise((resolve,reject)=>{const start=Date.now(),tick=()=>{const v=condition();if(v)return resolve(v);if(Date.now()-start>ms)return reject(Error('timeout waiting for state'));setTimeout(tick,15);};tick();});
async function freePort(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function start(port,directory){const p=spawn(process.execPath,['server/server.mjs','--port',String(port)],{cwd:root,env:{...process.env,HOST:'127.0.0.1',BLOODFLOW_DATA:directory,BLOODFLOW_ALLOWED_ORIGINS:'https://pincon.app'},stdio:['ignore','pipe','pipe']});let output='';p.stdout.on('data',x=>output+=x);p.stderr.on('data',x=>output+=x);await waitFor(()=>{if(p.exitCode!==null)throw Error('Server exited before readiness: '+output);return /^BLOODFLOW:/m.test(output);});p.readOutput=()=>output;return p;}
async function stop(p){if(!p||p.exitCode!==null)return;const done=once(p,'exit');p.kill('SIGTERM');await done;}
async function join(port,code,role){const socket=new WebSocket(`ws://127.0.0.1:${port}/bloodflow/ws`),messages=[];socket.addEventListener('message',e=>messages.push(JSON.parse(e.data)));await once(socket,'open');socket.send(JSON.stringify({type:'join',experimentId:code,role}));await waitFor(()=>messages.find(m=>m.type==='state'));return {socket,messages,state:()=>messages.filter(m=>m.type==='state').at(-1)};}
const command=(client,code,type,props={},revision=client.state().revision)=>{const id=crypto.randomUUID();const m={type,eventId:id,experimentId:code,expectedRevision:revision,expectedVersion:client.state().version,timestamp:new Date().toISOString(),...props};client.socket.send(JSON.stringify(m));return m;};
test('real server rejects invalid joins once with a terminal phase and closes; a corrected join still works',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bloodflow-join-test-')),port=await freePort();const server=await start(port,dir),sockets=[];
 t.after(async()=>{for(const socket of sockets)socket.close();await stop(server);fs.rmSync(dir,{recursive:true,force:true});});
 const created=await (await fetch(`http://127.0.0.1:${port}/bloodflow/api/rooms`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json();
 const missing=created.experimentId==='000000'?'111111':'000000';
 for(const message of [
  {type:'join',experimentId:missing,role:'engineering'},
  {type:'join',experimentId:created.experimentId,role:'biology',token:'incorrect-token'},
  {type:'join',experimentId:created.experimentId,role:'invalid-role'},
  {type:'heartbeat',experimentId:created.experimentId}
 ]){
  const socket=new WebSocket(`ws://127.0.0.1:${port}/bloodflow/ws`),messages=[];sockets.push(socket);let closeCode;
  socket.addEventListener('message',e=>messages.push(JSON.parse(e.data)));socket.addEventListener('close',e=>closeCode=e.code);await once(socket,'open');socket.send(JSON.stringify(message));socket.send(JSON.stringify({type:'heartbeat'}));
  await waitFor(()=>closeCode,2000);assert.equal(closeCode,1008);assert.equal(messages.length,1);assert.equal(messages[0].type,'error');assert.equal(messages[0].phase,'join');assert.equal(messages[0].retryable,false);assert.equal(messages.some(m=>m.type==='state'),false);
 }
 const idle=new WebSocket(`ws://127.0.0.1:${port}/bloodflow/ws`),idleMessages=[];sockets.push(idle);let idleCloseCode;
 idle.addEventListener('message',e=>idleMessages.push(JSON.parse(e.data)));idle.addEventListener('close',e=>idleCloseCode=e.code);await once(idle,'open');await waitFor(()=>idleCloseCode,12000);assert.equal(idleCloseCode,1008);assert.equal(idleMessages.length,1);assert.equal(idleMessages[0].phase,'join');assert.equal(idleMessages[0].retryable,false);
 for(const file of ['startup.js','modules/app.mjs','modules/client.mjs']){const response=await fetch(`http://127.0.0.1:${port}/bloodflow/${file}`);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/javascript/);assert.ok((await response.text()).length>100);}
 const corrected=await join(port,created.experimentId,'biology');sockets.push(corrected.socket);assert.equal(corrected.state().world.t,0);assert.deepEqual(corrected.state().peers,['biology']);
 const illegal=command(corrected,created.experimentId,'configure',{patch:{safetyDays:8}});await waitFor(()=>corrected.messages.some(m=>m.type==='error'&&m.eventId===illegal.eventId));assert.equal(corrected.socket.readyState,1);assert.equal(corrected.messages.at(-1).phase,undefined);
 const allowed=command(corrected,created.experimentId,'notes',{patch:{biology:'접속 뒤 독립 연구 해석'}});await waitFor(()=>corrected.messages.some(m=>m.type==='ack'&&m.eventId===allowed.eventId));assert.equal(corrected.state().notes.biology,'접속 뒤 독립 연구 해석');
});
for(const network of ['incheon','nationwide'])test(network+' two real WebSocket clients: sync, permissions, conflicts, deduplication, disconnect, rejoin, disk restore and isolated routes',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bloodflow-test-')),port=await freePort();let server=await start(port,dir),a,b,c;
 t.after(async()=>{a?.socket.close();b?.socket.close();c?.socket.close();await stop(server);fs.rmSync(dir,{recursive:true,force:true});});
 const res=await fetch(`http://127.0.0.1:${port}/bloodflow/api/rooms`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:{network}})}).catch(e=>{throw Error(e.message+'; server output: '+server?.readOutput?.());});assert.equal(res.status,201);const created=await res.json(),code=created.experimentId;
 for(const lab of ['','nationwide','engineering','biology','research'])assert.equal((await fetch(`http://127.0.0.1:${port}/bloodflow/${lab}`)).status,200);
 const preflight=await fetch(`http://127.0.0.1:${port}/bloodflow/api/rooms`,{method:'OPTIONS',headers:{Origin:'https://pincon.app','Access-Control-Request-Method':'POST'}});assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'https://pincon.app');
 assert.equal((await fetch(`http://127.0.0.1:${port}/bloodflow/api/rooms`,{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'application/json'},body:'{}'})).status,403);
 assert.equal((await fetch(`http://127.0.0.1:${port}/new`)).status,404);assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status,404);assert.equal((await fetch(`http://127.0.0.1:${port}/bloodflow/../package.json`)).status,404);
 a=await join(port,code,'engineering');b=await join(port,code,'biology');await waitFor(()=>a.state().peers.length===2);assert.deepEqual(a.state().world.summary,b.state().world.summary);
 const step=command(a,code,'step',{hours:6});await waitFor(()=>b.state().world.t===6);a.socket.send(JSON.stringify(step));await waitFor(()=>a.messages.find(m=>m.type==='ack'&&m.eventId===step.eventId&&m.duplicate));assert.equal(a.state().world.t,6);
 const illegal=command(b,code,'configure',{patch:{safetyDays:8}});await waitFor(()=>b.messages.find(m=>m.type==='error'&&m.eventId===illegal.eventId));assert.equal(a.state().world.c.safetyDays,3);
 const revision=a.state().revision,first=command(a,code,'configure',{patch:{safetyDays:4}},revision),second=command(b,code,'configure',{patch:{product:'PLT'}},revision);
 await waitFor(()=>a.messages.some(m=>m.eventId===first.eventId&&m.type==='ack')||a.messages.some(m=>m.eventId===first.eventId&&m.type==='conflict'));
 await waitFor(()=>b.messages.some(m=>m.eventId===second.eventId&&['ack','conflict'].includes(m.type)));assert.equal(a.state().revision,revision+1);assert.ok([...a.messages,...b.messages].some(m=>m.type==='conflict'));assert.deepEqual(a.state().world.summary,b.state().world.summary);
 command(a,code,'clock',{mode:'TIMELAPSE',speed:24,running:true});await waitFor(()=>b.state().running);b.socket.close();await waitFor(()=>a.state().running===false);const paused=a.state().world.t;
 c=await join(port,code,'biology');assert.equal(c.state().world.t,paused);assert.equal(c.state().running,false);
 command(a,code,'compute',{plan:{experiment:network==='nationwide'?'N':'A',days:1,repeats:2}});await waitFor(()=>a.state().result&&c.state().result);assert.equal(a.state().result.format,'BLOODFLOW-PAIRED-1');
 const bioNote=command(c,code,'notes',{patch:{biology:'생명과학 연구자의 원래 해석'}});await waitFor(()=>a.state().notes.biology==='생명과학 연구자의 원래 해석');
 const exportCommand=command(a,code,'export');await waitFor(()=>a.messages.find(m=>m.type==='export'&&m.eventId===exportCommand.eventId));const snapshot=structuredClone(a.messages.find(m=>m.type==='export'&&m.eventId===exportCommand.eventId).snapshot),beforeRestore=a.state().world.summary;
 snapshot.nodes[0].lat=1;snapshot.c.realNodes[0].lat=1;const corrupt=command(a,code,'restore',{snapshot});await waitFor(()=>a.messages.find(m=>m.type==='error'&&m.eventId===corrupt.eventId));assert.deepEqual(a.state().world.summary,beforeRestore);
 const originalSnapshot=structuredClone(a.messages.find(m=>m.type==='export'&&m.eventId===exportCommand.eventId).snapshot),originalResult=structuredClone(a.state().result),version=a.state().version;
 const malformed=command(a,code,'restore',{snapshot:originalSnapshot,notes:{engineering:'적용되면 안 되는 해석'},result:{format:'BLOODFLOW-PAIRED-1'}});await waitFor(()=>a.messages.find(m=>m.type==='error'&&m.eventId===malformed.eventId));assert.equal(a.state().version,version);assert.deepEqual(a.state().result,originalResult);assert.deepEqual(c.state().result,originalResult);
 const cleanRestore=command(a,code,'restore',{snapshot:originalSnapshot,notes:{engineering:'복원한 산업공학 해석',biology:'파일에 들어 있던 다른 역할 해석'},result:null});await waitFor(()=>a.state().result===null&&c.state().result===null);assert.equal(c.state().notes.engineering,'복원한 산업공학 해석');assert.equal(c.state().notes.biology,'생명과학 연구자의 원래 해석');assert.ok(a.messages.some(m=>m.type==='ack'&&m.eventId===cleanRestore.eventId));
 const expected=a.state().world.summary;await stop(server);server=null;await waitFor(()=>a.socket.readyState===3);server=await start(port,dir);const again=await join(port,code,'engineering');assert.equal(again.state().running,false);assert.notEqual(again.state().authorityId,a.state().authorityId);assert.deepEqual(again.state().world.summary,expected);again.socket.close();
});

test('real server survives a disk outage across periodic save, two-role reconnect, explicit retry and process restart',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bloodflow-disk-test-')),port=await freePort();let server=await start(port,dir),a,b,c,d;
 const sockets=[];t.after(async()=>{for(const socket of sockets)socket.close();await stop(server);fs.rmSync(dir,{recursive:true,force:true});});
 const res=await fetch(`http://127.0.0.1:${port}/bloodflow/api/rooms`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(res.status,201);const {experimentId:code}=await res.json();a=await join(port,code,'engineering');b=await join(port,code,'biology');sockets.push(a.socket,b.socket);
 command(a,code,'step',{hours:6});await waitFor(()=>b.state().world.t===6);const file=path.join(dir,code+'.json'),lastGood=fs.readFileSync(file,'utf8');fs.mkdirSync(file+'.tmp');
 const note=command(a,code,'notes',{patch:{engineering:'디스크 장애 중 작성한 산업공학 해석'}});await waitFor(()=>b.state().storage?.kind==='blocked');assert.equal(b.state().notes.engineering,'디스크 장애 중 작성한 산업공학 해석');assert.equal(a.messages.find(x=>x.type==='ack'&&x.eventId===note.eventId).storageSaved,false);assert.equal(fs.readFileSync(file,'utf8'),lastGood);
 const bio=command(b,code,'notes',{patch:{biology:'디스크 장애 중 작성한 생명과학 해석'}});await waitFor(()=>a.state().notes.biology==='디스크 장애 중 작성한 생명과학 해석');assert.equal(b.messages.find(x=>x.type==='ack'&&x.eventId===bio.eventId).storageSaved,false);
 const blockedVersion=b.state().version;await waitFor(()=>b.state().version>blockedVersion,18000);assert.equal(server.exitCode,null);assert.equal((await fetch(`http://127.0.0.1:${port}/bloodflow/api/health`)).status,200);assert.equal(b.state().storage.kind,'blocked');assert.equal(b.state().world.t,6);
 a.socket.close();await waitFor(()=>b.state().peers.length===1);c=await join(port,code,'engineering');sockets.push(c.socket);assert.equal(c.state().storage.kind,'blocked');assert.equal(c.state().notes.biology,b.state().notes.biology);assert.equal(c.state().running,false);
 const exp=command(c,code,'export');await waitFor(()=>c.messages.some(x=>x.type==='export'&&x.eventId===exp.eventId));const exported=c.messages.find(x=>x.type==='export'&&x.eventId===exp.eventId);assert.equal(exported.snapshot.t,6);assert.deepEqual(exported.notes,b.state().notes);
 fs.rmdirSync(file+'.tmp');command(b,code,'save');await waitFor(()=>c.state().storage.kind==='saved');const expected=c.state().notes;assert.deepEqual(JSON.parse(fs.readFileSync(file)).notes,expected);assert.equal(c.state().running,false);
 await stop(server);server=null;await waitFor(()=>c.socket.readyState===3);server=await start(port,dir);d=await join(port,code,'biology');sockets.push(d.socket);assert.equal(d.state().world.t,6);assert.deepEqual(d.state().notes,expected);assert.equal(d.state().storage.kind,'saved');assert.equal(d.state().running,false);
 const revision=d.state().revision;d.socket.send(JSON.stringify(bio));await waitFor(()=>d.messages.some(x=>x.type==='ack'&&x.eventId===bio.eventId&&x.duplicate));assert.equal(d.state().revision,revision);assert.doesNotMatch(server.readOutput(),/uncaught|EISDIR/);
});
