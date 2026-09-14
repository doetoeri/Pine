import { NextDataGateway } from "../core/data-gateway.js";
import { getExperimentPlatform } from "../experiment/experiment-service.js";
import { notificationPeriodAt } from "../experiment/assignment-service.js";
import { accountRequest } from "../core/student-auth.js";

const gateway = new NextDataGateway();
await gateway.start();
const platform = await getExperimentPlatform();
let currentId = "pincon-next-ui";
let bundle = { config: null, assignments: [], events: [], participants: [], betaEnrollments: [], surveys: [] };
let roster = [];
let loading = false;

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
const avg = (rows) => rows.length ? rows.reduce((a,b)=>a+b,0)/rows.length : NaN;
const percent = (value) => Number.isFinite(value) ? `${(value*100).toFixed(1)}%` : "–";

const kstDateKey = (timestampMs = Date.now()) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date(Number(timestampMs) || Date.now()));
const eventRows = (type, variant="") => bundle.events.filter((row)=>row.eventType===type && (!variant || row.variant===variant));

function controlledRows(variant = "") {
  const startedAt = Number(bundle.config?.activeStartedAtMs || 0);
  if (!startedAt) return [];
  return bundle.events.filter((row) => {
    if (variant && row.variant !== variant) return false;
    if (startedAt && Number(row.timestampMs || 0) < startedAt) return false;
    const cohort = String(row.properties?.cohort || "");
    return cohort !== "public-beta" && cohort !== "canary";
  });
}

function variantMetrics(variant) {
  const rows = controlledRows(variant);
  const participants = new Set(rows.map((row) => row.anonymousParticipant));
  const sessionRows = rows.filter((row) => row.eventType === "session_start");
  const sessions = new Set(sessionRows.map((row) => row.sessionId));
  const today = kstDateKey();
  const dau = new Set(sessionRows.filter((row) => kstDateKey(row.timestampMs) === today).map((row) => row.anonymousParticipant)).size;
  const reach = new Set(rows.filter((row) => ["schedule_view", "assignment_view", "material_view", "notice_view", "target_information_view"].includes(row.eventType)).map((row) => row.anonymousParticipant));
  const tti = rows.filter((row) => row.eventType === "target_information_view").map((row) => Number(row.properties?.durationMs)).filter(Number.isFinite);
  const taskStarts = rows.filter((row) => row.eventType === "task_start").length;
  const taskTargets = rows.filter((row) => row.eventType === "target_information_view").length;
  const errors = rows.filter((row) => ["js_error", "data_load_failure", "login_failure", "fcm_failure", "navigation_error"].includes(row.eventType)).length;
  const dataFailures = rows.filter((row) => row.eventType === "data_load_failure").length;
  const satisfaction = rows.filter((row) => row.eventType === "ui_satisfaction").map((row) => Number(row.properties?.value)).filter(Number.isFinite);
  const days = new Map();
  sessionRows.forEach((row) => {
    const set = days.get(row.anonymousParticipant) || new Set();
    set.add(kstDateKey(row.timestampMs));
    days.set(row.anonymousParticipant, set);
  });
  return {
    participants: participants.size, sessions: sessions.size, dau,
    reach: participants.size ? reach.size / participants.size : NaN,
    taskSuccess: taskStarts ? Math.min(1, taskTargets / taskStarts) : NaN,
    tti: avg(tti),
    errors: sessions.size ? errors / sessions.size : NaN,
    dataFailure: sessions.size ? dataFailures / sessions.size : NaN,
    satisfaction: avg(satisfaction),
    returns: participants.size ? [...days.values()].filter((set) => set.size >= 2).length / participants.size : NaN,
  };
}

