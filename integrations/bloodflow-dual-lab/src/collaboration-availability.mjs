const guidance='단독 연구는 계속 사용할 수 있습니다. 두 기기를 연결하려면 공통 서버가 실행 중인 주소로 접속하세요.';

export function resolveServerBase(context=globalThis){
 const {location,window}=context;let url;
 try{url=new URL(window?.BLOODFLOW_RUNTIME?.serverOrigin||location?.origin);}catch{throw Error('공통 서버 주소를 사용할 수 없습니다. '+guidance);}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('공통 서버 설정에는 경로·계정 정보 없는 HTTP 또는 HTTPS 주소가 필요합니다.');
 if(location?.protocol==='https:'&&url.protocol!=='https:')throw Error('HTTPS 화면에서는 HTTPS 협업 서버가 필요합니다.');
 return url;
}

export class CollaborationAvailability{
 constructor({fetchImpl=(...args)=>fetch(...args),context=()=>globalThis,timeoutMs=5000,cacheMs=15000,now=()=>Date.now()}={}){
  Object.assign(this,{fetchImpl,context,timeoutMs,cacheMs,now});this.pending=null;this.cached=null;
 }
 check({force=false}={}){
  const context=this.context();
  if(context.window?.BLOODFLOW_STANDALONE||context.location?.protocol==='file:')return Promise.resolve({ready:false,kind:'standalone',message:'이 파일은 단독 연구용입니다. '+guidance});
  let base;try{base=resolveServerBase(context);}catch(e){return Promise.resolve({ready:false,kind:'configuration',message:e.message});}
  if(this.pending?.origin===base.origin)return this.pending.promise;
  if(!force&&this.cached?.origin===base.origin&&this.now()-this.cached.at<this.cacheMs)return Promise.resolve(this.cached.result);
  const task={origin:base.origin};
  task.promise=this.request(base).then(result=>{this.cached={origin:base.origin,at:this.now(),result};return result;}).finally(()=>{if(this.pending===task)this.pending=null;});
  this.pending=task;return task.promise;
 }
 async request(base){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs),url=new URL('/bloodflow/api/health',base).href;
  try{
   const r=await this.fetchImpl(url,{signal:controller.signal,headers:{Accept:'application/json'},cache:'no-store'});
   if(!r.ok)return {ready:false,kind:'http',status:r.status,url,message:`공통 서버를 사용할 수 없습니다 (HTTP ${r.status}). ${guidance}`};
   if(!r.headers.get('content-type')?.includes('application/json'))return {ready:false,kind:'missing',url,message:'이 주소에는 BLOODFLOW 공통 서버가 연결되지 않았습니다. '+guidance};
   let data;try{data=await r.json();}catch{return {ready:false,kind:'invalid',url,message:'공통 서버의 상태 응답을 읽을 수 없습니다. '+guidance};}
   if(data?.app!=='BLOODFLOW Dual Lab'||data.websocket!==true||typeof data.version!=='string')return {ready:false,kind:'invalid',url,message:'이 주소에서 BLOODFLOW 협업 서버를 확인하지 못했습니다. '+guidance};
   return {ready:true,kind:'ready',url,version:data.version,message:'공통 서버 연결 확인 완료 · 두 기기에서 같은 코드를 사용할 수 있습니다.'};
  }catch{return {ready:false,kind:controller.signal.aborted?'timeout':'network',url,message:(controller.signal.aborted?'공통 서버의 응답 시간이 초과되었습니다. ':'공통 서버에 연결할 수 없습니다. ')+guidance};}
  finally{clearTimeout(timer);}
 }
}
