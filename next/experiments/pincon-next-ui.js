import { NextDataGateway, readClassProfile } from "../core/data-gateway.js";
import { reportDataGatewaySnapshot } from "../experiment/bootstrap.js";

const root = document.createElement("div");
root.id = "experimentApp";
document.body.appendChild(root);

const style = document.createElement("link");
style.rel = "stylesheet";
style.href = "./experiments/pincon-next-ui.css?v=20260914-flux1";
document.head.appendChild(style);

const gateway = new NextDataGateway();
let snapshot = gateway.snapshot();
let flowTab = location.hash.startsWith("#schedule") ? "schedule" : "timetable";
let classroomTab = "notice";
let searchQuery = "";
let selectedLesson = 0;
let selectedDayDate = "";
let detailOpen = false;
let focusMode = false;
let timelineDrag = null;
let navDrag = null;
let toastTimer = 0;
let transitionDirection = 1;
const completedPreparation = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem("pincon-flux-prep-v1") || "[]");
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  } catch {
    return new Set();
  }
})();

const NAV = [
  { id: "today", label: "오늘", route: "today" },
  { id: "flow", label: "흐름", route: "timetable" },
  { id: "classroom", label: "학급", route: "classroom" },
  { id: "me", label: "나", route: "more" },
];

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  }[char]));
}
function clean(value) {
  const node = document.createElement("div");
  node.innerHTML = String(value || "").replace(/<br\s*\/?>/gi, " ");
  return (node.textContent || "").replace(/\s+/g, " ").trim();
}
function data() { return snapshot.data || {}; }
function localDate(date = new Date()) {
  const y = date.getFullYear(), m = String(date.getMonth()+1).padStart(2,"0"), d = String(date.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}
function itemDate(item = {}) {
  const raw = item.dueDate || item.date || item.startsOn || item.startDate || "";
  const match = String(raw).match(/^\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  const ms = Number(item.dueAtMs || item.startsAtMs || 0);
  return ms ? localDate(new Date(ms)) : "";
}
function title(item, fallback="정보") { return clean(item?.title || item?.name || item?.subject || item?.question || fallback); }
function sectionFromHash() {
  const route = location.hash.replace(/^#\/?/, "").split("?")[0] || "today";
  if (["timetable","schedule"].includes(route)) return "flow";
  if (route === "classroom") return "classroom";
  if (route === "more") return "me";
  return "today";
}
function profileLabel() {
  const p = snapshot.profile || readClassProfile() || {};
  return p.classKey || (p.grade && p.classNumber ? `${p.grade}-${p.classNumber}` : "학급");
}
function todayTimetable() {
  const today = localDate();
  return (data().neisTimetables || []).find((doc) => doc.date === today)
    || (data().neisTimetables || []).find((doc) => Array.isArray(doc.periods))
    || null;
}
const FALLBACK_PERIOD_TIMES = Object.freeze({
  1:["09:00","09:50"],2:["10:00","10:50"],3:["11:00","11:50"],4:["12:00","12:50"],
  5:["13:50","14:40"],6:["14:50","15:40"],7:["15:50","16:40"],
});
function periodTimes(period = {}) {
  const fallback = FALLBACK_PERIOD_TIMES[Number(period.period || 0)] || ["",""];
  const start = clean(period.startTime || period.startsAt || fallback[0]);
  const end = clean(period.endTime || period.endsAt || fallback[1]);
  return { start, end };
}
function minutes(value) {
  const m = String(value || "").match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}
function lessonState(period, dateText = localDate()) {
  const { start, end } = periodTimes(period);
  const a = minutes(start), b = minutes(end);
  if (dateText !== localDate() || !Number.isFinite(a) || !Number.isFinite(b)) {
    return { current:false, past:Boolean(dateText && dateText < localDate()) };
  }
  const now = new Date(), current = now.getHours()*60 + now.getMinutes();
  return { current: current >= a && current <= b, past: current > b };
}
function dateLabel(dateText) {
  if (!dateText) return "";
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateText;
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(date);
}
function weekdayLabel(dateText) {
  if (!dateText) return "";
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", { weekday: "long" }).format(date);
}
function shortDate(dateText) {
  const match = String(dateText || "").match(/^\d{4}-(\d{2})-(\d{2})/);
  return match ? `${match[1]}.${match[2]}` : dateText || "미정";
}
function sortedTimetables() {
  const rows = (data().neisTimetables || [])
    .filter((doc) => Array.isArray(doc.periods) && doc.periods.length)
    .sort((a,b) => String(a.date || "").localeCompare(String(b.date || "")));
  const today = localDate();
  const future = rows.filter((doc) => !doc.date || doc.date >= today).slice(0,3);
  return future.length ? future : rows.slice(-3);
}
function activeTimetable() {
  const docs = sortedTimetables();
  if (!docs.length) return null;
  if (!selectedDayDate || !docs.some((doc) => doc.date === selectedDayDate)) {
    selectedDayDate = docs.find((doc) => doc.date === localDate())?.date || docs[0]?.date || "";
  }
  return docs.find((doc) => doc.date === selectedDayDate) || docs[0];
}
function currentPeriodIndex(periods = [], dateText = localDate()) {
  const current = periods.findIndex((period) => lessonState(period, dateText).current);
  if (current >= 0) return current;
  const firstFuture = periods.findIndex((period) => !lessonState(period, dateText).past);
  return firstFuture >= 0 ? firstFuture : Math.max(0, periods.length - 1);
}
function syncSelectedLesson() {
  const doc = activeTimetable();
  const periods = doc?.periods || [];
  if (!periods.length) { selectedLesson = 0; return; }
  if (!Number.isInteger(selectedLesson) || selectedLesson < 0 || selectedLesson >= periods.length) {
    selectedLesson = currentPeriodIndex(periods, doc?.date || localDate());
  }
}
function saveCompletedPreparation() {
  try { localStorage.setItem("pincon-flux-prep-v1", JSON.stringify([...completedPreparation].slice(-200))); } catch {}
}

function matchingPreparation(period, dateText = selectedDayDate || localDate()) {
  const subject = clean(period?.subject || period?.name || "");
  return (data().classAssignments || []).filter((item) => {
    if (item.deleted || item.published === false) return false;
    const type = String(item.type || "");
    return type === "preparation"
      && (!itemDate(item) || itemDate(item) === dateText)
      && (!subject || !item.subject || subject.includes(clean(item.subject)) || clean(item.subject).includes(subject));
  });
}
function nextImportant() {
  const now = Date.now();
  return (data().classAssignments || [])
    .filter((item) => !item.deleted && item.published !== false && item.type !== "preparation")
    .map((item) => ({ item, ms: Number(item.dueAtMs || (itemDate(item) ? Date.parse(itemDate(item)+"T23:59:00") : 0)) }))
    .filter(({ms}) => ms >= now)
    .sort((a,b) => a.ms-b.ms)[0]?.item || null;
}
function syncLabel() {
  if (!snapshot.online) return "오프라인 · 저장된 정보";
  if (snapshot.syncing) return "동기화 중";
  if (snapshot.usingCache) return "캐시 표시 · 동기화 대기";
  if (snapshot.error) return "일부 정보 연결 실패";
  return "실시간 동기화";
}
function rowMarkup(period, index) {
  const key = `lesson-${period.id || period.period || index+1}`;
  const state = lessonState(period);
  const prep = matchingPreparation(period);
  const times = periodTimes(period);
  const subtitle = [clean(period.teacher || period.teacherName || ""), clean(period.classroom || period.room || "")].filter(Boolean).join(" · ");
  return `<article class="qf-row" data-row-key="${esc(key)}" data-open="${openKey===key}" data-current="${state.current}" data-past="${state.past}">
    <div class="qf-clock">${esc(times.start || `${period.period || index+1}교시`)}${times.end ? `<small>${esc(times.end)}</small>` : ""}</div>
    <div class="qf-row-main"><button class="qf-row-button" data-qf-expand="${esc(key)}" type="button" aria-expanded="${openKey===key}">
      <span class="qf-title">${esc(clean(period.subject || period.name || "수업 정보"))}</span>
      ${subtitle ? `<span class="qf-sub">${esc(subtitle)}</span>` : ""}
      ${prep.length ? `<span class="qf-attach">준비물 ${prep.length}건</span>` : ""}
    </button>
    <div class="qf-detail"><div><div class="qf-detail-inner">
      ${prep.length ? prep.map((item)=>`<p><strong>준비물</strong> · ${esc(title(item))}${item.materials ? `<br>${esc(clean(item.materials))}` : ""}</p>`).join("") : "<p>등록된 준비물이 없습니다.</p>"}
      <button class="qf-button" type="button" data-qf-route="schedule" data-task="material">수행·준비물 흐름 보기</button>
    </div></div></div></div>
  </article>`;
}
function todayMarkup() {
  const timetable = todayTimetable();
  const periods = timetable?.periods || [];
  const important = nextImportant();
  const meal = (data().meals || []).find((item)=>item.date===localDate()) || (data().meals || [])[0];
  const current = periods.find((p)=>lessonState(p).current);
  return `<section>
    <div class="qf-hero"><span class="qf-eyebrow">Living Spine · ${esc(localDate())}</span><h1>${current ? esc(clean(current.subject || "지금 수업")) : "오늘의 흐름"}</h1><p>${current ? "현재 시간에 가까운 정보가 자연스럽게 커집니다." : "시간표와 준비물, 가까운 일정을 한 축에서 확인합니다."}</p></div>
    ${snapshot.syncing && !snapshot.ready ? '<div class="qf-skeleton"></div>' : snapshot.error && !periods.length ? '<div class="qf-error">시간표를 불러오지 못했습니다. 안정된 PinCon 데이터가 다시 연결되면 자동으로 갱신됩니다.</div>' : `<div class="qf-timeline">${periods.length ? periods.map(rowMarkup).join("") : '<div class="qf-empty">오늘 시간표 데이터가 아직 없습니다.</div>'}</div>`}
    ${important ? `<div class="qf-mass"><span class="qf-eyebrow">Approach</span><h2>${esc(title(important))}</h2><p>${esc([clean(important.subject), itemDate(important)].filter(Boolean).join(" · "))}</p><button class="qf-button primary" type="button" data-qf-route="schedule" data-task="assignment">가까운 수행 확인</button></div>` : ""}
    ${meal ? `<div class="qf-flat"><div><h3>오늘 급식</h3><p>${esc(clean(meal.menu || meal.dishName || meal.dishesHtml || meal.meal || meal.body || (Array.isArray(meal.items) ? meal.items.join(" · ") : "급식 정보 확인"))).slice(0,220)}</p></div><button class="qf-button" data-qf-event="meal_view">확인</button></div>` : ""}
  </section>`;
}
function flowRows(items) {
  if (!items.length) return '<div class="qf-empty">표시할 일정이 없습니다.</div>';
  return `<div class="qf-flow">${items.map(({item,kind})=>`<article class="qf-row"><div class="qf-clock">${esc(itemDate(item) || "미정")}</div><div class="qf-row-main"><button class="qf-row-button" type="button" data-qf-item="${esc(kind)}"><span class="qf-title">${esc(title(item))}</span><span class="qf-sub">${esc([clean(item.subject), clean(item.status || item.verificationStatus)].filter(Boolean).join(" · "))}</span></button></div></article>`).join("")}</div>`;
}
function flowMarkup() {
  if (flowTab === "timetable") {
    const doc = todayTimetable();
    return `<section><div class="qf-hero"><span class="qf-eyebrow">Flow</span><h1>시간의 흐름</h1><p>수업 순서가 하나의 축으로 이어집니다.</p></div>${subnav("flow", [["timetable","시간표"],["schedule","수행·일정"]],flowTab)}<div class="qf-timeline">${(doc?.periods||[]).length ? doc.periods.map(rowMarkup).join("") : '<div class="qf-empty">시간표 데이터가 없습니다.</div>'}</div></section>`;
  }
  const rows = [
    ...(data().classAssignments || []).filter((x)=>!x.deleted && x.published!==false).map(item=>({item,kind:item.type==="preparation"?"material":"assignment"})),
    ...(data().academicSchedules || []).filter((x)=>!x.deleted).map(item=>({item,kind:"schedule"})),
  ].sort((a,b)=>String(itemDate(a.item)).localeCompare(String(itemDate(b.item))));
  return `<section><div class="qf-hero"><span class="qf-eyebrow">Approach</span><h1>다가오는 것들</h1><p>가까워지는 수행평가와 학사일정이 먼저 보입니다.</p></div>${subnav("flow", [["timetable","시간표"],["schedule","수행·일정"]],flowTab)}${flowRows(rows)}</section>`;
}
function subnav(group, entries, active) {
  return `<nav class="qf-subnav" aria-label="하위 탐색">${entries.map(([id,label])=>`<button type="button" data-qf-tab="${group}:${id}" aria-selected="${active===id}">${label}</button>`).join("")}</nav>`;
}
function classroomMarkup() {
  const notices = (data().announcements || []).filter((x)=>!x.deleted);
  const resources = (data().resources || []).filter((x)=>!x.deleted && (!x.moderationStatus || x.moderationStatus==="approved"));
  const items = classroomTab === "notice" ? notices : resources;
  return `<section><div class="qf-hero"><span class="qf-eyebrow">Classroom</span><h1>${esc(profileLabel())}의 맥락</h1><p>공지와 자료를 별도 카드 더미가 아니라 같은 흐름에서 펼칩니다.</p></div>
  ${subnav("classroom", [["notice","공지"],["resources","자료"]],classroomTab)}
  <div class="qf-search"><input id="qfSearch" type="search" value="${esc(searchQuery)}" placeholder="제목으로 빠르게 찾기" aria-label="학급 정보 검색"></div>
  ${items.filter((item)=>!searchQuery || title(item).toLowerCase().includes(searchQuery.toLowerCase())).map((item)=>`<div class="qf-flat"><div><h3>${esc(title(item))}</h3><p>${esc(clean(item.body || item.description || item.subject || "")).slice(0,200)}</p></div><button class="qf-button" type="button" data-qf-item="${classroomTab==="notice"?"notice":"material"}">확인</button></div>`).join("") || '<div class="qf-empty">조건에 맞는 정보가 없습니다.</div>'}</section>`;
}
function notificationSurveyMarkup() {
  const ctx = globalThis.PinConExperiment?.context;
  if (ctx?.experimentId !== "notification-frequency" || ctx.phase !== "EXPERIMENT") return "";
  return `<div class="qf-flat"><div><h3>이번 알림 기간 피드백</h3><p>${esc(ctx.condition)} 조건 · Period ${ctx.period}</p></div><button class="qf-button" type="button" data-qf-survey>짧은 설문</button></div>`;
}
function meMarkup() {
  const name = clean(snapshot.user?.displayName || snapshot.user?.email || "PinCon 사용자");
  const ui = globalThis.PinConExperiment?.uiContext;
  return `<section><div class="qf-hero"><span class="qf-eyebrow">Me</span><h1>${esc(name)}</h1><p>실험 중에도 사용자가 Variant를 직접 바꾸는 스위치는 제공하지 않습니다.</p></div>
    <div class="qf-status"><span class="qf-pill">${esc(syncLabel())}</span><span class="qf-pill">UI · ${esc(ui?.variant || "legacy")}</span><span class="qf-pill">${esc(profileLabel())}</span></div>
    ${ui?.cohort === "public-beta" ? '<div class="qf-flat"><div><h3>공개 베타 참여 중</h3><p>이 사용 기록은 정식 A/B 비교와 분리됩니다. 원하면 바로 기존 PinCon으로 돌아갈 수 있습니다.</p></div><button class="qf-button" type="button" data-pincon-public-beta="leave">기존 화면으로 돌아가기</button></div>' : ""}
    ${notificationSurveyMarkup()}
    ${snapshot.canArchiveContent ? '<div class="qf-flat"><div><h3>PinCon 운영센터</h3><p>학급 운영과 실험 집계는 권한이 있는 계정만 접근합니다.</p></div><a class="qf-button primary" href="./admin/">운영센터</a></div>' : ""}
    <div class="qf-flat"><div><h3>PWA · 알림</h3><p>설치형 앱과 FCM 연결은 기존 PinCon 계층을 그대로 사용합니다. 현재 알림 권한: ${esc(Notification.permission || "default")}</p></div></div>
    <div class="qf-flat"><div><h3>분석 개인정보</h3><p>실험 이벤트에는 이름·학번·입력한 검색어 원문을 저장하지 않습니다.</p></div></div>
  </section>`;
}
function dockMarkup(active) {
  return `<div class="qf-dock-wrap"><nav class="qf-dock" aria-label="PinCon 주요 탐색"><span class="qf-selector" aria-hidden="true"></span>${NAV.map((item)=>`<button type="button" data-qf-nav="${item.id}" aria-current="${active===item.id?"page":"false"}">${item.label}</button>`).join("")}</nav></div>`;
}
function render() {
  reportDataGatewaySnapshot(snapshot);
  const active = sectionFromHash();
  root.innerHTML = `<div class="qf-shell"><header class="qf-top"><div class="qf-brand"><span class="qf-seed" aria-hidden="true"></span><div><strong>PinCon</strong><small>Quiet Flux · ${esc(profileLabel())}</small></div></div><span class="qf-sync">${esc(syncLabel())}</span></header><main class="qf-main">${active==="today"?todayMarkup():active==="flow"?flowMarkup():active==="classroom"?classroomMarkup():meMarkup()}</main></div>${dockMarkup(active)}`;
  settleDock(false);
}
function settleDock(animate=true) {
  const active = sectionFromHash();
  const index = NAV.findIndex((item)=>item.id===active);
  const selector = root.querySelector(".qf-selector");
  if (!selector) return;
  if (!animate) selector.style.transition = "none";
  selector.style.width = "25%";
  selector.style.transform = `translateX(${Math.max(0,index)*100}%)`;
  requestAnimationFrame(()=>{ selector.style.transition = ""; });
}
function navigate(section) {
  const nav = NAV.find((item)=>item.id===section);
  if (!nav) return;
  const route = section==="flow" ? (flowTab==="schedule"?"schedule":"timetable") : nav.route;
  if (location.hash !== `#${route}`) history.pushState({route}, "", `#${route}`);
  render();
  globalThis.PinConExperiment?.log("navigation_change",{to:route,route});
}
function openSurvey() {
  const ctx = globalThis.PinConExperiment?.context;
  if (!ctx || ctx.experimentId!=="notification-frequency") return;
  const dialog=document.createElement("dialog");
  dialog.innerHTML=`<form method="dialog" style="width:min(520px,86vw);font-family:inherit"><h2>알림 피드백</h2><p>각 항목을 1~5점으로 답해 주세요.</p>
  ${[["usefulnessScore","알림이 유용했다"],["annoyanceScore","알림이 너무 많다고 느꼈다"],["increasedUseScore","알림 때문에 PinCon을 더 자주 확인했다"],["continueScore","이 정도의 알림을 계속 받고 싶다"]].map(([name,label])=>`<label style="display:grid;gap:6px;margin:14px 0">${label}<input name="${name}" type="range" min="1" max="5" value="3"></label>`).join("")}
  <label style="display:grid;gap:6px">적절한 하루 알림 수<select name="preferredDailyCount"><option>0</option><option>1</option><option selected>2</option><option>3</option><option>4</option><option>5+</option></select></label>
  <p style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px"><button value="cancel">취소</button><button value="save">저장</button></p></form>`;
  document.body.appendChild(dialog);dialog.showModal();
  dialog.addEventListener("close",async()=>{if(dialog.returnValue==="save"){const fd=new FormData(dialog.querySelector("form"));await globalThis.PinConExperiment.saveNotificationSurvey({period:ctx.period,condition:ctx.condition,usefulnessScore:Number(fd.get("usefulnessScore")),annoyanceScore:Number(fd.get("annoyanceScore")),increasedUseScore:Number(fd.get("increasedUseScore")),continueScore:Number(fd.get("continueScore")),preferredDailyCount:String(fd.get("preferredDailyCount"))}).catch(()=>{});}dialog.remove();},{once:true});
}

root.addEventListener("click",(event)=>{
  const nav=event.target.closest("[data-qf-nav]");if(nav){navigate(nav.dataset.qfNav);return}
  const expand=event.target.closest("[data-qf-expand]");if(expand){openKey=openKey===expand.dataset.qfExpand?"":expand.dataset.qfExpand;render();globalThis.PinConExperiment?.log("item_expand",{itemType:"schedule",route:sectionFromHash()});return}
  const route=event.target.closest("[data-qf-route]");if(route){flowTab=route.dataset.qfRoute==="schedule"?"schedule":flowTab;const section=route.dataset.qfRoute==="schedule"?"flow":route.dataset.qfRoute;navigate(section);return}
  const tab=event.target.closest("[data-qf-tab]");if(tab){const [group,id]=tab.dataset.qfTab.split(":");if(group==="flow"){flowTab=id;history.replaceState(history.state,"",`#${id==="schedule"?"schedule":"timetable"}`)}else classroomTab=id;render();return}
  const item=event.target.closest("[data-qf-item]");if(item){const type=item.dataset.qfItem;globalThis.PinConExperiment?.log(type==="assignment"?"assignment_view":type==="notice"?"notice_view":type==="material"?"material_view":"schedule_view",{itemType:type,route:sectionFromHash()});return}
  const evt=event.target.closest("[data-qf-event]");if(evt){globalThis.PinConExperiment?.log(evt.dataset.qfEvent,{route:sectionFromHash()});return}
  if(event.target.closest("[data-qf-survey]")){openSurvey();return}
});
root.addEventListener("input",(event)=>{if(event.target.id==="qfSearch"){searchQuery=String(event.target.value||"");const pos=event.target.selectionStart;render();const input=root.querySelector("#qfSearch");input?.focus();input?.setSelectionRange(pos,pos);}});

let drag=null;
root.addEventListener("pointerdown",(event)=>{const dock=event.target.closest(".qf-dock");if(!dock||event.button!==0)return;const rect=dock.getBoundingClientRect();drag={dock,rect,pointerId:event.pointerId};dock.setPointerCapture?.(event.pointerId);});
root.addEventListener("pointermove",(event)=>{if(!drag||drag.pointerId!==event.pointerId)return;const selector=drag.dock.querySelector(".qf-selector");const x=Math.max(0,Math.min(drag.rect.width,event.clientX-drag.rect.left));const idx=Math.max(0,Math.min(3,Math.floor(x/(drag.rect.width/4))));selector.style.transition="none";selector.style.transform=`translateX(${idx*100}%)`;drag.index=idx;});
root.addEventListener("pointerup",(event)=>{if(!drag||drag.pointerId!==event.pointerId)return;const idx=Number.isInteger(drag.index)?drag.index:NAV.findIndex((item)=>item.id===sectionFromHash());drag=null;navigate(NAV[Math.max(0,idx)].id);});
window.addEventListener("popstate",render,{passive:true});window.addEventListener("hashchange",render,{passive:true});
gateway.addEventListener("change",(event)=>{snapshot=event.detail;render();});

document.body.dataset.pinconVariant="next";
render();
await gateway.start();
