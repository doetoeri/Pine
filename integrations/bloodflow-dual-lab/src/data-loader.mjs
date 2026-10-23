// Background geometry is optional. Facilities and transport data must never be invented.
export const DATA_LOAD_TIMEOUT_MS=10000;
const headerNames=['content-type','cache-control','age','etag','last-modified','date','server','retry-after','vary','access-control-allow-origin','x-cache'];
const publicURL=value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)?u.origin+u.pathname:null;}catch{return null;}};
function responseMetadata(response){
 const headers={};let headersReadable=false;
 try{if(typeof response.headers?.get==='function'){headersReadable=true;for(const name of headerNames){const value=response.headers.get(name);if(value!==null)headers[name]=String(value).slice(0,512);}}}catch{headersReadable=false;}
 return {responseUrl:publicURL(response.url),responseType:['basic','cors','default','error','opaque','opaqueredirect'].includes(response.type)?response.type:'unknown',headersReadable,headers};
}
const assets=[
 {key:'facilities',file:'facilities.json',required:true,valid:v=>Array.isArray(v)&&v.length===4},
 {key:'routes',file:'routes.json',required:true,valid:v=>v&&typeof v.routes==='object'&&v.routes!==null&&Object.keys(v.routes).length===12},
 {key:'nationwide',file:'nationwide.json',required:true,valid:v=>v?.facilities?.length===100&&v?.regions?.length===17},
 ...['roads','regions'].map(key=>({key,file:key+'.geojson',required:false,valid:v=>v?.type==='FeatureCollection'&&Array.isArray(v.features)}))
];
const emptyGeometry=()=>({type:'FeatureCollection',features:[]});
export class ResearchDataError extends Error{
 constructor(issues){super('계산 필수 자료를 받지 못했습니다: '+issues.filter(x=>x.required).map(x=>x.file+' ('+x.error+')').join(' · '));this.name='ResearchDataError';this.issues=issues;}
}
export class ResearchDataLoader{
 constructor({fetchImpl=(...args)=>fetch(...args),timeoutMs=DATA_LOAD_TIMEOUT_MS,embeddedData}={}){
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>60000)throw RangeError('자료 요청 대기 시간은 0초 초과·60초 이하여야 합니다.');
  this.fetchImpl=fetchImpl;this.timeoutMs=timeoutMs;this.embeddedData=embeddedData;this.cache={};this.records=[];this.pending=null;
 }
 load(){
  // Repeated clicks share the same in-flight requests; only missing files are retried.
  if(this.pending)return this.pending;
  this.pending=this.readAll().finally(()=>{this.pending=null;});return this.pending;
 }
 diagnostics({protocol,origin,online}={}){
  return {schema:'BLOODFLOW-DATA-DIAGNOSTICS-1',createdAt:new Date().toISOString(),timeoutMs:this.timeoutMs,
   context:{protocol:['http:','https:','file:'].includes(protocol)?protocol:null,origin:publicURL(origin)?new URL(origin).origin:null,online:typeof online==='boolean'?online:null},
   explanation:'현재 페이지의 최근 자료 요청 최대30개입니다. 브라우저가 공개한 응답 헤더만 기록합니다. 상태 미확인은 네트워크·CORS 등의 원인을 확정하지 못한 경우입니다. 연구 내용·실험실 코드·토큰·자료 본문은 포함하지 않습니다.',
   requests:JSON.parse(JSON.stringify(this.records))};
 }
 async readAll(){
  const issues=(await Promise.all(assets.map(async asset=>{
   if(Object.hasOwn(this.cache,asset.key))return null;
   const issue=await this.readAsset(asset);return issue;
  }))).filter(Boolean);
  if(issues.some(x=>x.required))throw new ResearchDataError(issues);
  return {data:{...this.cache,roads:this.cache.roads??emptyGeometry(),regions:this.cache.regions??emptyGeometry()},issues};
 }
 async readAsset(asset){
  const url='/bloodflow/data/'+asset.file,started=Date.now(),controller=new AbortController(),source=this.embeddedData!==undefined?'embedded':'http';let timer,timedOut=false,status=null,metadata={responseUrl:null,responseType:null,headersReadable:false,headers:{}};
  try{
   const read=async()=>{
    let value;
    if(this.embeddedData!==undefined)value=this.embeddedData?.[asset.key];
    else{
     const response=await this.fetchImpl(url,{signal:controller.signal,headers:{Accept:'application/json, application/geo+json'}});status=response.status||null;metadata=responseMetadata(response);
     if(!response.ok)throw Error(status===null?'응답 상태 확인 불가 ('+metadata.responseType+')':'HTTP '+status);
     try{value=await response.json();}catch(e){if(timedOut)throw e;throw Error('JSON 자료를 읽을 수 없음');}
    }
    if(!asset.valid(value))throw Error('자료 구조 확인 필요');return value;
   };
   const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{timedOut=true;controller.abort();reject(Error('응답 대기 시간 초과'));},this.timeoutMs);});
   const value=await Promise.race([read(),deadline]);this.cache[asset.key]=value;
   this.record({file:asset.file,url,status,source,...metadata,required:asset.required,elapsedMs:Date.now()-started,error:null});return null;
  }catch(e){
   const issue={file:asset.file,url,status,source,...metadata,required:asset.required,elapsedMs:Date.now()-started,error:timedOut?'응답 대기 시간 초과':e instanceof TypeError?'브라우저에서 응답을 읽지 못함 (네트워크/CORS 확인 필요)':e.message};this.record(issue);return issue;
  }finally{clearTimeout(timer);}
 }
 record(value){this.records.push({...value,at:new Date().toISOString()});if(this.records.length>30)this.records.splice(0,this.records.length-30);}
}

