import{initializeApp}from'https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js';
import{getAuth,signInAnonymously}from'https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js';
import{getFirestore,doc,getDoc,setDoc,updateDoc,onSnapshot,collection,addDoc,serverTimestamp,runTransaction,query,orderBy,limit}from'https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js';

const A=document.querySelector('#app'),cfg=globalThis.PINCON_FIREBASE_CONFIG;
const LS='sidedesk.v2';
let authUid='',room='',role='',name='',R=null,unsub,eu,timer,presenceTimer,started=0,cut=Date.now(),ownAt=0,historyId='',audioCtx=null,endArm=0,deferredInstall=null;
let activity={m:[],x:[]},eventsHydrated=false;
let local=loadLocal();

const E=s=>String(s||'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const C=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
const D=v=>({1:'가벼움',2:'보통',3:'어려움',4:'매우 어려움'})[+v]||'보통';
const P=p=>p?.total?Math.min(100,Math.round((p.done||0)/p.total*100)):0;
const SESSIONP=p=>{
  const start=Math.max(0,p?.startDone||0),total=Math.max(start+1,p?.total||1),fresh=Math.max(0,(p?.done||0)-start);
  return Math.min(100,Math.round(fresh/Math.max(1,total-start)*100))
};
const ACC=p=>{let n=(p?.correct||0)+(p?.wrong||0);return n?Math.round((p.correct||0)/n*100):null};
const code=()=>{let s='',c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';for(let i=0;i<6;i++)s+=c[Math.random()*c.length|0];return s};
const wid=()=>('wb_'+Date.now().toString(36)+Math.random().toString(36).slice(2,7));
const workbookKey=w=>String(w?.id||'')||[w?.title||'',w?.subject||'',w?.total||0].join('|');
function historyFor(w){
  const key=workbookKey(w);
  return local.history.filter(h=>(h.workbookId&&h.workbookId===key)||(!h.workbookId&&h.workbookTitle===w.title&&h.subject===w.subject));
}
function continuationFor(w){
  return historyFor(w).find(h=>(h.done||0)>0&&(h.done||0)<(h.total||w.total));
}
function workbookStats(w){
  const hs=historyFor(w);
  const answered=hs.reduce((a,h)=>a+(h.correct||0)+(h.wrong||0),0);
  const correct=hs.reduce((a,h)=>a+(h.correct||0),0);
  return{
    sessions:hs.length,
    problems:hs.reduce((a,h)=>a+Math.max(0,(h.done||0)-(h.startDone||0)),0),
    minutes:hs.reduce((a,h)=>a+minutesOf(h),0),
    accuracy:answered?Math.round(correct/answered*100):null
  };
}

function loadLocal(){
  try{
    const x=JSON.parse(localStorage.getItem(LS)||'{}');
    x.workbooks=Array.isArray(x.workbooks)?x.workbooks:[];
    x.history=Array.isArray(x.history)?x.history:[];
    if(typeof x.sound!=='boolean')x.sound=true;
    return x;
  }catch{return{workbooks:[],history:[],sound:true}}
}
function saveLocal(){try{localStorage.setItem(LS,JSON.stringify(local))}catch{}}
function audio(){
  if(!local.sound)return null;
  try{
    audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)();
    if(audioCtx.state==='suspended')audioCtx.resume();
    return audioCtx
  }catch{return null}
}
function sound(type){
  const a=audio();if(!a)return;
  const now=a.currentTime;
  if(type==='page'){
    const n=a.createBufferSource(),buf=a.createBuffer(1,Math.floor(a.sampleRate*.09),a.sampleRate),d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*(1-i/d.length)*.11;
    const f=a.createBiquadFilter(),g=a.createGain();f.type='highpass';f.frequency.value=900;g.gain.setValueAtTime(.45,now);g.gain.exponentialRampToValueAtTime(.01,now+.1);
    n.buffer=buf;n.connect(f).connect(g).connect(a.destination);n.start(now)
  }else if(type==='tap'){
    const o=a.createOscillator(),g=a.createGain();o.type='sine';o.frequency.setValueAtTime(120,now);o.frequency.exponentialRampToValueAtTime(72,now+.055);g.gain.setValueAtTime(.12,now);g.gain.exponentialRampToValueAtTime(.001,now+.07);o.connect(g).connect(a.destination);o.start(now);o.stop(now+.08)
  }else if(type==='sync'){
    [0,0.08].forEach((x,i)=>{const o=a.createOscillator(),g=a.createGain();o.frequency.value=i?660:520;g.gain.setValueAtTime(.055,now+x);g.gain.exponentialRampToValueAtTime(.001,now+x+.11);o.connect(g).connect(a.destination);o.start(now+x);o.stop(now+x+.12)})
  }else if(type==='static'){
    const n=a.createBufferSource(),buf=a.createBuffer(1,Math.floor(a.sampleRate*.16),a.sampleRate),d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*(.12*(1-i/d.length));
    const f=a.createBiquadFilter(),g=a.createGain();f.type='bandpass';f.frequency.value=1800;f.Q.value=.7;g.gain.value=.18;
    n.buffer=buf;n.connect(f).connect(g).connect(a.destination);n.start(now)
  }
}
function rememberRoom(){local.activeRoom={room,role,name,at:Date.now()};saveLocal()}
function forgetRoom(){delete local.activeRoom;saveLocal()}
async function resumeOrLanding(){
  const a=local.activeRoom;
  if(!a?.room||!a?.role)return landing();
  try{
    const snap=await getDoc(doc(db,'sidedeskRooms',a.room));
    if(!snap.exists())throw Error('missing');
    const d=snap.data(),p=d[a.role];
    if(!p||p.uid!==authUid)throw Error('identity');
    room=a.room;role=a.role;name=a.name||p.nickname;R=d;
    if(d.status==='studying')study();else lobby();
    bind();
  }catch{forgetRoom();landing()}
}
function ensureWorkbook(){
  if(!local.workbooks.length){
    local.workbooks.push({id:wid(),title:'오늘의 문제집',subject:'수학',total:20,difficulty:2,createdAt:Date.now()});
    local.lastWorkbookId=local.workbooks[0].id;saveLocal();
  }
}
function activeWorkbook(){
  ensureWorkbook();
  return local.workbooks.find(w=>w.id===local.lastWorkbookId)||local.workbooks[0];
}
function normalizeWorkbook(w={}){
  return{
    id:String(w.id||wid()).slice(0,80),
    title:String(w.title||'이름 없는 문제집').trim().slice(0,40)||'이름 없는 문제집',
    subject:String(w.subject||'기타').trim().slice(0,20)||'기타',
    total:Math.max(1,Math.min(300,+w.total||20)),
    difficulty:Math.max(1,Math.min(4,+w.difficulty||2)),
    createdAt:+w.createdAt||Date.now()
  };
}
function player(n){
  let w=normalizeWorkbook(activeWorkbook());
  return{uid:authUid,nickname:n,workbook:w,total:w.total,difficulty:w.difficulty,startDone:0,done:0,correct:0,wrong:0,skipped:0,status:'ready',presenceAtMs:Date.now(),visibility:'active',problemAtMs:Date.now(),updatedAtMs:Date.now()};
}
function fail(m){A.innerHTML='<main class="app"><div class="shell"><div class="paper error" style="max-width:520px;margin:20vh auto">'+E(m)+'</div></div></main>'}

if(!cfg){fail('Firebase 설정을 찾지 못했습니다.');throw 0}
const fa=initializeApp(cfg,'sidedesk-v2'),auth=getAuth(fa),db=getFirestore(fa);

function minutesOf(h){return Math.max(1,Math.round(((h.endedAt||h.lastSeenAt||Date.now())-h.startedAt)/60000))}
function weeklyStats(){
  const since=Date.now()-7*86400000,hs=local.history.filter(h=>h.startedAt>=since);
  return{
    sessions:hs.length,
    problems:hs.reduce((a,h)=>a+(h.done||0),0),
    minutes:hs.reduce((a,h)=>a+minutesOf(h),0)
  };
}
function recentHistory(){
  return local.history.slice(0,4).map(h=>{
    const min=minutesOf(h);
    const acc=(h.correct+h.wrong)?Math.round(h.correct/(h.correct+h.wrong)*100):null;
    const pct=h.total?Math.min(100,Math.round((h.done||0)/h.total*100)):0;
    const fresh=Math.max(0,(h.done||0)-(h.startDone||0));
    return '<button type="button" class="history-item history-click" data-history="'+E(h.id)+'"><span class="history-bookmark"></span><div><div class="history-title">'+E(h.workbookTitle)+'</div><div class="small">'+E(h.subject)+' · 이번 +'+fresh+'문항 · 전체 '+h.done+'/'+h.total+(acc==null?'':' · '+acc+'%')+' · '+min+'분</div><div class="history-progress"><i style="width:'+pct+'%"></i></div></div></button>'
  }).join('')||'<div class="small">아직 공부 기록이 없습니다.</div>';
}
function historyPanel(){
  document.querySelector('#historyPanel')?.remove();
  const host=document.querySelector('.shell');if(!host)return;
  const panel=document.createElement('section');panel.id='historyPanel';panel.className='paper history-panel';
  panel.innerHTML='<div class="section-title"><div><div class="kicker">LOCAL ARCHIVE</div><h2>내 공부 책장</h2></div><button id="historyClose" class="btn ghost" style="min-height:38px">닫기</button></div>'+
    '<div class="bookcase">'+(local.history.length?local.history.map((h,i)=>{
      const pct=h.total?Math.min(100,Math.round((h.done||0)/h.total*100)):0;
      const acc=(h.correct+h.wrong)?Math.round(h.correct/(h.correct+h.wrong)*100):null;
      const date=new Date(h.startedAt).toLocaleDateString('ko-KR',{month:'numeric',day:'numeric'});
      return '<article class="archive-book" style="--book-i:'+(i%6)+'"><div class="archive-spine"></div><div class="archive-body"><div class="kicker">'+E(date)+' · '+E(h.subject)+'</div><b>'+E(h.workbookTitle)+'</b><div class="small">'+h.done+'/'+h.total+'문항 · '+minutesOf(h)+'분'+(acc==null?'':' · '+acc+'%')+'</div><div class="history-progress"><i style="width:'+pct+'%"></i></div></div></article>'
    }).join(''):'<div class="small">기록이 쌓이면 여기에 책처럼 꽂힙니다.</div>')+'</div>';
  host.appendChild(panel);historyClose.onclick=()=>panel.remove();panel.scrollIntoView({behavior:'smooth',block:'start'});
}
function landing(){
  ensureWorkbook();
  A.innerHTML='<main class="app"><div class="shell"><header class="top"><div class="brand"><div class="logo">SD</div><div><h1 class="title">SideDesk</h1><div class="muted">멀리 있어도 같은 책상처럼.</div></div></div><div class="row"><button id="installApp" class="btn ghost hidden" style="min-height:36px;padding:6px 10px">앱 설치</button><span class="badge">● 실시간 연결됨</span></div></header>'+
  '<section class="desk lobby"><div class="paper"><h2 style="margin-top:0">공부방</h2><p class="muted">각자 실제 문제집을 펴고, 진행과 손짓만 연결합니다.</p>'+
  '<div class="field"><label>닉네임</label><input id="nick" class="input" maxlength="14" value="'+E(local.nickname||'')+'" placeholder="예: 도영"></div>'+
  '<button id="mk" class="btn primary" style="width:100%;margin-top:14px">새 방 만들기</button>'+
  '<div style="height:1px;background:#bca98f;margin:18px 0"></div>'+
  '<div class="field"><label>친구 방 코드</label><div class="join-code-shell"><span class="join-code-label">CHANNEL CODE</span><input id="jc" class="input join-code-input" maxlength="6" placeholder="______" inputmode="text" autocomplete="off"></div></div>'+
  '<button id="jn" class="btn" style="width:100%;margin-top:12px">친구 방 들어가기</button><div id="err" class="error hidden"></div></div>'+
  '<div class="paper"><div class="section-title"><h2>내 문제집</h2><button id="newwb" class="btn ghost" style="min-height:40px;padding:7px 10px">+ 만들기</button></div>'+
  '<div id="landingShelf" class="shelf"></div><div class="weekly-strip" id="weeklyStrip"></div><div class="section-title" style="margin-top:18px"><h3>최근 공부</h3><button id="historyAll" class="btn ghost" style="min-height:38px;padding:6px 10px">책장 보기</button></div><div class="history">'+recentHistory()+'</div></div></section></div></main>';
  renderLandingShelf();
  const invited=C(new URLSearchParams(location.search).get('room')||'');
  if(invited){jc.value=invited}
  const ws=weeklyStats();
  weeklyStrip.innerHTML='<div><b>'+ws.sessions+'</b><span>세션</span></div><div><b>'+ws.problems+'</b><span>문항</span></div><div><b>'+ws.minutes+'</b><span>분</span></div>';
  mk.onclick=create;jn.onclick=join;newwb.onclick=()=>workbookEditor(null,renderLandingShelf);historyAll.onclick=historyPanel;
  if(deferredInstall&&!matchMedia('(display-mode: standalone)').matches){installApp.classList.remove('hidden');installApp.onclick=promptInstall}
  document.querySelectorAll('.history-click').forEach(b=>b.onclick=historyPanel);
  jc.oninput=e=>e.target.value=C(e.target.value);
}
function renderLandingShelf(){
  const box=document.querySelector('#landingShelf');if(!box)return;
  box.innerHTML=local.workbooks.slice(0,4).map(w=>{
    const last=historyFor(w)[0],st=workbookStats(w);
    const lastText=last?' · 최근 '+last.done+'/'+last.total:'';
    const statsText=st.sessions?' · 누적 '+st.problems+'문항/'+st.minutes+'분':'';
    return '<div class="shelf-item"><div class="book-spine"></div><div><b>'+E(w.title)+'</b><div class="small">'+E(w.subject)+' · '+w.total+'문항 · '+E(D(w.difficulty))+lastText+statsText+'</div></div><button class="btn ghost" data-wb="'+E(w.id)+'" style="min-height:38px;padding:6px 9px">'+(w.id===local.lastWorkbookId?'선택됨':'선택')+'</button></div>'
  }).join('');
  box.querySelectorAll('[data-wb]').forEach(b=>b.onclick=()=>{local.lastWorkbookId=b.dataset.wb;saveLocal();renderLandingShelf()});
}
function workbookEditor(existing,after){
  const old=document.querySelector('#editor');old?.remove();
  const w=existing?normalizeWorkbook(existing):{id:wid(),title:'',subject:'',total:20,difficulty:2,createdAt:Date.now()};
  const host=document.querySelector('.shell');if(!host)return;
  const el=document.createElement('section');el.id='editor';el.className='paper';el.style='max-width:620px;margin:14px auto';
  el.innerHTML='<div class="section-title"><h2>'+(existing?'문제집 수정':'새 문제집 만들기')+'</h2><button id="edx" class="btn ghost" style="min-height:38px">닫기</button></div>'+
  '<div class="split"><div class="field"><label>문제집 이름</label><input id="wbt" class="input" maxlength="40" value="'+E(w.title)+'" placeholder="예: 공통수학2 유형서"></div>'+
  '<div class="field"><label>과목</label><input id="wbs" class="input" maxlength="20" value="'+E(w.subject)+'" placeholder="예: 수학"></div>'+
  '<div class="field"><label>문항 수</label><input id="wbn" class="input" type="number" min="1" max="300" value="'+w.total+'"></div>'+
  '<div class="field"><label>난이도</label><select id="wbd" class="select"><option value="1">가벼움</option><option value="2">보통</option><option value="3">어려움</option><option value="4">매우 어려움</option></select></div></div>'+
  '<button id="eds" class="btn primary" style="width:100%;margin-top:14px">문제집 저장</button>'+(existing?'<button id="edd" class="btn danger" style="width:100%;margin-top:10px">이 문제집 삭제</button>':'');
  host.appendChild(el);wbd.value=String(w.difficulty);edx.onclick=()=>el.remove();
  if(existing&&document.querySelector('#edd'))edd.onclick=()=>deleteWorkbook(w.id,el,after);
  eds.onclick=async()=>{
    const nw=normalizeWorkbook({id:w.id,title:wbt.value,subject:wbs.value,total:wbn.value,difficulty:wbd.value,createdAt:w.createdAt});
    if(!wbt.value.trim())return wbt.focus();
    const i=local.workbooks.findIndex(x=>x.id===nw.id);
    if(i>=0)local.workbooks[i]=nw;else local.workbooks.unshift(nw);
    local.lastWorkbookId=nw.id;saveLocal();el.remove();after?.();
    if(R&&document.querySelector('#lobbyScreen'))await selectWorkbook(nw.id);
  };
  el.scrollIntoView({behavior:'smooth',block:'center'});
}
function deleteWorkbook(id,editor,after){
  if(local.workbooks.length<=1){
    editor.querySelector('#edd').textContent='문제집은 최소 1개 필요해요';setTimeout(()=>{const b=editor.querySelector('#edd');if(b)b.textContent='이 문제집 삭제'},1600);return
  }
  const b=editor.querySelector('#edd'),armed=b.dataset.armed==='1';
  if(!armed){b.dataset.armed='1';b.textContent='한 번 더 눌러 삭제';setTimeout(()=>{if(b){b.dataset.armed='0';b.textContent='이 문제집 삭제'}},2800);return}
  local.workbooks=local.workbooks.filter(x=>x.id!==id);
  if(local.lastWorkbookId===id)local.lastWorkbookId=local.workbooks[0]?.id||'';
  saveLocal();editor.remove();after?.()
}
const err=m=>{let e=document.querySelector('#err');if(e){e.textContent=m;e.classList.remove('hidden')}};
function setNick(){const n=document.querySelector('#nick')?.value.trim();if(n){local.nickname=n;saveLocal()}return n}
async function create(){
  let n=setNick();if(!n)return err('닉네임을 입력해 주세요.');
  name=n;role='host';
  for(let i=0;i<5;i++){
    let x=code(),r=doc(db,'sidedeskRooms',x);if((await getDoc(r)).exists())continue;
    room=x;await setDoc(r,{version:2,status:'lobby',host:player(n),guest:null,createdAtMs:Date.now(),startedAtMs:null,updatedAt:serverTimestamp()});
    rememberRoom();history.replaceState(null,'',location.pathname+'?room='+room);lobby();bind();return
  }err('방 코드를 만들지 못했습니다.')
}
async function join(){
  let n=setNick(),x=C(document.querySelector('#jc')?.value);if(!n)return err('닉네임을 입력해 주세요.');if(x.length!==6)return err('6자리 코드를 입력해 주세요.');
  try{
    let r=doc(db,'sidedeskRooms',x);
    await runTransaction(db,async t=>{
      let s=await t.get(r);if(!s.exists())throw Error('없음');let d=s.data();
      if(d.status!=='lobby')throw Error('시작');if(d.guest)throw Error('가득');
      t.update(r,{guest:player(n),updatedAt:serverTimestamp()})
    });
    room=x;name=n;role='guest';rememberRoom();history.replaceState(null,'',location.pathname+'?room='+room);lobby();bind()
  }catch(e){err(e.message==='없음'?'방을 찾지 못했습니다.':e.message==='가득'?'이미 두 명이 들어와 있습니다.':e.message==='시작'?'이미 시작한 방입니다.':'입장하지 못했습니다.')}
}
function bookMarkup(w,id='book'){
  w=normalizeWorkbook(w);
  return '<div class="book-stage"><div class="book" id="'+id+'"><div class="pages"></div><div class="open-page"><div class="kicker">'+E(w.subject)+'</div><b>'+E(w.title)+'</b><div class="small" style="margin-top:8px">'+w.total+'문항 · '+E(D(w.difficulty))+'</div><div class="page-lines" style="margin-top:12px"></div></div><div class="cover"><span>'+E(w.subject)+'</span><strong>'+E(w.title)+'</strong><span>'+w.total+' QUESTIONS · '+E(D(w.difficulty))+'</span></div></div></div>';
}
function openBook(id){requestAnimationFrame(()=>setTimeout(()=>document.querySelector('#'+id)?.classList.add('open'),70))}
function lobby(){
  const w=activeWorkbook();
  A.innerHTML='<main class="app" id="lobbyScreen"><div class="shell"><header class="top"><div class="brand"><div class="logo">SD</div><div><h1 class="title">SideDesk</h1><div class="muted">문제집을 고르고 친구를 기다리세요.</div></div></div><span class="badge">ROOM '+room+'</span></header>'+
  '<section class="desk lobby"><div class="paper"><div class="kicker">ROOM CODE</div><div class="analog-module"><i class="screw s1"></i><i class="screw s2"></i><i class="screw s3"></i><i class="screw s4"></i><div class="code analog-code tuning" id="roomCode" aria-label="참여 코드">'+room+'</div><div class="analog-caption"><span>LINK / 01</span><span id="signalText">TUNING</span></div></div><button id="shareInvite" class="btn ghost" style="width:100%;margin-top:10px">초대 링크 공유</button>'+
  '<div class="status" style="margin-top:14px"><span><i class="dot on"></i> <b>'+E(name)+'</b></span><span>준비됨</span></div>'+
  '<div class="status" style="margin-top:8px"><span><i id="fd" class="dot"></i> <b id="fn">친구 기다리는 중</b></span><span id="fr">대기</span></div>'+
  '<div class="section-title" style="margin-top:18px"><h3>친구 문제집</h3><button id="copywb" class="btn ghost hidden" style="min-height:38px;padding:6px 9px">내 목록에 저장</button></div><div id="friendBook" class="small">친구가 들어오면 여기에 표시됩니다.</div>'+
  '<button class="btn" id="leave" style="width:100%;margin-top:16px">나가기</button></div>'+
  '<div class="paper"><div class="section-title"><h2>내 문제집</h2><button id="newwb" class="btn ghost" style="min-height:40px;padding:7px 10px">+ 새 문제집</button></div>'+
  bookMarkup(w,'myBook')+
  '<div id="resumeBox"></div><div id="workbookStatsBox"></div>'+
  '<div class="field"><label>문제집 선택</label><select id="wbselect" class="select">'+local.workbooks.map(x=>'<option value="'+E(x.id)+'" '+(x.id===w.id?'selected':'')+'>'+E(x.title)+' · '+E(x.subject)+'</option>').join('')+'</select></div>'+
  '<div class="row" style="margin-top:10px"><button id="editwb" class="btn ghost" style="flex:1">현재 문제집 수정</button></div>'+
  '<button id="go" class="btn primary start-lever" style="width:100%;margin-top:14px" disabled>'+(role==='host'?'친구를 기다리는 중':'방장이 시작하면 자동 시작')+'</button></div></section></div></main>';
  leave.onclick=leaveRoom;shareInvite.onclick=shareRoom;newwb.onclick=()=>workbookEditor(null,renderLobbyLibrary);editwb.onclick=()=>workbookEditor(activeWorkbook(),renderLobbyLibrary);
  wbselect.onchange=()=>selectWorkbook(wbselect.value);if(role==='host')go.onclick=start;copywb.onclick=copyFriendWorkbook;openBook('myBook');renderWorkbookExtras(w);
  analogCodeReveal(document.querySelector('#roomCode'),room);
  roomCode.onclick=copyRoomCode;roomCode.title='눌러서 코드 복사';
}
function renderWorkbookExtras(w){
  const rb=document.querySelector('#resumeBox'),sb=document.querySelector('#workbookStatsBox');if(!rb||!sb)return;
  const h=continuationFor(w),st=workbookStats(w);
  sb.innerHTML='<div class="workbook-stats"><div><b>'+st.sessions+'</b><span>세션</span></div><div><b>'+st.problems+'</b><span>누적 문항</span></div><div><b>'+st.minutes+'</b><span>누적 분</span></div><div><b>'+(st.accuracy==null?'–':st.accuracy+'%')+'</b><span>누적 정확도</span></div></div>';
  if(!h){rb.innerHTML='';return}
  const next=Math.min((h.done||0)+1,w.total);
  rb.innerHTML='<div class="resume-note"><div><div class="kicker">CONTINUE</div><b>지난번 '+h.done+'/'+h.total+'까지</b><span>'+next+'번부터 이어서 풀 수 있어요.</span></div><div class="row"><button id="resumeYes" class="btn primary">이어하기</button><button id="resumeNo" class="btn ghost">처음부터</button></div></div>';
  resumeYes.onclick=()=>applyStartPoint(w,h.done||0,true);
  resumeNo.onclick=()=>applyStartPoint(w,0,false);
}
async function applyStartPoint(w,done,isResume){
  if(!R){const s=await getDoc(doc(db,'sidedeskRooms',room));if(s.exists())R=s.data()}
  if(!R)return;
  const p={...R[role],workbook:normalizeWorkbook(w),total:w.total,difficulty:w.difficulty,startDone:done,done,correct:0,wrong:0,skipped:0,status:'ready',problemAtMs:Date.now(),updatedAtMs:Date.now()};
  await updateDoc(doc(db,'sidedeskRooms',room),{[role]:p,updatedAt:serverTimestamp()});
  const rb=document.querySelector('#resumeBox');if(rb)rb.innerHTML='<div class="resume-applied">'+(isResume?(done+1)+'번부터 이어서 시작':'처음부터 시작')+'</div>'
}
function analogCodeReveal(el,value){
  if(!el)return;
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789#%*+=';
  let tick=0,locked=0;el.classList.add('tuning');
  const iv=setInterval(()=>{
    tick++;
    if(tick%2===0&&locked<value.length)locked++;
    let out='';
    for(let i=0;i<value.length;i++)out+=i<locked?value[i]:chars[Math.floor(Math.random()*chars.length)];
    el.textContent=out;
    if(tick===1)sound('static');
    if(locked>=value.length){
      clearInterval(iv);el.textContent=value;
      setTimeout(()=>{el.classList.remove('tuning');document.querySelector('#signalText')?.replaceChildren(document.createTextNode('LOCKED'))},150)
    }
  },55)
}
async function copyRoomCode(){
  try{
    await navigator.clipboard?.writeText(room);
    roomCode.classList.add('copied');signalText.textContent='COPIED';
    setTimeout(()=>{roomCode.classList.remove('copied');signalText.textContent='LOCKED'},1100)
  }catch{}
}
async function promptInstall(){
  if(!deferredInstall)return;
  deferredInstall.prompt();
  try{await deferredInstall.userChoice}catch{}
  deferredInstall=null;document.querySelector('#installApp')?.classList.add('hidden')
}
async function shareRoom(){
  const url=location.origin+location.pathname+'?room='+room;
  const data={title:'SideDesk 공부방',text:name+'님이 SideDesk 공부방에 초대했습니다. 방 코드 '+room,url};
  try{
    if(navigator.share){await navigator.share(data);return}
    if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(url);shareInvite.textContent='링크 복사됨';setTimeout(()=>shareInvite.textContent='초대 링크 공유',1300);return}
  }catch(e){if(e?.name==='AbortError')return}
  prompt('이 링크를 친구에게 보내세요.',url);
}
function leaveRoom(){
  forgetRoom();unsub?.();eu?.();clearInterval(timer);clearInterval(presenceTimer);history.replaceState(null,'',location.pathname);location.reload()
}
async function renderLobbyLibrary(){
  if(!document.querySelector('#lobbyScreen'))return;
  const w=activeWorkbook(),sel=document.querySelector('#wbselect');
  if(sel){sel.innerHTML=local.workbooks.map(x=>'<option value="'+E(x.id)+'" '+(x.id===w.id?'selected':'')+'>'+E(x.title)+' · '+E(x.subject)+'</option>').join('')}
  const old=document.querySelector('#myBook')?.closest('.book-stage');
  if(old){const holder=document.createElement('div');holder.innerHTML=bookMarkup(w,'myBook');old.replaceWith(holder.firstElementChild);openBook('myBook')}
  await selectWorkbook(w.id);
}
async function selectWorkbook(id){
  const w=local.workbooks.find(x=>x.id===id);if(!w)return;
  if(!R){const s=await getDoc(doc(db,'sidedeskRooms',room));if(s.exists())R=s.data()}
  if(!R)return;
  local.lastWorkbookId=id;saveLocal();
  let p={...R[role],workbook:normalizeWorkbook(w),total:w.total,difficulty:w.difficulty,startDone:0,done:0,correct:0,wrong:0,skipped:0,status:'ready',problemAtMs:Date.now(),updatedAtMs:Date.now()};
  await updateDoc(doc(db,'sidedeskRooms',room),{[role]:p,updatedAt:serverTimestamp()});renderWorkbookExtras(w)
}
function copyFriendWorkbook(){
  const f=R?.[role==='host'?'guest':'host'];if(!f?.workbook)return;
  let w=normalizeWorkbook({...f.workbook,id:wid(),createdAt:Date.now()});
  const same=local.workbooks.find(x=>x.title===w.title&&x.subject===w.subject&&x.total===w.total&&x.difficulty===w.difficulty);
  if(same)local.lastWorkbookId=same.id;else{local.workbooks.unshift(w);local.lastWorkbookId=w.id}
  saveLocal();renderLobbyLibrary();
}
async function start(){
  if(role!=='host'||!R?.guest)return;
  let t=Date.now();
  await updateDoc(doc(db,'sidedeskRooms',room),{
    host:{...R.host,status:'solving',presenceAtMs:t,visibility:'active',problemAtMs:R.host.problemAtMs||t,updatedAtMs:t},guest:{...R.guest,status:'solving',presenceAtMs:t,visibility:'active',problemAtMs:R.guest.problemAtMs||t,updatedAtMs:t},
    status:'studying',startedAtMs:t,updatedAt:serverTimestamp()
  });event('start')
}
function bind(){
  unsub?.();eu?.();cut=Date.now();
  unsub=onSnapshot(doc(db,'sidedeskRooms',room),s=>{
    if(!s.exists())return fail('방이 사라졌습니다.');
    R=s.data();
    if(R.status==='studying'&&!document.querySelector('#study'))study();
    if(document.querySelector('#lobbyScreen'))updateLobby();
    if(document.querySelector('#study'))updateStudy();
  });
  let q=query(collection(db,'sidedeskRooms',room,'events'),orderBy('clientTs','desc'),limit(25));eventsHydrated=false;
  eu=onSnapshot(q,s=>{
    if(!eventsHydrated){
      const rows=s.docs.map(d=>d.data()).filter(e=>['correct','wrong','skip'].includes(e.type)).reverse();
      activity.m=rows.filter(e=>e.uid===authUid).slice(-12).map(e=>({type:e.type,at:e.clientTs||0}));
      activity.x=rows.filter(e=>e.uid!==authUid).slice(-12).map(e=>({type:e.type,at:e.clientTs||0}));
      renderRail('m');renderRail('x');eventsHydrated=true
    }
    s.docChanges().forEach(ch=>{let e=ch.doc.data();if(ch.type==='added'&&e.uid!==authUid&&(e.clientTs||0)>=cut)remote(e)})
  })
}
function updateLobby(){
  let m=R?.[role],f=R?.[role==='host'?'guest':'host'];if(!m)return;
  if(f){
    fd.classList.add('on');fn.textContent=f.nickname;fr.textContent='준비됨';
    friendBook.innerHTML='<b>'+E(f.workbook?.title||'문제집')+'</b><div class="small">'+E(f.workbook?.subject||'기타')+' · '+(f.workbook?.total||f.total)+'문항 · '+E(D(f.workbook?.difficulty||f.difficulty))+'</div>';
    copywb.classList.remove('hidden');
    if(role==='host'){go.disabled=false;go.textContent='두 문제집 펼치고 시작'}
  }
}
function study(){
  started=R.startedAtMs||Date.now();beginHistory();
  A.innerHTML='<main class="app study-open" id="study"><div class="shell"><header class="top"><div class="brand"><div class="logo">SD</div><div><h1 class="title">Shared Desk</h1><div class="muted">각자 다른 문제집, 같은 공부 시간.</div></div></div><div class="row"><button id="soundToggle" class="sound-toggle" type="button">'+(local.sound?'소리 켬':'소리 끔')+'</button><span id="rs" class="badge">● 같이 공부 중</span></div></header>'+
  '<section id="desk" class="desk"><div class="study"><div class="paper player" id="me"><div class="presence-lamp" id="mpresence"><i></i><span>함께 있음</span></div><div class="desk-tool"><span class="pencil" id="mpencil"></span><span class="eraser"></span></div><div class="head"><b id="mn">나</b><span id="ms" class="muted">풀이 중</span></div><div id="mbook" class="workbook-chip"></div><div class="problem-slip" id="mslip"><span>현재 문항</span><b id="mcurrent">1</b><em id="mage">시작함</em></div><div style="margin:15px 0 10px"><span id="md" class="num">0</span><span class="muted"> / <span id="mt">20</span></span></div><div class="progress"><div id="mb" class="bar"></div></div><div class="head" style="margin-top:10px"><span id="mp" class="muted">0%</span><span id="ma" class="muted">정확도 -</span></div><div class="activity-rail" id="mrail" aria-label="최근 풀이 리듬"></div></div>'+
  '<div class="timer"><div><span class="muted" style="color:#9fb49a">STUDY TIME</span><strong id="clock">00:00</strong><span id="pace" class="muted" style="color:#aabca6">같이 시작함</span></div></div>'+
  '<div class="paper player" id="friend"><div class="presence-lamp" id="xpresence"><i></i><span>연결 확인</span></div><div class="desk-tool friend-tool"><span class="pencil" id="xpencil"></span><span class="eraser"></span></div><div class="head"><b id="xn">친구</b><span id="xs" class="muted">풀이 중</span></div><div id="xbook" class="workbook-chip"></div><div class="problem-slip" id="xslip"><span>현재 문항</span><b id="xcurrent">1</b><em id="xage">시작함</em></div><div style="margin:15px 0 10px"><span id="xd" class="num">0</span><span class="muted"> / <span id="xt">20</span></span></div><div class="progress"><div id="xb" class="bar friendbar"></div></div><div class="head" style="margin-top:10px"><span id="xp" class="muted">0%</span><span id="xa" class="muted">정확도 -</span></div><div class="activity-rail" id="xrail" aria-label="친구의 최근 풀이 리듬"></div></div></div>'+
  '<div class="actions"><button id="ok" class="btn action">✓ 정답</button><button id="no" class="btn action">× 오답</button><button id="sk" class="btn action">→ 보류</button></div>'+
  '<div class="secondary secondary-three"><button id="tap" class="btn">책상 톡</button><button id="pause" class="btn">잠깐 멈춤</button><button id="finish" class="btn ghost">공부 마치기</button></div><div id="live" class="live">친구의 행동이 여기에 바로 나타납니다.</div><div id="trace" class="trace"></div><section id="summary" class="session-summary hidden"></section></section></div></main>';
  ok.onclick=()=>mark('correct');no.onclick=()=>mark('wrong');sk.onclick=()=>mark('skip');
  tap.onclick=async()=>{sound('tap');await event('tap');msg('친구 책상을 톡 건드렸습니다.');tr(name+' · 책상 톡');navigator.vibrate?.(18)};
  pause.onclick=togglePause;finish.onclick=finishStudy;
  soundToggle.onclick=()=>{local.sound=!local.sound;saveLocal();soundToggle.textContent=local.sound?'소리 켬':'소리 끔';if(local.sound)audio()};
  ticker();startPresence();updateStudy()
}
async function mark(type){
  let ref=doc(db,'sidedeskRooms',room),done=0;
  await runTransaction(db,async t=>{
    let s=await t.get(ref),d=s.data(),m=d[role];if(!m||m.status==='paused'||m.done>=m.total)return;
    let now=Date.now(),n={...m,done:m.done+1,problemAtMs:now,presenceAtMs:now,visibility:'active',updatedAtMs:now};
    if(type==='correct')n.correct=(m.correct||0)+1;if(type==='wrong')n.wrong=(m.wrong||0)+1;if(type==='skip')n.skipped=(m.skipped||0)+1;
    if(n.done>=n.total)n.status='done';done=n.done;t.update(ref,{[role]:n,updatedAt:serverTimestamp()})
  });
  if(done){ownAt=Date.now();pushActivity('m',type);animatePage('m',type);sound('page');await event(type,{done});msg('내 '+label(type)+' 기록이 친구 화면에 전달됐습니다.');tr(name+' · '+label(type));navigator.vibrate?.(12)}
}
async function finishStudy(){
  const now=Date.now();
  if(now>endArm){endArm=now+3200;finish.textContent='한 번 더 눌러 종료';setTimeout(()=>{if(Date.now()>endArm&&document.querySelector('#finish'))finish.textContent='공부 마치기'},3300);return}
  const m=R?.[role];if(!m)return;
  await updateDoc(doc(db,'sidedeskRooms',room),{[role]:{...m,status:'done',updatedAtMs:Date.now()},updatedAt:serverTimestamp()});
  await event('finish',{done:m.done||0});finish.textContent='종료됨';msg('내 공부를 여기서 마쳤습니다. 기록은 저장되었습니다.')
}
async function togglePause(){
  let m=R?.[role];if(!m||m.status==='done')return;let x=m.status==='paused';
  await updateDoc(doc(db,'sidedeskRooms',room),{[role]:{...m,status:x?'solving':'paused',updatedAtMs:Date.now()},updatedAt:serverTimestamp()});event(x?'resume':'pause')
}
async function event(type,x={}){await addDoc(collection(db,'sidedeskRooms',room,'events'),{uid:authUid,nickname:name,type,clientTs:Date.now(),...x,createdAt:serverTimestamp()})}
const label=t=>({correct:'정답',wrong:'오답',skip:'보류',tap:'책상 톡',pause:'잠깐 멈춤',resume:'다시 시작',start:'시작',finish:'공부 종료'})[t]||t;
function updateStudy(){
  let m=R?.[role],f=R?.[role==='host'?'guest':'host'];if(!m||!f)return;
  fill('m',m);fill('x',f);
  let a=SESSIONP(m),b=SESSIONP(f);pace.textContent=a===b?'이번 세션은 거의 같은 속도':a>b?'이번 세션 내가 '+(a-b)+'% 앞서는 중':'이번 세션 친구가 '+(b-a)+'% 앞서는 중';
  pause.textContent=m.status==='paused'?'다시 시작':'잠깐 멈춤';
  let dis=m.status==='paused'||m.status==='done';ok.disabled=no.disabled=sk.disabled=dis;
  if(document.querySelector('#finish')){
    if(m.status==='done'&&f.status!=='done'){finish.disabled=false;finish.textContent='홈으로';finish.onclick=leaveRoom}
    else if(m.status!=='done'){finish.disabled=false;finish.onclick=finishStudy}
    else finish.disabled=true
  }
  syncHistory(m,f);
  if(m.status==='done'&&f.status==='done'){
    rs.textContent='● 세션 완료';ok.disabled=no.disabled=sk.disabled=tap.disabled=pause.disabled=true;
    msg('둘 다 완료했습니다. 오늘 공부 기록도 이 기기에 저장했습니다.');showSummary(m,f)
  }
}
function fill(p,d){
  document.querySelector('#'+p+'n').textContent=d.nickname;
  document.querySelector('#'+p+'d').textContent=d.done||0;document.querySelector('#'+p+'t').textContent=d.total;
  document.querySelector('#'+p+'p').textContent='전체 '+P(d)+'% · 오늘 +'+Math.max(0,(d.done||0)-(d.startDone||0));let a=ACC(d);document.querySelector('#'+p+'a').textContent=a==null?'정확도 -':'정확도 '+a+'%';
  document.querySelector('#'+p+'b').style.width=P(d)+'%';document.querySelector('#'+p+'s').textContent=d.status==='paused'?'잠깐 멈춤':d.status==='done'?'완료':'풀이 중';
  const cur=document.querySelector('#'+p+'current');if(cur)cur.textContent=d.status==='done'?'✓':Math.min((d.done||0)+1,d.total);
  const age=document.querySelector('#'+p+'age');if(age){const sec=Math.max(0,Math.floor((Date.now()-(d.problemAtMs||d.updatedAtMs||started))/1000));age.textContent=d.status==='done'?'완료':d.status==='paused'?'멈춤':sec<5?'방금 넘김':sec<60?sec+'초째':Math.floor(sec/60)+'분째'}
  const w=d.workbook||{title:'문제집',subject:'기타',difficulty:d.difficulty,total:d.total};
  document.querySelector('#'+p+'book').innerHTML='<b>'+E(w.title)+'</b><span>'+E(w.subject)+' · '+E(D(w.difficulty))+'</span>';renderPresence(p,d)
}
function remote(e){
  let c=document.querySelector('#friend');c?.classList.remove('flash');void c?.offsetWidth;c?.classList.add('flash');let w=e.nickname||'친구';
  if(e.type==='tap'){sound('tap');wigglePencil('x');msg(w+'가 책상을 톡 건드렸습니다.');navigator.vibrate?.([20,30,20])}
  else if(e.type==='pause')msg(w+'가 잠깐 멈췄습니다.');
  else if(e.type==='resume')msg(w+'가 다시 시작했습니다.');
  else if(e.type==='finish'){msg(w+'가 오늘 공부를 마쳤습니다.');wigglePencil('x')}
  else if(['correct','wrong','skip'].includes(e.type)){
    pushActivity('x',e.type);wigglePencil('x');animatePage('x',e.type);sound('page');
    msg(w+'가 방금 '+label(e.type)+' 처리했습니다.');
    if(Date.now()-ownAt<=3000){sound('sync');desk.classList.add('sync');setTimeout(()=>desk.classList.remove('sync'),700);msg('SYNC · 거의 동시에 한 문제를 끝냈습니다.')}
  }tr(w+' · '+label(e.type))
}
function renderPresence(prefix,d){
  const el=document.querySelector('#'+prefix+'presence');if(!el)return;
  const lag=Date.now()-(d.presenceAtMs||d.updatedAtMs||0);
  let cls='active',text='함께 있음';
  if(lag>70000){cls='quiet';text='연결 확인 중'}
  else if(d.visibility==='background'){cls='background';text='다른 화면 열어둠'}
  else if(d.status==='paused'){cls='paused';text='잠깐 멈춤'}
  else if(d.status==='done'){cls='done';text='오늘 공부 끝'}
  el.className='presence-lamp '+cls;el.querySelector('span').textContent=text
}
async function sendPresence(){
  if(!room||!role||!R||R.status!=='studying')return;
  if(!R[role])return;
  const now=Date.now(),visibility=document.hidden?'background':'active';
  const patch={updatedAt:serverTimestamp()};patch[role+'.presenceAtMs']=now;patch[role+'.visibility']=visibility;
  try{await updateDoc(doc(db,'sidedeskRooms',room),patch)}catch{}
}
function startPresence(){
  clearInterval(presenceTimer);sendPresence();presenceTimer=setInterval(sendPresence,25000)
}
function pushActivity(prefix,type){
  activity[prefix].push({type,at:Date.now()});activity[prefix]=activity[prefix].slice(-12);renderRail(prefix)
}
function renderRail(prefix){
  const rail=document.querySelector('#'+prefix+'rail');if(!rail)return;
  rail.innerHTML=activity[prefix].map(x=>'<i class="'+x.type+'" title="'+label(x.type)+'"></i>').join('')
}
function wigglePencil(prefix){
  const p=document.querySelector('#'+prefix+'pencil');if(!p)return;p.classList.remove('write');void p.offsetWidth;p.classList.add('write');setTimeout(()=>p.classList.remove('write'),650)
}
function animatePage(prefix,type){
  const el=document.querySelector('#'+prefix+'slip');if(!el)return;wigglePencil(prefix);
  el.dataset.result=type;el.classList.remove('turn');void el.offsetWidth;el.classList.add('turn');
  setTimeout(()=>el.classList.remove('turn'),650);
}
function showSummary(m,f){
  const box=document.querySelector('#summary');if(!box||!box.classList.contains('hidden'))return;
  const secs=Math.max(1,Math.floor((Date.now()-started)/1000)),mins=Math.max(1,Math.round(secs/60));
  const ma=ACC(m),fa=ACC(f);
  box.innerHTML='<div class="kicker">SESSION COMPLETE</div><h2>오늘은 여기까지</h2><div class="summary-grid">'+
    '<div><span>내 기록</span><b>'+m.done+'/'+m.total+'</b><em>'+(ma==null?'정확도 -':ma+'%')+'</em></div>'+
    '<div><span>함께 공부</span><b>'+mins+'분</b><em>'+E(f.nickname)+'와 함께</em></div>'+
    '<div><span>'+E(f.nickname)+'</span><b>'+f.done+'/'+f.total+'</b><em>'+(fa==null?'정확도 -':fa+'%')+'</em></div>'+
    '</div><button id="backHome" class="btn primary" style="width:100%;margin-top:14px">책상 정리하고 홈으로</button>';
  box.classList.remove('hidden');backHome.onclick=leaveRoom;box.scrollIntoView({behavior:'smooth',block:'center'});
}
function beginHistory(){
  const m=R?.[role];if(!m)return;
  historyId=room+'_'+started+'_'+authUid;
  if(local.history.some(h=>h.id===historyId))return;
  const w=m.workbook||activeWorkbook(),f=R?.[role==='host'?'guest':'host'];
  local.history.unshift({id:historyId,room,workbookId:workbookKey(w),workbookTitle:w.title,subject:w.subject,difficulty:w.difficulty,total:m.total,startDone:m.startDone||0,done:m.done||0,correct:m.correct||0,wrong:m.wrong||0,skipped:m.skipped||0,friend:f?.nickname||'',startedAt:started,lastSeenAt:Date.now(),endedAt:null});
  local.history=local.history.slice(0,60);saveLocal()
}
function syncHistory(m,f){
  if(!historyId)beginHistory();
  const h=local.history.find(x=>x.id===historyId);if(!h)return;
  h.done=m.done||0;h.correct=m.correct||0;h.wrong=m.wrong||0;h.skipped=m.skipped||0;h.friend=f?.nickname||h.friend;h.lastSeenAt=Date.now();
  if(m.status==='done'||(m.status==='done'&&f?.status==='done'))h.endedAt=Date.now();
  saveLocal()
}
function msg(t){let e=document.querySelector('#live');if(e)e.textContent=t}
function tr(t){let l=document.querySelector('#trace');if(!l)return;let e=document.createElement('div');e.textContent=new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})+' · '+t;l.prepend(e);while(l.children.length>5)l.lastElementChild.remove()}
function ticker(){clearInterval(timer);timer=setInterval(()=>{let c=document.querySelector('#clock');if(!c)return;let s=Math.max(0,((Date.now()-started)/1000)|0);c.textContent=String((s/60)|0).padStart(2,'0')+':'+String(s%60).padStart(2,'0');if(R){const m=R?.[role],f=R?.[role==='host'?'guest':'host'];if(m&&f){fill('m',m);fill('x',f)}}},1000)}

addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;const b=document.querySelector('#installApp');if(b&&!matchMedia('(display-mode: standalone)').matches){b.classList.remove('hidden');b.onclick=promptInstall}});
addEventListener('appinstalled',()=>{deferredInstall=null;document.querySelector('#installApp')?.classList.add('hidden')});
addEventListener('visibilitychange',()=>{if(room)sendPresence()});addEventListener('focus',()=>{if(room)sendPresence()});addEventListener('online',()=>{if(room)sendPresence()});
addEventListener('pointerdown',()=>{if(local.sound)audio()},{once:true,capture:true});
try{let c=await signInAnonymously(auth);authUid=c.user.uid;await resumeOrLanding()}catch(e){console.error(e);fail('실시간 연결용 익명 로그인을 시작하지 못했습니다.')}
