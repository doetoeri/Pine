import { f as firebaseApi } from "./assets/firebase-IW9tbrMW.js";

const FIREBASE = globalThis.PINCON_FIREBASE_CONFIG || {};
const SCHOOL = globalThis.PINCON_SCHOOL_CONFIG || { id: "gochon-high", name: "학교" };
const PROJECT_ID = FIREBASE.projectId;
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const BETA_KEY = "pincon-next-beta-v1";
const PROFILE_KEY = "pincon-profile-v2";
const LAST_SEEN_PREFIX = "pincon-next-last-seen";
const SESSION_ID = `visit_${Date.now()}_${crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)}`;
const APP_VERSION = "next-20260817-1";

let currentUser = null;
let currentClassKey = "";
let classContent = [];
let unsubscribeContent = null;
let sessionStartedAt = Date.now();
let previousSeenAt = 0;
let assignments = [];
let polls = [];
let stats = null;
let isSchoolAdmin = false;
let smartSheet = null;
let pendingShareHandled = false;

const style = document.createElement("style");
style.textContent = `
  .pincon-next-card { grid-column:1/-1; padding:18px; border-radius:26px; background:var(--md-sys-color-surface-container-low); border:1px solid color-mix(in srgb,var(--md-sys-color-outline-variant) 65%,transparent); }
  .pincon-next-row { display:flex; align-items:center; justify-content:space-between; gap:14px; }
  .pincon-next-card h3,.pincon-next-card p { margin:0; }
  .pincon-next-card p { margin-top:5px; color:var(--md-sys-color-on-surface-variant); }
  .pincon-next-toggle { border:0; border-radius:999px; padding:10px 15px; font:inherit; font-weight:700; cursor:pointer; background:var(--md-sys-color-secondary-container); color:var(--md-sys-color-on-secondary-container); }
  .pincon-next-toggle[data-on="true"] { background:var(--md-sys-color-primary); color:var(--md-sys-color-on-primary); }
  .pincon-next-badge { display:inline-flex; align-items:center; gap:5px; padding:5px 9px; border-radius:999px; font-size:.75rem; font-weight:750; background:var(--md-sys-color-primary-container); color:var(--md-sys-color-on-primary-container); }
  .pincon-next-fab { position:fixed; right:18px; bottom:max(92px,calc(env(safe-area-inset-bottom) + 78px)); z-index:80; border:0; border-radius:20px; min-width:58px; height:58px; padding:0 16px; display:none; align-items:center; gap:8px; background:var(--md-sys-color-primary); color:var(--md-sys-color-on-primary); box-shadow:0 10px 30px rgba(30,70,35,.24); font:inherit; font-weight:750; cursor:pointer; }
  body.pincon-next-beta .pincon-next-fab { display:flex; }
  body.pincon-next-beta .content-section { border-radius:28px !important; box-shadow:0 1px 0 rgba(255,255,255,.55) inset,0 12px 34px rgba(40,65,42,.06); }
  body.pincon-next-beta .view-layout { gap:18px !important; }
  body.pincon-next-beta .hero-card, body.pincon-next-beta .summary-card { border-radius:30px !important; }
  body.pincon-next-beta md-filled-button { --md-filled-button-container-shape:999px; }
  body.pincon-next-beta .pincon-workspace-tabs { padding:4px; border-radius:999px; background:var(--md-sys-color-surface-container); }
  body.pincon-next-beta .pincon-workspace-tabs button { flex:1 1 110px; text-align:center; }
  .pincon-next-sheet { position:fixed; z-index:160; inset:0; display:none; align-items:flex-end; justify-content:center; background:rgba(15,23,20,.34); backdrop-filter:blur(5px); }
  .pincon-next-sheet.open { display:flex; }
  .pincon-next-sheet-panel { width:min(100%,760px); max-height:min(86vh,820px); overflow:auto; padding:22px; border-radius:30px 30px 0 0; background:var(--md-sys-color-surface); color:var(--md-sys-color-on-surface); box-shadow:0 -20px 60px rgba(0,0,0,.18); }
  .pincon-next-sheet-head { display:flex; align-items:center; justify-content:space-between; gap:14px; }
  .pincon-next-sheet-head h2 { margin:0; }
  .pincon-next-close { border:0; border-radius:999px; width:42px; height:42px; background:var(--md-sys-color-surface-container-high); color:inherit; cursor:pointer; }
  .pincon-next-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin-top:16px; }
  .pincon-next-metric { padding:14px; border-radius:20px; background:var(--md-sys-color-surface-container-low); }
  .pincon-next-metric strong { display:block; font-size:1.4rem; }
  .pincon-next-metric span { font-size:.78rem; color:var(--md-sys-color-on-surface-variant); }
  .pincon-next-section { margin-top:20px; }
  .pincon-next-section h3 { margin:0 0 10px; font-size:1rem; }
  .pincon-next-list { display:grid; gap:8px; }
  .pincon-next-item { padding:12px 14px; border-radius:18px; background:var(--md-sys-color-surface-container-low); }
  .pincon-next-item strong { display:block; }
  .pincon-next-item small { color:var(--md-sys-color-on-surface-variant); }
  .pincon-next-bars { display:flex; align-items:flex-end; gap:7px; height:112px; padding:10px 4px 0; }
  .pincon-next-bar { flex:1; min-width:12px; border-radius:10px 10px 4px 4px; background:var(--md-sys-color-primary-container); position:relative; }
  .pincon-next-bar span { position:absolute; left:50%; bottom:-20px; transform:translateX(-50%); font-size:.68rem; color:var(--md-sys-color-on-surface-variant); white-space:nowrap; }
  .pincon-apple-button { width:100%; min-height:46px; border:0; border-radius:999px; padding:0 18px; display:flex; align-items:center; justify-content:center; gap:9px; background:#000; color:#fff; font:inherit; font-weight:650; cursor:pointer; margin-top:8px; }
  .pincon-apple-mark { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; font-size:1.35rem; line-height:1; }
  .pincon-share-import { display:grid; gap:12px; }
  .pincon-share-import select,.pincon-share-import input,.pincon-share-import textarea { width:100%; box-sizing:border-box; border:1px solid var(--md-sys-color-outline-variant); border-radius:14px; padding:11px 12px; background:var(--md-sys-color-surface); color:inherit; font:inherit; }
  .pincon-share-import textarea { min-height:110px; resize:vertical; }
  .pincon-next-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }
  .pincon-next-actions button { border:0; border-radius:999px; padding:9px 14px; font:inherit; cursor:pointer; background:var(--md-sys-color-secondary-container); color:var(--md-sys-color-on-secondary-container); }
  .pincon-next-actions button.primary { background:var(--md-sys-color-primary); color:var(--md-sys-color-on-primary); }
  @media (max-width:680px){ .pincon-next-grid{grid-template-columns:1fr 1fr}.pincon-next-sheet-panel{padding:18px}.pincon-next-fab span{display:none}.pincon-next-fab{width:58px;padding:0;justify-content:center} }
`;
document.head.appendChild(style);

