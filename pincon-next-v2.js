import { f as firebaseApi } from "./assets/firebase-IW9tbrMW.js";

const FIREBASE = globalThis.PINCON_FIREBASE_CONFIG || {};
const SCHOOL = globalThis.PINCON_SCHOOL_CONFIG || { id: "gochon-high", name: "학교" };
const PROJECT_ID = FIREBASE.projectId;
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const BETA_KEY = "pincon-next-beta-v1";
const PROFILE_KEY = "pincon-profile-v2";
const LAST_SEEN_PREFIX = "pincon-next-last-seen";
const PREF_KEY = "pincon-next-v2-prefs";
const FOCUS_PREFIX = "pincon-next-v2-focus";
const NOTES_PREFIX = "pincon-next-v2-notes";
const SNAPSHOT_PREFIX = "pincon-next-v2-snapshot";

let currentUser = null;
let currentClassKey = "";
let classContent = [];
let unsubscribeContent = null;
let dataCache = { at: 0, assignments: [], polls: [] };
let suiteSheet = null;
let importSheet = null;
let currentTab = "brief";
let shareHandled = false;
let uiPassQueued = false;

const style = document.createElement("style");
style.id = "pincon-next-v2-style";
style.textContent = `
  .pincon-v2-card{grid-column:1/-1;padding:18px;border-radius:24px;background:var(--md-sys-color-surface-container-low);border:1px solid var(--md-sys-color-outline-variant)}
  .pincon-v2-card-row{display:flex;align-items:center;justify-content:space-between;gap:16px}.pincon-v2-card h3,.pincon-v2-card p{margin:0}.pincon-v2-card p{margin-top:5px;color:var(--md-sys-color-on-surface-variant)}
  .pincon-v2-badge{display:inline-flex;align-items:center;gap:5px;padding:5px 9px;border-radius:999px;font-size:.75rem;font-weight:750;background:var(--md-sys-color-primary-container);color:var(--md-sys-color-on-primary-container)}
  .pincon-v2-toggle,.pincon-v2-button{border:0;border-radius:999px;min-height:42px;padding:9px 14px;font:inherit;font-weight:700;cursor:pointer;background:var(--md-sys-color-secondary-container);color:var(--md-sys-color-on-secondary-container);touch-action:manipulation}
  .pincon-v2-toggle[data-on="true"],.pincon-v2-button.primary{background:var(--md-sys-color-primary);color:var(--md-sys-color-on-primary)}
  .pincon-v2-dock{position:fixed;z-index:78;left:18px;bottom:max(94px,calc(env(safe-area-inset-bottom) + 80px));display:none;align-items:center;gap:8px;border:0;border-radius:18px;min-height:54px;padding:0 15px;background:var(--md-sys-color-primary);color:var(--md-sys-color-on-primary);box-shadow:0 8px 22px rgba(30,70,35,.2);font:inherit;font-weight:750;cursor:pointer;touch-action:manipulation}
  body.pincon-next-beta .pincon-v2-dock{display:flex}
  .pincon-v2-dot{display:grid;place-items:center;min-width:20px;height:20px;padding:0 5px;border-radius:999px;background:var(--md-sys-color-error);color:var(--md-sys-color-on-error);font-size:.7rem}
  .pincon-v2-sheet{position:fixed;z-index:170;inset:0;display:none;align-items:flex-end;justify-content:center;background:rgba(15,23,20,.3)}
  .pincon-v2-sheet.open{display:flex}.pincon-v2-panel{width:min(100%,820px);max-height:min(90vh,880px);overflow:auto;padding:18px;border-radius:30px 30px 0 0;background:var(--md-sys-color-surface);color:var(--md-sys-color-on-surface);box-shadow:0 -12px 36px rgba(0,0,0,.16);overscroll-behavior:contain}
  .pincon-v2-head{display:flex;align-items:center;justify-content:space-between;gap:12px;position:sticky;top:-18px;z-index:3;padding:18px 0 10px;background:var(--md-sys-color-surface)}
  .pincon-v2-head h2{margin:0}.pincon-v2-close{border:0;width:42px;height:42px;border-radius:999px;background:var(--md-sys-color-surface-container-high);color:inherit;cursor:pointer;touch-action:manipulation}
  .pincon-v2-tabs{display:flex;gap:7px;overflow-x:auto;padding:2px 0 10px;scrollbar-width:none}.pincon-v2-tabs::-webkit-scrollbar{display:none}
  .pincon-v2-tabs button{border:0;white-space:nowrap;border-radius:999px;min-height:40px;padding:8px 13px;background:var(--md-sys-color-surface-container);color:var(--md-sys-color-on-surface-variant);font:inherit;cursor:pointer;touch-action:manipulation}
  .pincon-v2-tabs button[aria-selected="true"]{background:var(--md-sys-color-primary-container);color:var(--md-sys-color-on-primary-container);font-weight:700}
  .pincon-v2-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.pincon-v2-metric,.pincon-v2-item{padding:14px;border-radius:19px;background:var(--md-sys-color-surface-container-low)}
  .pincon-v2-metric strong{display:block;font-size:1.35rem}.pincon-v2-metric span,.pincon-v2-item small{color:var(--md-sys-color-on-surface-variant);font-size:.78rem}
  .pincon-v2-section{margin-top:18px}.pincon-v2-section h3{margin:0 0 9px}.pincon-v2-list{display:grid;gap:8px}.pincon-v2-item strong{display:block}.pincon-v2-item p{margin:7px 0 0;white-space:pre-wrap;color:var(--md-sys-color-on-surface-variant)}
  .pincon-v2-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.pincon-v2-actions button{border:0;border-radius:999px;min-height:38px;padding:7px 11px;background:var(--md-sys-color-secondary-container);color:var(--md-sys-color-on-secondary-container);font:inherit;cursor:pointer;touch-action:manipulation}
  .pincon-v2-actions button.primary{background:var(--md-sys-color-primary);color:var(--md-sys-color-on-primary)}
  .pincon-v2-search{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}.pincon-v2-search input,.pincon-v2-note-form input,.pincon-v2-note-form textarea,.pincon-v2-import select,.pincon-v2-import input,.pincon-v2-import textarea{width:100%;box-sizing:border-box;border:1px solid var(--md-sys-color-outline-variant);border-radius:15px;padding:11px 12px;background:var(--md-sys-color-surface);color:inherit;font:inherit}
  .pincon-v2-note-form,.pincon-v2-import{display:grid;gap:10px}.pincon-v2-note-form textarea,.pincon-v2-import textarea{min-height:96px;resize:vertical}
  .pincon-v2-pref{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 0;border-bottom:1px solid var(--md-sys-color-outline-variant)}.pincon-v2-pref:last-child{border-bottom:0}
  .pincon-v2-empty{padding:18px;border-radius:18px;background:var(--md-sys-color-surface-container-low);color:var(--md-sys-color-on-surface-variant)}
  body.pincon-v2-compact .content-section,body.pincon-v2-compact .pincon-feature-card{padding-top:12px!important;padding-bottom:12px!important}body.pincon-v2-compact .view-layout{gap:14px!important}
  body.pincon-v2-calm .system-banner,body.pincon-v2-calm .hero-support{display:none!important}
  body.pincon-v2-reduce-motion *,body.pincon-v2-reduce-motion *::before,body.pincon-v2-reduce-motion *::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}
  .pincon-apple-button{width:100%;min-height:46px;border:0;border-radius:999px;padding:0 18px;display:flex;align-items:center;justify-content:center;background:#000;color:#fff;font:inherit;font-weight:650;cursor:pointer;margin-top:8px;touch-action:manipulation}
  @media(max-width:700px){.pincon-v2-grid{grid-template-columns:1fr 1fr}.pincon-v2-dock span.label{display:none}.pincon-v2-dock{width:54px;padding:0;justify-content:center}.pincon-v2-card-row{align-items:flex-start;flex-direction:column}.pincon-v2-panel{padding:16px}.pincon-v2-head{top:-16px}}
`;
document.head.appendChild(style);

