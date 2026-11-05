// Unacknowledged writing is local to this page and its room/role. It is never a server record.
export const noteScope=client=>client.mode==='shared'?client.code+':'+client.role:null;
export class NoteDrafts{
 constructor(){this.scopes=new Map();}
 get(scope,key){return this.scopes.get(scope)?.get(key);}
 capture(scope,key,value,confirmed=''){
  if(!scope)return;
  const previous=this.get(scope,key);
  if(!previous?.eventId&&value===confirmed){this.scopes.get(scope)?.delete(key);return;}
  if(previous?.value===value)return previous;
  if(!this.scopes.has(scope))this.scopes.set(scope,new Map());
  const draft={value,base:previous?.base??confirmed,eventId:previous?.eventId??null,sentValue:previous?.sentValue,issue:previous?.issue??''};
  this.scopes.get(scope).set(key,draft);return draft;
 }
 sent(scope,key,eventId){const draft=this.get(scope,key);if(draft){draft.eventId=eventId;draft.sentValue=draft.value;draft.issue='';}}
 acknowledge(eventId){
  for(const notes of this.scopes.values())for(const [key,draft] of notes)if(draft.eventId===eventId){
   if(draft.value===draft.sentValue)notes.delete(key);
   else{draft.eventId=null;draft.issue='전송한 뒤 입력이 바뀌었습니다. 현재 초안은 아직 반영되지 않았습니다.';}
  }
 }
 reject(eventId,message){for(const notes of this.scopes.values())for(const draft of notes.values())if(draft.eventId===eventId){draft.eventId=null;draft.issue=message;}}
 reconcile(pending){for(const notes of this.scopes.values())for(const draft of notes.values())if(draft.eventId&&!pending.has(draft.eventId)){draft.eventId=null;draft.issue='이전 전송의 반영을 확인하지 못했습니다. 서버 기록을 확인한 뒤 직접 다시 보내세요.';}}
 export(){return {format:'BLOODFLOW-NOTE-DRAFTS-1',savedAt:new Date().toISOString(),scope:'이 탭의 미확인 초안 보관본. 공통 서버 반영본이나 실험 상태 복원 파일이 아닙니다.',drafts:[...this.scopes].flatMap(([scope,notes])=>[...notes].map(([key,draft])=>({room:scope.split(':')[0],role:scope.split(':')[1],key,value:draft.value,confirmedAtEdit:draft.base,awaitingAcknowledgement:!!draft.eventId,issue:draft.issue})))};}
 get size(){return [...this.scopes.values()].reduce((sum,notes)=>sum+notes.size,0);}
}
