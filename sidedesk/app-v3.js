import{initializeApp}from'https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js';
import{getAuth,signInAnonymously}from'https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js';
import{getFirestore,doc,getDoc,setDoc,updateDoc,onSnapshot,collection,addDoc,serverTimestamp,query,orderBy,limit,getDocs,writeBatch}from'https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js';

const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const A=$('#app'),cfg=globalThis.PINCON_FIREBASE_CONFIG;
const LS='sidedesk.v3',LEGACY='sidedesk.v2',REVIEW_ACTIVE_MS=12*60*60*1000,MAX_ACTIVE_MS=24*60*60*1000;
let uid='',roomId='',room=null,me=null,participants=[],assignments=new Map(),unsubs=[],clockTimer=0,presenceTimer=0,eventCut=0,finishArm=0,timerReviewOpen=false;
let local=loadLocal();

const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const code=()=>{const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let s='';for(let i=0;i<6;i++)s+=c[crypto.getRandomValues(new Uint32Array(1))[0]%c.length];return s};
const id=prefix=>prefix+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const now=()=>Date.now();
const C=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
const fmt=ms=>{ms=Math.max(0,Math.floor(ms||0));const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return h?`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(x).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(x).padStart(2,'0')}`};
const fmtShort=ms=>{const m=Math.max(0,Math.floor((ms||0)/60000)),h=Math.floor(m/60),r=m%60;return h?`${h}h ${r}m`:`${r}m`};
const statusLabel=s=>({idle:'대기',studying:'공부 중',grading:'채점 중',break:'쉬는 중',paused:'일시정지',finished:'완료'})[s]||'대기';
const teamLabel=t=>t==='green'?'TEAM GREEN':t==='gold'?'TEAM GOLD':'TEAM —';