function locked() { return Boolean(globalThis.__PINCON_TOUCH_STABILITY__?.locked?.()); }
function betaOn() { return localStorage.getItem(BETA_KEY) === "1"; }
function profileClassKey() {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
    const g = Number(p?.grade), c = Number(p?.classNumber);
    return Number.isInteger(g) && g >= 1 && g <= 3 && Number.isInteger(c) && c >= 1 && c <= 10 ? `${g}-${c}` : "";
  } catch { return ""; }
}
function key(prefix) { return `${prefix}:${currentUser?.uid || "anon"}:${currentClassKey || "none"}`; }
function lastSeenKey() { return key(LAST_SEEN_PREFIX); }
function schoolPath(name) { return `schools/${SCHOOL.id}/${name}`; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function safeId(prefix="d") { return `${prefix}_${Date.now()}_${crypto.randomUUID ? crypto.randomUUID().replaceAll("-","").slice(0,12) : Math.random().toString(36).slice(2,14)}`; }
function formatDate(ms) {
  if (!Number(ms)) return "";
  try { return new Intl.DateTimeFormat("ko-KR",{month:"numeric",day:"numeric",hour:"numeric",minute:"2-digit"}).format(new Date(Number(ms))); } catch { return ""; }
}
function decodeValue(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return Date.parse(v.timestampValue);
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeValue);
  if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
  return null;
}
function decodeFields(fields={}) { const out={}; for (const [k,v] of Object.entries(fields)) out[k]=decodeValue(v); return out; }
function decodeDoc(doc) { return { id:String(doc.name||"").split("/").pop(), ...decodeFields(doc.fields||{}) }; }
function encodeValue(v) {
  if (v === null || v === undefined) return { nullValue:null };
  if (Array.isArray(v)) return { arrayValue:{ values:v.map(encodeValue) } };
  if (typeof v === "boolean") return { booleanValue:v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue:String(v) } : { doubleValue:v };
  if (typeof v === "object") { const fields={}; for (const [k,x] of Object.entries(v)) fields[k]=encodeValue(x); return { mapValue:{fields} }; }
  return { stringValue:String(v) };
}
async function idToken() { if (!currentUser) throw new Error("로그인이 필요합니다."); return currentUser.getIdToken(); }
async function apiFetch(url, init={}) {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${await idToken()}`);
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try { const body = await response.json(); message = body?.error?.message || message; } catch {}
    throw new Error(message);
  }
  return response;
}
async function listCollection(path, pageSize=100, limit=600) {
  const rows=[]; let token="";
  do {
    const q=new URLSearchParams({pageSize:String(pageSize)}); if(token) q.set("pageToken",token);
    const response=await apiFetch(`${FIRESTORE_BASE}/${path}?${q}`);
    const body=await response.json();
    rows.push(...(body.documents||[]).map(decodeDoc));
    token=body.nextPageToken||"";
  } while(token && rows.length<limit);
  return rows;
}
async function createDoc(collectionPath, docId, data) {
  const q=new URLSearchParams({documentId:docId}); const fields={};
  for (const [k,v] of Object.entries(data)) fields[k]=encodeValue(v);
  const response=await apiFetch(`${FIRESTORE_BASE}/${collectionPath}?${q}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fields})});
  return decodeDoc(await response.json());
}

