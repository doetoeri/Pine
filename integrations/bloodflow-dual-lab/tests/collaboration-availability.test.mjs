import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {CollaborationAvailability,resolveServerBase} from '../src/collaboration-availability.mjs';
import {LabClient} from '../src/client.mjs';
const context=()=>({location:{origin:'https://lab.example',protocol:'https:'},window:{BLOODFLOW_RUNTIME:{}}});
const healthy=()=>Response.json({app:'BLOODFLOW Dual Lab',version:'2.0.0',websocket:true});

test('a static HTML page and unrelated JSON cannot enable shared research',async()=>{
 for(const response of [new Response('<!doctype html>',{headers:{'content-type':'text/html'}}),Response.json({app:'another app',websocket:true,version:'2'}),Response.json(null),new Response('{',{headers:{'content-type':'application/json'}})]){
  const probe=new CollaborationAvailability({context,fetchImpl:async()=>response});assert.equal((await probe.check()).ready,false);
 }
 const probe=new CollaborationAvailability({context,fetchImpl:async url=>{assert.equal(url,'https://lab.example/bloodflow/api/health');return healthy();}});
 assert.equal((await probe.check()).ready,true);
});

test('concurrent health probes share one request; a failure needs expiry or an explicit retry',async()=>{
 let calls=0,release,now=100;const wait=new Promise(r=>release=r);
 const probe=new CollaborationAvailability({context,now:()=>now,cacheMs:1000,fetchImpl:async()=>{calls++;await wait;return calls===1?new Response('missing',{status:404}):healthy();}});
 const a=probe.check(),b=probe.check({force:true});assert.equal(a,b);assert.equal(calls,1);release();
 assert.equal((await a).status,404);assert.equal((await b).ready,false);await probe.check();assert.equal(calls,1);
 await probe.check({force:true});assert.equal(calls,2);now+=1001;await probe.check();assert.equal(calls,3);
});

test('a stalled server times out without retrying and a network error is distinguished',async()=>{
 let calls=0;const probe=new CollaborationAvailability({context,timeoutMs:15,fetchImpl:(_url,{signal})=>{calls++;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));}});
 const result=await probe.check();assert.equal(result.kind,'timeout');assert.equal(result.ready,false);assert.equal(calls,1);
 const failed=new CollaborationAvailability({context,fetchImpl:async()=>{throw Error('network down');}});assert.equal((await failed.check()).kind,'network');
});

test('single-file and invalid server settings never send an external request',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;return healthy();};
 for(const c of [{location:{protocol:'file:'},window:{}},{...context(),window:{BLOODFLOW_STANDALONE:true}}, {...context(),window:{BLOODFLOW_RUNTIME:{serverOrigin:'https://lab.example/path'}}}, {...context(),window:{BLOODFLOW_RUNTIME:{serverOrigin:'http://lab.example'}}}]){
  assert.equal((await new CollaborationAvailability({context:()=>c,fetchImpl}).check()).ready,false);
 }
 assert.equal(calls,0);assert.equal(resolveServerBase({location:{origin:'http://192.168.1.20:8787',protocol:'http:'},window:{}}).origin,'http://192.168.1.20:8787');
});

const data=Object.fromEntries(['facilities','routes','nationwide'].map(k=>[k,JSON.parse(fs.readFileSync(new URL('../public/data/'+k+'.json',import.meta.url)))]));
test('a missing collaboration backend cannot replace or lock the current solo world',async t=>{
 const keys=['window','location','fetch','WebSocket'],old=Object.fromEntries(keys.map(k=>[k,globalThis[k]]));let requests=0,sockets=0;
 Object.assign(globalThis,{...context(),fetch:async(_u,options)=>{requests++;assert.equal(options.method,undefined);return new Response('Not found',{status:404});},WebSocket:class{constructor(){sockets++;}}});
 const client=new LabClient(data,{network:'nationwide'});t.after(()=>{for(const k of ['loop','saveLoop','watch'])clearInterval(client[k]);for(const [k,v]of Object.entries(old))if(v===undefined)delete globalThis[k];else globalThis[k]=v;});
 await client.restoreAutosave();const before=JSON.stringify(client.world.snapshot());
 await assert.rejects(client.create('engineering'),/HTTP 404/);await assert.rejects(client.joinAvailable('ABC123','biology'),/HTTP 404/);
 assert.equal(client.mode,'solo');assert.equal(client.ready,true);assert.equal(client.socket,undefined);assert.equal(sockets,0);assert.equal(requests,1);assert.equal(JSON.stringify(client.world.snapshot()),before);
 client.command('step',{hours:6});assert.equal(client.world.t,6);assert.equal(client.world.verify().passed,true);
});

test('validated server health allows a guarded join and uses the configured server origin',async t=>{
 const keys=['window','location','fetch','WebSocket','localStorage'],old=Object.fromEntries(keys.map(k=>[k,globalThis[k]]));let target;
 Object.assign(globalThis,{...context(),window:{BLOODFLOW_RUNTIME:{serverOrigin:'https://shared.example'}},fetch:async url=>{target=url;return healthy();},WebSocket:class{constructor(url){this.url=url;this.readyState=0;}close(){}},localStorage:{getItem:()=>null}});
 const client=new LabClient(data);t.after(()=>{client.reconnect=false;clearTimeout(client.reconnectTimer);clearTimeout(client.joinTimer);for(const k of ['loop','saveLoop','watch'])clearInterval(client[k]);for(const [k,v]of Object.entries(old))if(v===undefined)delete globalThis[k];else globalThis[k]=v;});
 await client.restoreAutosave();await client.joinAvailable('ABC123','biology');assert.equal(target,'https://shared.example/bloodflow/api/health');assert.equal(client.socket.url,'wss://shared.example/bloodflow/ws');assert.equal(client.mode,'shared');assert.equal(client.ready,false);
});
