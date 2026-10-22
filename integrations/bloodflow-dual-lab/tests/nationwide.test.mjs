import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {DualWorld} from '../src/engine.mjs';import {routeFor,allowedSource} from '../src/geography.mjs';import {runExperiment,statistics,resultRows} from '../src/experiments.mjs';import {viewOf} from '../src/view.mjs';
const data=Object.fromEntries(['facilities','routes','nationwide'].map(k=>[k,JSON.parse(fs.readFileSync(new URL('../public/data/'+k+'.json',import.meta.url)))]));
test('100-node geography keeps 96 synthetic nodes and original four facilities with all12 directed road caches',()=>{
 assert.equal(data.nationwide.regions.length,17);assert.equal(data.nationwide.facilities.length,100);assert.equal(data.nationwide.facilities.filter(n=>n.virtual).length,96);
 for(const old of data.facilities){const n=data.nationwide.facilities[data.nationwide.realFacilityMap[old.id]];for(const key of ['name','lat','lon','addr','officialSource'])assert.deepEqual(n[key],old[key]);}
 for(const [key,r] of Object.entries(data.routes.routes)){const [a,b]=key.split('>').map(Number),route=routeFor(data,data.nationwide.facilities[data.nationwide.realFacilityMap[a]],data.nationwide.facilities[data.nationwide.realFacilityMap[b]],'nationwide');assert.equal(route.estimated,false);assert.equal(route.hours,r.durationSeconds/3600);assert.deepEqual(route.geometry,r.geometry);}
 assert.equal(routeFor(data,data.nationwide.facilities[0],data.nationwide.facilities[1],'nationwide').estimated,true);
});
test('national inventory, regional denominators and transit are conserved for all three supply policies',()=>{
 for(const redistribution of ['A','B','C']){const w=new DualWorld({network:'nationwide',redistribution},data);for(let h=1;h<=168;h+=5){w.advance(h);assert.equal(w.verify().passed,true);}
 const s=w.summary(),r=w.regionalSummary();assert.equal(r.reduce((a,r)=>a+r.unmet,0),s.unmet);assert.equal(r.reduce((a,r)=>a+r.requested,0),s.requested);assert.equal(r.reduce((a,r)=>a+r.expired,0),s.expired);assert.equal(r.reduce((a,r)=>a+r.created,0),s.created);
 assert.equal(r.reduce((a,r)=>a+r.imported,0),s.regionalTransfers);assert.equal(r.reduce((a,r)=>a+r.exported,0),s.regionalTransfers);
 for(const [flow] of Object.entries(w.flowTotals)){const [from,to]=flow.split('>');assert.equal(allowedSource({regionId:from},{regionId:to},redistribution,w.c.regions),true);}
 if(redistribution==='A')assert.equal(s.regionalTransfers,0);else assert.ok(s.regionalTransfers>0);
 const active=[...w.units.values()];assert.ok(active.every(u=>['ready','truck','review','queue'].includes(u.status)));assert.equal(active.length+w.archivedCount,s.created);
 }
});
test('national checkpoint restores compacted units, future events and transport without changing results',()=>{
 const a=new DualWorld({network:'nationwide',redistribution:'C'},data);a.advance(24*8);const snapshot=JSON.parse(JSON.stringify(a.snapshot())),b=DualWorld.restore(snapshot);a.advance(24*10);b.advance(24*10);assert.deepEqual(a.summary(),b.summary());assert.deepEqual(a.regionalSummary(),b.regionalSummary());
 assert.ok(JSON.stringify(viewOf(a)).length<8*1024*1024);assert.ok(a.activeUnits().every(u=>u.trace.length<=16));
});
test('three national policy arms share exogenous requests and statistics include a valid C minus A interval',()=>{
 const r=runExperiment({network:'nationwide'},data,{experiment:'N',days:3,repeats:2,seed:123});
 for(const p of r.pairs){assert.equal(p.control.requested,p.treatment.requested);assert.equal(p.control.demandFingerprint,p.integrated.demandFingerprint);assert.equal(p.control.demandFingerprint,p.treatment.demandFingerprint);assert.equal(p.control.created,p.integrated.created);assert.equal(p.regions.A.length,17);}
 assert.deepEqual(r.metrics.shortageRate.integratedDifference,statistics(r.pairs.map(p=>p.integrated.shortageRate-p.control.shortageRate)));assert.equal(resultRows(r).length,6);assert.equal(r.config.network,'nationwide');
 const again=runExperiment({network:'nationwide'},data,{experiment:'N',days:3,repeats:2,seed:123});assert.deepEqual(r.pairs,again.pairs);
});
test('duplicate cargo IDs cannot create a shipment or duplicate stock',()=>{
 const w=new DualWorld({network:'nationwide'},data),n=w.nodes.slice(0,w.nc).find(n=>n.stock.length),h=w.nodes[w.nc],id=n.stock[0];const trips=w.metrics.shipments;assert.equal(w.dispatch(n,h,[id,id]),false);assert.equal(w.metrics.shipments,trips);assert.equal(w.verify().passed,true);
});
test('authoritative restore rejects tampered regions, coordinates, counters, UID and future truck events',()=>{
 const w=new DualWorld({network:'nationwide',redistribution:'C'},data);w.advance(24);const base=JSON.parse(JSON.stringify(w.snapshot()));
 const cases=[s=>s.nodes[0].regionId='bogus',s=>s.nodes[0].lat=1,s=>{s.nodes[0].lat=1;s.c.realNodes[0].lat=1;},s=>s.metrics.requested++,s=>s.uid=1,s=>s.trucks[0].capacity=Infinity,s=>s.events.arr.push({at:s.t+1,type:'arrival',info:{truck:999},seq:999999})];
 for(const mutate of cases){const s=structuredClone(base);mutate(s);assert.throws(()=>DualWorld.restore(s,data));}
 assert.equal(w.verify().passed,true);
});