function prefs() {
  try { return { compact:false, calm:false, reduceMotion:false, ...(JSON.parse(localStorage.getItem(PREF_KEY)||"{}")) }; }
  catch { return { compact:false, calm:false, reduceMotion:false }; }
}
function savePrefs(next) { localStorage.setItem(PREF_KEY, JSON.stringify(next)); applyPrefs(); }
function applyPrefs() {
  const p=prefs();
  document.body.classList.toggle("pincon-v2-compact", p.compact && betaOn());
  document.body.classList.toggle("pincon-v2-calm", p.calm && betaOn());
  document.body.classList.toggle("pincon-v2-reduce-motion", p.reduceMotion && betaOn());
}
function focusIds() {
  try { return JSON.parse(localStorage.getItem(key(FOCUS_PREFIX)) || "[]"); } catch { return []; }
}
function setFocusIds(ids) { localStorage.setItem(key(FOCUS_PREFIX), JSON.stringify([...new Set(ids)].slice(0,3))); }
function notes() {
  try { return JSON.parse(localStorage.getItem(key(NOTES_PREFIX)) || "[]"); } catch { return []; }
}
function setNotes(rows) { localStorage.setItem(key(NOTES_PREFIX), JSON.stringify(rows.slice(0,20))); }
function snapshot() {
  try { return JSON.parse(localStorage.getItem(key(SNAPSHOT_PREFIX)) || "null"); } catch { return null; }
}
function saveSnapshot(data) { localStorage.setItem(key(SNAPSHOT_PREFIX), JSON.stringify({ at:Date.now(), ...data })); }

function applyBeta() {
  document.body.classList.toggle("pincon-next-beta", betaOn());
  document.querySelectorAll(".pincon-v2-toggle").forEach((button)=>{button.dataset.on=String(betaOn());button.textContent=betaOn()?"베타 켜짐":"베타 꺼짐";});
  const dock=document.querySelector(".pincon-v2-dock");
  if (dock) dock.hidden=!betaOn();
  if (!betaOn()) suiteSheet?.classList.remove("open");
  applyPrefs();
  updateContentSubscription();
}

function ensureSettingsCard() {
  const grid=document.querySelector(".settings-grid");
  if (!grid || grid.querySelector(".pincon-v2-card")) return;
  const card=document.createElement("section");
  card.className="pincon-v2-card";
  card.innerHTML=`<div class="pincon-v2-card-row"><div><span class="pincon-v2-badge"><md-icon>experiment</md-icon>PinCon Next Beta 2</span><h3 style="margin-top:9px">새 UI와 스마트 도구</h3><p>브리핑, 통합 검색, 집중 3개, 마감 레이더, 빠른 메모, 오프라인 스냅샷을 시험합니다.</p></div><button type="button" class="pincon-v2-toggle"></button></div>`;
  grid.prepend(card);
  card.querySelector(".pincon-v2-toggle").addEventListener("click",()=>{
    localStorage.setItem(BETA_KEY,betaOn()?"0":"1");
    applyBeta();
  });
  applyBeta();
}

function ensureDock() {
  let dock=document.querySelector(".pincon-v2-dock");
  if (!dock) {
    dock=document.createElement("button");
    dock.type="button";
    dock.className="pincon-v2-dock";
    dock.innerHTML='<md-icon>auto_awesome</md-icon><span class="label">Next</span><span class="pincon-v2-dot" hidden>0</span>';
    dock.addEventListener("click",()=>openSuite("brief"));
    document.body.appendChild(dock);
  }
  dock.hidden=!betaOn();
}

function ensureSuiteSheet() {
  if (suiteSheet) return;
  suiteSheet=document.createElement("div");
  suiteSheet.className="pincon-v2-sheet";
  suiteSheet.innerHTML=`<div class="pincon-v2-panel">
    <div class="pincon-v2-head"><h2>PinCon Next</h2><button type="button" class="pincon-v2-close" aria-label="닫기"><md-icon>close</md-icon></button></div>
    <nav class="pincon-v2-tabs" aria-label="Next 기능">
      <button data-v2-tab="brief">브리핑</button><button data-v2-tab="search">통합 검색</button><button data-v2-tab="focus">집중 3개</button><button data-v2-tab="radar">마감 레이더</button><button data-v2-tab="notes">빠른 메모</button><button data-v2-tab="prefs">환경</button>
    </nav>
    <div class="pincon-v2-content"></div>
  </div>`;
  document.body.appendChild(suiteSheet);
  suiteSheet.querySelector(".pincon-v2-close").addEventListener("click",()=>suiteSheet.classList.remove("open"));
  suiteSheet.addEventListener("click",(event)=>{if(event.target===suiteSheet)suiteSheet.classList.remove("open")});
  suiteSheet.querySelector(".pincon-v2-tabs").addEventListener("click",(event)=>{
    const button=event.target.closest("[data-v2-tab]"); if(!button)return;
    renderTab(button.dataset.v2Tab);
  });
  suiteSheet.querySelector(".pincon-v2-content").addEventListener("click",handleSuiteClick);
  suiteSheet.querySelector(".pincon-v2-content").addEventListener("submit",handleSuiteSubmit);
  suiteSheet.querySelector(".pincon-v2-content").addEventListener("input",handleSuiteInput);
}

