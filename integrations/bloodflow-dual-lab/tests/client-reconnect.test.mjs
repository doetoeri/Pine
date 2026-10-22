import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {LabClient} from '../src/client.mjs';
const data=Object.fromEntries(['facilities','routes','nationwide'].map(k=>[k,JSON.parse(fs.readFileSync(new URL('../public/data/'+k+'.json',import.meta.url)))]));
test('client accepts a restarted authority checkpoint, cancels stale commands and ignores an old room socket',async t=>{
 const old=Object.fromEntries(['window','location','WebSocket','localStorage'].map(k=>[k,globalThis[k]])),storage=new Map();
 class Socket{constructor(){this.readyState=1;this.sent=[];}send(v){this.sent.push(JSON.parse(v));}close(){this.readyState=3;this.onclose?.();}}
 Object.assign(globalThis,{window:{BLOODFLOW_RUNTIME:{}},location:{origin:'http://lab.test',protocol:'http:'},WebSocket:Socket,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}});
 const c=new LabClient(data);t.after(()=>{c.reconnect=false;clearTimeout(c.reconnectTimer);for(const k of ['loop','saveLoop','watch'])clearInterval(c[k]);for(const [key,value] of Object.entries(old))if(value===undefined)delete globalThis[key];else globalThis[key]=value;});
 await c.restoreAutosave();c.join('ABC123','engineering');const socket=c.socket;
 const state=(version,authorityId,t)=>JSON.stringify({type:'state',version,revision:0,authorityId,experimentId:'ABC123',world:{t},notes:{},peers:[]});
 socket.onmessage({data:state(9,'old-process',10)});assert.equal(c.state.world.t,10);c.command('notes',{patch:{hypothesis:'pending'}});assert.equal(c.pending.size,1);
 socket.onmessage({data:state(3,'old-process',9)});assert.equal(c.state.world.t,10);
 socket.onmessage({data:state(3,'restarted-process',9)});assert.equal(c.state.world.t,9);assert.equal(c.ready,true);assert.equal(c.pending.size,0);
 c.join('DEF456','biology');assert.equal(socket.readyState,3);socket.onmessage({data:state(100,'old-process',80)});assert.equal(c.sharedState,null);
 c.socket.onmessage({data:JSON.stringify({type:'state',version:0,revision:0,authorityId:'new-room-process',experimentId:'DEF456',world:{t:0},notes:{},peers:[]})});assert.equal(c.state.world.t,0);
});