function publicBetaMetrics() {
  const startedAt = Number(bundle.config?.publicBetaStartedAtMs || 0);
  const rows = bundle.events.filter((row) =>
    row.properties?.cohort === "public-beta"
    && (!startedAt || Number(row.timestampMs || 0) >= startedAt)
  );
  const participants = new Set(rows.map((row) => row.anonymousParticipant));
  const sessions = new Set(rows.filter((row) => row.eventType === "session_start").map((row) => row.sessionId));
  const errors = rows.filter((row) => ["js_error", "data_load_failure", "login_failure", "navigation_error"].includes(row.eventType)).length;
  const satisfaction = rows.filter((row) => row.eventType === "ui_satisfaction").map((row) => Number(row.properties?.value)).filter(Number.isFinite);
  return {
    participants: participants.size,
    sessions: sessions.size,
    errorRate: sessions.size ? errors / sessions.size : NaN,
    satisfaction: avg(satisfaction),
  };
}

function conditionMetrics(condition) {
  const sent = eventRows("notification_sent", condition).length;
  const rate = (type) => sent ? eventRows(type, condition).length / sent : NaN;
  const surveys = bundle.surveys.filter((row)=>row.condition===condition);
  return {
    sent,
    clickRate: rate("notification_click"),
    open1hRate: rate("app_open_after_notification_1h"),
    targetRate: rate("target_view_after_notification"),
    annoyance: avg(surveys.map((row)=>Number(row.annoyanceScore)).filter(Number.isFinite)),
    usefulness: avg(surveys.map((row)=>Number(row.usefulnessScore)).filter(Number.isFinite)),
  };
}

function metric(label, value, support="") {
  return `<div class="experiment-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(support)}</small></div>`;
}

function barPercent(value, max = 1) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.max(0, Math.min(100, (value / Math.max(max, 0.0001)) * 100));
}

function compareBar(label, a, b, formatter = percent, support = "") {
  const max = Math.max(Number(a) || 0, Number(b) || 0, 0.0001);
  return `<div class="experiment-compare-card">
    <div class="experiment-compare-card__head"><strong>${esc(label)}</strong><span>${esc(support)}</span></div>
    <div class="experiment-bar-row"><b>Legacy</b><div class="experiment-bar"><i style="width:${barPercent(a, max)}%"></i></div><span>${esc(formatter(a))}</span></div>
    <div class="experiment-bar-row"><b>Next</b><div class="experiment-bar"><i style="width:${barPercent(b, max)}%"></i></div><span>${esc(formatter(b))}</span></div>
  </div>`;
}

function conditionBar(label, rows, key) {
  const max = Math.max(...rows.map(([, metric]) => Number(metric[key]) || 0), 0.0001);
  return `<div class="experiment-compare-card"><div class="experiment-compare-card__head"><strong>${esc(label)}</strong></div>${rows.map(([name, metric]) => `
    <div class="experiment-bar-row"><b>${esc(name)}</b><div class="experiment-bar"><i style="width:${barPercent(metric[key], max)}%"></i></div><span>${esc(percent(metric[key]))}</span></div>`).join("")}</div>`;
}

function assignmentState() {
  const version = Number(bundle.config?.version || 1);
  const assignments = new Map(bundle.assignments
    .filter((item) => Number(item.experimentVersion || 0) === version)
    .map((item) => [item.id, item]));
  const participants = new Set(bundle.participants.map((item) => item.uid));
  const beta = new Set(bundle.betaEnrollments.filter((item) => item.enabled === true).map((item) => item.uid));
  const rows = roster.map((account) => ({
    ...account,
    assignment: assignments.get(account.uid) || null,
    activated: participants.has(account.uid),
    beta: beta.has(account.uid),
  }));
  return { rows, assignments, participants, beta };
}