function showSuiteLoading(tab) {
  ensureSuiteSheet();
  currentTab=tab;
  suiteSheet.querySelectorAll("[data-v2-tab]").forEach(b=>b.setAttribute("aria-selected",String(b.dataset.v2Tab===tab)));
  suiteSheet.querySelector(".pincon-v2-content").innerHTML='<div class="pincon-v2-empty">필요한 정보만 불러오는 중…</div>';
  suiteSheet.classList.add("open");
}

async function loadData(force=false) {
  if (!currentUser || !currentClassKey) return dataCache;
  if (!force && Date.now()-dataCache.at<60_000) return dataCache;
  try {
    const [assignments,polls]=await Promise.all([
      listCollection(schoolPath("assignments"),100,500),
      listCollection(schoolPath("polls"),100,500),
    ]);
    dataCache={
      at:Date.now(),
      assignments:assignments.filter(x=>x.classKey===currentClassKey&&!x.deleted).sort((a,b)=>(a.dueAtMs||Number.MAX_SAFE_INTEGER)-(b.dueAtMs||Number.MAX_SAFE_INTEGER)),
      polls:polls.filter(x=>x.classKey===currentClassKey&&!x.deleted).sort((a,b)=>(b.updatedAtMs||b.createdAtMs||0)-(a.updatedAtMs||a.createdAtMs||0)),
    };
    saveSnapshot({ assignments:dataCache.assignments, polls:dataCache.polls, classContent });
  } catch (error) {
    const old=snapshot();
    if (old) dataCache={at:old.at||Date.now(),assignments:old.assignments||[],polls:old.polls||[]};
    else throw error;
  }
  updateDockBadge();
  return dataCache;
}

function urgentAssignments(assignments) {
  const now=Date.now();
  return assignments.filter(a=>a.dueAtMs&&a.dueAtMs>=now&&a.dueAtMs-now<=24*36e5);
}
function scoreItems(assignments) {
  const now=Date.now(), seen=Number(localStorage.getItem(lastSeenKey())||0), rows=[];
  for (const a of assignments) {
    const due=Number(a.dueAtMs)||0, hours=(due-now)/36e5;
    let score=0,meta="";
    if(due&&hours>=0&&hours<=24){score=100;meta=`24시간 안 · ${formatDate(due)}`;}
    else if(due&&hours>=0&&hours<=72){score=86;meta=`3일 안 · ${formatDate(due)}`;}
    else if(Number(a.updatedAtMs||0)>seen){score=58;meta="최근 등록/수정된 과제";}
    if(score)rows.push({score,title:`${a.subject?`${a.subject} · `:""}${a.title}`,meta,type:"assignment",id:a.id});
  }
  for (const item of classContent.filter(x=>!x.deleted)) {
    const updated=Number(item.updatedAtMs||item.createdAtMs||0); let score=0,meta="";
    if(item.kind==="schedule"&&updated>Date.now()-48*36e5){score=96;meta="최근 시간표 변경";}
    else if(item.kind==="event"&&item.date){const t=Date.parse(item.date),days=(t-now)/864e5;if(days>=0&&days<=2){score=90;meta=`${item.date} 일정`;}}
    else if(item.kind==="notice"&&updated>seen){score=72;meta="새 공지";}
    if(score)rows.push({score,title:item.title||"새 소식",meta,type:item.kind,id:item.id});
  }
  return rows.sort((a,b)=>b.score-a.score).slice(0,5);
}
function missedItems() {
  const seen=Number(localStorage.getItem(lastSeenKey())||0);
  return classContent.filter(x=>!x.deleted&&Number(x.updatedAtMs||x.createdAtMs||0)>seen).sort((a,b)=>Number(b.updatedAtMs||b.createdAtMs||0)-Number(a.updatedAtMs||a.createdAtMs||0)).slice(0,12);
}
function renderItems(rows, empty) {
  return rows.length?`<div class="pincon-v2-list">${rows.map(x=>`<div class="pincon-v2-item"><strong>${escapeHtml(x.title||x.question||"항목")}</strong><small>${escapeHtml(x.meta||x.kind||"")}</small>${x.body?`<p>${escapeHtml(x.body)}</p>`:""}</div>`).join("")}</div>`:`<div class="pincon-v2-empty">${escapeHtml(empty)}</div>`;
}
function briefingText(data) {
  const top=scoreItems(data.assignments).slice(0,3);
  const lines=["PinCon 오늘 브리핑",...top.map((x,i)=>`${i+1}. ${x.title}${x.meta?` · ${x.meta}`:""}`)];
  if(top.length===0)lines.push("지금 급한 항목이 없습니다.");
  return lines.join("\n");
}

