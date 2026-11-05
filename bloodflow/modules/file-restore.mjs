export const STATE_FILE_TIMEOUT_MS=10000,MAX_STATE_FILE_BYTES=24*1024*1024;
const changed='파일을 선택한 뒤 연구 상태나 연결이 바뀌어 복원을 취소했습니다. 현재 연구를 확인한 뒤 파일을 다시 선택하세요.';
// Guard the asynchronous file read. Existing client/server restore validation is authoritative.
export class StateFileReader extends EventTarget{
 constructor(client,{timeoutMs=STATE_FILE_TIMEOUT_MS}={}){
  super();if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>60000)throw RangeError('파일 읽기 대기 시간은 0초 초과·60초 이하여야 합니다.');
  this.client=client;this.timeoutMs=timeoutMs;this.current=null;this.submittedId=null;this.status={kind:'idle',message:''};
  this.observe=()=>{if(this.current&&!this.matches(this.current))this.cancel(changed);if(this.submittedId&&!client.pending.has(this.submittedId)){this.submittedId=null;this.update('uncertain','이전 복원 요청의 반영을 확인하지 못했습니다. 최신 서버 상태를 확인한 뒤 필요한 경우 파일을 다시 선택하세요.');}};
  this.ack=e=>{if(e.detail?.eventId===this.submittedId){this.submittedId=null;this.update('complete','공통 서버가 파일 복원을 확인했습니다. 현재 시간·두 해석·결과를 확인하세요.');}};
  this.rejected=e=>{if(e.detail.eventId===this.submittedId){this.submittedId=null;this.update('error','파일 복원 요청이 거절됐습니다: '+e.detail.error);}};
  client.addEventListener('change',this.observe);client.addEventListener('ack',this.ack);client.addEventListener('command-rejected',this.rejected);
 }
 study(){return this.client.mode==='shared'?this.client.sharedState:this.client;}
 update(kind,message){this.status={kind,message};this.dispatchEvent(new Event('status'));}
 matches(r){
  const c=this.client,s=this.study();return !c.initializing&&c.ready&&!!s?.world&&!s.running&&!s.job&&!c.pending.size&&r.mode===c.mode&&r.role===c.role&&r.code===c.code&&r.socket===c.socket&&r.authorityId===c.authorityId&&(c.mode==='shared'||r.world===c.world)&&r.revision===s.revision&&r.time===s.world.t;
 }
 prepare(){
  const c=this.client,s=this.study();
  if(c.initializing||!c.ready||!s?.world)throw Error('연결 복구와 저장 확인이 끝난 뒤 파일을 선택하세요.');
  if(s.running||s.job)throw Error('시간 진행·반복 계산을 멈춘 뒤 파일을 선택하세요.');
  if(c.pending.size)throw Error('공통 서버의 대기 조작을 확인한 뒤 파일을 선택하세요.');
  this.cancel('새 파일 선택을 시작해 이전 읽기를 취소했습니다.');
  return this.current={mode:c.mode,role:c.role,code:c.code,socket:c.socket,authorityId:c.authorityId,world:c.world,revision:s.revision,time:s.world.t,result:JSON.stringify(s.result??null)};
 }
 cancel(message=changed){const r=this.current;if(!r)return;this.current=null;clearTimeout(r.timer);r.cancel?.();this.update('canceled',message);}
 async read(file,r=this.current){
  if(!r||r!==this.current||r.reading)return false;r.reading=true;let applying=false;
  try{
   if(!this.matches(r)){this.cancel();return false;}
   if(!Number.isSafeInteger(file?.size)||file.size<0||file.size>MAX_STATE_FILE_BYTES||typeof file.text!=='function')throw Error('읽을 수 있는 24MB 이하의 상태 JSON 파일을 선택하세요.');
   this.update('reading','상태 파일을 읽고 있습니다. 최대 10초 기다리며 연구 상태가 바뀌면 복원을 취소합니다.');
   const deadline=new Promise((resolve,reject)=>{r.cancel=()=>resolve(null);r.timer=setTimeout(()=>reject(Error('파일 읽기 대기 시간이 초과됐습니다. 현재 연구를 유지했습니다. 파일을 다시 선택하세요.')),this.timeoutMs);});
   const text=await Promise.race([file.text(),deadline]);if(r!==this.current)return false;
   if(!this.matches(r)||JSON.stringify(this.study().result??null)!==r.result){this.cancel();return false;}
   const raw=JSON.parse(text);applying=true;this.current=null;
   const id=this.client.command('restore',{snapshot:raw?.snapshot??raw,notes:raw?.notes,result:raw?.result});
   if(this.client.mode==='shared'){this.submittedId=id;this.update('submitted','파일 복원 요청을 보냈습니다. 공통 서버의 확인을 기다립니다.');}
   else this.update('complete','상태 파일을 복원했습니다. 현재 시간·두 해석·결과를 확인하세요.');
   return true;
  }catch(error){
   if(!applying&&this.current!==r)return false;
   this.current=null;this.update('error','상태 파일을 복원하지 못했습니다: '+error.message);throw error;
  }finally{clearTimeout(r.timer);r.cancel=null;}
 }
 dispose(){this.cancel();this.client.removeEventListener('change',this.observe);this.client.removeEventListener('ack',this.ack);this.client.removeEventListener('command-rejected',this.rejected);}
}