function rosterMarkup() {
  const state = assignmentState();
  if (!roster.length) return '<div class="experiment-note">현재 선택 학급의 활성 학생 계정을 불러오지 못했습니다. 계정 관리와 학급 선택을 확인하세요.</div>';
  return `<div class="experiment-roster">
    <div class="experiment-roster__head"><div><strong>실험 대상자</strong><span>계정 명단 기준 · PinCon 미접속 학생도 사전배정 가능</span></div><span>${state.rows.length}명</span></div>
    <div class="experiment-table-wrap"><table class="experiment-table"><thead><tr><th>학생</th><th>배정</th><th>활성화</th><th>공개 베타</th></tr></thead><tbody>
      ${state.rows.map((row) => `<tr><td><strong>${esc(row.studentNumber || "")}</strong> ${esc(row.name || "")}</td><td>${esc(row.assignment?.variant || "미배정")}</td><td>${row.activated ? "분석 시작" : "미접속"}</td><td>${row.beta ? "참여" : "–"}</td></tr>`).join("")}
    </tbody></table></div>
  </div>`;
}

function uiBody() {
  const legacy = variantMetrics("legacy");
  const next = variantMetrics("next");
  const beta = publicBetaMetrics();
  const assignment = assignmentState();
  const counts = assignment.rows.reduce((out, row) => {
    if (row.assignment?.variant === "legacy" || row.assignment?.variant === "next") out[row.assignment.variant] = (out[row.assignment.variant] || 0) + 1;
    return out;
  }, {});
  const activated = assignment.rows.filter((row) => row.activated).length;
  const betaOpen = bundle.config?.publicBetaEnabled === true;
  return `
    <div class="experiment-status"><b>${esc(bundle.config?.status || "설정 없음")}</b><span>배정 Legacy ${counts.legacy || 0} · Next ${counts.next || 0}</span><span>활성화 ${activated}/${roster.length}</span><span>공개 베타 ${betaOpen ? "OPEN" : "CLOSED"}</span><span>Rollout ${Number(bundle.config?.rolloutPercent || 0)}%</span></div>
    <div class="experiment-comparison">
      ${compareBar("핵심 정보 도달률", legacy.reach, next.reach, percent, "정식 A/B만")}
      ${compareBar("주요 작업 성공률", legacy.taskSuccess, next.taskSuccess, percent, "정식 A/B만")}
      ${compareBar("Return Rate", legacy.returns, next.returns, percent, "정식 A/B만")}
      ${compareBar("Guardrail Error", legacy.errors, next.errors, percent, "낮을수록 좋음")}
    </div>
    <div class="experiment-grid">
      ${metric("Assigned Users", `A ${counts.legacy || 0} / B ${counts.next || 0}`, `roster ${roster.length}명`)}
      ${metric("Activated Users", `${activated} / ${roster.length}`, "익명 분석 ID 생성")}
      ${metric("DAU", `A ${legacy.dau} / B ${next.dau}`)}
      ${metric("Sessions", `A ${legacy.sessions} / B ${next.sessions}`)}
      ${metric("핵심 정보 도달률", `A ${percent(legacy.reach)} / B ${percent(next.reach)}`)}
      ${metric("주요 작업 성공률", `A ${percent(legacy.taskSuccess)} / B ${percent(next.taskSuccess)}`)}
      ${metric("Time to Information", `A ${Number.isFinite(legacy.tti) ? Math.round(legacy.tti) + "ms" : "–"} / B ${Number.isFinite(next.tti) ? Math.round(next.tti) + "ms" : "–"}`)}
      ${metric("Return Rate", `A ${percent(legacy.returns)} / B ${percent(next.returns)}`)}
      ${metric("Guardrail Error", `A ${percent(legacy.errors)} / B ${percent(next.errors)}`)}
      ${metric("Data Load Failure", `A ${percent(legacy.dataFailure)} / B ${percent(next.dataFailure)}`)}
      ${metric("사용자 만족도", `A ${Number.isFinite(legacy.satisfaction) ? legacy.satisfaction.toFixed(2) : "–"} / B ${Number.isFinite(next.satisfaction) ? next.satisfaction.toFixed(2) : "–"}`, "1~5점")}
      ${metric("공개 베타", `${beta.participants}명 · ${beta.sessions} sessions`, `오류 ${percent(beta.errorRate)} · 만족 ${Number.isFinite(beta.satisfaction) ? beta.satisfaction.toFixed(2) : "–"}`)}
    </div>
    <div class="experiment-actions">
      <button data-exp-action="seed-ui">설정 생성</button><button class="primary" data-exp-action="canary">Canary</button>
      <button data-exp-action="open-beta">공개 베타 열기</button><button data-exp-action="close-beta">공개 베타 닫기</button>
      <button data-exp-action="balance-ui">${roster.length || 34}명 균형 사전배정</button><button data-exp-action="active">50:50 A/B</button><button data-exp-action="pause-ui">Pause</button>
      ${[25,50,75,100].map((n) => `<button data-exp-action="rollout" data-value="${n}">${n}%</button>`).join("")}
      <button data-exp-action="complete-next">Next 승격</button><button data-exp-action="complete-legacy">Legacy 유지</button><button class="danger" data-exp-action="rollback">Rollback</button>
    </div>
    ${rosterMarkup()}
    <div class="experiment-canary"><input id="experimentTargetUids" placeholder="Canary/복귀 대상 UID, 쉼표로 구분"><span><button data-exp-action="set-canary">Canary 지정</button> <button data-exp-action="force-legacy">강제 Legacy</button></span></div>
    <p class="experiment-note">공개 베타 참여 데이터는 정식 A/B 지표에서 제외됩니다. ACTIVE 이후에는 배정을 다시 섞지 않고 Sticky Assignment를 유지합니다.</p>`;
}