async function renderBrief() {
  const data=await loadData();
  const top=scoreItems(data.assignments), missed=missedItems(), decisions=data.polls.filter(p=>p.status==="closed").slice(0,5), urgent=urgentAssignments(data.assignments);
  const focus=focusIds().length;
  suiteSheet.querySelector(".pincon-v2-content").innerHTML=`
    <div class="pincon-v2-grid">
      <div class="pincon-v2-metric"><strong>${urgent.length}</strong><span>24시간 안 마감</span></div>
      <div class="pincon-v2-metric"><strong>${missed.length}</strong><span>놓친 변경</span></div>
      <div class="pincon-v2-metric"><strong>${focus}/3</strong><span>집중 항목</span></div>
    </div>
    <section class="pincon-v2-section"><h3>오늘의 우선순위</h3>${renderItems(top.slice(0,5),"지금 급한 항목이 없습니다.")}</section>
    <section class="pincon-v2-section"><h3>놓친 내용</h3>${renderItems(missed.map(x=>({title:x.title,meta:x.kind,body:""})).slice(0,8),"마지막 확인 이후 새 변경이 없습니다.")}</section>
    <section class="pincon-v2-section"><h3>최근 결정</h3>${renderItems(decisions.map(x=>({title:x.question,meta:"종료된 투표"})),"종료된 투표가 없습니다.")}</section>
    <div class="pincon-v2-actions"><button data-v2-action="copy-brief">브리핑 복사</button><button class="primary" data-v2-action="share-brief">공유</button><button data-v2-tab-jump="radar">마감 레이더</button></div>`;
  localStorage.setItem(lastSeenKey(),String(Date.now()));
}

function searchRows(data, query) {
  const q=query.trim().toLowerCase(); if(!q)return[];
  const rows=[];
  for(const x of classContent.filter(x=>!x.deleted)){
    const hay=[x.title,x.body,x.kind,x.subject].join(" ").toLowerCase();
    if(hay.includes(q))rows.push({title:x.title||"항목",meta:`${x.kind||"학급 정보"}`,body:x.body||""});
  }
  for(const a of data.assignments){
    const hay=[a.title,a.subject,a.description].join(" ").toLowerCase();
    if(hay.includes(q))rows.push({title:a.title,meta:`과제 · ${a.subject||"과목 미지정"}`,body:a.description||"",assignmentId:a.id});
  }
  for(const p of data.polls){
    const hay=[p.question,...(p.options||[])].join(" ").toLowerCase();
    if(hay.includes(q))rows.push({title:p.question,meta:`투표 · ${p.status==="closed"?"종료":"진행 중"}`,body:(p.options||[]).join(" / ")});
  }
  return rows.slice(0,30);
}
async function renderSearch(query="") {
  const data=await loadData();
  suiteSheet.querySelector(".pincon-v2-content").innerHTML=`<section class="pincon-v2-section"><div class="pincon-v2-search"><input id="pincon-v2-search-input" autocomplete="off" placeholder="공지, 과제, 투표를 한 번에 검색" value="${escapeHtml(query)}"><button class="pincon-v2-button primary" data-v2-action="do-search">검색</button></div><div id="pincon-v2-search-results" style="margin-top:12px">${query?renderItems(searchRows(data,query),"검색 결과가 없습니다."):'<div class="pincon-v2-empty">검색어를 입력하면 공지·일정·과제·투표를 함께 찾습니다.</div>'}</div></section>`;
  suiteSheet.querySelector("#pincon-v2-search-input")?.focus({preventScroll:true});
}
async function updateSearchResults() {
  const input=suiteSheet.querySelector("#pincon-v2-search-input"); if(!input)return;
  const data=await loadData();
  const target=suiteSheet.querySelector("#pincon-v2-search-results");
  target.innerHTML=input.value.trim()?renderItems(searchRows(data,input.value),"검색 결과가 없습니다."):'<div class="pincon-v2-empty">검색어를 입력하세요.</div>';
}

async function renderFocus() {
  const data=await loadData(), ids=focusIds(), rows=ids.map(id=>data.assignments.find(a=>a.id===id)).filter(Boolean);
  suiteSheet.querySelector(".pincon-v2-content").innerHTML=`<section class="pincon-v2-section"><h3>오늘 집중할 3개</h3>${rows.length?`<div class="pincon-v2-list">${rows.map(a=>`<div class="pincon-v2-item"><strong>${escapeHtml(a.title)}</strong><small>${escapeHtml(a.subject||"과목 미지정")}${a.dueAtMs?` · ${escapeHtml(formatDate(a.dueAtMs))}`:""}</small><div class="pincon-v2-actions"><button data-v2-unfocus="${escapeHtml(a.id)}">집중에서 빼기</button>${a.dueAtMs?`<button data-v2-calendar="${escapeHtml(a.id)}">캘린더</button>`:""}</div></div>`).join("")}</div>`:'<div class="pincon-v2-empty">마감 레이더에서 최대 3개를 집중 항목으로 고를 수 있습니다.</div>'}</section><div class="pincon-v2-actions"><button data-v2-tab-jump="radar">마감 레이더에서 고르기</button></div>`;
}

