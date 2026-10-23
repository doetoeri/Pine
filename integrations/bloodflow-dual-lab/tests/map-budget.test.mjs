import test from 'node:test';
import assert from 'node:assert/strict';
import {TileScheduler,TileRequestWindow} from '../src/map-requests.mjs';
import {createOnlineLayer} from '../src/map-layer.mjs';

const ok=()=>new Response(new Blob(['synthetic tile'],{type:'image/png'}));
class GridLayer{
 constructor(options){this.options=options;}
 on(){}
 onRemove(){}
 static extend(methods){class Layer extends GridLayer{}Object.assign(Layer.prototype,methods);return Layer;}
}
function layers(t,origin,fetcher){
 const old=new Map(['fetch','location'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 Object.assign(globalThis,{fetch:fetcher,location:{href:'https://app.test/bloodflow/nationwide'}});
 t.after(()=>{for(const [key,d] of old)if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];});
 return (suffix='one')=>createOnlineLayer({GridLayer},{name:'Provider '+suffix,url:origin+'/'+suffix+'/{z}/{x}/{y}.png?style='+suffix,attribution:'Synthetic test'},()=>{});
}

test('map removal and recreation retain the same server minute limit across templates and names',async t=>{
 let calls=0;const make=layers(t,'https://budget-recreate.test',async()=>{calls++;return ok();});
 const first=make();for(let i=0;i<20;i++)await first.scheduler.request('https://budget-recreate.test/first/'+i);
 first.layer.onRemove({});
 const second=make('changed');let completed=0,rejected=0;
 for(let i=0;i<20;i++){try{await second.scheduler.request('https://budget-recreate.test/second/'+i);completed++;}catch{rejected++;}}
 assert.equal(calls,32);assert.equal(completed,12);assert.equal(rejected,8);assert.equal(second.scheduler.closed,true);assert.equal(second.scheduler.state().windowRequests,32);
 assert.match(second.scheduler.reason,/한도/);assert.equal(first.scheduler.closed,true);
});

test('overlapping map layers cannot each spend a separate budget for the same tile origin',async t=>{
 let calls=0;const make=layers(t,'https://budget-overlap.test',async()=>{calls++;await Promise.resolve();return ok();});
 const [a,b]=[make('north'),make('south')];
 const settled=await Promise.allSettled(Array.from({length:40},(_,i)=>(i%2?a:b).scheduler.request('https://budget-overlap.test/'+i)));
 assert.equal(calls,32);assert.equal(a.scheduler.requests+b.scheduler.requests,32);assert.ok(settled.some(x=>x.status==='rejected'));
 assert.equal(a.scheduler.state().windowRequests,32);assert.equal(b.scheduler.state().windowRequests,32);
 a.layer.onRemove({});b.layer.onRemove({});
});

test('an explicitly configured other origin has its own budget and default HTTP cache remains enabled',async t=>{
 let calls=0;const make=layers(t,'https://budget-origin-a.test',async(_url,options)=>{calls++;assert.equal(options.cache,'default');assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'strict-origin-when-cross-origin');return ok();});
 const a=make();for(let i=0;i<32;i++)await a.scheduler.request('https://budget-origin-a.test/'+i);
 a.layer.onRemove({});
 const b=createOnlineLayer({GridLayer},{name:'Explicit other provider',url:'https://budget-origin-b.test/{z}/{x}/{y}.png',attribution:'Synthetic'},()=>{});
 await b.scheduler.request('https://budget-origin-b.test/one');assert.equal(calls,33);assert.equal(b.scheduler.closed,false);assert.equal(b.scheduler.state().windowRequests,1);
 b.layer.onRemove({});
});

test('rolling expiry retains newer attempts and permits only manual requests in a new layer',async()=>{
 let now=0,calls=0;const requestWindow=new TileRequestWindow(),create=()=>new TileScheduler({requestWindow,clock:()=>now,fetcher:async()=>{calls++;return ok();}});
 const a=create();for(let i=0;i<10;i++)await a.request('https://expiry.test/early/'+i);
 now=10000;for(let i=0;i<22;i++)await a.request('https://expiry.test/later/'+i);a.stop();
 now=59999;const blocked=create();await assert.rejects(blocked.request('https://expiry.test/too-soon'),/한도/);assert.equal(calls,32);
 now=60000;await Promise.resolve();assert.equal(calls,32);assert.equal(blocked.closed,true);
 const manual=create();for(let i=0;i<10;i++)await manual.request('https://expiry.test/manual/'+i);
 await assert.rejects(manual.request('https://expiry.test/no-extra'),/한도/);assert.equal(calls,42);assert.equal(manual.state().windowRequests,32);
 now=70000;const later=create();await later.request('https://expiry.test/after-newer-expire');assert.equal(calls,43);assert.equal(later.state().windowRequests,11);later.stop();
});

test('503 retries spend the shared attempt budget and a replacement layer cannot reset it',async()=>{
 let calls=0;const delays=[],requestWindow=new TileRequestWindow(),create=fetcher=>new TileScheduler({requestWindow,minuteBudget:4,fetcher,clock:()=>0,sleep:async ms=>delays.push(ms)});
 const a=create(async()=>{calls++;return calls===1?new Response('synthetic503',{status:503}):ok();});await a.request('https://retry.test/one');a.stop();
 const b=create(async()=>{calls++;return new Response('synthetic503',{status:503});});
 await assert.rejects(b.request('https://retry.test/two'),/한도/);assert.equal(calls,4);assert.equal(b.requests,2);assert.equal(b.state().windowRequests,4);assert.deepEqual(delays,[800,800,1600]);
});

test('deduplicated and canceled queued tiles do not spend attempts, while sent aborts are retained',async()=>{
 let calls=0;const requestWindow=new TileRequestWindow(),a=new TileScheduler({requestWindow,concurrency:1,minuteBudget:2,clock:()=>0,fetcher:(_url,{signal})=>{calls++;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));}});
 const active=a.request('https://cancel.test/active'),duplicate=a.request('https://cancel.test/active');assert.equal(active,duplicate);
 const queued=a.request('https://cancel.test/queued'),settled=Promise.allSettled([active,queued]);assert.equal(a.cancelQueued('https://cancel.test/queued'),true);a.stop('Removed map');assert.ok((await settled).every(x=>x.status==='rejected'));assert.equal(calls,1);
 const b=new TileScheduler({requestWindow,minuteBudget:2,clock:()=>0,fetcher:async()=>{calls++;return ok();}});await b.request('https://cancel.test/new');await assert.rejects(b.request('https://cancel.test/blocked'),/한도/);assert.equal(calls,2);
});

test('a per-view ceiling does not consume a shared slot when no fetch starts',async()=>{
 let calls=0;const requestWindow=new TileRequestWindow(),a=new TileScheduler({requestWindow,budget:1,clock:()=>0,fetcher:async()=>{calls++;return ok();}});
 await a.request('https://view.test/one');await assert.rejects(a.request('https://view.test/blocked'),/한도/);assert.equal(calls,1);assert.equal(a.state().windowRequests,1);
 const b=new TileScheduler({requestWindow,clock:()=>0,fetcher:async()=>{calls++;return ok();}});await b.request('https://view.test/new');assert.equal(calls,2);assert.equal(b.state().windowRequests,2);b.stop();
});