function currentNotificationCounts() {
  const result = { LOW: 0, MID: 0, HIGH: 0 };
  const periodInfo = notificationPeriodAt(bundle.config || {}, new Date());
  if (periodInfo.phase !== "EXPERIMENT") return { ...result, periodInfo };
  for (const assignment of bundle.assignments) {
    const condition = assignment.sequence?.[periodInfo.period - 1];
    if (condition in result) result[condition] += 1;
  }
  return { ...result, periodInfo };
}

function notificationBody() {
  const rows = ["LOW","MID","HIGH"].map((condition) => [condition, conditionMetrics(condition)]);
  const counts = currentNotificationCounts();
  return `
    <div class="experiment-status"><b>${esc(bundle.config?.status || "설정 없음")}</b><span>${esc(counts.periodInfo.phase)} · Period ${counts.periodInfo.period || 0}</span><span>참여자 ${bundle.assignments.length}</span><span>LOW ${counts.LOW} · MID ${counts.MID} · HIGH ${counts.HIGH}</span><span>설문 ${bundle.surveys.length}</span></div>
    <div class="experiment-comparison experiment-comparison--notification">
      ${conditionBar("알림 클릭률", rows, "clickRate")}
      ${conditionBar("Target View", rows, "targetRate")}
    </div>
    <div class="experiment-table-wrap"><table class="experiment-table"><thead><tr><th>조건</th><th>FCM accepted</th><th>Click</th><th>1h open</th><th>Target</th><th>피로도</th><th>유용성</th></tr></thead><tbody>
    ${rows.map(([name,m]) => `<tr><td>${name}</td><td>${m.sent}</td><td>${percent(m.clickRate)}</td><td>${percent(m.open1hRate)}</td><td>${percent(m.targetRate)}</td><td>${Number.isFinite(m.annoyance) ? m.annoyance.toFixed(2) : "–"}</td><td>${Number.isFinite(m.usefulness) ? m.usefulness.toFixed(2) : "–"}</td></tr>`).join("")}
    </tbody></table></div>
    <div class="experiment-actions"><button data-exp-action="seed-notification">설정 생성</button><button class="primary" data-exp-action="start-notification">실험 시작</button><button data-exp-action="pause-notification">Pause</button><button data-exp-action="csv">CSV</button><button data-exp-action="json">JSON</button></div>
    <p class="experiment-note">Critical 알림은 실험에서 제외됩니다. sent는 실제 기기 도착이 아니라 FCM 발송 수락을 뜻합니다.</p>`;
}
function markup() {
  return `<section class="experiment-admin" id="pinconExperimentAdmin" tabindex="-1" aria-labelledby="experiment-admin-title">
    <div class="experiment-admin__head"><div><span class="admin-meta">EXPERIMENT PLATFORM</span><h2 id="experiment-admin-title">실험 · 통계</h2><p>Canary, A/B, rollout, rollback과 후속 알림 빈도 실험을 같은 상태 모델로 관리합니다.</p></div><button data-exp-action="refresh">새로고침</button></div>
    <div class="experiment-tabs"><button data-exp-tab="pincon-next-ui" aria-selected="${currentId==="pincon-next-ui"}">PinCon Next UI</button><button data-exp-tab="notification-frequency" aria-selected="${currentId==="notification-frequency"}">알림 빈도</button></div>
    <div>${loading?"<md-linear-progress indeterminate></md-linear-progress>":currentId==="pincon-next-ui"?uiBody():notificationBody()}</div>
  </section>`;
}