function dueBucket(a) {
  const now=Date.now(), d=Number(a.dueAtMs)||0; if(!d)return"none";
  const h=(d-now)/36e5; if(h<0)return"overdue"; if(h<=24)return"day"; if(h<=72)return"three"; if(h<=168)return"week"; return"later";
}
async function renderRadar() {
  const data=await loadData(), focus=new Set(focusIds());
  const groups=[["day","24시간 안"],["three","3일 안"],["week","7일 안"],["overdue","기한 지남"],["later","그 이후"]];
  const html=groups.map(([key,label])=>{
    const rows=data.assignments.filter(a=>dueBucket(a)===key);
    if(!rows.length)return"";
    return `<section class="pincon-v2-section"><h3>${label}</h3><div class="pincon-v2-list">${rows.map(a=>`<div class="pincon-v2-item"><strong>${escapeHtml(a.title)}</strong><small>${escapeHtml(a.subject||"과목 미지정")}${a.dueAtMs?` · ${escapeHtml(formatDate(a.dueAtMs))}`:""}</small><div class="pincon-v2-actions"><button data-v2-focus="${escapeHtml(a.id)}">${focus.has(a.id)?"집중 해제":"집중에 추가"}</button>${a.dueAtMs?`<button data-v2-calendar="${escapeHtml(a.id)}">캘린더</button>`:""}</div></div>`).join("")}</div></section>`;
  }).join("");
  suiteSheet.querySelector(".pincon-v2-content").innerHTML=html||'<div class="pincon-v2-empty">마감이 등록된 과제가 없습니다.</div>';
}

function renderNotes() {
  const rows=notes();
  suiteSheet.querySelector(".pincon-v2-content").innerHTML=`<form class="pincon-v2-note-form" data-v2-note-form><input name="title" maxlength="80" placeholder="메모 제목"><textarea name="body" maxlength="1500" placeholder="잠깐 적어둘 내용"></textarea><button class="pincon-v2-button primary" type="submit">메모 저장</button></form><section class="pincon-v2-section"><h3>내 빠른 메모</h3>${rows.length?`<div class="pincon-v2-list">${rows.map(n=>`<div class="pincon-v2-item" data-v2-note="${escapeHtml(n.id)}"><strong>${escapeHtml(n.title||"메모")}</strong><small>${escapeHtml(formatDate(n.createdAt))}</small><p>${escapeHtml(n.body||"")}</p><div class="pincon-v2-actions"><button data-v2-note-copy="${escapeHtml(n.id)}">복사</button><button data-v2-note-delete="${escapeHtml(n.id)}">삭제</button></div></div>`).join("")}</div>`:'<div class="pincon-v2-empty">아직 메모가 없습니다. 이 메모는 이 기기에만 저장됩니다.</div>'}</section>`;
}
function renderPrefs() {
  const p=prefs();
  suiteSheet.querySelector(".pincon-v2-content").innerHTML=`<section class="pincon-v2-section"><h3>화면 환경</h3>
    <div class="pincon-v2-pref"><div><strong>컴팩트 모드</strong><small>카드 간격을 줄입니다.</small></div><button class="pincon-v2-button" data-v2-pref="compact">${p.compact?"켜짐":"꺼짐"}</button></div>
    <div class="pincon-v2-pref"><div><strong>차분한 모드</strong><small>보조 설명을 줄여 정보 밀도를 낮춥니다.</small></div><button class="pincon-v2-button" data-v2-pref="calm">${p.calm?"켜짐":"꺼짐"}</button></div>
    <div class="pincon-v2-pref"><div><strong>모션 줄이기</strong><small>애니메이션과 전환을 최소화합니다.</small></div><button class="pincon-v2-button" data-v2-pref="reduceMotion">${p.reduceMotion?"켜짐":"꺼짐"}</button></div>
    <div class="pincon-v2-pref"><div><strong>오프라인 스냅샷</strong><small>${snapshot()?`마지막 저장 ${formatDate(snapshot().at)}`:"아직 저장된 스냅샷 없음"}</small></div><button class="pincon-v2-button" data-v2-action="refresh-snapshot">새로 저장</button></div>
  </section>`;
}