function profileClassKey() {
  try {
    const profile = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
    const grade = Number(profile?.grade);
    const classNumber = Number(profile?.classNumber);
    return Number.isInteger(grade) && grade >= 1 && grade <= 3 && Number.isInteger(classNumber) && classNumber >= 1 && classNumber <= 10 ? `${grade}-${classNumber}` : "";
  } catch { return ""; }
}
function betaOn() { return localStorage.getItem(BETA_KEY) === "1"; }
function lastSeenKey() { return `${LAST_SEEN_PREFIX}:${currentUser?.uid || "anon"}:${currentClassKey || "none"}`; }
function safeId(prefix="d") { return `${prefix}_${Date.now()}_${crypto.randomUUID ? crypto.randomUUID().replaceAll("-","").slice(0,12) : Math.random().toString(36).slice(2,14)}`; }
function deviceType() { const w = Math.min(screen.width || innerWidth, screen.height || innerHeight); return w < 600 ? "mobile" : w < 1024 ? "tablet" : "desktop"; }
function dayKey(ms=Date.now()) { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function escapeHtml(v) { return String(v ?? "").replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }
function decodeValue(v) { if(!v)return null; if("stringValue" in v)return v.stringValue; if("integerValue" in v)return Number(v.integerValue); if("doubleValue" in v)return Number(v.doubleValue); if("booleanValue" in v)return v.booleanValue; if("timestampValue" in v)return Date.parse(v.timestampValue); if("arrayValue" in v)return (v.arrayValue.values||[]).map(decodeValue); if("mapValue" in v)return decodeFields(v.mapValue.fields||{}); return null; }
function decodeFields(fields={}) { const out={}; for(const [k,v] of Object.entries(fields)) out[k]=decodeValue(v); return out; }
function decodeDoc(doc) { return { id:String(doc.name||"").split("/").pop(), ...decodeFields(doc.fields||{}) }; }
function encodeValue(v) { if(v===null||v===undefined)return {nullValue:null}; if(Array.isArray(v))return {arrayValue:{values:v.map(encodeValue)}}; if(typeof v==="boolean")return {booleanValue:v}; if(typeof v==="number")return Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v}; if(typeof v==="object"){const fields={}; for(const [k,x] of Object.entries(v))fields[k]=encodeValue(x); return {mapValue:{fields}};} return {stringValue:String(v)}; }
async function idToken(force=false) { if(!currentUser)throw new Error("로그인이 필요합니다."); return currentUser.getIdToken(force); }
async function apiFetch(url, init={}) { const headers=new Headers(init.headers||{}); headers.set("Authorization",`Bearer ${await idToken()}`); const r=await fetch(url,{...init,headers}); if(!r.ok){let m=`${r.status} ${r.statusText}`; try{const j=await r.json();m=j?.error?.message||m;}catch{} throw new Error(m);} return r; }
async function getDoc(path) { const r=await fetch(`${FIRESTORE_BASE}/${path}`,{headers:{Authorization:`Bearer ${await idToken()}`}}); if(r.status===404)return null; if(!r.ok)throw new Error(`${r.status}`); return decodeDoc(await r.json()); }
async function listCollection(path, pageSize=300) { const rows=[]; let token=""; do { const p=new URLSearchParams({pageSize:String(pageSize)}); if(token)p.set("pageToken",token); const r=await apiFetch(`${FIRESTORE_BASE}/${path}?${p}`); const j=await r.json(); rows.push(...(j.documents||[]).map(decodeDoc)); token=j.nextPageToken||""; } while(token && rows.length<1500); return rows; }
async function patchDoc(path,data) { const fields={}; for(const [k,v] of Object.entries(data))fields[k]=encodeValue(v); const r=await apiFetch(`${FIRESTORE_BASE}/${path}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({fields})}); return decodeDoc(await r.json()); }
async function createDoc(collectionPath, docId, data) { const p=new URLSearchParams({documentId:docId}); const fields={}; for(const [k,v] of Object.entries(data))fields[k]=encodeValue(v); const r=await apiFetch(`${FIRESTORE_BASE}/${collectionPath}?${p}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fields})}); return decodeDoc(await r.json()); }
function schoolPath(name){return `schools/${SCHOOL.id}/${name}`;}

