// Background geometry is optional. Facilities and transport data must never be invented.
export const DATA_LOAD_TIMEOUT_MS=10000;
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
 async readAll(){
  const issues=(await Promise.all(assets.map(async asset=>{
   if(Object.hasOwn(this.cache,asset.key))return null;
   const issue=await this.readAsset(asset);return issue;
  }))).filter(Boolean);
  if(issues.some(x=>x.required))throw new ResearchDataError(issues);
  return {data:{...this.cache,roads:this.cache.roads??emptyGeometry(),regions:this.cache.regions??emptyGeometry()},issues};
 }
 async readAsset(asset){
  const url='/bloodflow/data/'+asset.file,started=Date.now(),controller=new AbortController();let timer,timedOut=false,status=null;
  try{
   const read=async()=>{
    let value;
    if(this.embeddedData!==undefined)value=this.embeddedData?.[asset.key];
    else{
     const response=await this.fetchImpl(url,{signal:controller.signal,headers:{Accept:'application/json, application/geo+json'}});status=response.status;
     if(!response.ok)throw Error('HTTP '+status);
     try{value=await response.json();}catch(e){if(timedOut)throw e;throw Error('JSON 자료를 읽을 수 없음');}
    }
    if(!asset.valid(value))throw Error('자료 구조 확인 필요');return value;
   };
   const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{timedOut=true;controller.abort();reject(Error('응답 대기 시간 초과'));},this.timeoutMs);});
   const value=await Promise.race([read(),deadline]);this.cache[asset.key]=value;
   this.record({file:asset.file,url,status,required:asset.required,elapsedMs:Date.now()-started,error:null});return null;
  }catch(e){
   const issue={file:asset.file,url,status,required:asset.required,elapsedMs:Date.now()-started,error:timedOut?'응답 대기 시간 초과':e instanceof TypeError?'네트워크 연결 실패':e.message};this.record(issue);return issue;
  }finally{clearTimeout(timer);}
 }
 record(value){this.records.push({...value,at:new Date().toISOString()});if(this.records.length>30)this.records.splice(0,this.records.length-30);}
}
