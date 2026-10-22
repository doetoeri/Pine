import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {Rooms} from './rooms.mjs';
const require=createRequire(import.meta.url),{WebSocketServer}=require('../vendor/ws/index.js');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const data={facilities:JSON.parse(fs.readFileSync(path.join(root,'public/data/facilities.json'))),routes:JSON.parse(fs.readFileSync(path.join(root,'public/data/routes.json'))),nationwide:JSON.parse(fs.readFileSync(path.join(root,'public/data/nationwide.json')))};
const portIndex=process.argv.indexOf('--port'),port=Number(portIndex>=0?process.argv[portIndex+1]:process.env.PORT||8787),host=process.env.HOST||'0.0.0.0';
const rooms=new Rooms(data,process.env.BLOODFLOW_DATA||path.join(root,'data'));
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.geojson':'application/geo+json; charset=utf-8','.svg':'image/svg+xml'};
const allowedOrigins=new Set((process.env.BLOODFLOW_ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean));
function originAllowed(origin,req){if(!origin)return true;try{const u=new URL(origin);return origin===u.origin&&['http:','https:'].includes(u.protocol)&&(u.host===req.headers.host||allowedOrigins.has(u.origin));}catch{return false;}}
const json=(res,status,obj)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj));};
const fixtureHits=new Map(),qaEnabled=process.argv.includes('--qa')||process.env.BLOODFLOW_QA==='1'||process.env.SITES_MANAGED_LINUX_CONTAINER==='1';
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
 if(!url.pathname.startsWith('/bloodflow')){res.writeHead(404);res.end('BLOODFLOW serves /bloodflow only. Existing PinCon routes belong to the existing host.');return;}
 if(!originAllowed(req.headers.origin,req)){json(res,403,{error:'허용되지 않은 출처입니다.'});return;}
 if(req.headers.origin){res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');}
 if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'});res.end();return;}
 if(qaEnabled&&req.method==='GET'&&/^\/bloodflow\/qa\/tiles\/[0-9]+\/[0-9]+\/[0-9]+\.svg$/.test(url.pathname)){
  const key=url.searchParams.get('run')??'default',count=(fixtureHits.get(key)??0)+1;fixtureHits.set(key,count);if(fixtureHits.size>80)fixtureHits.delete(fixtureHits.keys().next().value);
  const down=url.searchParams.get('case')==='down'||count===1;res.writeHead(down?503:200,{'Content-Type':down?'text/plain':'image/svg+xml','Cache-Control':'no-store','X-Bloodflow-Fixture':'synthetic-'+(down?'503':'200')});
  res.end(down?'BLOODFLOW QA synthetic 503; not a public map server.':'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e6efeb"/><path d="M0 128H256M128 0V256" stroke="#bccdc6"/><text x="10" y="24" font-size="14">QA · synthetic tile 200</text></svg>');return;
 }
 if(req.method==='GET'&&url.pathname==='/bloodflow/api/health'){json(res,200,{app:'BLOODFLOW Dual Lab',version:'2.0.0',websocket:true});return;}
 if(req.method==='POST'&&url.pathname==='/bloodflow/api/rooms'){
  if(!originAllowed(req.headers.origin,req)){json(res,403,{error:'다른 출처의 생성 요청은 허용하지 않습니다.'});return;}
  try{let text='';for await(const chunk of req){text+=chunk;if(text.length>4096)throw Error('요청이 너무 큽니다.');}const body=text?JSON.parse(text):{};const r=rooms.create(body.config??{});json(res,201,{experimentId:r.code,tokens:r.tokens});}catch(e){json(res,400,{error:e.message});}return;
 }
 if(req.method!=='GET'){json(res,405,{error:'method not allowed'});return;}
 let file;
 if(/^\/bloodflow\/?$|^\/bloodflow\/(nationwide|engineering|biology|research)\/?$/.test(url.pathname))file=path.join(root,'public/index.html');
 else if(url.pathname.startsWith('/bloodflow/modules/'))file=path.join(root,'src',url.pathname.slice('/bloodflow/modules/'.length));
 else file=path.join(root,'public',url.pathname.slice('/bloodflow/'.length));
 const allowed=[path.join(root,'public')+path.sep,path.join(root,'src')+path.sep];
 if(!allowed.some(p=>file.startsWith(p))||file.includes('\0')||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end('Not found');return;}
 if(url.pathname.endsWith('sw.js'))res.setHeader('Service-Worker-Allowed','/bloodflow/');
 res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-cache');fs.createReadStream(file).pipe(res);
});
const wss=new WebSocketServer({noServer:true,maxPayload:24*1024*1024});
server.on('upgrade',(req,socket,head)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname!=='/bloodflow/ws'||!originAllowed(req.headers.origin,req)){socket.destroy();return;}
 wss.handleUpgrade(req,socket,head,s=>wss.emit('connection',s));
});
wss.on('connection',socket=>{
 socket.isAlive=true;socket.on('pong',()=>{socket.isAlive=true;});
 let peer=null;const timer=setTimeout(()=>{if(!peer)socket.close(1008,'join required');},10000);
 socket.on('message',raw=>{let m;try{m=JSON.parse(raw);if(peer&&m.type==='heartbeat'){socket.send(JSON.stringify({type:'heartbeat',timestamp:Date.now()}));return;}if(!peer){if(m.type!=='join')throw Error('먼저 실험실에 접속하세요.');peer=rooms.join(socket,String(m.experimentId||'').toUpperCase(),m.role,m.token);clearTimeout(timer);}else rooms.command(peer,m);}catch(e){socket.send(JSON.stringify({type:'error',eventId:m?.eventId,error:e.message}));}});
 socket.on('close',()=>{clearTimeout(timer);rooms.leave(peer);});
});
const heartbeat=setInterval(()=>{for(const s of wss.clients){if(!s.isAlive){s.terminate();continue;}s.isAlive=false;s.ping();}},8000);
const interval=setInterval(()=>rooms.tick(1),1000),saveInterval=setInterval(()=>{for(const r of rooms.rooms.values())rooms.persist(r);},15000);
server.listen(port,host,()=>{console.log(`BLOODFLOW: http://localhost:${port}/bloodflow/nationwide · data ${rooms.directory}`);try{for(const address of Object.values(os.networkInterfaces()).flat())if(address&&address.family==='IPv4'&&!address.internal)console.log(`Tablets on same LAN: http://${address.address}:${port}/bloodflow/nationwide | http://${address.address}:${port}/bloodflow/biology`);}catch{console.log(`LAN address lookup unavailable. Read this PC's IPv4 address in network settings; server continues on port ${port}.`);}});
const close=()=>{clearInterval(interval);clearInterval(saveInterval);clearInterval(heartbeat);rooms.close();wss.close();server.close(()=>process.exit(0));};process.on('SIGINT',close);process.on('SIGTERM',close);
export {rooms,server};
