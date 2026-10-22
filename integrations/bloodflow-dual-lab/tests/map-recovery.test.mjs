import test from 'node:test';import assert from 'node:assert/strict';import {TileScheduler} from '../src/map-requests.mjs';
const ok=()=>new Response(new Blob(['image-bytes'],{type:'image/png'}),{status:200,headers:{'cache-control':'max-age=604800'}});
test('a503 tile retries with exponential backoff then recovers and preserves actual response metadata',async()=>{
 const delays=[];let calls=0;const s=new TileScheduler({fetcher:async()=>++calls===1?new Response('Unavailable',{status:503}):ok(),sleep:async ms=>delays.push(ms)});
 const blob=await s.request('https://tile.test/one');assert.equal(blob.type,'image/png');assert.equal(calls,2);assert.deepEqual(delays,[800]);assert.equal(s.retries,1);assert.deepEqual(s.records.map(x=>x.status),[503,200]);assert.equal(s.closed,false);assert.equal(s.records[1].headers['cache-control'],'max-age=604800');
});
test('persistent503 opens the circuit after three requests and never polls the failed server indefinitely',async()=>{
 const delays=[];const s=new TileScheduler({fetcher:async()=>new Response('Down',{status:503}),sleep:async ms=>delays.push(ms)});
 await assert.rejects(s.request('https://tile.test/down'));assert.equal(s.closed,true);assert.equal(s.requests,3);assert.deepEqual(delays,[800,1600]);await assert.rejects(s.request('https://tile.test/another'));assert.equal(s.requests,3);
});
test('provider429 is never retried or bypassed; network error does not get mislabelled503',async()=>{
 const s=new TileScheduler({fetcher:async()=>new Response('',{status:429})});await assert.rejects(s.request('https://tile.test/limited'));assert.equal(s.requests,1);assert.equal(s.closed,true);
 const t=new TileScheduler({fetcher:async()=>{throw TypeError('Failed to fetch');},sleep:async()=>{}});await assert.rejects(t.request('https://tile.test/offline'));assert.ok(t.records.every(r=>r.status===null));assert.equal(t.requests,3);
});
test('same request is deduplicated, queue concurrency bounded and offscreen queued tiles cancelled',async()=>{
 let inFlight=0,peak=0;const gates=[];const s=new TileScheduler({concurrency:2,fetcher:()=>{inFlight++;peak=Math.max(peak,inFlight);return new Promise(resolve=>gates.push(()=>{inFlight--;resolve(ok());}));}});
 const a=s.request('https://tile.test/1'),duplicate=s.request('https://tile.test/1');assert.equal(a,duplicate);const b=s.request('https://tile.test/2'),c=s.request('https://tile.test/3');const rejected=assert.rejects(c);assert.equal(s.cancelQueued('https://tile.test/3'),true);gates.splice(0).forEach(f=>f());await Promise.all([a,b,rejected]);assert.equal(s.requests,2);assert.equal(peak,2);
});
test('view budget and a server disconnect abort requests without starting more queued work',async()=>{
 const s=new TileScheduler({budget:2,fetcher:async()=>ok()});await s.request('https://tile.test/1');await s.request('https://tile.test/2');await assert.rejects(s.request('https://tile.test/3'));assert.equal(s.requests,2);
 const t=new TileScheduler({concurrency:1,fetcher:(_url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))))});
 const pending=Promise.allSettled([t.request('https://tile.test/a'),t.request('https://tile.test/b')]);t.stop('network disconnected');assert.ok((await pending).every(x=>x.status==='rejected'));assert.equal(t.requests,1);
});
