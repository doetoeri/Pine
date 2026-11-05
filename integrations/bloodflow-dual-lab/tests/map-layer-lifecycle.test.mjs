import test from 'node:test';
import assert from 'node:assert/strict';
import {createOnlineLayer} from '../src/map-layer.mjs';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
const waitFor=async predicate=>{const start=Date.now();while(!predicate()){if(Date.now()-start>2000)throw Error('Tile fixture did not settle');await new Promise(resolve=>setTimeout(resolve,1));}};
class GridLayer{
 constructor(){this.events=new Map();}
 on(name,listener){this.events.set(name,listener);}
 onRemove(){}
 static extend(methods){class Layer extends GridLayer{}Object.assign(Layer.prototype,methods);return Layer;}
}
function setup(t,name,fetcher,onState=()=>{}){
 const keys=['fetch','document','location'],old=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const created=[],revoked=[],methods=new Map(['createObjectURL','revokeObjectURL'].map(k=>[k,Object.getOwnPropertyDescriptor(URL,k)]));
 Object.assign(globalThis,{fetch:fetcher,location:{href:'https://app.test/bloodflow/'},document:{createElement:()=>({dataset:{},isConnected:true,setAttribute(){}})}});
 URL.createObjectURL=()=>{const url='blob:qa-'+created.length;created.push(url);return url;};URL.revokeObjectURL=url=>revoked.push(url);
 t.after(()=>{for(const [k,d] of old)if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];for(const [k,d] of methods)Object.defineProperty(URL,k,d);});
 const adapter=createOnlineLayer({GridLayer},{name,url:'https://'+name+'.test/{z}/{x}/{y}.png',attribution:'Synthetic'},onState);
 return {...adapter,created,revoked};
}
const ok=()=>new Response(new Blob(['synthetic image'],{type:'image/png'}));

test('an exhausted window reports closure after the Leaflet adding stack and suppresses removed tile completion',async t=>{
 let adding=false,notifications=0,callbacks=0,adapter;
 adapter=setup(t,'lifecycle-exhaust',async()=>ok(),state=>{assert.equal(adding,false);if(state.closed){notifications++;adapter.layer.onRemove({});}});
 for(let i=0;i<32;i++)assert.equal(adapter.scheduler.requestWindow.take(Date.now(),32),true);
 adding=true;adapter.layer.createTile({z:1,x:1,y:1},()=>callbacks++);assert.equal(notifications,0);adding=false;
 await flush();assert.equal(notifications,1);assert.equal(callbacks,0);assert.equal(adapter.scheduler.requests,0);assert.equal(adapter.created.length,0);
});

test('a response arriving after layer removal neither creates a blob URL nor calls Leaflet done',async t=>{
 let resolve,callbacks=0;const adapter=setup(t,'lifecycle-late',()=>new Promise(r=>resolve=r));
 adapter.layer.createTile({z:1,x:1,y:1},()=>callbacks++);adapter.layer.onRemove({});resolve(ok());await waitFor(()=>adapter.scheduler.pending.size===0);
 assert.equal(callbacks,0);assert.equal(adapter.created.length,0);assert.equal(adapter.scheduler.pending.size,0);
});

test('unloaded images suppress queued load/error callbacks and release their blob URLs',async t=>{
 let callbacks=0;const adapter=setup(t,'lifecycle-unload',async()=>ok());
 const image=adapter.layer.createTile({z:1,x:1,y:1},()=>callbacks++);await waitFor(()=>typeof image.onload==='function');const lateLoad=image.onload,lateError=image.onerror;
 assert.equal(adapter.created.length,1);image.isConnected=false;adapter.layer.events.get('tileunload')({tile:image});
 assert.equal(image.onload,null);assert.equal(image.onerror,null);lateLoad();lateError();adapter.layer.onRemove({});
 assert.equal(callbacks,0);assert.deepEqual(adapter.revoked,adapter.created);
});

test('a connected image completes normally once and a queued callback after removal is ignored',async t=>{
 const completed=[];const adapter=setup(t,'lifecycle-normal',async()=>ok());
 const image=adapter.layer.createTile({z:1,x:1,y:1},(...args)=>completed.push(args));await waitFor(()=>typeof image.onload==='function');const load=image.onload,error=image.onerror;
 load();error();assert.equal(completed.length,1);assert.deepEqual(completed[0],[null,image]);assert.equal(image.onload,null);adapter.layer.onRemove({});load();assert.equal(completed.length,1);assert.deepEqual(adapter.revoked,adapter.created);
});
