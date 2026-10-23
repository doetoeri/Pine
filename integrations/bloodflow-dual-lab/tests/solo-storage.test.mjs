import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {openStateDatabase,readCheckpoint} from '../src/solo-storage.mjs';import {LabClient} from '../src/client.mjs';import {DualWorld} from '../src/engine.mjs';
const data=Object.fromEntries(['facilities','routes','nationwide'].map(k=>[k,JSON.parse(fs.readFileSync(new URL('../public/data/'+k+'.json',import.meta.url)))]));
const checkpoint=(network='incheon')=>{const world=new DualWorld({network},data);world.advance(6);return structuredClone({snapshot:world.snapshot(),notes:{engineering:'보호할 연구 기록',biology:'보존 조건의 해석'},result:null});};
function database(records=new Map(),options={}){
 const stats={reads:0,writes:0,aborts:0,commits:0,closes:0,transactions:[],written:[]};
 const db={stats,records,objectStoreNames:{contains:()=>true},close(){stats.closes++;},transaction(_name,mode){
  let pending=0,ended=false;const staged=new Map(),view=new Map(records);
  const tx={mode,abort(){if(ended)return;ended=true;stats.aborts++;queueMicrotask(()=>tx.onabort?.());},objectStore(){return store;}};
  stats.transactions.push(tx);if(mode==='readonly')stats.reads++;else stats.writes++;
  const complete=()=>{if(pending||ended)return;queueMicrotask(()=>{if(pending||ended)return;ended=true;for(const [k,v]of staged)records.set(k,v);stats.commits++;tx.oncomplete?.();});};
  const request=action=>{const q={};pending++;queueMicrotask(()=>{if(ended)return;if(mode==='readonly'&&options.hangRead||mode==='readwrite'&&options.hangWrite)return;
   try{if(mode==='readwrite'&&options.failWrite)throw Error('QuotaExceededError');q.result=action();q.onsuccess?.();pending--;complete();}
   catch(error){q.error=error;tx.error=error;tx.onerror?.({target:q});if(!ended)tx.abort();}
  });return q;};
  const store={get:key=>request(()=>structuredClone(view.get(key))),put(value,key){const copy=structuredClone(value);stats.written.push({key,record:copy});return request(()=>{staged.set(key,copy);return key;});}};
  return tx;
 }};return db;
}
function client(t,db){const c=new LabClient(data,{}, {storageTimeoutMs:20});c.db=async()=>db;t.after(()=>{for(const k of ['loop','saveLoop','watch'])clearInterval(c[k]);});return c;}
async function drain(c){while(c._autosavePending)await c._autosavePending;}

test('a missing target of the latest checkpoint blocks writes instead of replacing its pointer',async t=>{
 for(const target of [undefined,null]){
  const records=new Map([['latest:incheon',{slotKey:'solo:previous:incheon'}],['solo:orphan:incheon',checkpoint()]]);if(target===null)records.set('solo:previous:incheon',null);
  const before=JSON.stringify([...records]),db=database(records),c=client(t,db);let exported;
  c.addEventListener('export',e=>exported=e.detail);await c.restoreAutosave();
  assert.equal(c.ready,true);assert.equal(c.autosaveAllowed,false);assert.equal(c.storageStatus.kind,'blocked');assert.match(c.storageStatus.message,/자동/);
  c.command('step',{hours:6});c.command('notes',{patch:{engineering:'파일로 보관할 임시 연구'}});c.command('export');await c.autosave();
  assert.equal(db.stats.writes,0);assert.equal(JSON.stringify([...records]),before);assert.equal(exported.snapshot.t,6);assert.equal(exported.notes.engineering,'파일로 보관할 임시 연구');assert.equal(DualWorld.restore(exported.snapshot,data).verify().passed,true);
 }
});

test('null checkpoint records and null latest metadata are corruption rather than an empty database',async t=>{
 for(const entries of [[['solo:mine:incheon',null]],[['solo:incheon',null]],[['solo',null]],[['latest:incheon',null]]]){
  const records=new Map(entries),db=database(records),c=client(t,db);c.clientId='mine';await c.restoreAutosave();assert.equal(c.autosaveAllowed,false);assert.equal(c.storageStatus.kind,'blocked');await c.autosave();assert.equal(db.stats.writes,0);assert.deepEqual([...records],entries);
 }
});

test('an explicit broken latest pointer does not silently roll back to an older regional record',async t=>{
 const saved=checkpoint(),records=new Map([['latest:incheon',{slotKey:'solo:missing:incheon'}],['solo:incheon',saved],['solo',saved]]),db=database(records),c=client(t,db);await c.restoreAutosave();assert.equal(c.autosaveAllowed,false);assert.equal(c.world.t,0);assert.equal(db.stats.writes,0);assert.deepEqual(records.get('solo:incheon'),saved);
});

