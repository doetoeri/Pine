import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setImmediate as flush} from 'node:timers/promises';
import {LabClient} from '../src/client.mjs';
import {Rooms} from '../server/rooms.mjs';
import {NoteDrafts,noteScope} from '../src/note-drafts.mjs';

const data=Object.fromEntries(['facilities','routes','nationwide'].map(k=>[k,JSON.parse(fs.readFileSync(new URL('../public/data/'+k+'.json',import.meta.url)))]));
async function fixture(t){
 const keys=['window','location','WebSocket','localStorage','sessionStorage'],old=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)])),directory=fs.mkdtempSync(path.join(os.tmpdir(),'bf-client-notes-')),rooms=new Rooms(data,directory),room=rooms.create(),clients=[],held=[];
 class Socket{
  constructor(){this.readyState=1;}
  send(raw){const m=JSON.parse(raw);if(m.type==='heartbeat')return;
   if(m.type==='join'){const socket=this;this.peer=rooms.join({get readyState(){return socket.readyState;},send(text){queueMicrotask(()=>{if(socket.readyState===1)socket.onmessage?.({data:text});});},close(){socket.close();}},m.experimentId,m.role,m.token);}
   else if(this.hold&&m.type==='notes')held.push({peer:this.peer,m});
   else try{rooms.command(this.peer,m);}catch(error){queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'error',eventId:m.eventId,error:error.message})}));}
  }
  close(){if(this.readyState===3)return;this.readyState=3;rooms.leave(this.peer);this.onclose?.();}
 }
 Object.assign(globalThis,{window:{BLOODFLOW_RUNTIME:{}},location:{origin:'http://lab.test',protocol:'http:'},WebSocket:Socket,localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{getItem:()=>null,setItem(){}}});
 const makeClient=async(role='engineering')=>{const c=new LabClient(data),drafts=new NoteDrafts();clients.push(c);c.initializing=false;c.addEventListener('change',()=>drafts.reconcile(c.pending));c.addEventListener('ack',e=>{if(e.detail?.type==='notes')drafts.acknowledge(e.detail.eventId);});c.addEventListener('command-rejected',e=>drafts.reject(e.detail.eventId,e.detail.error));c.join(room.code,role,room.tokens[role]);c.socket.onopen();await flush();return {c,drafts,edit(key,value){drafts.capture(noteScope(c),key,value,c.state.notes[key]);},submit(key){const scope=noteScope(c),id=c.command('notes',{patch:{[key]:drafts.get(scope,key).value}});drafts.sent(scope,key,id);return id;}};};
 t.after(async()=>{for(const c of clients){c.reconnect=false;clearTimeout(c.reconnectTimer);clearTimeout(c.joinTimer);for(const k of ['loop','saveLoop','watch'])clearInterval(c[k]);c.socket?.close();}rooms.close();await flush();for(const [key,d] of old)if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];fs.rmSync(directory,{recursive:true,force:true});});
 return {rooms,room,makeClient,held,release(){for(const {peer,m} of held.splice(0))rooms.command(peer,m);}};
}

test('two researchers resolve a real Rooms revision conflict only by an explicit resend',async t=>{
 const f=await fixture(t),a=await f.makeClient(),b=await f.makeClient('biology');a.c.socket.hold=true;a.edit('question','A pending');const id=a.submit('question');assert.equal(a.c.pending.has(id),true);b.edit('question','B confirmed');b.submit('question');await flush();f.release();await flush();
 assert.equal(f.room.notes.question,'B confirmed');assert.equal(a.c.pending.size,0);assert.equal(a.drafts.get(noteScope(a.c),'question').value,'A pending');assert.match(a.drafts.get(noteScope(a.c),'question').issue,/다른 연구자/);assert.equal(b.drafts.size,0);assert.equal(f.room.logs.filter(x=>x.action==='notes').length,1);
 a.c.socket.hold=false;a.submit('question');await flush();assert.equal(f.room.notes.question,'A pending');assert.equal(b.c.state.notes.question,'A pending');assert.equal(a.drafts.size,0);assert.equal(f.room.logs.filter(x=>x.action==='notes').length,2);assert.equal(f.room.world.verify().passed,true);
});

test('changing room or role hides old drafts without deleting them or writing into the new room',async t=>{
 const f=await fixture(t),a=await f.makeClient(),scope=noteScope(a.c);a.c.socket.hold=true;a.edit('question','old room');a.submit('question');const next=f.rooms.create();a.c.join(next.code,'engineering',next.tokens.engineering);a.c.socket.onopen();await flush();
 assert.equal(a.drafts.get(noteScope(a.c),'question'),undefined);assert.equal(a.drafts.get(scope,'question').value,'old room');assert.equal(a.drafts.get(scope,'question').eventId,null);assert.notEqual(next.notes.question,'old room');a.c.join(f.room.code,'biology',f.room.tokens.biology);a.c.socket.onopen();await flush();assert.equal(a.drafts.get(noteScope(a.c),'question'),undefined);a.c.join(f.room.code,'engineering',f.room.tokens.engineering);a.c.socket.onopen();await flush();assert.equal(a.drafts.get(noteScope(a.c),'question').value,'old room');assert.equal(f.room.logs.filter(x=>x.action==='notes').length,0);
});

test('a permission error reports the correlated event and keeps the rejected text out of server notes',async t=>{
 const f=await fixture(t),b=await f.makeClient('biology');b.edit('engineering','must stay local');const id=b.submit('engineering');await flush();assert.equal(b.c.pending.has(id),false);const d=b.drafts.get(noteScope(b.c),'engineering');assert.equal(d.value,'must stay local');assert.equal(d.eventId,null);assert.match(d.issue,/권한|역할/);assert.equal(f.room.notes.engineering,'');
});

test('newer writing survives acknowledgement of an earlier value and both roles retain independent interpretations',async t=>{
 const f=await fixture(t),a=await f.makeClient(),b=await f.makeClient('biology');a.c.socket.hold=true;a.edit('engineering','first');a.submit('engineering');a.edit('engineering','newer');f.release();await flush();assert.equal(f.room.notes.engineering,'first');assert.equal(a.drafts.get(noteScope(a.c),'engineering').value,'newer');assert.equal(a.drafts.get(noteScope(a.c),'engineering').eventId,null);
 a.c.socket.hold=false;a.submit('engineering');await flush();b.edit('biology','independent biology');b.submit('biology');await flush();assert.equal(a.drafts.size+b.drafts.size,0);assert.equal(f.room.notes.engineering,'newer');assert.equal(f.room.notes.biology,'independent biology');assert.deepEqual(a.c.state.notes,b.c.state.notes);assert.equal(f.room.world.t,0);
});
