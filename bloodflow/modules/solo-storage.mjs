export const STORAGE_TIMEOUT_MS=5000;
export function openStateDatabase({factory,timeoutMs=STORAGE_TIMEOUT_MS}={}){
 return new Promise((resolve,reject)=>{
  let request,settled=false;
  const finish=(error,db)=>{if(settled){db?.close();return;}settled=true;clearTimeout(timer);if(error)reject(error);else resolve(db);};
  const timer=setTimeout(()=>finish(Error('기기 저장소 열기 대기 시간이 초과됐습니다.')),timeoutMs);
  try{
   const idb=factory??globalThis.indexedDB;if(!idb?.open)throw Error('이 브라우저에서 기기 저장소를 사용할 수 없습니다.');
   request=idb.open('bloodflow-dual-lab-v1',1);
   request.onupgradeneeded=()=>{if(settled){try{request.transaction?.abort();request.result?.close();}catch{}return;}if(!request.result.objectStoreNames.contains('states'))request.result.createObjectStore('states');};
   request.onsuccess=()=>finish(null,request.result);
   request.onerror=()=>finish(request.error??Error('기기 저장소를 열지 못했습니다.'));
   request.onblocked=()=>finish(Error('다른 창의 저장소 작업을 기다리고 있습니다. 해당 창을 닫고 다시 확인하세요.'));
  }catch(error){finish(error);}
 });
}
function transact(db,mode,setup,timeoutMs){
 return new Promise((resolve,reject)=>{
  let tx,result,settled=false;
  const fail=error=>{if(settled)return;settled=true;clearTimeout(timer);try{tx?.abort();}catch{}reject(error);};
  const timer=setTimeout(()=>fail(Error(mode==='readonly'?'자동 저장 읽기 대기 시간이 초과됐습니다.':'자동 저장 쓰기 대기 시간이 초과됐습니다.')),timeoutMs);
  try{
   tx=db.transaction('states',mode);
   tx.oncomplete=()=>{if(settled)return;try{const value=result?.();settled=true;clearTimeout(timer);resolve(value);}catch(error){fail(error);}};
   tx.onabort=()=>fail(tx.error??Error('기기 저장소 작업이 중단됐습니다.'));
   tx.onerror=event=>fail(event?.target?.error??tx.error??Error('기기 저장소 작업에 실패했습니다.'));
   result=setup(tx.objectStore('states'),fail);
  }catch(error){fail(error);}
 });
}
export function readCheckpoint(db,clientId,network,{timeoutMs=STORAGE_TIMEOUT_MS}={}){
 return transact(db,'readonly',(store,fail)=>{
  const own=store.get('solo:'+clientId+':'+network),latest=store.get('latest:'+network),regional=store.get('solo:'+network),legacy=store.get('solo');let linked;
  latest.onsuccess=()=>{
   try{
    if(own.result!=null||latest.result==null)return;
    const key=latest.result.slotKey;
    if(typeof key!=='string'||!key.startsWith('solo:')||!key.endsWith(':'+network)||key.length>=200)throw Error('자동 저장 위치 정보가 올바르지 않습니다.');
    linked=store.get(key);
   }catch(error){fail(error);}
  };
  return ()=>own.result??linked?.result??regional.result??((legacy.result?.snapshot?.c?.network??'incheon')===network?legacy.result:undefined);
 },timeoutMs);
}
export function writeCheckpoint(db,clientId,record,{timeoutMs=STORAGE_TIMEOUT_MS}={}){
 const network=record.snapshot.c.network??'incheon',slotKey='solo:'+clientId+':'+network;
 return transact(db,'readwrite',store=>{store.put(record,slotKey);store.put({slotKey},'latest:'+network);return ()=>true;},timeoutMs);
}