test('a healthy own checkpoint keeps priority over broken latest metadata from another tab',async()=>{
 const own=checkpoint();for(const latest of [null,{slotKey:'solo:missing:incheon'},{slotKey:'invalid'}]){
  const db=database(new Map([['solo:mine:incheon',own],['latest:incheon',latest]]));assert.deepEqual(await readCheckpoint(db,'mine','incheon'),own);
 }
});

test('a genuinely new database still permits its first atomic checkpoint and unrelated legacy data stays scoped',async t=>{
 const db=database(),c=client(t,db);await c.restoreAutosave();assert.equal(c.autosaveAllowed,true);assert.equal(c.storageStatus.restored,false);c.command('step',{hours:6});await drain(c);assert.equal(db.stats.writes,1);assert.equal(db.records.get('solo:'+c.clientId+':incheon').snapshot.t,6);assert.deepEqual(db.records.get('latest:incheon'),{slotKey:'solo:'+c.clientId+':incheon'});
 assert.equal(await readCheckpoint(database(new Map([['solo',null]])),'new','nationwide'),undefined);
});

test('an unresponsive open times out once and a late database connection is closed',async()=>{
 let request,opens=0,closed=0;const pending=openStateDatabase({timeoutMs:20,factory:{open(){opens++;request={};return request;}}});
 await assert.rejects(pending,/열기 대기 시간/);request.result={close(){closed++;}};request.onsuccess();assert.equal(opens,1);assert.equal(closed,1);
});

test('blocked opens report recovery guidance and cannot retain a late upgrade connection',async()=>{
 let request,aborted=0,closed=0,created=0;const pending=openStateDatabase({factory:{open(){request={};return request;}},timeoutMs:100});
 request.onblocked();await assert.rejects(pending,/다른 창/);request.result={close(){closed++;},createObjectStore(){created++;}};request.transaction={abort(){aborted++;}};request.onupgradeneeded();request.onsuccess();
 assert.equal(aborted,1);assert.ok(closed>=1);assert.equal(created,0);
});

test('checkpoint reads preserve per-tab priority and network-specific legacy fallbacks in one transaction',async()=>{
 const saved=checkpoint(),other=structuredClone(saved);other.notes.engineering='다른 기기의 마지막 연구';
 const cases=[
  [new Map([['solo:mine:incheon',saved],['latest:incheon',{slotKey:'solo:other:incheon'}],['solo:other:incheon',other]]),'mine',saved],
  [new Map([['latest:incheon',{slotKey:'solo:other:incheon'}],['solo:other:incheon',other]]),'new',other],
  [new Map([['solo:incheon',saved]]),'new',saved],
  [new Map([['solo',saved]]),'new',saved]
 ];
 for(const [records,id,expected]of cases){const db=database(records);assert.deepEqual(await readCheckpoint(db,id,'incheon'),expected);assert.equal(db.stats.reads,1);}
 assert.equal(await readCheckpoint(database(new Map([['solo',saved]])),'new','nationwide'),undefined);
});

test('a timed-out read releases the UI but blocks every write and ignores late completion',async t=>{
 const records=new Map([['solo:incheon',checkpoint()]]),before=JSON.stringify([...records]),db=database(records,{hangRead:true}),c=client(t,db);
 await c.restoreAutosave();assert.equal(c.initializing,false);assert.equal(c.ready,true);assert.equal(c.autosaveAllowed,false);assert.match(c.storageStatus.message,/읽기 대기 시간/);assert.equal(db.stats.aborts,1);
 c.command('step',{hours:6});await c.autosave();db.stats.transactions[0].oncomplete();assert.equal(c.world.t,6);assert.equal(c.world.verify().passed,true);assert.equal(db.stats.writes,0);assert.equal(JSON.stringify([...records]),before);
});

test('a corrupt checkpoint stays byte-equivalent after failed restore and temporary research',async t=>{
 const bad=checkpoint();bad.snapshot.units[0].bloodType='INVALID';const records=new Map([['solo:incheon',bad]]),before=JSON.stringify([...records]),db=database(records),c=client(t,db);let exported;
 c.addEventListener('export',e=>{exported=e.detail;});await c.restoreAutosave();assert.equal(c.ready,true);assert.equal(c.world.t,0);assert.equal(c.autosaveAllowed,false);
 c.command('step',{hours:6});c.command('notes',{patch:{engineering:'파일로 내보낼 임시 해석'}});c.command('export');await c.autosave();
 assert.equal(db.stats.writes,0);assert.equal(JSON.stringify([...records]),before);assert.equal(exported.snapshot.t,6);assert.equal(exported.notes.engineering,'파일로 내보낼 임시 해석');assert.equal(DualWorld.restore(exported.snapshot,data).verify().passed,true);
});