function applyBeta() {
  document.body.classList.toggle("pincon-next-beta", betaOn());
  document.querySelectorAll(".pincon-next-toggle").forEach((b)=>{b.dataset.on=String(betaOn());b.textContent=betaOn()?"베타 켜짐":"베타 꺼짐";});
}

function ensureBetaCard() {
  const grid=document.querySelector(".settings-grid");
  if(!grid||document.querySelector(".pincon-next-card"))return;
  const card=document.createElement("section");
  card.className="pincon-next-card";
  card.innerHTML=`<div class="pincon-next-row"><div><span class="pincon-next-badge"><md-icon>experiment</md-icon>PinCon Next Beta</span><h3 style="margin-top:9px">신규 UI와 스마트 브리핑</h3><p>Material You 기반 새 화면, 오늘의 3가지, 놓친 내용 복구, 방문자 인사이트를 시험합니다.</p></div><button class="pincon-next-toggle" type="button"></button></div>`;
  grid.prepend(card);
  card.querySelector(".pincon-next-toggle").addEventListener("click",()=>{localStorage.setItem(BETA_KEY,betaOn()?"0":"1");applyBeta();ensureNextFab();});
  applyBeta();
}

function ensureNextFab(){
  let fab=document.querySelector(".pincon-next-fab");
  if(!fab){fab=document.createElement("button");fab.className="pincon-next-fab";fab.type="button";fab.innerHTML='<md-icon>auto_awesome</md-icon><span>오늘</span>';document.body.appendChild(fab);fab.addEventListener("click",openSmartSheet);} applyBeta();
}

