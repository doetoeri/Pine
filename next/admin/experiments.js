import { NextDataGateway } from "../core/data-gateway.js";
import { getExperimentPlatform } from "../experiment/experiment-service.js";
import { notificationPeriodAt } from "../experiment/assignment-service.js";

const gateway = new NextDataGateway();
const platform = await getExperimentPlatform();
let currentId = "pincon-next-ui";
let bundle = { config: null, assignments: [], events: [], surveys: [] };
let loading = false;

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
const avg = (rows) => rows.length ? rows.reduce((a,b)=>a+b,0)/rows.length : NaN;
const percent = (value) => Number.isFinite(value) ? `${(value*100).toFixed(1)}%` : "–";
const eventRows = (type, variant="") => bundle.events.filter((row)=>row.eventType===type && (!variant || row.variant===variant));

function variantMetrics(variant) {
  const rows = bundle.events.filter((row)=>row.variant===variant);
  const participants = new Set(rows.map((row)=>row.anonymousParticipant));
  const sessions = new Set(rows.filter((row)=>row.eventType==="session_start").map((row)=>row.sessionId));
  const reach = new Set(rows.filter((row)=>["schedule_view","assignment_view","material_view","notice_view","target_information_view"].includes(row.eventType)).map((row)=>row.anonymousParticipant));
  const tti = rows.filter((row)=>row.eventType==="target_information_view").map((row)=>Number(row.properties?.durationMs)).filter(Number.isFinite);
  const errors = rows.filter((row)=>["js_error","data_load_failure","login_failure","fcm_failure","navigation_error"].includes(row.eventType)).length;
  const days = new Map();
  rows.filter((row)=>row.eventType==="session_start").forEach((row)=>{
    const set=days.get(row.anonymousParticipant)||new Set();
    set.add(new Date(row.timestampMs).toISOString().slice(0,10));
    days.set(row.anonymousParticipant,set);
  });
  return {
    participants: participants.size,
    sessions: sessions.size,
    reach: participants.size ? reach.size/participants.size : NaN,
    tti: avg(tti),
    errors: sessions.size ? errors/sessions.size : NaN,
    returns: participants.size ? [...days.values()].filter((set)=>set.size>=2).length/participants.size : NaN,
  };
}

function conditionMetrics(condition) {
  const sent = eventRows("notification_sent", condition).length;
  const ratio = (type) => percent(sent ? eventRows(type, condition).length/sent : NaN);
  const surveys = bundle.surveys.filter((row)=>row.condition===condition);
  return {
    sent,
    click: ratio("notification_click"),
    open1h: ratio("app_open_after_notification_1h"),
    target: ratio("target_view_after_notification"),
    annoyance: avg(surveys.map((row)=>Number(row.annoyanceScore)).filter(Number.isFinite)),
    usefulness: avg(surveys.map((row)=>Number(row.usefulnessScore)).filter(Number.isFinite)),
  };
}

function metric(label, value, support="") {
  return `<div class="experiment-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(support)}</small></div>`;
}

function uiBody() {
  const legacy = variantMetrics("legacy");
  const next = variantMetrics("next");
  const counts = bundle.assignments.reduce((out,row)=>{out[row.variant]=(out[row.variant]||0)+1;return out},{});
  return `
    <div class="experiment-status"><b>${esc(bundle.config?.status||"설정 없음")}</b><span>Legacy ${counts.legacy||0} · Next ${counts.next||0}</span><span>Rollout ${Number(bundle.config?.rolloutPercent||0)}%</span></div>
    <div class="experiment-grid">
      ${metric("Participants",`A ${legacy.participants} / B ${next.participants}`)}
      ${metric("Sessions",`A ${legacy.sessions} / B ${next.sessions}`)}
      ${metric("핵심 정보 도달률",`A ${percent(legacy.reach)} / B ${percent(next.reach)}`)}
      ${metric("Time to Information",`A ${Number.isFinite(legacy.tti)?Math.round(legacy.tti)+"ms":"–"} / B ${Number.isFinite(next.tti)?Math.round(next.tti)+"ms":"–"}`)}
      ${metric("Return Rate",`A ${percent(legacy.returns)} / B ${percent(next.returns)}`)}
      ${metric("Guardrail Error",`A ${percent(legacy.errors)} / B ${percent(next.errors)}`)}
    </div>
    <div class="experiment-actions">
      <button data-exp-action="seed-ui">설정 생성</button><button class="primary" data-exp-action="canary">Canary</button>
      <button data-exp-action="active">50:50 A/B</button><button data-exp-action="pause-ui">Pause</button>
      ${[25,50,75,100].map((n)=>`<button data-exp-action="rollout" data-value="${n}">${n}%</button>`).join("")}
      <button data-exp-action="complete-next">Next 승격</button><button data-exp-action="complete-legacy">Legacy 유지</button>
      <button class="danger" data-exp-action="rollback">Rollback</button>
    </div>
    <div class="experiment-canary"><input id="experimentCanaryUids" placeholder="Canary UID 최대 7개, 쉼표로 구분"><button data-exp-action="set-canary">지정</button></div>
    <p class="experiment-note">Canary는 안정성 검증용입니다. 사용자는 Variant를 직접 바꿀 수 없고, 강제 복귀는 운영센터에서만 수행합니다.</p>`;
}

