import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';
import {ResearchDataLoader,waitForDataRetry} from '../src/data-loader.mjs';
const files=['facilities.json','routes.json','nationwide.json','roads.geojson','regions.geojson'];
const values=Object.fromEntries(files.map(file=>[file,JSON.parse(fs.readFileSync(new URL('../public/data/'+file,import.meta.url)))]));
const fixture=url=>values[url.split('/').at(-1)];
const context={protocol:'https:',origin:'https://lab.example/path?token=private#room',online:true};

test('required HTTP failures retain selected headers without response bodies or sensitive headers',async()=>{
 const loader=new ResearchDataLoader({fetchImpl:async url=>url.endsWith('routes.json')?new Response('private body',{status:503,headers:{'Content-Type':'text/html','Cache-Control':'max-age=600','Retry-After':'30',Server:'fixture','X-Cache':'MISS','Set-Cookie':'session=private','Authorization':'private','X-Other':'private',ETag:'x'.repeat(900)}}):Response.json(fixture(url))});
 await assert.rejects(loader.load(),/routes.json \(HTTP 503\)/);const report=loader.diagnostics({...context,room:'private',notes:'private'}),r=report.requests.find(x=>x.file==='routes.json');
 assert.equal(r.url,'/bloodflow/data/routes.json');assert.equal(r.status,503);assert.equal(r.source,'http');assert.equal(r.headersReadable,true);assert.equal(r.headers['retry-after'],'30');assert.equal(r.headers['cache-control'],'max-age=600');assert.equal(r.headers.etag.length,512);assert.equal(r.headers.server,'fixture');assert.equal(report.context.origin,'https://lab.example');
 assert.equal(JSON.stringify(report).includes('private'),false);assert.equal(report.requests.length,5);
});

test('network, opaque response and body failures distinguish unknown status from HTTP 200',async()=>{
 for(const [response,status,error] of [[()=>{throw TypeError('private network detail');},null,/네트워크\/CORS/],[()=>Response.error(),null,/상태 확인 불가/],[()=>new Response('<html>private body</html>',{headers:{'Content-Type':'text/html'}}),200,/JSON 자료/]]){
  const loader=new ResearchDataLoader({fetchImpl:async url=>url.endsWith('routes.json')?response():Response.json(fixture(url))});await assert.rejects(loader.load());
  const r=loader.diagnostics().requests.find(x=>x.file==='routes.json');assert.equal(r.status,status);assert.match(r.error,error);assert.equal(JSON.stringify(r).includes('private'),false);
 }
});

test('a body timeout retains received HTTP metadata and aborts without automatic retry',async()=>{
 let count=0,aborted=false;const loader=new ResearchDataLoader({timeoutMs:20,fetchImpl:async(url,{signal})=>{if(!url.endsWith('routes.json'))return Response.json(fixture(url));count++;signal.addEventListener('abort',()=>aborted=true);return {ok:true,status:200,type:'basic',url:'https://lab.example/data/route?token=private#room',headers:new Headers({'Content-Type':'application/json',Age:'12'}),json:()=>new Promise(()=>{})};}});
 await assert.rejects(loader.load(),/대기 시간 초과/);const r=loader.diagnostics().requests.find(x=>x.file==='routes.json');assert.equal(count,1);assert.equal(aborted,true);assert.equal(r.status,200);assert.equal(r.headers.age,'12');assert.equal(r.responseUrl,'https://lab.example/data/route');assert.match(r.error,/대기 시간 초과/);
});

test('unavailable headers do not prevent valid data, while report snapshots are detached and bounded',async()=>{
 const loader=new ResearchDataLoader({fetchImpl:async url=>({ok:true,status:200,type:'cors',url:'https://user:private@cdn.example/file?token=private#fragment',headers:{get(){throw Error('not exposed');}},json:async()=>fixture(url)})});await loader.load();
 const report=loader.diagnostics(context);assert.ok(report.requests.every(x=>x.headersReadable===false&&x.responseUrl==='https://cdn.example/file'));assert.equal(JSON.stringify(report).includes('private'),false);
 report.requests[0].headers.fake='detached';report.requests.pop();assert.equal(loader.records.length,5);assert.deepEqual(loader.records[0].headers,{});
 for(let i=0;i<40;i++)loader.record({...loader.records[0],at:String(i)});assert.equal(loader.records.length,30);assert.equal(report.requests.length,4);
});