async function renderTab(tab) {
  if(!betaOn())return;
  currentTab=tab;
  ensureSuiteSheet();
  suiteSheet.querySelectorAll("[data-v2-tab]").forEach(b=>b.setAttribute("aria-selected",String(b.dataset.v2Tab===tab)));
  suiteSheet.querySelector(".pincon-v2-content").innerHTML='<div class="pincon-v2-empty">불러오는 중…</div>';
  try{
    if(tab==="brief")await renderBrief();
    else if(tab==="search")await renderSearch();
    else if(tab==="focus")await renderFocus();
    else if(tab==="radar")await renderRadar();
    else if(tab==="notes")renderNotes();
    else renderPrefs();
  }catch(error){
    suiteSheet.querySelector(".pincon-v2-content").innerHTML=`<div class="pincon-v2-empty">${escapeHtml(error?.message||"불러오지 못했습니다.")}</div>`;
  }
}
function openSuite(tab="brief"){if(!betaOn())return;showSuiteLoading(tab);renderTab(tab)}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const area=document.createElement("textarea");area.value=text;area.style.position="fixed";area.style.opacity="0";document.body.appendChild(area);area.select();document.execCommand("copy");area.remove();
  }
}
async function shareText(title,text) {
  if(navigator.share){try{await navigator.share({title,text});return}catch(error){if(error?.name==="AbortError")return}}
  await copyText(text);
}
function downloadIcs(assignment) {
  if(!assignment?.dueAtMs)return;
  const stamp=(ms)=>new Date(ms).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");
  const end=Number(assignment.dueAtMs), start=end-30*60*1000;
  const ics=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//PinCon//Next//KO","BEGIN:VEVENT",`UID:${assignment.id}@pincon.app`,`DTSTAMP:${stamp(Date.now())}`,`DTSTART:${stamp(start)}`,`DTEND:${stamp(end)}`,`SUMMARY:${String(assignment.title||"과제 마감").replace(/[\n\r]/g," ")}`,`DESCRIPTION:${String(assignment.description||"").replace(/[\n\r]/g,"\\n")}`,"END:VEVENT","END:VCALENDAR"].join("\r\n");
  const url=URL.createObjectURL(new Blob([ics],{type:"text/calendar;charset=utf-8"}));
  const a=document.createElement("a");a.href=url;a.download=`${assignment.title||"pincon"}-deadline.ics`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function handleSuiteClick(event) {
  const tabJump=event.target.closest("[data-v2-tab-jump]"); if(tabJump){renderTab(tabJump.dataset.v2TabJump);return}
  const action=event.target.closest("[data-v2-action]");
  if(action){
    if(action.dataset.v2Action==="copy-brief"){const data=await loadData();await copyText(briefingText(data));}
    if(action.dataset.v2Action==="share-brief"){const data=await loadData();await shareText("PinCon 오늘 브리핑",briefingText(data));}
    if(action.dataset.v2Action==="do-search")await updateSearchResults();
    if(action.dataset.v2Action==="refresh-snapshot"){await loadData(true);renderPrefs();}
    return;
  }
  const pref=event.target.closest("[data-v2-pref]"); if(pref){const p=prefs(),k=pref.dataset.v2Pref;p[k]=!p[k];savePrefs(p);renderPrefs();return}
  const focusButton=event.target.closest("[data-v2-focus]");
  if(focusButton){
    const id=focusButton.dataset.v2Focus,ids=focusIds();
    if(ids.includes(id))setFocusIds(ids.filter(x=>x!==id));
    else if(ids.length<3)setFocusIds([...ids,id]);
    else { alert("집중 항목은 3개까지 고를 수 있습니다."); return; }
    renderRadar();return;
  }
  const unfocus=event.target.closest("[data-v2-unfocus]"); if(unfocus){setFocusIds(focusIds().filter(x=>x!==unfocus.dataset.v2Unfocus));renderFocus();return}
  const cal=event.target.closest("[data-v2-calendar]"); if(cal){const data=await loadData(),a=data.assignments.find(x=>x.id===cal.dataset.v2Calendar);downloadIcs(a);return}
  const noteCopy=event.target.closest("[data-v2-note-copy]");if(noteCopy){const n=notes().find(x=>x.id===noteCopy.dataset.v2NoteCopy);if(n)await copyText(`${n.title}\n\n${n.body}`);return}
  const noteDelete=event.target.closest("[data-v2-note-delete]");if(noteDelete){setNotes(notes().filter(x=>x.id!==noteDelete.dataset.v2NoteDelete));renderNotes();return}
}
async function handleSuiteSubmit(event) {
  const form=event.target.closest("[data-v2-note-form]"); if(!form)return;
  event.preventDefault();const fd=new FormData(form),title=String(fd.get("title")||"").trim(),body=String(fd.get("body")||"").trim();if(!title&&!body)return;
  setNotes([{id:safeId("note"),title:title||"메모",body,createdAt:Date.now()},...notes()]);renderNotes();
}
let searchDebounce=null;
function handleSuiteInput(event) {
  if(event.target.id!=="pincon-v2-search-input")return;
  clearTimeout(searchDebounce);searchDebounce=setTimeout(updateSearchResults,180);
}

function updateDockBadge() {
  const dot=document.querySelector(".pincon-v2-dot"); if(!dot)return;
  const n=urgentAssignments(dataCache.assignments||[]).length;
  dot.textContent=String(Math.min(n,99));dot.hidden=n===0;
}

function updateContentSubscription() {
  const need=Boolean(currentUser&&currentClassKey&&(betaOn()||new URLSearchParams(location.search).get("share-target")==="1"));
  if(!need){unsubscribeContent?.();unsubscribeContent=null;classContent=[];return}
  if(unsubscribeContent)return;
  unsubscribeContent=firebaseApi.subscribeClassContent(currentClassKey,(items)=>{
    classContent=items||[];
    if(betaOn()&&dataCache.at)saveSnapshot({assignments:dataCache.assignments,polls:dataCache.polls,classContent});
    handleShareTarget();
  },()=>{},()=>{});
}

function ensureImportSheet() {
  if(importSheet)return;
  importSheet=document.createElement("div");importSheet.className="pincon-v2-sheet";
  importSheet.innerHTML='<div class="pincon-v2-panel"><div class="pincon-v2-head"><h2>PinCon으로 공유</h2><button type="button" class="pincon-v2-close" aria-label="닫기"><md-icon>close</md-icon></button></div><div class="pincon-v2-import"></div></div>';
  document.body.appendChild(importSheet);
  importSheet.querySelector(".pincon-v2-close").addEventListener("click",clearShareUrl);
}
function clearShareUrl(){
  const u=new URL(location.href);["share-target","title","text","url"].forEach(k=>u.searchParams.delete(k));history.replaceState({},"",u.pathname+u.search+u.hash);importSheet?.classList.remove("open");
}
async function handleShareTarget() {
  if(shareHandled||!currentUser||!currentClassKey)return;
  const q=new URLSearchParams(location.search);if(q.get("share-target")!=="1")return;
  const groups=classContent.filter(x=>x.kind==="group"&&!x.deleted);if(!groups.length)return;
  shareHandled=true;ensureImportSheet();
  const title=q.get("title")||"",url=q.get("url")||"",text=q.get("text")||"",detected=url||text.match(/https?:\/\/\S+/)?.[0]||"";
  const box=importSheet.querySelector(".pincon-v2-import");
  box.innerHTML=`<label>저장할 모둠<select id="pincon-v2-import-group">${groups.map(g=>`<option value="${escapeHtml(g.id)}">${escapeHtml(g.groupLabel||g.title||g.subject||"모둠")}</option>`).join("")}</select></label><label>제목<input id="pincon-v2-import-title" maxlength="140" value="${escapeHtml(title||(detected?"공유 링크":"공유 텍스트"))}"></label>${detected?`<label>링크<input id="pincon-v2-import-url" value="${escapeHtml(detected)}"></label>`:`<label>내용<textarea id="pincon-v2-import-text">${escapeHtml(text)}</textarea></label>`}<div class="pincon-v2-actions"><button data-import-cancel>취소</button><button class="primary" data-import-save>모둠 공유함에 저장</button></div>`;
  importSheet.classList.add("open");
  box.querySelector("[data-import-cancel]").addEventListener("click",clearShareUrl);
  box.querySelector("[data-import-save]").addEventListener("click",async()=>{
    const groupId=box.querySelector("#pincon-v2-import-group").value,itemTitle=box.querySelector("#pincon-v2-import-title").value.trim()||"공유 항목";
    const data={classKey:currentClassKey,groupId,type:detected?"link":"note",title:itemTitle,deleted:false,authorUid:currentUser.uid,authorName:currentUser.displayName||currentUser.email||"학생",createdAtMs:Date.now(),updatedAtMs:Date.now()};
    if(detected)data.url=box.querySelector("#pincon-v2-import-url").value.trim();else data.body=box.querySelector("#pincon-v2-import-text").value.trim();
    try{await createDoc(`${schoolPath("groupDrive")}/${groupId}/items`,safeId("item"),data);clearShareUrl()}catch(error){alert(error?.message||"저장하지 못했습니다.")}
  });
}

async function appleSignIn() {
  try {
    const [{initializeApp},{getAuth,OAuthProvider,signInWithRedirect,browserLocalPersistence,setPersistence}]=await Promise.all([
      import("https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js"),
    ]);
    const app=initializeApp(FIREBASE);const auth=getAuth(app);await setPersistence(auth,browserLocalPersistence);
    const provider=new OAuthProvider("apple.com");provider.addScope("email");provider.addScope("name");provider.setCustomParameters({locale:"ko_KR"});
    await signInWithRedirect(auth,provider);
  } catch(error) {
    console.error(error);
    alert("Apple 로그인을 사용할 수 없습니다. Firebase와 Apple Developer의 로그인 설정을 확인해 주세요.");
  }
}
function ensureAppleButton() {
  if(currentUser||document.querySelector(".pincon-apple-button"))return;
  const controls=[...document.querySelectorAll("button,md-filled-button,md-outlined-button,md-text-button")];
  const google=controls.find(b=>/Google/i.test(b.textContent||""));if(!google)return;
  const button=document.createElement("button");button.type="button";button.className="pincon-apple-button";button.textContent="Apple로 계속";button.addEventListener("click",appleSignIn);google.insertAdjacentElement("afterend",button);
}

function syncClass() {
  const next=profileClassKey();if(next===currentClassKey)return;
  currentClassKey=next;shareHandled=false;dataCache={at:0,assignments:[],polls:[]};classContent=[];unsubscribeContent?.();unsubscribeContent=null;updateContentSubscription();updateDockBadge();
}
function uiPass() {
  if(locked()){scheduleUiPass(120);return}
  syncClass();ensureSettingsCard();ensureAppleButton();ensureDock();applyBeta();
}
function scheduleUiPass(delay=60) {
  if(uiPassQueued)return;uiPassQueued=true;
  setTimeout(()=>{uiPassQueued=false;uiPass()},delay);
}

firebaseApi.observeAuth((user)=>{
  currentUser=user;currentClassKey="";shareHandled=false;syncClass();scheduleUiPass(0);
});
const root=document.getElementById("root");
if(root)new MutationObserver(()=>scheduleUiPass(70)).observe(root,{childList:true,subtree:true});
new MutationObserver(()=>{if(!betaOn())suiteSheet?.classList.remove("open");ensureDock();applyPrefs()}).observe(document.body,{attributes:true,attributeFilter:["class"]});
window.addEventListener("storage",()=>{syncClass();applyBeta();});
window.addEventListener("pageshow",()=>scheduleUiPass(0));
document.addEventListener("keydown",(event)=>{
  if(!betaOn())return;
  const tag=document.activeElement?.tagName;
  if(tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT")return;
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="k"){event.preventDefault();openSuite("search");}
});
ensureDock();applyBeta();scheduleUiPass(0);