function scoreTodayItems() {
  const now=Date.now(); const out=[];
  for(const a of assignments.filter(x=>!x.deleted)){
    const due=Number(a.dueAtMs)||0; const hours=(due-now)/36e5;
    let score=0; if(due&&hours>=0&&hours<=24)score=100; else if(due&&hours<=72)score=82; else if((a.updatedAtMs||0)>previousSeenAt)score=55;
    if(score)out.push({score,title:`${a.subject?`${a.subject} · `:""}${a.title}`,meta:due?`마감 ${new Intl.DateTimeFormat("ko-KR",{month:"numeric",day:"numeric",hour:"numeric",minute:"2-digit"}).format(new Date(due))}`:"과제 허브"});
  }
  for(const item of classContent.filter(x=>!x.deleted)){
    const updated=Number(item.updatedAtMs||item.createdAtMs||0); let score=0; let meta="";
    if(item.kind==="schedule"&&updated>Date.now()-48*36e5){score=95;meta="최근 시간표 변경";}
    else if(item.kind==="event"&&item.date){const t=Date.parse(item.date);const days=(t-now)/864e5;if(days>=0&&days<=2){score=88;meta=`${item.date} 일정`;}}
    else if(item.kind==="notice"&&updated>Date.now()-36*36e5){score=72;meta="최근 공지";}
    else if(item.kind==="supply"&&updated>Date.now()-48*36e5){score=65;meta="준비물";}
    if(score)out.push({score,title:item.title||item.subject||"새 항목",meta});
  }
  return out.sort((a,b)=>b.score-a.score).slice(0,3);
}
function catchupItems(){
  if(!previousSeenAt)return [];
  const rows=[];
  classContent.filter(x=>Number(x.updatedAtMs||x.createdAtMs||0)>previousSeenAt).forEach(x=>rows.push({title:x.title||x.subject||"학급 항목",meta:`${x.kind||"항목"} 변경`}));
  assignments.filter(x=>Number(x.updatedAtMs||x.createdAtMs||0)>previousSeenAt).forEach(x=>rows.push({title:x.title,meta:"과제 변경"}));
  polls.filter(x=>Number(x.updatedAtMs||x.createdAtMs||0)>previousSeenAt).forEach(x=>rows.push({title:x.question,meta:x.status==="closed"?"투표 종료":"새 투표"}));
  return rows.slice(0,8);
}
async function closedPollDecisions(){
  const closed=polls.filter(p=>!p.deleted&&p.status==="closed").slice(0,5); const out=[];
  for(const poll of closed){
    try{const votes=await listCollection(`${schoolPath("polls")}/${poll.id}/votes`,100); const counts=(poll.options||[]).map(()=>0); for(const v of votes)for(const n of v.selected||[])if(counts[n]!==undefined)counts[n]++; const max=Math.max(0,...counts); const winners=(poll.options||[]).filter((_,i)=>counts[i]===max&&max>0); out.push({title:poll.question,meta:winners.length?`결정: ${winners.join(", ")} · ${votes.length}명 참여`:`종료 · ${votes.length}명 참여`});}catch{out.push({title:poll.question,meta:"종료된 투표"});}
  } return out;
}