function loadLocal(){
  let x={};try{x=JSON.parse(localStorage.getItem(LS)||'{}')}catch{}
  x.workbooks=Array.isArray(x.workbooks)?x.workbooks:[];x.archive=Array.isArray(x.archive)?x.archive:[];x.progress=x.progress&&typeof x.progress==='object'?x.progress:{};
  x.invalidLegacy=Array.isArray(x.invalidLegacy)?x.invalidLegacy:[];
  if(!x.workbooks.length)x.workbooks=[{id:id('wb'),title:'오늘의 문제집',subject:'수학',total:80,goal:80,shared:true,createdAtMs:now()}];
  if(!x.legacyChecked){migrateLegacy(x);x.legacyChecked=true;try{localStorage.setItem(LS,JSON.stringify(x))}catch{}}
  return x
}
function migrateLegacy(x){
  try{
    const old=JSON.parse(localStorage.getItem(LEGACY)||'{}'),hs=Array.isArray(old.history)?old.history:[];
    for(const h of hs){const start=+h.startedAt||0,end=+(h.endedAt||h.lastSeenAt)||0,d=end-start;if(!start||!end||d<0||d>MAX_ACTIVE_MS||start>now()+300000)x.invalidLegacy.push({...h,invalid:true,reason:d>MAX_ACTIVE_MS?'duration_over_24h':'invalid_timestamp'})}
    x.invalidLegacy=x.invalidLegacy.slice(-40)
  }catch{}
}
function save(){try{localStorage.setItem(LS,JSON.stringify(local))}catch{}}
function activeWorkbook(){return local.workbooks.find(w=>w.id===local.lastWorkbookId)||local.workbooks[0]}
function normalizeBook(w={}){const total=clamp(+w.total||20,1,5000),goal=clamp(+w.goal||total,1,total);return{id:String(w.id||id('wb')).slice(0,80),title:String(w.title||'이름 없는 문제집').trim().slice(0,50)||'이름 없는 문제집',subject:String(w.subject||'기타').trim().slice(0,24)||'기타',total,goal,shared:w.shared!==false,createdAtMs:+w.createdAtMs||now()}}
function currentProgress(w){return clamp(+(local.progress[w.id]||0),0,w.goal)}
function timerBase(sessionId=''){return{sessionId,state:'idle',startedAtMs:null,accumulatedMs:0,breakStartedAtMs:null,breakAccumulatedMs:0,gradingStartedAtMs:null,gradingAccumulatedMs:0,createdAtMs:now(),finishedAtMs:null,invalid:false}}
function sanitizeTimer(t={},sessionId=''){
  const x={...timerBase(sessionId),...t};
  for(const k of ['accumulatedMs','breakAccumulatedMs','gradingAccumulatedMs'])x[k]=Math.max(0,Number(x[k])||0);
  for(const k of ['startedAtMs','breakStartedAtMs','gradingStartedAtMs','createdAtMs','finishedAtMs'])if(x[k]!=null)x[k]=Number(x[k])||null;
  if(x.sessionId!==sessionId&&sessionId)x.sessionId=sessionId;
  if(x.startedAtMs&&x.startedAtMs>now()+300000)x.invalid=true;
  if(x.startedAtMs&&now()-x.startedAtMs>MAX_ACTIVE_MS)x.invalid=true;
  return x
}
function activeStudyMs(p,at=now()){const t=sanitizeTimer(p?.timer||{},room?.sessionId||'');if(t.invalid)return t.accumulatedMs;let ms=t.accumulatedMs;if((p?.status==='studying'||p?.status==='grading')&&t.startedAtMs)ms+=clamp(at-t.startedAtMs,0,MAX_ACTIVE_MS);return ms}
function gradingMs(p,at=now()){const t=sanitizeTimer(p?.timer||{},room?.sessionId||'');let ms=t.gradingAccumulatedMs;if(p?.status==='grading'&&t.gradingStartedAtMs)ms+=clamp(at-t.gradingStartedAtMs,0,MAX_ACTIVE_MS);return ms}
function breakMs(p,at=now()){const t=sanitizeTimer(p?.timer||{},room?.sessionId||'');let ms=t.breakAccumulatedMs;if(p?.status==='break'&&t.breakStartedAtMs)ms+=clamp(at-t.breakStartedAtMs,0,MAX_ACTIVE_MS);return ms}
function timerTransition(p,next){
  const at=now(),sid=room?.sessionId||p?.timer?.sessionId||id('session'),t=sanitizeTimer(p?.timer||{},sid),cur=p?.status||'idle';
  if(t.invalid)throw Error('TIMER_INVALID');
  if(t.startedAtMs&&(cur==='studying'||cur==='grading')){const d=at-t.startedAtMs;if(d<0||d>MAX_ACTIVE_MS)throw Error('TIMER_INVALID');t.accumulatedMs+=d;if(cur==='grading'&&t.gradingStartedAtMs)t.gradingAccumulatedMs+=clamp(at-t.gradingStartedAtMs,0,MAX_ACTIVE_MS)}
  if(cur==='break'&&t.breakStartedAtMs)t.breakAccumulatedMs+=clamp(at-t.breakStartedAtMs,0,MAX_ACTIVE_MS);
  t.startedAtMs=null;t.breakStartedAtMs=null;t.gradingStartedAtMs=null;
  if(next==='studying')t.startedAtMs=at;else if(next==='grading'){t.startedAtMs=at;t.gradingStartedAtMs=at}else if(next==='break')t.breakStartedAtMs=at;else if(next==='finished')t.finishedAtMs=at;
  t.state=next;return t
}
function participantDoc(nickname){
  const w=normalizeBook(activeWorkbook()),done=currentProgress(w),sid=room?.sessionId||'';
  return{uid,nickname:String(nickname||'친구').slice(0,14),joinedAtMs:now(),updatedAtMs:now(),presenceAtMs:now(),visibility:'active',status:room?.status==='studying'?'studying':'idle',workbook:{...w,done},problemsSolved:0,timer:room?.status==='studying'?{...timerBase(room.sessionId),state:'studying',startedAtMs:now()}:timerBase(sid)}
}
function fail(m){A.innerHTML=`<main class="v3"><section class="paper error-card"><h1>SideDesk</h1><p>${E(m)}</p></section></main>`}
if(!cfg){fail('Firebase 설정을 찾지 못했습니다.');throw new Error('firebase config missing')}
const fa=initializeApp(cfg,'sidedesk-v3'),auth=getAuth(fa),db=getFirestore(fa);
const roomRef=()=>doc(db,'sidedeskRooms',roomId),partRef=(idv=uid)=>doc(db,'sidedeskRooms',roomId,'participants',idv),assignRef=(idv=uid)=>doc(db,'sidedeskRooms',roomId,'assignments',idv);
function clearSubs(){unsubs.forEach(f=>{try{f()}catch{}});unsubs=[];clearInterval(clockTimer);clearInterval(presenceTimer)}
function rememberRoom(){local.activeRoom={roomId,nickname:me?.nickname||local.nickname||'',at:now()};save()}
function forgetRoom(){delete local.activeRoom;save()}
function campStats(){
  const since=now()-7*86400000,rows=local.archive.filter(a=>(a.finishedAtMs||0)>=since&&a.campDay>=1&&a.campDay<=4);
  return{studyMs:rows.reduce((n,a)=>n+(a.studyMs||0),0),problems:rows.reduce((n,a)=>n+(a.problems||0),0),books:new Set(rows.map(a=>(a.subject||'')+'|'+(a.bookTitle||''))).size,days:new Set(rows.map(a=>a.campDay)).size}
}
function openArchive(){
  const box=document.createElement('div');box.className='modal-backdrop';box.id='archiveModal';
  const rows=local.archive,cs=campStats();
  box.innerHTML=`<section class="paper modal archive-modal"><div class="section-head"><div><span>LOCAL ARCHIVE</span><h2>내 공부 책장</h2></div><button id="archiveClose">닫기</button></div><div class="camp-slip"><span>SIDE DESK STUDY CAMP</span><b>${cs.days} / 4 DAYS</b><em>함께 공부 ${fmtShort(cs.studyMs)} · 문제 ${cs.problems}개 · 문제집 ${cs.books}권</em></div><div class="archive-shelf">${rows.length?rows.map(a=>`<article class="archive-book"><i></i><div><span>DAY ${a.campDay||'-'} · ${new Date(a.finishedAtMs||0).toLocaleDateString('ko-KR',{month:'numeric',day:'numeric'})}</span><b>${E(a.bookTitle)}</b><em>${E(a.subject)} · ${fmtShort(a.studyMs)} · ${a.problems}문제</em><strong>FINISHED</strong></div></article>`).join(''):'<p class="muted">완료한 공부 기록이 아직 없습니다.</p>'}</div></section>`;
  document.body.appendChild(box);$('#archiveClose').onclick=()=>box.remove()
}

