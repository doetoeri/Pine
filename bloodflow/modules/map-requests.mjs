// Request governor shared by online tiles and deterministic fault-injection tests.
// Browser HTTP cache is authoritative; no tile prefetch or persistent tile archive.
export class TileScheduler {
 constructor({fetcher=(...args)=>fetch(...args),concurrency=4,maxAttempts=3,budget=80,minuteBudget=32,baseDelay=800,clock=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),onState=()=>{}}={}){
  Object.assign(this,{fetcher,concurrency,maxAttempts,budget,minuteBudget,baseDelay,clock,sleep,onState});
  this.queue=[];this.pending=new Map();this.controllers=new Set();this.active=0;this.requests=0;this.completed=0;this.failures=0;this.retries=0;this.stamps=[];this.records=[];this.closed=false;this.reason='저장된 벡터 지도';
 }
 state(){return {requests:this.requests,completed:this.completed,retries:this.retries,active:this.active,queued:this.queue.length,closed:this.closed,reason:this.reason,records:this.records.slice(-30)};}
 emit(){this.onState(this.state());}
 stop(reason='저장된 벡터 지도로 전환'){
  if(this.closed)return;this.closed=true;this.reason=reason;for(const c of this.controllers)c.abort();
  for(const q of this.queue.splice(0)){q.reject(Error(reason));this.pending.delete(q.url);}this.emit();
 }
 request(url){
  if(this.closed)return Promise.reject(Error(this.reason));
  if(this.pending.has(url))return this.pending.get(url);
  let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});
  this.pending.set(url,promise);this.queue.push({url,resolve,reject});this.pump();return promise;
 }
 cancelQueued(url){const i=this.queue.findIndex(q=>q.url===url);if(i<0)return false;const [q]=this.queue.splice(i,1);this.pending.delete(url);q.reject(Error('화면 밖 타일 요청 취소'));return true;}
 pump(){while(!this.closed&&this.active<this.concurrency&&this.queue.length){const q=this.queue.shift();this.active++;this.execute(q.url).then(q.resolve,q.reject).finally(()=>{this.active--;this.pending.delete(q.url);this.emit();this.pump();});}}
 async execute(url){
  for(let attempt=1;attempt<=this.maxAttempts;attempt++){
   if(this.closed)throw Error(this.reason);
   const now=this.clock();this.stamps=this.stamps.filter(t=>now-t<60000);
   if(this.requests>=this.budget||this.stamps.length>=this.minuteBudget){this.stop('지도 요청 한도 도달 · 저장된 지도로 계속합니다. 1분 뒤 수동 재연결하세요.');throw Error(this.reason);}
   this.requests++;this.stamps.push(now);const controller=new AbortController();this.controllers.add(controller);
   let record={url,attempt,at:new Date(now).toISOString(),status:null,headers:{},error:null};
   const timeout=setTimeout(()=>controller.abort(),7000);let retry=false;
   try{
    const response=await this.fetcher(url,{mode:'cors',credentials:'omit',cache:'default',referrerPolicy:'strict-origin-when-cross-origin',signal:controller.signal});
    record.status=response.status;for(const k of ['content-type','cache-control','expires','etag','retry-after','x-bloodflow-fixture']){const v=response.headers.get(k);if(v!==null)record.headers[k]=v;}
    if(response.ok){const blob=await response.blob();if(blob.type&&!blob.type.startsWith('image/'))throw Error('타일이 이미지 형식이 아닙니다.');this.records.push(record);this.records=this.records.slice(-30);this.completed++;this.failures=0;this.reason='온라인 지도 표시 중';this.emit();return blob;}
    record.error='HTTP '+response.status;
    if([401,403,429].includes(response.status)){this.records.push(record);this.stop('지도 제공자가 요청을 제한했습니다 ('+response.status+'). 저장된 지도를 사용합니다.');throw Error(this.reason);}
    retry=response.status>=500;
   }catch(e){record.error??=e.name==='AbortError'?'요청 취소·시간 초과':e.message;retry=!this.closed&&record.status===null;}
   finally{clearTimeout(timeout);this.controllers.delete(controller);}
   if(!this.records.includes(record))this.records.push(record);this.records=this.records.slice(-30);this.failures++;
   if(this.closed)throw Error(this.reason);
   if(this.failures>=3){this.stop('지도 요청 연속 실패 · 저장된 지도로 복구했습니다.');throw Error(this.reason);}
   if(!retry||attempt===this.maxAttempts){this.reason='일부 타일 요청 실패 · 저장된 지도를 함께 표시합니다.';this.emit();throw Error(record.error??'지도 요청 실패');}
   this.retries++;this.reason='지도 연결 재시도 '+attempt+' / '+(this.maxAttempts-1);this.emit();await this.sleep(this.baseDelay*2**(attempt-1));
  }
 }
}