function notificationBody() {
  const rows = ["LOW","MID","HIGH"].map((condition)=>[condition,conditionMetrics(condition)]);
  return `
    <div class="experiment-status"><b>${esc(bundle.config?.status||"설정 없음")}</b><span>참여자 ${bundle.assignments.length}</span><span>설문 ${bundle.surveys.length}</span></div>
    <table class="experiment-table"><thead><tr><th>조건</th><th>FCM accepted</th><th>Click</th><th>1h open</th><th>Target</th><th>피로도</th><th>유용성</th></tr></thead><tbody>
    ${rows.map(([name,m])=>`<tr><td>${name}</td><td>${m.sent}</td><td>${m.click}</td><td>${m.open1h}</td><td>${m.target}</td><td>${Number.isFinite(m.annoyance)?m.annoyance.toFixed(2):"–"}</td><td>${Number.isFinite(m.usefulness)?m.usefulness.toFixed(2):"–"}</td></tr>`).join("")}
    </tbody></table>
    <div class="experiment-actions"><button data-exp-action="seed-notification">설정 생성</button><button class="primary" data-exp-action="start-notification">실험 시작</button><button data-exp-action="pause-notification">Pause</button><button data-exp-action="csv">CSV</button><button data-exp-action="json">JSON</button></div>
    <p class="experiment-note">Critical 알림은 실험에서 제외됩니다. sent는 실제 기기 도착이 아니라 FCM 발송 수락을 뜻합니다.</p>`;
}

function markup() {
  return `<section class="experiment-admin" id="pinconExperimentAdmin">
    <div class="experiment-admin__head"><div><span class="admin-meta">EXPERIMENT PLATFORM</span><h2>실험 · 점진 배포</h2><p>Canary, A/B, rollout, rollback과 후속 알림 빈도 실험을 같은 상태 모델로 관리합니다.</p></div><button data-exp-action="refresh">새로고침</button></div>
    <div class="experiment-tabs"><button data-exp-tab="pincon-next-ui" aria-selected="${currentId==="pincon-next-ui"}">PinCon Next UI</button><button data-exp-tab="notification-frequency" aria-selected="${currentId==="notification-frequency"}">알림 빈도</button></div>
    <div>${loading?"<md-linear-progress indeterminate></md-linear-progress>":currentId==="pincon-next-ui"?uiBody():notificationBody()}</div>
  </section>`;
}

function render() {
  const snap = gateway.snapshot();
  if (snap.access?.role !== "system-admin") return;
  const workspace = document.querySelector("#adminApp .admin-workspace");
  if (!workspace) return;
  const existing = document.querySelector("#pinconExperimentAdmin");
  if (existing) existing.outerHTML = markup();
  else workspace.querySelector(".admin-modules")?.insertAdjacentHTML("beforebegin", markup());
}

async function load() {
  if (loading) return;
  loading=true; render();
  try { bundle = await platform.adminReadExperiment(currentId); }
  finally { loading=false; render(); }
}