function render() {
  const snap = gateway.snapshot();
  const existing = document.querySelector("#pinconExperimentAdmin");
  if (snap.access?.role !== "system-admin") {
    existing?.remove();
    return;
  }
  const workspace = document.querySelector("#adminApp .admin-workspace");
  if (!workspace) return;
  if (existing) existing.outerHTML = markup();
  else workspace.insertAdjacentHTML("beforeend", markup());
}

function experimentViewOpen() {
  return document.querySelector("#adminApp .admin-workspace")?.classList.contains("admin-workspace--experiments") === true;
}
function activeStudentRoster(accounts = []) {
  const classKey = String(gateway.snapshot().profile?.classKey || "");
  return accounts.filter((account) => {
    const roles = Array.isArray(account.roles) ? account.roles : ["STUDENT"];
    return account?.uid
      && account.status === "ACTIVE"
      && /^\d{5}$/.test(String(account.studentNumber || ""))
      && (!classKey || account.classKey === classKey)
      && roles.includes("STUDENT")
      && !roles.includes("ADMIN")
      && !roles.includes("TEACHER");
  });
}

async function load() {
  if (loading) return;
  loading=true; render();
  try {
    const [nextBundle, accountResult] = await Promise.all([
      platform.adminReadExperiment(currentId),
      currentId === "pincon-next-ui"
        ? accountRequest("/api/accounts/manage").catch(() => ({ accounts: [] }))
        : Promise.resolve({ accounts: [] }),
    ]);
    bundle = nextBundle;
    roster = currentId === "pincon-next-ui" ? activeStudentRoster(accountResult.accounts || []) : [];
  } finally { loading=false; render(); }
}

const uiDefaults = () => ({ status:"DRAFT",version:1,stableVariant:"legacy",promotedVariant:"",rolloutPercent:0,allocation:{nextPercent:50},canarySize:7,publicBetaEnabled:false });
const notificationDefaults = () => ({ status:"DRAFT",version:1,stableVariant:"next",promotedVariant:"",rolloutPercent:0,startDate:kstDateKey(),baselineDays:2,periodDays:4,frequency:{lowPerDay:1,midPerDay:3,highPerDay:4} });

function targetUids(max = 7) {
  return String(document.querySelector("#experimentTargetUids")?.value || "").split(",").map((value) => value.trim()).filter(Boolean).slice(0, max);
}