test('bad note metadata and a wrong network never partially replace the current world',async t=>{
 for(const saved of [(()=>{const x=checkpoint();x.notes.engineering=42;return x;})(),checkpoint('nationwide')]){
  const db=database(new Map([['solo:incheon',saved]])),c=client(t,db),before=structuredClone(c.world.snapshot()),notes={...c.notes};await c.restoreAutosave();
  assert.deepEqual(c.world.snapshot(),before);assert.deepEqual(c.notes,notes);assert.equal(c.autosaveAllowed,false);assert.equal(db.stats.writes,0);
 }
});

test('healthy restore resumes deterministically and commits snapshot plus latest pointer together',async t=>{
 const saved=checkpoint(),db=database(new Map([['solo:incheon',saved]])),c=client(t,db);let saves=0;c.addEventListener('saved',()=>saves++);
 await c.restoreAutosave();assert.equal(c.autosaveAllowed,true);assert.equal(c.world.t,6);assert.equal(c.notes.engineering,saved.notes.engineering);c.command('step',{hours:6});await drain(c);
 const key='solo:'+c.clientId+':incheon',stored=db.records.get(key),control=DualWorld.restore(saved.snapshot,data);control.advance(12);
 assert.deepEqual(c.world.summary(),control.summary());assert.deepEqual(stored.snapshot,c.world.snapshot());assert.deepEqual(db.records.get('latest:incheon'),{slotKey:key});assert.equal(saves,1);assert.equal(db.stats.writes,1);
});

test('failed writes do not announce a save or commit either record and are not retried automatically',async t=>{
 const records=new Map([['solo:incheon',checkpoint()]]),before=JSON.stringify([...records]),options={},db=database(records,options),c=client(t,db);let saves=0;c.addEventListener('saved',()=>saves++);
 await c.restoreAutosave();options.failWrite=true;c.command('step',{hours:6});await drain(c);await c.autosave();
 assert.equal(saves,0);assert.equal(c.autosaveAllowed,false);assert.equal(c.storageStatus.kind,'blocked');assert.equal(db.stats.writes,1);assert.equal(db.stats.aborts,1);assert.equal(JSON.stringify([...records]),before);
});

test('a stalled write transaction is aborted without reporting a completed save',async t=>{
 const records=new Map([['solo:incheon',checkpoint()]]),before=JSON.stringify([...records]),options={},db=database(records,options),c=client(t,db);let saves=0;c.addEventListener('saved',()=>saves++);
 await c.restoreAutosave();options.hangWrite=true;c.command('step',{hours:6});await drain(c);
 assert.equal(saves,0);assert.match(c.storageStatus.message,/쓰기 대기 시간/);assert.equal(db.stats.aborts,1);assert.equal(c.autosaveAllowed,false);assert.equal(JSON.stringify([...records]),before);
});

test('database opens are shared and a version change releases the cached connection',async t=>{
 const prior=globalThis.indexedDB;let opens=0;const created=[];globalThis.indexedDB={open(){opens++;const request={},db=database();created.push(db);queueMicrotask(()=>{request.result=db;request.onsuccess();});return request;}};
 const c=new LabClient(data);t.after(()=>{for(const k of ['loop','saveLoop','watch'])clearInterval(c[k]);if(prior===undefined)delete globalThis.indexedDB;else globalThis.indexedDB=prior;});
 const values=await Promise.all([c.db(),c.db(),c.db()]);assert.equal(opens,1);assert.ok(values.every(x=>x===values[0]));values[0].onversionchange();assert.equal(created[0].stats.closes,1);const next=await c.db();assert.equal(opens,2);assert.notEqual(next,values[0]);
});

test('queued saves copy mutable engine references before database waits and keep the latest research',async t=>{
 const saved=checkpoint(),db=database(new Map([['solo:incheon',saved]])),c=client(t,db);await c.restoreAutosave();let release;const gate=new Promise(resolve=>{release=resolve;});c.db=()=>gate;
 c.command('step',{hours:6});c.command('notes',{patch:{engineering:'가장 최근 해석'}});c.command('step',{hours:6});release(db);await drain(c);
 const writes=db.stats.written.filter(x=>x.key.startsWith('solo:'));assert.equal(db.stats.writes,2);assert.deepEqual(writes.map(x=>x.record.snapshot.t),[12,18]);
 for(const x of writes)assert.equal(DualWorld.restore(x.record.snapshot,data).verify().passed,true);
 const latest=db.records.get('solo:'+c.clientId+':incheon');assert.equal(latest.snapshot.t,18);assert.equal(latest.notes.engineering,'가장 최근 해석');assert.equal(c.storageStatus.kind,'ready');
});