function renderVisitorStats(){
  if(!isSchoolAdmin||!stats)return "";
  const bars=stats.daily.map(d=>`<div class="pincon-next-bar" style="height:${Math.max(8,Math.round((d.sessions/stats.maxDaily)*88))}px"><span>${d.label}</span></div>`).join("");
  return `<section class="pincon-next-section"><h3>방문자 통계</h3><div class="pincon-next-grid"><div class="pincon-next-metric"><strong>${stats.todayUnique}</strong><span>오늘 방문자</span></div><div class="pincon-next-metric"><strong>${stats.weekUnique}</strong><span>최근 7일 고유 방문자</span></div><div class="pincon-next-metric"><strong>${stats.weekSessions}</strong><span>최근 7일 세션</span></div><div class="pincon-next-metric"><strong>${stats.avgMinutes}분</strong><span>평균 체류 시간</span></div><div class="pincon-next-metric"><strong>${stats.betaRate}%</strong><span>Next Beta 사용률</span></div><div class="pincon-next-metric"><strong>${stats.topClass||"-"}</strong><span>방문 최다 학급</span></div></div><div class="pincon-next-bars">${bars}</div><p style="margin:26px 0 0;color:var(--md-sys-color-on-surface-variant);font-size:.78rem">개별 학생 이름은 통계 화면에 표시하지 않고 로그인 세션을 집계해서 보여줍니다.</p></section>`;
}

async function openSmartSheet(){
  ensureSheet();
  const today=scoreTodayItems(); const missed=catchupItems(); const decisions=await closedPollDecisions();
  smartSheet.querySelector(".pincon-next-sheet-content").innerHTML=`
    <section class="pincon-next-section"><h3>오늘의 3가지</h3><div class="pincon-next-list">${today.length?today.map(x=>`<div class="pincon-next-item"><strong>${escapeHtml(x.title)}</strong><small>${escapeHtml(x.meta)}</small></div>`).join(""):'<div class="pincon-next-item">급하게 확인할 항목이 없습니다.</div>'}</div></section>
    <section class="pincon-next-section"><h3>놓친 내용 복구</h3><div class="pincon-next-list">${missed.length?missed.map(x=>`<div class="pincon-next-item"><strong>${escapeHtml(x.title)}</strong><small>${escapeHtml(x.meta)}</small></div>`).join(""):'<div class="pincon-next-item">마지막 확인 이후 새 변경이 없습니다.</div>'}</div></section>
    <section class="pincon-next-section"><h3>결정 기록</h3><div class="pincon-next-list">${decisions.length?decisions.map(x=>`<div class="pincon-next-item"><strong>${escapeHtml(x.title)}</strong><small>${escapeHtml(x.meta)}</small></div>`).join(""):'<div class="pincon-next-item">종료된 투표가 없습니다.</div>'}</div></section>
    <section class="pincon-next-section"><h3>스마트 액션</h3><div class="pincon-next-list">${buildSmartActions()}</div></section>
    ${renderVisitorStats()}`;
  smartSheet.classList.add("open");
}
function buildSmartActions(){
  const actions=[]; const now=Date.now();
  const soon=assignments.find(a=>!a.deleted&&a.dueAtMs&&a.dueAtMs>now&&a.dueAtMs-now<24*36e5); if(soon)actions.push(`<div class="pincon-next-item"><strong>${escapeHtml(soon.title)} 마감 확인</strong><small>24시간 안에 마감되는 과제입니다.</small></div>`);
  const changed=classContent.find(x=>x.kind==="schedule"&&Number(x.updatedAtMs||0)>previousSeenAt); if(changed)actions.push(`<div class="pincon-next-item"><strong>시간표 변경 다시 확인</strong><small>${escapeHtml(changed.title||changed.subject||"최근 변경")}</small></div>`);
  if(!actions.length)actions.push('<div class="pincon-next-item">지금 자동으로 제안할 행동이 없습니다.</div>'); return actions.join("");
}
function ensureSheet(){
  if(smartSheet)return; smartSheet=document.createElement("div");smartSheet.className="pincon-next-sheet";smartSheet.innerHTML='<div class="pincon-next-sheet-panel"><div class="pincon-next-sheet-head"><div><span class="pincon-next-badge">PinCon Next</span><h2 style="margin-top:7px">스마트 브리핑</h2></div><button class="pincon-next-close"><md-icon>close</md-icon></button></div><div class="pincon-next-sheet-content"></div></div>';document.body.appendChild(smartSheet);smartSheet.querySelector(".pincon-next-close").addEventListener("click",()=>smartSheet.classList.remove("open"));smartSheet.addEventListener("click",e=>{if(e.target===smartSheet)smartSheet.classList.remove("open");});
}