async function run(action, value) {
  if (action === "refresh") return load();
  if (action === "seed-ui") {
    await platform.adminSetExperiment("pincon-next-ui", uiDefaults());
    await platform.adminSetFlag("pincon_next_ui",{enabled:true,rolloutPercent:0,experimentId:"pincon-next-ui",stableVariant:"legacy"});
  } else if (action === "canary") {
    await platform.adminSetExperiment("pincon-next-ui",{...uiDefaults(),...(bundle.config||{}),status:"CANARY",publicBetaEnabled:false});
  } else if (action === "open-beta") {
    if (bundle.config?.status !== "CANARY") throw new Error("공개 베타는 Canary 단계에서만 열 수 있습니다.");
    await platform.adminSetExperiment("pincon-next-ui",{publicBetaEnabled:true,publicBetaStartedAtMs:Date.now()});
  } else if (action === "close-beta") {
    await platform.adminSetExperiment("pincon-next-ui",{publicBetaEnabled:false});
  } else if (action === "balance-ui") {
    if (!roster.length) throw new Error("현재 학급의 활성 학생 계정이 없습니다.");
    if (!confirm(`${roster.length}명을 로그인 여부와 관계없이 Legacy/Next로 균형 사전배정합니다.`)) return;
    const result = await platform.adminBalanceUiAssignments(roster.map((account) => account.uid));
    alert(`${result.assigned}명 사전배정 완료: Next ${result.nextCreated}명, Legacy ${result.legacyCreated}명. 이 중 ${result.activated}명은 이미 분석 ID가 있습니다.`);
  } else if (action === "active") {
    const state = assignmentState();
    const assigned = state.rows.filter((row) => row.assignment?.variant === "legacy" || row.assignment?.variant === "next").length;
    if (roster.length && assigned !== roster.length) throw new Error("먼저 전체 학생을 균형 사전배정하세요.");
    if (!confirm("공개 베타를 닫고 정식 50:50 A/B를 시작합니다.")) return;
    await platform.adminSetExperiment("pincon-next-ui",{...uiDefaults(),...(bundle.config||{}),status:"ACTIVE",allocation:{nextPercent:50},publicBetaEnabled:false,activeStartedAtMs:Date.now()});
  } else if (action === "pause-ui") {
    await platform.adminSetExperiment("pincon-next-ui",{status:"PAUSED",stableVariant:"legacy",publicBetaEnabled:false});
  } else if (action === "rollout") {
    if (!confirm(`Next를 ${value}%로 배포합니다.`)) return;
    await platform.adminSetExperiment("pincon-next-ui",{status:"ROLLOUT",stableVariant:"legacy",promotedVariant:"next",rolloutPercent:Number(value),publicBetaEnabled:false});
    await platform.adminSetFlag("pincon_next_ui",{enabled:true,rolloutPercent:Number(value),experimentId:"pincon-next-ui",stableVariant:"legacy"});
  } else if (action === "complete-next") {
    if (!confirm("Next를 최종 Stable UI로 승격합니다.")) return;
    await platform.adminSetExperiment("pincon-next-ui",{status:"COMPLETED",stableVariant:"next",promotedVariant:"next",rolloutPercent:100,publicBetaEnabled:false});
  } else if (action === "complete-legacy") {
    if (!confirm("UI 실험을 종료하고 Legacy를 유지합니다.")) return;
    await platform.adminSetExperiment("pincon-next-ui",{status:"COMPLETED",stableVariant:"legacy",promotedVariant:"legacy",rolloutPercent:0,publicBetaEnabled:false});
  } else if (action === "rollback") {
    if (!confirm("즉시 Legacy를 Stable UI로 되돌립니다.")) return;
    await platform.adminSetExperiment("pincon-next-ui",{status:"PAUSED",stableVariant:"legacy",promotedVariant:"legacy",rolloutPercent:0,publicBetaEnabled:false});
    await platform.adminSetFlag("pincon_next_ui",{enabled:false,rolloutPercent:0,experimentId:"pincon-next-ui",stableVariant:"legacy"});
  } else if (action === "set-canary") {
    for (const uid of targetUids()) await platform.adminSetTarget("pincon-next-ui", uid, "canary");
  } else if (action === "force-legacy") {
    const uids = targetUids();
    if (!uids.length || !confirm(`${uids.length}명을 Legacy로 강제 복귀시킵니다.`)) return;
    for (const uid of uids) await platform.adminSetTarget("pincon-next-ui", uid, "force_legacy");
  } else if (action === "seed-notification") {
    await platform.adminSetExperiment("notification-frequency",notificationDefaults());
    await platform.adminSetFlag("notification_experiment",{enabled:false,rolloutPercent:0,experimentId:"notification-frequency",stableVariant:"next"});
  } else if (action === "start-notification") {
    if (!confirm("UI 실험이 Next 승격으로 완료된 경우에만 시작됩니다.")) return;
    await platform.adminSetExperiment("notification-frequency",{...notificationDefaults(),...(bundle.config||{}),status:"ACTIVE"});
    await platform.adminSetFlag("notification_experiment",{enabled:true,rolloutPercent:100,experimentId:"notification-frequency",stableVariant:"next"});
  } else if (action === "pause-notification") {
    await platform.adminSetExperiment("notification-frequency",{status:"PAUSED"});
    await platform.adminSetFlag("notification_experiment",{enabled:false,rolloutPercent:0,experimentId:"notification-frequency",stableVariant:"next"});
  }
  await load();
}