async function boot(){
  const c=await signInAnonymously(auth);uid=c.user.uid;
  if(local.activeRoom?.roomId){
    try{const s=await getDoc(doc(db,'sidedeskRooms',local.activeRoom.roomId));if(s.exists()&&s.data().version===3){roomId=local.activeRoom.roomId;room=s.data();const p=await getDoc(partRef());if(p.exists()){me=p.data();return connectRoom()}}}catch{}
    forgetRoom()
  }
  const invited=C(new URLSearchParams(location.search).get('room')||'');landing(invited)
}
function landing(invited=''){
  clearSubs();roomId='';room=null;me=null;participants=[];assignments.clear();
  const invalid=local.invalidLegacy.length;
  A.innerHTML=`<main class="v3"><div class="room-shell"><header class="brandbar"><div class="brandmark">SD</div><div><h1>SideDesk</h1><p>친구들이 지금 저 책상에서 같이 공부하고 있다.</p></div><span class="signal">LINK READY</span></header>
  <section class="landing-grid"><article class="wood-panel join-panel"><div class="metal-label">STUDY ROOM TERMINAL</div><label>닉네임<input id="nickname" maxlength="14" value="${E(local.nickname||'')}"></label><button id="createRoom" class="mechanical primary">새 공부방 만들기</button><div class="divider"></div><label>참여 코드<div class="vfd-input"><input id="joinCode" maxlength="6" placeholder="______" autocomplete="off" value="${E(invited)}"></div></label><button id="joinRoom" class="mechanical">공부방 들어가기</button><p id="landingError" class="error-line"></p></article>
  <article class="paper shelf-card"><div class="section-head"><div><span>MY SHELF</span><h2>오늘 펼칠 문제집</h2></div><div class="head-buttons"><button id="openShelf" class="small-button">책장</button><button id="newBook" class="small-button">+ 문제집</button></div></div><div id="landingBook"></div><div class="legacy-note ${invalid?'':'hidden'}">비정상적인 과거 기록 ${invalid}건을 통계에서 격리했습니다.</div><div class="receipt-stack">${local.archive.slice(0,3).map(a=>`<div class="mini-receipt"><b>${E(a.bookTitle)}</b><span>${fmtShort(a.studyMs)} · ${a.problems}문제</span></div>`).join('')||'<span class="muted">공부를 마치면 기록지가 여기에 쌓입니다.</span>'}</div></article></section></div></main>`;
  renderLandingBook();$('#joinCode').oninput=e=>e.target.value=C(e.target.value);$('#createRoom').onclick=createRoom;$('#joinRoom').onclick=joinRoom;$('#newBook').onclick=()=>bookEditor(null,renderLandingBook);$('#openShelf').onclick=openArchive
}
function renderLandingBook(){
  const box=$('#landingBook');if(!box)return;const w=activeWorkbook();
  box.innerHTML=`<div class="physical-book"><div class="book-spine"></div><div><span>${E(w.subject)}</span><b>${E(w.title)}</b><em>${w.goal} / ${w.total}문제 목표</em></div></div><div class="book-list">${local.workbooks.map(x=>`<button data-wb="${E(x.id)}" class="book-list-row ${x.id===w.id?'selected':''}"><span><b>${E(x.title)}</b><small>${E(x.subject)} · ${x.goal}/${x.total}</small></span><i>${x.id===w.id?'ON DESK':'SELECT'}</i></button>`).join('')}</div>`;
  $$('[data-wb]',box).forEach(b=>b.onclick=()=>{local.lastWorkbookId=b.dataset.wb;save();renderLandingBook()})
}
function bookEditor(existing,after){
  $('#bookEditor')?.remove();const w=normalizeBook(existing||{title:'',subject:'',total:80,goal:80,shared:true});
  const el=document.createElement('div');el.id='bookEditor';el.className='modal-backdrop';
  el.innerHTML=`<section class="paper modal"><div class="section-head"><h2>${existing?'문제집 수정':'새 문제집'}</h2><button id="closeBook">닫기</button></div><label>이름<input id="bt" maxlength="50" value="${E(existing?w.title:'')}"></label><div class="two"><label>과목<input id="bs" maxlength="24" value="${E(existing?w.subject:'')}"></label><label>전체 문제 수<input id="bn" type="number" min="1" max="5000" value="${w.total}"></label></div><label>오늘 목표 문제 수<input id="bg" type="number" min="1" max="${w.total}" value="${w.goal}"></label><label class="check"><input id="bshare" type="checkbox" ${w.shared?'checked':''}> 친구가 이 문제집 정보를 복사할 수 있게 공유</label><button id="saveBook" class="mechanical primary">저장</button></section>`;
  document.body.appendChild(el);$('#closeBook').onclick=()=>el.remove();$('#bn').oninput=()=>{$('#bg').max=$('#bn').value};
  $('#saveBook').onclick=()=>{if(!$('#bt').value.trim())return $('#bt').focus();const nw=normalizeBook({...w,id:existing?w.id:id('wb'),title:$('#bt').value,subject:$('#bs').value,total:$('#bn').value,goal:$('#bg').value,shared:$('#bshare').checked,createdAtMs:existing?w.createdAtMs:now()});const i=local.workbooks.findIndex(x=>x.id===nw.id);if(i>=0)local.workbooks[i]=nw;else local.workbooks.unshift(nw);local.lastWorkbookId=nw.id;save();el.remove();after?.()}
}
async function createRoom(){
  const n=$('#nickname').value.trim();if(!n)return landingErr('닉네임을 입력해 주세요.');local.nickname=n;save();
  for(let i=0;i<6;i++){
    const c=code(),r=doc(db,'sidedeskRooms',c);if((await getDoc(r)).exists())continue;
    roomId=c;const sid=id('session');room={version:3,status:'lobby',hostUid:uid,createdAtMs:now(),startedAtMs:null,finishedAtMs:null,sessionId:sid,teamSeed:id('mix'),sharedGoal:500,campDay:clamp(+local.campDay||1,1,4),updatedAtMs:now()};
    await setDoc(r,{...room,updatedAt:serverTimestamp()});me=participantDoc(n);await setDoc(partRef(),me);rememberRoom();history.replaceState(null,'',location.pathname+'?room='+roomId);return connectRoom()
  }
  landingErr('방 코드를 만들지 못했습니다.')
}
async function joinRoom(){
  const n=$('#nickname').value.trim(),c=C($('#joinCode').value);if(!n)return landingErr('닉네임을 입력해 주세요.');if(c.length!==6)return landingErr('6자리 코드를 입력해 주세요.');
  try{const r=doc(db,'sidedeskRooms',c),s=await getDoc(r);if(!s.exists()||s.data().version!==3)throw Error('missing');if(s.data().status==='finished')throw Error('finished');roomId=c;room=s.data();local.nickname=n;save();const old=await getDoc(partRef());if(old.exists())me=old.data();else{me=participantDoc(n);await setDoc(partRef(),me)}rememberRoom();history.replaceState(null,'',location.pathname+'?room='+roomId);await ensureOwnAssignment();connectRoom()}catch(e){landingErr(e.message==='finished'?'이미 종료된 방입니다.':'방을 찾지 못했습니다.')}
}
function landingErr(t){$('#landingError').textContent=t}
async function connectRoom(){
  clearSubs();eventCut=now();
  unsubs.push(onSnapshot(roomRef(),s=>{if(!s.exists())return fail('방이 사라졌습니다.');const prev=room?.status;room=s.data();if(prev!==room.status)renderCurrent();else updateRoomMeta()}));
  unsubs.push(onSnapshot(collection(db,'sidedeskRooms',roomId,'participants'),s=>{const old=new Map(participants.map(p=>[p.uid,p]));participants=s.docs.map(d=>d.data()).sort((a,b)=>(a.joinedAtMs||0)-(b.joinedAtMs||0));me=participants.find(p=>p.uid===uid)||me;for(const p of participants){const before=old.get(p.uid);if(before&&p.uid!==uid&&(p.workbook?.done||0)>(before.workbook?.done||0))deskPulse(p.uid,p.workbook.done-before.workbook.done)}renderParticipants();renderMetrics();updateConsole();if(room?.hostUid===uid&&room.status==='studying'&&participants.length&&participants.every(p=>p.status==='finished'))updateDoc(roomRef(),{status:'finished',finishedAtMs:now(),updatedAtMs:now(),updatedAt:serverTimestamp()}).catch(()=>{})}));
  unsubs.push(onSnapshot(collection(db,'sidedeskRooms',roomId,'assignments'),s=>{assignments=new Map(s.docs.map(d=>[d.id,d.data().team]));renderParticipants();renderMetrics()}));
  const q=query(collection(db,'sidedeskRooms',roomId,'events'),orderBy('clientTs','desc'),limit(30));
  unsubs.push(onSnapshot(q,s=>s.docChanges().forEach(ch=>{if(ch.type!=='added')return;const e=ch.doc.data();if((e.clientTs||0)<eventCut||e.uid===uid)return;if(e.targetUid&&e.targetUid!==uid)return;remoteEvent(e)})));
  startPresence();renderCurrent()
}
function renderCurrent(){if(!room)return;if(room.status==='lobby')lobby();else study()}
function lobby(){
  A.innerHTML=`<main class="v3"><div class="room-shell"><header class="brandbar"><div class="brandmark">SD</div><div><h1>Shared Study Room</h1><p>책을 고르고 친구들이 앉을 때까지 기다립니다.</p></div><button id="leaveRoom" class="small-button">나가기</button></header>
  <section class="room-code-panel"><span>CHANNEL</span><button id="roomCode" class="vfd-code">${E(roomId)}</button><em>눌러서 코드 복사</em></section>
  <section class="lobby-layout"><article class="wood-panel"><div class="section-head"><div><span>PARTICIPANTS</span><h2>현재 책상</h2></div><b id="participantCount">0명</b></div><div id="participantLobby" class="lobby-seats"></div></article>
  <article class="paper setup-card"><div class="section-head"><div><span>MY DESK</span><h2>내 문제집</h2></div><button id="newBook2" class="small-button">+ 추가</button></div><div id="lobbyBook"></div><label>오늘 목표<select id="goalBook">${local.workbooks.map(w=>`<option value="${E(w.id)}" ${w.id===activeWorkbook().id?'selected':''}>${E(w.title)} · ${w.goal}문제</option>`).join('')}</select></label>${room.hostUid===uid?`<div class="two"><label>공동 목표<input id="sharedGoal" type="number" min="1" max="99999" value="${room.sharedGoal||500}"></label><label>4-Day Camp<select id="campDay"><option value="1">DAY 1 / 4</option><option value="2">DAY 2 / 4</option><option value="3">DAY 3 / 4</option><option value="4">DAY 4 / 4</option></select></label></div><button id="startStudy" class="mechanical primary lever">랜덤 팀 추첨 후 START STUDY</button>`:`<div class="waiting-slip">방장이 팀을 섞고 공부를 시작하면 자동으로 책상 조명이 켜집니다.</div>`}</article></section></div></main>`;
  $('#leaveRoom').onclick=leave;$('#roomCode').onclick=copyCode;$('#newBook2').onclick=()=>bookEditor(null,()=>lobby());$('#goalBook').onchange=()=>switchWorkbook($('#goalBook').value,false);
  if(room.hostUid===uid){$('#campDay').value=String(room.campDay||1);$('#startStudy').onclick=startStudy}
  renderLobbyBook();renderParticipants()
}
function renderLobbyBook(){const box=$('#lobbyBook');if(!box)return;const w=me?.workbook||activeWorkbook();box.innerHTML=`<div class="physical-book compact"><div class="book-spine"></div><div><span>${E(w.subject)}</span><b>${E(w.title)}</b><em>${w.done||0} / ${w.goal}문제</em></div></div>`}
async function startStudy(){
  if(room.hostUid!==uid)return;const docs=(await getDocs(collection(db,'sidedeskRooms',roomId,'participants'))).docs;if(!docs.length)return;
  const ids=docs.map(d=>d.id);for(let i=ids.length-1;i>0;i--){const j=crypto.getRandomValues(new Uint32Array(1))[0]%(i+1);[ids[i],ids[j]]=[ids[j],ids[i]]}
  const batch=writeBatch(db),at=now(),sid=id('session');ids.forEach((x,i)=>batch.set(assignRef(x),{uid:x,team:i%2?'gold':'green',assignedAtMs:at,sessionId:sid}));
  docs.forEach(d=>batch.update(d.ref,{status:'studying',timer:{...timerBase(sid),state:'studying',startedAtMs:at},problemsSolved:0,updatedAtMs:at,presenceAtMs:at}));
  batch.update(roomRef(),{status:'studying',startedAtMs:at,finishedAtMs:null,sessionId:sid,teamSeed:id('mix'),sharedGoal:clamp(+$('#sharedGoal').value||500,1,99999),campDay:clamp(+$('#campDay').value||1,1,4),updatedAtMs:at,updatedAt:serverTimestamp()});await batch.commit();local.campDay=clamp(+$('#campDay').value||1,1,4);save();await sendEvent('start')
}
async function ensureOwnAssignment(){
  if(room?.status!=='studying')return;const s=await getDoc(assignRef());if(s.exists())return;
  const all=await getDocs(collection(db,'sidedeskRooms',roomId,'assignments'));let g=0,o=0;all.forEach(d=>d.data().team==='green'?g++:o++);const team=g===o?(crypto.getRandomValues(new Uint32Array(1))[0]%2?'green':'gold'):(g<o?'green':'gold');
  await setDoc(assignRef(),{uid,team,assignedAtMs:now(),sessionId:room.sessionId});if(me?.status==='idle')await setStatus('studying')
}
function study(){
  ensureOwnAssignment();
  A.innerHTML=`<main class="v3 study-screen"><div class="room-shell wide"><header class="brandbar compactbar"><div class="brandmark">SD</div><div><h1>SideDesk · DAY ${room.campDay||1}/4</h1><p>ROOM ${E(roomId)} · ${participants.length} desks linked</p></div><div class="header-actions"><button id="copyCode2" class="small-button">${E(roomId)}</button><span class="signal">LIVE</span></div></header>
  <section class="common-board"><div><span>TODAY OUR ROOM</span><b id="sharedProgress">0 / ${room.sharedGoal||500}</b><div class="progress"><i id="sharedBar"></i></div></div><div class="team-board green"><span>TEAM GREEN</span><b id="greenTime">0m</b><em id="greenProblems">0문제</em></div><div class="team-board gold"><span>TEAM GOLD</span><b id="goldTime">0m</b><em id="goldProblems">0문제</em></div></section>
  <section class="desk-room"><div id="participantGrid" class="participant-grid"></div></section>
  <section class="my-console wood-panel"><div class="console-top"><div class="lcd-timer"><span id="timerMode">STUDY</span><strong id="studyClock">00:00</strong><em id="timerSub">BREAK 00:00 · GRADING 00:00</em></div><div class="current-book" id="myCurrentBook"></div></div><div class="counter-controls"><button data-add="1" class="mechanical">+1</button><button data-add="5" class="mechanical">+5</button><button data-add="10" class="mechanical">+10</button><label class="direct-counter">현재<input id="directDone" type="number" min="0"><button id="setDone">적용</button></label></div><div class="state-controls"><button id="grading" class="mechanical red">채점 시작</button><button id="breakBtn" class="mechanical">BREAK</button><button id="pauseBtn" class="mechanical">PAUSE</button><button id="switchBook" class="mechanical">+ 문제집</button><button id="finishStudy" class="mechanical dark">FINISH</button></div></section>
  <div id="toast" class="toast"></div><div id="stickyLayer" class="sticky-layer"></div></div></main>`;
  $('#copyCode2').onclick=copyCode;$$('[data-add]').forEach(b=>b.onclick=()=>addProblems(+b.dataset.add));$('#setDone').onclick=()=>setProblems(+$('#directDone').value);$('#grading').onclick=toggleGrading;$('#breakBtn').onclick=toggleBreak;$('#pauseBtn').onclick=togglePause;$('#switchBook').onclick=openSwitchBook;$('#finishStudy').onclick=finishStudy;
  renderParticipants();renderMetrics();updateConsole();clearInterval(clockTimer);clockTimer=setInterval(()=>{updateClocks();renderMetrics()},1000)
}
function renderParticipants(){
  const lobbyBox=$('#participantLobby');if(lobbyBox){$('#participantCount').textContent=participants.length+'명';lobbyBox.innerHTML=participants.map(p=>`<div class="lobby-seat ${p.uid===uid?'me':''}"><i class="lamp ${p.uid===uid||p.status!=='idle'?'on':''}"></i><div><b>${E(p.nickname)}</b><span>${E(p.workbook?.title||'문제집')} · ${p.workbook?.done||0}/${p.workbook?.goal||p.workbook?.total||0}</span></div></div>`).join('')||'<span class="muted">아직 아무도 앉지 않았습니다.</span>';renderLobbyBook()}
  const grid=$('#participantGrid');if(!grid)return;grid.innerHTML=participants.map(p=>deskMarkup(p)).join('');
  $$('[data-knock]',grid).forEach(b=>b.onclick=()=>sendEvent('knock',{targetUid:b.dataset.knock}));$$('[data-note]',grid).forEach(b=>b.onclick=()=>sendEvent('note',{targetUid:b.dataset.note,note:'10문제만 더 ㄱㄱ'}));$$('[data-copybook]',grid).forEach(b=>b.onclick=()=>copyBookFrom(b.dataset.copybook))
}
function deskMarkup(p){
  const team=assignments.get(p.uid),isMe=p.uid===uid,age=now()-(p.presenceAtMs||0),offline=age>70000,status=offline?'연결 확인 중':statusLabel(p.status),w=p.workbook||{},pct=clamp(Math.round((w.done||0)/Math.max(1,w.goal||w.total||1)*100),0,100);
  return `<article class="desk-card ${isMe?'mine':''} ${team||''}" id="desk-${E(p.uid)}"><div class="desk-lamp ${p.status==='studying'||p.status==='grading'?'on':p.status==='break'?'dim':''}"></div><div class="nameplate"><b>${E(p.nickname)}${isMe?' · 나':''}</b><span>${teamLabel(team)}</span></div><div class="desk-book ${p.status==='break'?'closed':''}"><span>${E(w.subject||'')}</span><b>${E(w.title||'문제집')}</b><em>${w.done||0} / ${w.goal||w.total||0}</em></div><div class="mini-counter"><strong>${w.done||0}</strong><span>/ ${w.goal||w.total||0}</span></div><div class="progress"><i style="width:${pct}%"></i></div><div class="desk-status"><span class="state-dot ${p.status}"></span><b>${status}</b><em data-clock="${E(p.uid)}">${fmtShort(activeStudyMs(p))}</em></div>${p.status==='grading'?'<div class="red-pen">RED PEN · CHECKING</div>':''}${!isMe?`<div class="desk-actions"><button data-knock="${E(p.uid)}">KNOCK</button><button data-note="${E(p.uid)}">POST-IT</button>${w.shared?`<button data-copybook="${E(p.uid)}">책 복사</button>`:''}</div>`:''}</article>`
}
function deskPulse(idv,delta){const el=document.getElementById('desk-'+CSS.escape(idv));if(!el)return;el.classList.remove('pulse');void el.offsetWidth;el.classList.add('pulse');if(delta>=10)toast(`${participants.find(p=>p.uid===idv)?.nickname||'친구'} +${delta}문제`);setTimeout(()=>el.classList.remove('pulse'),650)}
function renderMetrics(){
  if(!room)return;let gp=0,op=0,gt=0,ot=0,total=0;
  for(const p of participants){const probs=Math.max(0,+p.problemsSolved||0),t=activeStudyMs(p);total+=probs;if(assignments.get(p.uid)==='green'){gp+=probs;gt+=t}else if(assignments.get(p.uid)==='gold'){op+=probs;ot+=t}}
  if($('#greenTime'))$('#greenTime').textContent=fmtShort(gt);if($('#goldTime'))$('#goldTime').textContent=fmtShort(ot);if($('#greenProblems'))$('#greenProblems').textContent=gp+'문제';if($('#goldProblems'))$('#goldProblems').textContent=op+'문제';if($('#sharedProgress'))$('#sharedProgress').textContent=`${total} / ${room.sharedGoal||500}`;if($('#sharedBar'))$('#sharedBar').style.width=clamp(total/Math.max(1,room.sharedGoal||500)*100,0,100)+'%';
  if(total>=(room.sharedGoal||500)&&!local['goalCelebrated_'+roomId+'_'+room.sessionId]){local['goalCelebrated_'+roomId+'_'+room.sessionId]=true;save();document.querySelector('.common-board')?.classList.add('goal-complete');toast('SESSION COMPLETE · 공동 목표 달성')}
}
function updateConsole(){if(!me||!$('#myCurrentBook'))return;reviewLongTimer();const w=me.workbook||{};$('#myCurrentBook').innerHTML=`<span>${E(w.subject||'')}</span><b>${E(w.title||'문제집')}</b><em>${w.done||0} / ${w.goal||w.total||0}문제</em>`;$('#directDone').value=w.done||0;$('#directDone').max=w.goal||w.total||0;$('#grading').textContent=me.status==='grading'?'채점 완료':'채점 시작';$('#breakBtn').textContent=me.status==='break'?'공부 재개':'BREAK';$('#pauseBtn').textContent=me.status==='paused'?'RESUME':'PAUSE';updateClocks()}
function updateClocks(){if(!me)return;const c=$('#studyClock');if(c)c.textContent=fmt(activeStudyMs(me));const sub=$('#timerSub');if(sub)sub.textContent=`BREAK ${fmt(breakMs(me))} · GRADING ${fmt(gradingMs(me))}`;const mode=$('#timerMode');if(mode)mode.textContent=(me.status||'idle').toUpperCase();$('[data-clock]').forEach(x=>{const p=participants.find(p=>p.uid===x.dataset.clock);if(p)x.textContent=fmtShort(activeStudyMs(p))})}
function reviewLongTimer(){
  if(timerReviewOpen||!me||!['studying','grading'].includes(me.status))return;
  const started=me.timer?.startedAtMs,d=started?now()-started:0,key='timerReviewed_'+roomId+'_'+room.sessionId;
  if(d<REVIEW_ACTIVE_MS||d>=MAX_ACTIVE_MS||local[key])return;
  timerReviewOpen=true;
  const box=document.createElement('div');box.className='modal-backdrop';box.innerHTML=`<section class="paper modal"><h2>긴 세션 확인</h2><p>이 공부 구간이 12시간을 넘었습니다. 실제로 계속 공부한 기록이면 유지하고, 방치된 타이머라면 원본을 격리한 뒤 지금부터 다시 시작할 수 있습니다.</p><div class="two"><button id="keepLongTimer" class="mechanical">기록 유지</button><button id="resetLongTimer" class="mechanical primary">지금부터 복구</button></div></section>`;document.body.appendChild(box);
  $('#keepLongTimer').onclick=()=>{local[key]=true;save();timerReviewOpen=false;box.remove()};
  $('#resetLongTimer').onclick=async()=>{local.invalidLegacy.push({source:'v3-long-session',roomId,raw:me.timer,invalid:true,at:now()});save();const t={...timerBase(room.sessionId),state:'studying',startedAtMs:now()};await updateDoc(partRef(),{status:'studying',timer:t,updatedAtMs:now(),presenceAtMs:now()});timerReviewOpen=false;box.remove()}
}
async function addProblems(n){if(!me||!['studying','grading'].includes(me.status))return toast('공부 또는 채점 상태에서만 문제 수를 올릴 수 있습니다.');return setProblems((me.workbook?.done||0)+n)}
async function setProblems(v){
  if(!me||me.status==='finished')return;const w=me.workbook||{},next=clamp(Number.isFinite(v)?v:+v||0,0,w.goal||w.total||0),old=w.done||0,delta=next-old;if(!delta)return;
  const progress=Math.max(0,(me.problemsSolved||0)+delta);local.progress[w.id]=next;save();await updateDoc(partRef(),{workbook:{...w,done:next},problemsSolved:progress,updatedAtMs:now(),presenceAtMs:now()});await sendEvent('problems',{delta,done:next});if(next>=(w.goal||w.total||0))toast('목표 문제 수를 채웠습니다. 채점하거나 다음 문제집을 펼치세요.')
}
async function setStatus(next){if(!me||me.status==='finished')return;try{const t=timerTransition(me,next);await updateDoc(partRef(),{status:next,timer:t,updatedAtMs:now(),presenceAtMs:now()});await sendEvent(next)}catch(e){if(e.message==='TIMER_INVALID')timerRecovery()}}
async function toggleGrading(){if(me?.status==='grading')return setStatus('studying');if(me?.status==='break'||me?.status==='paused')return toast('먼저 공부를 재개한 뒤 채점을 시작하세요.');return setStatus('grading')}
async function toggleBreak(){if(me?.status==='break')return setStatus('studying');if(me?.status==='paused')return toast('일시정지 상태입니다. RESUME을 먼저 누르세요.');return setStatus('break')}
async function togglePause(){if(me?.status==='paused')return setStatus('studying');return setStatus('paused')}
function timerRecovery(){
  const raw=me?.timer||{};const box=document.createElement('div');box.className='modal-backdrop';box.innerHTML=`<section class="paper modal"><h2>타이머 복구 필요</h2><p>연속 세션 시간이 비정상적으로 길거나 타임스탬프가 잘못되어 자동 통계에 넣지 않았습니다. 기존 원본은 남기고 현재 시점부터 새 구간으로 복구합니다.</p><button id="recoverTimer" class="mechanical primary">현재 시점부터 복구</button></section>`;document.body.appendChild(box);$('#recoverTimer').onclick=async()=>{local.invalidLegacy.push({source:'v3-live',roomId,raw,invalid:true,at:now()});save();const t={...timerBase(room.sessionId),state:'studying',startedAtMs:now()};await updateDoc(partRef(),{status:'studying',timer:t,updatedAtMs:now()});box.remove()}
}
function openSwitchBook(){
  const box=document.createElement('div');box.className='modal-backdrop';box.id='switchModal';box.innerHTML=`<section class="paper modal"><div class="section-head"><h2>문제집 바꾸기</h2><button id="smClose">닫기</button></div><div class="switch-list">${local.workbooks.map(w=>`<button data-switch="${E(w.id)}"><b>${E(w.title)}</b><span>${E(w.subject)} · ${currentProgress(w)}/${w.goal}</span></button>`).join('')}</div><button id="smNew" class="mechanical">+ 새 문제집 만들기</button></section>`;document.body.appendChild(box);$('#smClose').onclick=()=>box.remove();$$('[data-switch]',box).forEach(b=>b.onclick=async()=>{await switchWorkbook(b.dataset.switch,true);box.remove()});$('#smNew').onclick=()=>bookEditor(null,()=>{box.remove();openSwitchBook()})
}
async function switchWorkbook(bookId,emit=true){const w=local.workbooks.find(x=>x.id===bookId);if(!w)return;const nw={...normalizeBook(w),done:currentProgress(w)};local.lastWorkbookId=w.id;save();if(roomId&&me){await updateDoc(partRef(),{workbook:nw,updatedAtMs:now(),presenceAtMs:now()});if(emit)await sendEvent('workbookSwitch',{title:w.title})}}
function copyBookFrom(otherUid){const p=participants.find(x=>x.uid===otherUid),w=p?.workbook;if(!w||!w.shared)return;const same=local.workbooks.find(x=>x.title===w.title&&x.subject===w.subject&&x.total===w.total);if(same)local.lastWorkbookId=same.id;else{const nw=normalizeBook({...w,id:id('wb'),createdAtMs:now()});local.workbooks.unshift(nw);local.lastWorkbookId=nw.id}save();toast('친구 문제집을 내 책장에 복사했습니다.')}
async function finishStudy(){
  if(!me||me.status==='finished')return;const at=now();if(at>finishArm){finishArm=at+2600;$('#finishStudy').textContent='한 번 더 눌러 FINISH';setTimeout(()=>{if($('#finishStudy')&&now()>finishArm)$('#finishStudy').textContent='FINISH'},2700);return}
  let t;try{t=timerTransition(me,'finished')}catch{return timerRecovery()};const finalStudy=t.accumulatedMs,finalGrade=t.gradingAccumulatedMs,finalBreak=t.breakAccumulatedMs;
  await updateDoc(partRef(),{status:'finished',timer:t,updatedAtMs:at,presenceAtMs:at});me={...me,status:'finished',timer:t};await sendEvent('finish');
  const w=me.workbook||{};local.archive.unshift({id:id('arc'),roomId,sessionId:room.sessionId,bookTitle:w.title||'문제집',subject:w.subject||'',studyMs:finalStudy,gradingMs:finalGrade,breakMs:finalBreak,problems:me.problemsSolved||0,team:assignments.get(uid)||'',campDay:room.campDay||1,finishedAtMs:at});local.archive=local.archive.slice(0,60);save();showReceipt(finalStudy,finalGrade)
}
function showReceipt(studyMs,gradeMs){
  const team=assignments.get(uid),teamPs=participants.filter(p=>assignments.get(p.uid)===team).reduce((a,p)=>a+(p.problemsSolved||0),0),teamTime=participants.filter(p=>assignments.get(p.uid)===team).reduce((a,p)=>a+activeStudyMs(p),0);
  const box=document.createElement('div');box.className='modal-backdrop';box.innerHTML=`<section class="receipt"><span>TODAY'S DESK</span><h2>${E(me.nickname)}</h2><div><b>집중</b><strong>${fmtShort(studyMs)}</strong></div><div><b>문제</b><strong>${me.problemsSolved||0}개</strong></div><div><b>채점</b><strong>${fmtShort(gradeMs)}</strong></div><hr><span>${teamLabel(team)}</span><div><b>총 집중</b><strong>${fmtShort(teamTime)}</strong></div><div><b>총 문제</b><strong>${teamPs}개</strong></div><button id="receiptHome" class="mechanical dark">책상 정리하고 나가기</button></section>`;document.body.appendChild(box);$('#receiptHome').onclick=leave
}
async function sendEvent(type,extra={}){if(!roomId)return;try{await addDoc(collection(db,'sidedeskRooms',roomId,'events'),{uid,nickname:me?.nickname||local.nickname||'친구',type,clientTs:now(),...extra,createdAt:serverTimestamp()})}catch{}}
function remoteEvent(e){if(e.type==='knock'){const d=document.getElementById('desk-'+CSS.escape(uid));d?.classList.add('knock');setTimeout(()=>d?.classList.remove('knock'),520);navigator.vibrate?.([18,35,18]);toast(`${e.nickname}가 책상을 똑똑 두드렸습니다.`)}else if(e.type==='note')sticky(e.note||'쪽지',e.nickname);else if(e.type==='grading')toast(`${e.nickname}가 채점을 시작했습니다.`);else if(e.type==='finish')toast(`${e.nickname}가 공부를 마쳤습니다.`)}
function sticky(note,from){const layer=$('#stickyLayer');if(!layer)return;const n=document.createElement('div');n.className='postit';n.innerHTML=`<b>${E(from)}</b><span>${E(note)}</span>`;layer.appendChild(n);requestAnimationFrame(()=>n.classList.add('show'));setTimeout(()=>{n.classList.remove('show');setTimeout(()=>n.remove(),300)},5200)}
function toast(t){const e=$('#toast');if(!e)return;e.textContent=t;e.classList.add('show');clearTimeout(e._t);e._t=setTimeout(()=>e.classList.remove('show'),2500)}
async function sendPresence(){if(!roomId||!me||me.status==='finished')return;try{await updateDoc(partRef(),{presenceAtMs:now(),visibility:document.hidden?'background':'active',updatedAtMs:now()})}catch{}}
function startPresence(){clearInterval(presenceTimer);sendPresence();presenceTimer=setInterval(sendPresence,25000)}
async function copyCode(){try{await navigator.clipboard.writeText(roomId);toast('참여 코드를 복사했습니다.')}catch{}}
function updateRoomMeta(){if($('#sharedProgress'))renderMetrics()}
function leave(){clearSubs();forgetRoom();roomId='';room=null;me=null;participants=[];assignments.clear();history.replaceState(null,'',location.pathname);landing()}

document.addEventListener('visibilitychange',()=>sendPresence());window.addEventListener('focus',()=>sendPresence());
boot().catch(e=>{console.error(e);fail('SideDesk 연결을 시작하지 못했습니다.')});