async function loadWorkspaceData(){
  if(!currentUser||!currentClassKey)return;
  try{const [a,p]=await Promise.all([listCollection(schoolPath("assignments")),listCollection(schoolPath("polls"))]);assignments=a.filter(x=>x.classKey===currentClassKey);polls=p.filter(x=>x.classKey===currentClassKey);}catch{}
}

async function checkAdminAndStats(){
  isSchoolAdmin=false; stats=null; if(!currentUser)return;
  try{const role=await getDoc(`${schoolPath("roles")}/${currentUser.uid}`);isSchoolAdmin=role?.enabled===true&&role?.level==="school";}catch{}
  if(!isSchoolAdmin)return;
  try{
    const rows=await listCollection(schoolPath("visits"),500); const now=Date.now(); const weekAgo=now-7*864e5; const recent=rows.filter(r=>Number(r.startedAtMs||0)>=weekAgo); const today=dayKey();
    const uniq=(arr)=>new Set(arr.map(r=>r.userUid)).size; const todayRows=rows.filter(r=>r.day===today); const durations=recent.map(r=>Math.max(0,Number(r.lastSeenMs||r.startedAtMs)-Number(r.startedAtMs||0))).filter(x=>x>=0&&x<12*36e5);
    const classCounts={};recent.forEach(r=>classCounts[r.classKey]=(classCounts[r.classKey]||0)+1); const topClass=Object.entries(classCounts).sort((a,b)=>b[1]-a[1])[0]?.[0]||"";
    const daily=[]; for(let i=6;i>=0;i--){const d=new Date(now-i*864e5);const key=dayKey(d.getTime());const ses=recent.filter(r=>r.day===key).length;daily.push({key,sessions:ses,label:`${d.getMonth()+1}/${d.getDate()}`});}
    stats={todayUnique:uniq(todayRows),weekUnique:uniq(recent),weekSessions:recent.length,avgMinutes:durations.length?Math.round(durations.reduce((a,b)=>a+b,0)/durations.length/60000):0,betaRate:recent.length?Math.round(recent.filter(r=>r.beta).length/recent.length*100):0,topClass,daily,maxDaily:Math.max(1,...daily.map(d=>d.sessions))};
  }catch{}
}

async function writeVisit(final=false){
  if(!currentUser||!currentClassKey)return;
  try{await patchDoc(`${schoolPath("visits")}/${SESSION_ID}`,{userUid:currentUser.uid,classKey:currentClassKey,day:dayKey(sessionStartedAt),startedAtMs:sessionStartedAt,lastSeenMs:Date.now(),beta:betaOn(),device:deviceType(),appVersion:APP_VERSION,closed:final});}catch{}
}

function installVisitHeartbeat(){
  clearInterval(installVisitHeartbeat.timer); installVisitHeartbeat.timer=setInterval(()=>writeVisit(false),5*60*1000); window.addEventListener("pagehide",()=>{localStorage.setItem(lastSeenKey(),String(Date.now()));writeVisit(true);},{once:true}); document.addEventListener("visibilitychange",()=>{if(document.hidden)writeVisit(false);});
}