test('embedded diagnostics identify local data without inventing HTTP requests or reading the study',async()=>{
 const embeddedData=Object.fromEntries(files.map(file=>[file.split('.')[0],values[file]]));embeddedData.notes={engineering:'private'};
 const loader=new ResearchDataLoader({embeddedData,fetchImpl:()=>assert.fail('No embedded request')});await loader.load();const report=loader.diagnostics({protocol:'file:',origin:'null',online:false});
 assert.equal(report.context.origin,null);assert.equal(report.context.protocol,'file:');assert.equal(report.context.online,false);assert.ok(report.requests.every(x=>x.source==='embedded'&&x.status===null&&x.responseUrl===null&&!x.headersReadable));assert.equal(JSON.stringify(report).includes('private'),false);
});

function domFixture(){
 class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.style={};this.attributes={};this._text='';}
  append(...children){this.children.push(...children);}replaceChildren(...children){this.children=children;this._text='';}setAttribute(k,v){this.attributes[k]=v;}
  set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(x=>x.textContent).join('');}
  set innerHTML(_){assert.fail('Use text nodes for diagnostic/error details.');}
 }
 const host=new Element('main'),find=(el,id)=>el.id===id?el:el.children.map(x=>find(x,id)).find(Boolean),document={createElement:tag=>new Element(tag),getElementById:id=>find(host,id)};return {host,document};
}

test('initialization recovery shows/export diagnostics as text and waits for one explicit retry',async()=>{
 const f=domFixture(),loader=new ResearchDataLoader({embeddedData:{}});await assert.rejects(loader.load());let resumed=0;const downloads=[],error=new Error('routes.json <img src=x onerror=alert(1)>');
 const pending=waitForDataRetry({...f,loader,error,context,download:(name,text)=>downloads.push({name,text})}).then(()=>resumed++);
 assert.equal(resumed,0);assert.equal(downloads.length,0);assert.match(f.host.textContent,/<img src=x/);assert.equal(f.host.children[0].attributes.role,'alert');
 const report=JSON.parse(f.document.getElementById('data-load-diagnostics').textContent);assert.equal(report.schema,'BLOODFLOW-DATA-DIAGNOSTICS-1');assert.equal(report.requests.length,5);
 f.document.getElementById('data-log-export').onclick();assert.equal(downloads.length,1);assert.equal(downloads[0].name,'BLOODFLOW_data_diagnostics.json');assert.deepEqual(JSON.parse(downloads[0].text).requests,report.requests);assert.match(f.document.getElementById('data-log-status').textContent,/저장을 요청/);assert.equal(resumed,0);
 const retry=f.document.getElementById('retry-data');retry.onclick();retry.onclick();await pending;assert.equal(resumed,1);assert.equal(retry.disabled,true);
});

test('a diagnostic file creation error leaves visible records and manual data recovery available',async()=>{
 const f=domFixture(),loader=new ResearchDataLoader({embeddedData:{}});await assert.rejects(loader.load());const pending=waitForDataRetry({...f,loader,error:new Error('Missing data'),download(){throw Error('Synthetic Blob failure');}});
 f.document.getElementById('data-log-export').onclick();assert.match(f.document.getElementById('data-log-status').textContent,/파일을 만들지 못/);assert.ok(f.document.getElementById('data-load-diagnostics').textContent);assert.equal(f.document.getElementById('retry-data').disabled,undefined);f.document.getElementById('retry-data').onclick();await pending;
});

test('real HTTP 503 diagnostics survive recovery and only the failed dataset is requested again',async t=>{
 let available=false;const calls=new Map(),server=http.createServer((req,res)=>{const name=req.url.split('/').at(-1);calls.set(name,(calls.get(name)??0)+1);res.setHeader('Cache-Control','max-age=600');res.setHeader('X-Cache','fixture');res.setHeader('Set-Cookie','private');if(name==='routes.json'&&!available){res.writeHead(503,{'Content-Type':'text/plain','Retry-After':'5'});res.end('private body');}else{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(values[name]));}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});const origin='http://127.0.0.1:'+server.address().port,loader=new ResearchDataLoader({fetchImpl:(url,options)=>fetch(origin+url,options)});
 await assert.rejects(loader.load(),/HTTP 503/);const failed=loader.diagnostics(),r=failed.requests.find(x=>x.file==='routes.json');assert.equal(r.responseUrl,origin+'/bloodflow/data/routes.json');assert.equal(r.responseType,'basic');assert.equal(r.headers['retry-after'],'5');assert.equal(JSON.stringify(failed).includes('private'),false);
 available=true;const [a,b]=await Promise.all([loader.load(),loader.load()]);assert.equal(a.data.routes,b.data.routes);assert.deepEqual(a.issues,[]);assert.equal(loader.records.length,6);assert.deepEqual(loader.records.filter(x=>x.file==='routes.json').map(x=>x.status),[503,200]);assert.equal(failed.requests.length,5);assert.equal(calls.get('routes.json'),2);for(const name of files.filter(x=>x!=='routes.json'))assert.equal(calls.get(name),1);
});
