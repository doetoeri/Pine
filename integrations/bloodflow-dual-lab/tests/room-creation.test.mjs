import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';
import {createSharedRoom} from '../src/collaboration-availability.mjs';import {LabClient} from '../src/client.mjs';
const context={location:{origin:'https://lab.example',protocol:'https:'},window:{BLOODFLOW_RUNTIME:{}}};

test('room creation aborts a missing response without automatically repeating the POST',async()=>{
 let requests=0,aborted=false;
 const fetchImpl=(_url,{signal})=>{requests++;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'));},{once:true}));};
 await assert.rejects(createSharedRoom({},'engineering',{context,fetchImpl,timeoutMs:20}),/시간이 초과.*자동으로 다시 요청하지/);
 assert.equal(requests,1);assert.equal(aborted,true);
});

test('room creation also bounds a real HTTP response body that never completes',async t=>{
 let requests=0;
 const server=http.createServer((req,res)=>{if(req.method==='GET'){res.end('ready');return;}requests++;res.writeHead(200,{'Content-Type':'application/json'});res.flushHeaders();res.write('{"experimentId":');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const origin='http://127.0.0.1:'+server.address().port;
 await (await fetch(origin)).text();
 await assert.rejects(createSharedRoom({},'biology',{context:{location:{origin,protocol:'http:'},window:{}},timeoutMs:350}),/시간이 초과.*자동으로 다시 요청하지/);
 assert.equal(requests,1);
});

test('malformed or incomplete room responses do not count as a successful room',async()=>{
 for(const response of [new Response('<html>missing</html>',{headers:{'content-type':'text/html'}}),new Response('{',{headers:{'content-type':'application/json'}}),Response.json(null),Response.json({experimentId:'ABC123',tokens:{engineering:''}}),Response.json({experimentId:'not-a-code',tokens:{engineering:'fixture'}})]){
  let requests=0;
  await assert.rejects(createSharedRoom({},'engineering',{context,fetchImpl:async()=>{requests++;return response;}}));assert.equal(requests,1);
 }
 await assert.rejects(createSharedRoom({},'engineering',{context,fetchImpl:async()=>Response.json({error:'방 수 한도'}, {status:429})}),/방 수 한도/);
});

test('a valid creation response preserves the request configuration and selected role token',async()=>{
 const payload={experimentId:'ABC123',tokens:{engineering:'fixture-engineering',biology:'fixture-biology'}},config={network:'nationwide',seed:20261022};let requests=0;
 const value=await createSharedRoom(config,'biology',{context:{...context,window:{BLOODFLOW_RUNTIME:{serverOrigin:'https://shared.example'}}},fetchImpl:async(url,options)=>{requests++;assert.equal(url.href,'https://shared.example/bloodflow/api/rooms');assert.equal(options.method,'POST');assert.equal(options.headers.Accept,'application/json');assert.ok(options.signal instanceof AbortSignal);assert.deepEqual(JSON.parse(options.body),{config});return Response.json(payload);}});
 assert.deepEqual(value,payload);assert.equal(value.tokens.biology,'fixture-biology');assert.equal(requests,1);
});

test('an invalid creation response leaves the solo world usable without opening a socket',async t=>{
 const data=Object.fromEntries(['facilities','routes','nationwide'].map(k=>[k,JSON.parse(fs.readFileSync(new URL('../public/data/'+k+'.json',import.meta.url)))]));
 const keys=['window','location','fetch','WebSocket'],old=Object.fromEntries(keys.map(k=>[k,globalThis[k]]));let posts=0,sockets=0;
 Object.assign(globalThis,{...context,fetch:async(_url,options={})=>{if(options.method==='POST'){posts++;return Response.json({experimentId:'ABC123',tokens:{}});}return Response.json({app:'BLOODFLOW Dual Lab',version:'2.0.0',websocket:true});},WebSocket:class{constructor(){sockets++;}}});
 const client=new LabClient(data,{network:'nationwide'});t.after(()=>{for(const k of ['loop','saveLoop','watch'])clearInterval(client[k]);for(const [k,v]of Object.entries(old))if(v===undefined)delete globalThis[k];else globalThis[k]=v;});
 await client.restoreAutosave();const before=JSON.stringify(client.world.snapshot());
 await assert.rejects(client.create('engineering'),/역할/);assert.equal(posts,1);assert.equal(sockets,0);assert.equal(client.mode,'solo');assert.equal(client.ready,true);assert.equal(JSON.stringify(client.world.snapshot()),before);
 client.command('step',{hours:6});assert.equal(client.world.t,6);assert.equal(client.world.verify().passed,true);
});