function groupItems(){return classContent.filter(x=>x.kind==="group"&&!x.deleted);}
async function handleShareTarget(){
  if(pendingShareHandled||!currentUser||!currentClassKey)return; const q=new URLSearchParams(location.search); if(q.get("share-target")!=="1")return; const groups=groupItems(); if(!groups.length)return;
  pendingShareHandled=true; const title=q.get("title")||""; const url=q.get("url")||""; const text=q.get("text")||""; const detected=url||text.match(/https?:\/\/\S+/)?.[0]||"";
  ensureSheet(); smartSheet.querySelector(".pincon-next-sheet-content").innerHTML=`<section class="pincon-next-section"><h3>PinCon으로 공유</h3><div class="pincon-share-import"><label>저장할 모둠<select id="pincon-share-group">${groups.map(g=>`<option value="${escapeHtml(g.id)}">${escapeHtml(g.groupLabel||g.title||g.subject||"모둠")}</option>`).join("")}</select></label><label>제목<input id="pincon-share-title" maxlength="140" value="${escapeHtml(title|| (detected?"공유 링크":"공유 텍스트"))}"></label>${detected?`<label>링크<input id="pincon-share-url" value="${escapeHtml(detected)}"></label>`:`<label>내용<textarea id="pincon-share-text">${escapeHtml(text)}</textarea></label>`}<div class="pincon-next-actions"><button type="button" data-share-cancel>취소</button><button type="button" class="primary" data-share-save>모둠 공유함에 저장</button></div></div></section>`;smartSheet.classList.add("open");
  const clear=()=>{const u=new URL(location.href);u.searchParams.delete("share-target");u.searchParams.delete("title");u.searchParams.delete("text");u.searchParams.delete("url");history.replaceState({},"",u.pathname+u.search+u.hash);smartSheet.classList.remove("open");};
  smartSheet.querySelector("[data-share-cancel]").addEventListener("click",clear); smartSheet.querySelector("[data-share-save]").addEventListener("click",async()=>{const groupId=smartSheet.querySelector("#pincon-share-group").value;const itemTitle=smartSheet.querySelector("#pincon-share-title").value.trim()||"공유 항목";const data={classKey:currentClassKey,groupId,type:detected?"link":"note",title:itemTitle,deleted:false,authorUid:currentUser.uid,authorName:currentUser.displayName||currentUser.email||"학생",createdAtMs:Date.now(),updatedAtMs:Date.now()};if(detected)data.url=smartSheet.querySelector("#pincon-share-url").value.trim();else data.body=smartSheet.querySelector("#pincon-share-text").value.trim();try{await createDoc(`${schoolPath("groupDrive")}/${groupId}/items`,safeId("item"),data);clear();alert("모둠 공유함에 저장했습니다.");}catch(e){alert(e?.message||"저장하지 못했습니다.");}});
}

async function appleSignIn(){
  try{
    const [{initializeApp},{getAuth,OAuthProvider,signInWithRedirect,browserLocalPersistence,setPersistence}]=await Promise.all([import("https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js"),import("https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js")]);
    const app=initializeApp(FIREBASE); const auth=getAuth(app); await setPersistence(auth,browserLocalPersistence); const provider=new OAuthProvider("apple.com"); provider.addScope("email"); provider.addScope("name"); provider.setCustomParameters({locale:"ko_KR"}); await signInWithRedirect(auth,provider);
  }catch(error){console.error(error);alert("Apple 로그인을 시작하지 못했습니다. Firebase에서 Apple 로그인 제공업체와 Apple Developer 설정이 완료되어 있어야 합니다.");}
}
function injectAppleButton(){
  if(currentUser)return; const candidates=[...document.querySelectorAll("button,md-filled-button,md-outlined-button,md-text-button")]; const google=candidates.find(b=>/Google/i.test(b.textContent||"")); if(!google||document.querySelector(".pincon-apple-button"))return; const button=document.createElement("button");button.type="button";button.className="pincon-apple-button";button.innerHTML='<span class="pincon-apple-mark">●</span><span>Apple로 계속</span>';button.setAttribute("aria-label","Apple로 로그인");button.addEventListener("click",appleSignIn);google.insertAdjacentElement("afterend",button);
}

function resetClass(){
  const next=profileClassKey(); if(next===currentClassKey&&unsubscribeContent)return; currentClassKey=next; classContent=[];unsubscribeContent?.();unsubscribeContent=null; if(currentUser&&currentClassKey){previousSeenAt=Number(localStorage.getItem(lastSeenKey())||0);unsubscribeContent=firebaseApi.subscribeClassContent(currentClassKey,(items)=>{classContent=items;handleShareTarget();},()=>{},()=>{});loadWorkspaceData().then(()=>handleShareTarget());writeVisit(false);installVisitHeartbeat();checkAdminAndStats();}
}

firebaseApi.observeAuth((user)=>{currentUser=user;resetClass();if(user){sessionStartedAt=Date.now();loadWorkspaceData();checkAdminAndStats();}setTimeout(injectAppleButton,200);});
new MutationObserver(()=>{ensureBetaCard();ensureNextFab();injectAppleButton();const next=profileClassKey();if(next!==currentClassKey)resetClass();}).observe(document.documentElement,{childList:true,subtree:true});
window.addEventListener("storage",()=>{applyBeta();resetClass();});
ensureNextFab();applyBeta();resetClass();