// Available before LabClient/map initialization; diagnostic export never reads saved research.
export function waitForDataRetry({document,host,loader,error,context,download}){
 const text=(parent,tag,value)=>{const el=document.createElement(tag);el.textContent=value;parent.append(el);return el;};
 const panel=document.createElement('section');panel.className='card card-body';panel.style.maxWidth='680px';panel.style.margin='48px auto';panel.setAttribute('role','alert');
 text(panel,'h1','연구 자료를 준비하지 못했습니다.');text(panel,'p',error.message);
 text(panel,'p','계산 필수 자료 없이 재고·운송을 추정해 실행하지 않습니다. 연결을 확인하고 다시 시도하거나 동봉한 오프라인 HTML을 사용하세요. 파일별 최대 대기 시간은 10초입니다.').className='scope';
 const retry=text(panel,'button','자료 다시 받기');retry.id='retry-data';retry.type='button';retry.className='primary';
 const details=document.createElement('details');text(details,'summary','자료 요청 기록 · HTTP 상태와 응답 헤더');
 text(details,'p','브라우저가 읽을 수 있는 응답 정보만 표시합니다. 상태 미확인은 네트워크·CORS 원인을 확정한 것이 아닙니다. 진단 파일은 기기에 저장하며 자동으로 전송하지 않습니다.').className='scope';
 const report=text(details,'pre',JSON.stringify(loader.diagnostics(context),null,2));report.id='data-load-diagnostics';report.style.whiteSpace='pre-wrap';report.style.overflowWrap='anywhere';panel.append(details);
 const save=text(panel,'button','자료 진단 JSON 저장');save.id='data-log-export';save.type='button';save.className='quiet section-gap';
 const status=text(panel,'p','');status.id='data-log-status';status.className='scope';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 save.onclick=()=>{try{download('BLOODFLOW_data_diagnostics.json',JSON.stringify(loader.diagnostics(context),null,2));status.textContent='진단 JSON 저장을 요청했습니다. 브라우저의 저장 결과를 확인하세요.';}catch{status.textContent='진단 파일을 만들지 못했습니다. 위 요청 기록을 펼쳐 확인하거나 자료를 다시 받아 보세요.';}};
 host.replaceChildren(panel);
 return new Promise(resolve=>{retry.onclick=()=>{if(retry.disabled)return;retry.disabled=true;retry.textContent='자료 확인 중…';resolve();};});
}