function saveFile(name, type, textValue) {
  const url = URL.createObjectURL(new Blob([textValue], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}

function notificationEventCount(type, participant, period, condition) {
  return bundle.events.filter((event) => event.eventType === type && event.anonymousParticipant === participant && Number(event.properties?.period || 0) === Number(period) && event.variant === condition).length;
}

function exportCsv() {
  const sent = eventRows("notification_sent");
  const participants = [...new Set([...sent.map((event) => event.anonymousParticipant), ...bundle.assignments.map((assignment) => assignment.anonymousParticipant).filter(Boolean)])];
  const lines = [["anonymousParticipant","period","condition","notificationCount","clickRate","open5mRate","open30mRate","open1hRate","targetViewRate","annoyanceScore","usefulnessScore"]];
  for (const participant of participants) {
    const assignment = bundle.assignments.find((item) => item.anonymousParticipant === participant);
    for (let period = 1; period <= 3; period += 1) {
      const ownSent = sent.filter((event) => event.anonymousParticipant === participant && Number(event.properties?.period || 0) === period);
      const condition = ownSent[0]?.variant || assignment?.sequence?.[period - 1] || "";
      const count = ownSent.length;
      const rate = (type) => count ? notificationEventCount(type, participant, period, condition) / count : 0;
      const survey = bundle.surveys.find((item) => item.anonymousParticipant === participant && Number(item.period) === period);
      lines.push([participant,period,condition,count,rate("notification_click"),rate("app_open_after_notification_5m"),rate("app_open_after_notification_30m"),rate("app_open_after_notification_1h"),rate("target_view_after_notification"),survey?.annoyanceScore ?? "",survey?.usefulnessScore ?? ""]);
    }
  }
  const csv = "\ufeff" + lines.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  saveFile("pincon-notification-experiment.csv","text/csv;charset=utf-8",csv);
}

document.addEventListener("click",(event) => {
  const tab = event.target.closest("[data-exp-tab]"); if (tab) { currentId = tab.dataset.expTab; load(); return; }
  const button = event.target.closest("[data-exp-action]"); if (!button) return;
  if (button.dataset.expAction === "csv") { exportCsv(); return; }
  if (button.dataset.expAction === "json") { saveFile(`pincon-${currentId}.json`,"application/json",JSON.stringify(bundle,null,2)); return; }
  run(button.dataset.expAction,button.dataset.value).catch((error) => { console.error("[Experiment Admin]",error); alert(error?.message || "실험 설정을 변경하지 못했습니다."); });
});
window.addEventListener("pincon-admin-view-change", (event) => {
  render();
  if (event.detail?.view === "experiments") load();
});
new MutationObserver(() => { if (!document.querySelector("#pinconExperimentAdmin")) render(); }).observe(document.querySelector("#adminApp"),{childList:true,subtree:true});
gateway.addEventListener("change",render);
render();
if (experimentViewOpen()) load();
