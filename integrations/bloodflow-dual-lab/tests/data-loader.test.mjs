import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';
import {ResearchDataLoader,ResearchDataError} from '../src/data-loader.mjs';import {DualWorld} from '../src/engine.mjs';
const files=['facilities.json','routes.json','nationwide.json','roads.geojson','regions.geojson'];
const values=Object.fromEntries(files.map(file=>[file,JSON.parse(fs.readFileSync(new URL('../public/data/'+file,import.meta.url)))]));
const fixture=url=>values[url.split('/').at(-1)];

test('valid static data is loaded once and successful files are reused',async()=>{
 const calls=[];const loader=new ResearchDataLoader({fetchImpl:async(url,options)=>{calls.push(url);assert.ok(options.signal instanceof AbortSignal);return Response.json(fixture(url));}});
 const first=await loader.load(),second=await loader.load();assert.equal(calls.length,5);assert.deepEqual(first.issues,[]);assert.deepEqual(second.data,first.data);
 assert.equal(first.data.facilities.length,4);assert.equal(Object.keys(first.data.routes.routes).length,12);assert.equal(first.data.nationwide.facilities.length,100);
});

test('503 and network failures in background geometry preserve the exact simulation and real routes',async()=>{
 const loader=new ResearchDataLoader({fetchImpl:async url=>{if(url.endsWith('roads.geojson'))return new Response('unavailable',{status:503});if(url.endsWith('regions.geojson'))throw TypeError('offline');return Response.json(fixture(url));}});
 const {data,issues}=await loader.load();assert.equal(issues.length,2);assert.equal(issues[0].status,503);assert.equal(issues[1].status,null);assert.ok(issues.every(x=>!x.required));
 assert.deepEqual(data.roads,{type:'FeatureCollection',features:[]});assert.deepEqual(data.regions,{type:'FeatureCollection',features:[]});assert.deepEqual(data.routes,values['routes.json']);
 const baseline={...data,roads:values['roads.geojson'],regions:values['regions.geojson']};
 for(const network of ['incheon','nationwide']){
  const actual=new DualWorld({network,seed:1234},data),control=new DualWorld({network,seed:1234},baseline);actual.advance(24);control.advance(24);
  assert.deepEqual(actual.snapshot(),control.snapshot());assert.equal(actual.verify().passed,true);
 }
});

test('required route failures stop initialization and a shared manual retry requests only the failed file',async()=>{
 const calls=new Map();let available=false;
 const loader=new ResearchDataLoader({fetchImpl:async url=>{const file=url.split('/').at(-1);calls.set(file,(calls.get(file)??0)+1);return file==='routes.json'&&!available?new Response('unavailable',{status:503}):Response.json(fixture(url));}});
 await assert.rejects(loader.load(),e=>e instanceof ResearchDataError&&e.message.includes('routes.json (HTTP 503)'));
 assert.equal(calls.get('routes.json'),1);available=true;
 const results=await Promise.all([loader.load(),loader.load(),loader.load()]);assert.ok(results.every(x=>!x.issues.length));assert.equal(calls.get('routes.json'),2);
 for(const file of files.filter(x=>x!=='routes.json'))assert.equal(calls.get(file),1);
});

test('a missing required response is aborted and names the file without automatic retries',async()=>{
 let attempts=0,aborted=false;
 const loader=new ResearchDataLoader({timeoutMs:20,fetchImpl:(url,{signal})=>{if(!url.endsWith('facilities.json'))return Promise.resolve(Response.json(fixture(url)));attempts++;return new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'));},{once:true}));}});
 await assert.rejects(loader.load(),/facilities.json \(응답 대기 시간 초과\)/);assert.equal(attempts,1);assert.equal(aborted,true);
});

test('the deadline includes a real HTTP geometry response body that never finishes',async t=>{
 let attempts=0;
 const server=http.createServer((req,res)=>{if(req.url==='/warmup'){res.end('ready');return;}const value=fixture(req.url);res.writeHead(200,{'Content-Type':'application/json'});if(req.url.endsWith('roads.geojson')){attempts++;res.flushHeaders();res.write('{"type":');}else res.end(JSON.stringify(value));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});const origin='http://127.0.0.1:'+server.address().port;
 await (await fetch(origin+'/warmup')).text();const loader=new ResearchDataLoader({timeoutMs:650,fetchImpl:(url,options)=>fetch(origin+url,options)});
 const {data,issues}=await loader.load();assert.equal(attempts,1);assert.equal(issues.length,1);assert.equal(issues[0].file,'roads.geojson');assert.equal(issues[0].status,200);assert.equal(issues[0].error,'응답 대기 시간 초과');assert.deepEqual(data.roads.features,[]);
});

test('HTML fallback pages and wrong GeoJSON structures produce explicit map data warnings',async()=>{
 const loader=new ResearchDataLoader({fetchImpl:async url=>url.endsWith('roads.geojson')?new Response('<html>fallback</html>',{headers:{'Content-Type':'text/html'}}):url.endsWith('regions.geojson')?Response.json({type:'not-a-map'}):Response.json(fixture(url))});
 const {issues}=await loader.load();assert.deepEqual(issues.map(x=>[x.file,x.error]),[['roads.geojson','JSON 자료를 읽을 수 없음'],['regions.geojson','자료 구조 확인 필요']]);
});

test('missing or incompatible required datasets are never replaced with an estimated supply model',async()=>{
 for(const missing of ['facilities.json','routes.json','nationwide.json']){
  const loader=new ResearchDataLoader({fetchImpl:async url=>Response.json(url.endsWith(missing)?{}:fixture(url))});
  await assert.rejects(loader.load(),e=>e instanceof ResearchDataError&&e.issues.some(x=>x.required&&x.file===missing));
 }
});

test('the bundled standalone datasets initialize without any network request',async()=>{
 const embeddedData=Object.fromEntries(files.map(file=>[file.split('.')[0],values[file]]));
 const loader=new ResearchDataLoader({embeddedData,fetchImpl:()=>{assert.fail('Standalone data must not trigger HTTP requests.');}});
 const {data,issues}=await loader.load();assert.deepEqual(issues,[]);assert.equal(data.routes,embeddedData.routes);assert.equal(data.roads,embeddedData.roads);
});