const uiDefaults = () => ({ status:"DRAFT",version:1,stableVariant:"legacy",promotedVariant:"",rolloutPercent:0,allocation:{nextPercent:50},canarySize:7 });
const notificationDefaults = () => ({ status:"DRAFT",version:1,stableVariant:"next",promotedVariant:"",rolloutPercent:0,startDate:new Date().toISOString().slice(0,10),baselineDays:2,periodDays:4,frequency:{lowPerDay:1,midPerDay:3,highPerDay:4} });
async function run(action,value) {
  if (action==="refresh") return load();
  if (action==="seed-ui") { await platform.adminSetExperiment("pincon-next-ui",uiDefaults()); await platform.adminSetFlag("pincon_next_ui",{enabled:true,rolloutPercent:0,experimentId:"pincon-next-ui",stableVariant:"legacy"}); }
  if (action==="canary") await platform.adminSetExperiment("pincon-next-ui",{...uiDefaults(),...(bundle.config||{}),status:"CANARY"});
  if (action==="active" && confirm("Canary 검증 후 50:50 A/B를 시작합니다.")) await platform.adminSetExperiment("pincon-next-ui",{...uiDefaults(),...(bundle.config||{}),status:"ACTIVE",allocation:{nextPercent:50}});
  if (action==="pause-ui") await platform.adminSetExperiment("pincon-next-ui",{status:"PAUSED",stableVariant:"legacy"});
  if (action==="rollout" && confirm(`Next를 ${value}%로 배포합니다.`)) { await platform.adminSetExperiment("pincon-next-ui",{status:"ROLLOUT",stableVariant:"legacy",promotedVariant:"next",rolloutPercent:Number(value)}); await platform.adminSetFlag("pincon_next_ui",{enabled:true,rolloutPercent:Number(value),experimentId:"pincon-next-ui",stableVariant:"legacy"}); }
  if (action==="complete-next") await platform.adminSetExperiment("pincon-next-ui",{status:"COMPLETED",stableVariant:"next",promotedVariant:"next",rolloutPercent:100});
  if (action==="complete-legacy") await platform.adminSetExperiment("pincon-next-ui",{status:"COMPLETED",stableVariant:"legacy",promotedVariant:"legacy",rolloutPercent:0});
  if (action==="rollback" && confirm("즉시 Legacy를 Stable UI로 되돌립니다.")) { await platform.adminSetExperiment("pincon-next-ui",{status:"PAUSED",stableVariant:"legacy",promotedVariant:"legacy",rolloutPercent:0}); await platform.adminSetFlag("pincon_next_ui",{enabled:false,rolloutPercent:0,experimentId:"pincon-next-ui",stableVariant:"legacy"}); }
  if (action==="set-canary") { const uids=String(document.querySelector("#experimentCanaryUids")?.value||"").split(",").map(v=>v.trim()).filter(Boolean).slice(0,7); for (const uid of uids) await platform.adminSetTarget("pincon-next-ui",uid,"canary"); }
  if (action==="seed-notification") { await platform.adminSetExperiment("notification-frequency",notificationDefaults()); await platform.adminSetFlag("notification_experiment",{enabled:false,rolloutPercent:0,experimentId:"notification-frequency",stableVariant:"next"}); }
  if (action==="start-notification" && confirm("UI 실험이 Next 승격으로 완료된 경우에만 시작됩니다.")) { await platform.adminSetExperiment("notification-frequency",{...notificationDefaults(),...(bundle.config||{}),status:"ACTIVE"}); await platform.adminSetFlag("notification_experiment",{enabled:true,rolloutPercent:100,experimentId:"notification-frequency",stableVariant:"next"}); }
  if (action==="pause-notification") { await platform.adminSetExperiment("notification-frequency",{status:"PAUSED"}); await platform.adminSetFlag("notification_experiment",{enabled:false,rolloutPercent:0,experimentId:"notification-frequency",stableVariant:"next"}); }
  await load();
}

function saveFile(name, type, text) {
  const url=URL.createObjectURL(new Blob([text],{type})); const link=document.createElement("a"); link.href=url; link.download=name; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}
function exportCsv() {
  const sent=eventRows("notification_sent");
  const lines=[["anonymousParticipant","condition","notificationCount","clickRate","open1hRate","annoyanceScore","usefulnessScore"]];
  for (const p of new Set(sent.map(e=>e.anonymousParticipant))) {
    const own=sent.filter(e=>e.anonymousParticipant===p), n=own.length, condition=own[0]?.variant||"";
    const survey=bundle.surveys.find(s=>s.anonymousParticipant===p&&s.condition===condition);
    lines.push([p,condition,n,n?eventRows("notification_click",condition).filter(e=>e.anonymousParticipant===p).length/n:0,n?eventRows("app_open_after_notification_1h",condition).filter(e=>e.anonymousParticipant===p).length/n:0,survey?.annoyanceScore??"",survey?.usefulnessScore??""]);
  }
  saveFile("pincon-notification-experiment.csv","text/csv;charset=utf-8","\ufeff"+lines.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(",")).join("\n"));
}

document.addEventListener("click",(event)=>{
  const tab=event.target.closest("[data-exp-tab]"); if(tab){currentId=tab.dataset.expTab;load();return}
  const button=event.target.closest("[data-exp-action]"); if(!button)return;
  if(button.dataset.expAction==="csv"){exportCsv();return}
  if(button.dataset.expAction==="json"){saveFile(`pincon-${currentId}.json`,"application/json",JSON.stringify(bundle,null,2));return}
  run(button.dataset.expAction,button.dataset.value).catch((error)=>console.error("[Experiment Admin]",error));
});
new MutationObserver(render).observe(document.querySelector("#adminApp"),{childList:true,subtree:true});
gateway.addEventListener("change",render);
render(); load();
