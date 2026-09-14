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

const kstDateKey = (timestampMs = Date.now()) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date(Number(timestampMs) || Date.now()));
const eventRows = (type, variant="") => bundle.events.filter((row)=>row.eventType===type && (!variant || row.variant===variant));

function variantMetrics(variant) {
  const rows = bundle.events.filter((row) => row.variant === variant);
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
  const counts = bundle.assignments.reduce((out, row) => {
    if (row.variant === "legacy" || row.variant === "next") out[row.variant] = (out[row.variant] || 0) + 1;
    return out;
  }, {});
  return `
    <div class="experiment-status"><b>${esc(bundle.config?.status || "설정 없음")}</b><span>Legacy ${counts.legacy || 0} · Next ${counts.next || 0}</span><span>Rollout ${Number(bundle.config?.rolloutPercent || 0)}%</span></div>
    <div class="experiment-grid">
      ${metric("Participants", `A ${legacy.participants} / B ${next.participants}`)}
      ${metric("DAU", `A ${legacy.dau} / B ${next.dau}`)}
      ${metric("Sessions", `A ${legacy.sessions} / B ${next.sessions}`)}
      ${metric("핵심 정보 도달률", `A ${percent(legacy.reach)} / B ${percent(next.reach)}`)}
      ${metric("주요 작업 성공률", `A ${percent(legacy.taskSuccess)} / B ${percent(next.taskSuccess)}`)}
      ${metric("Time to Information", `A ${Number.isFinite(legacy.tti) ? Math.round(legacy.tti) + "ms" : "–"} / B ${Number.isFinite(next.tti) ? Math.round(next.tti) + "ms" : "–"}`)}
      ${metric("Return Rate", `A ${percent(legacy.returns)} / B ${percent(next.returns)}`)}
      ${metric("Guardrail Error", `A ${percent(legacy.errors)} / B ${percent(next.errors)}`)}
      ${metric("Data Load Failure", `A ${percent(legacy.dataFailure)} / B ${percent(next.dataFailure)}`)}
      ${metric("사용자 만족도", `A ${Number.isFinite(legacy.satisfaction) ? legacy.satisfaction.toFixed(2) : "–"} / B ${Number.isFinite(next.satisfaction) ? next.satisfaction.toFixed(2) : "–"}`, "1~5점")}
    </div>
    <div class="experiment-actions">
      <button data-exp-action="seed-ui">설정 생성</button><button class="primary" data-exp-action="canary">Canary</button>
      <button data-exp-action="balance-ui">34명 균형 사전배정</button><button data-exp-action="active">50:50 A/B</button><button data-exp-action="pause-ui">Pause</button>
      ${[25,50,75,100].map((n) => `<button data-exp-action="rollout" data-value="${n}">${n}%</button>`).join("")}
      <button data-exp-action="complete-next">Next 승격</button><button data-exp-action="complete-legacy">Legacy 유지</button><button class="danger" data-exp-action="rollback">Rollback</button>
    </div>
    <div class="experiment-canary"><input id="experimentTargetUids" placeholder="Canary/복귀 대상 UID, 쉼표로 구분"><span><button data-exp-action="set-canary">Canary 지정</button> <button data-exp-action="force-legacy">강제 Legacy</button></span></div>
    <p class="experiment-note">Canary는 안정성 검증용입니다. 사용자는 Variant를 직접 바꿀 수 없고, 강제 복귀는 운영센터에서만 수행합니다.</p>`;
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
    <table class="experiment-table"><thead><tr><th>조건</th><th>FCM accepted</th><th>Click</th><th>1h open</th><th>Target</th><th>피로도</th><th>유용성</th></tr></thead><tbody>
    ${rows.map(([name,m]) => `<tr><td>${name}</td><td>${m.sent}</td><td>${m.click}</td><td>${m.open1h}</td><td>${m.target}</td><td>${Number.isFinite(m.annoyance) ? m.annoyance.toFixed(2) : "–"}</td><td>${Number.isFinite(m.usefulness) ? m.usefulness.toFixed(2) : "–"}</td></tr>`).join("")}
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

const uiDefaults = () => ({\n  status: "DRAFT", version: 1, stableVariant: "legacy", promotedVariant: "", rolloutPercent: 0,\n  allocation: { nextPercent: 50 }, canarySize: 7,\n});\n\nconst notificationDefaults = () => ({\n  status: "DRAFT", version: 1, stableVariant: "next", promotedVariant: "", rolloutPercent: 0,\n  startDate: kstDateKey(), baselineDays: 2, periodDays: 4,\n  frequency: { lowPerDay: 1, midPerDay: 3, highPerDay: 4 },\n});\n\nfunction targetUids(max = 7) {\n  return String(document.querySelector("#experimentTargetUids")?.value || "")\n    .split(",").map((value) => value.trim()).filter(Boolean).slice(0, max);\n}\n\nasync function run(action, value) {\n  if (action === "refresh") { await load(); return; }\n\n  if (action === "seed-ui") {\n    await platform.adminSetExperiment("pincon-next-ui", uiDefaults());\n    await platform.adminSetFlag("pincon_next_ui", { enabled: true, rolloutPercent: 0, experimentId: "pincon-next-ui", stableVariant: "legacy" });\n  } else if (action === "canary") {\n    await platform.adminSetExperiment("pincon-next-ui", { ...uiDefaults(), ...(bundle.config || {}), status: "CANARY" });\n  } else if (action === "balance-ui") {\n    const result = await platform.adminBalanceUiAssignments();\n    alert(`분석 ID가 생성된 ${result.participants}명 중 ${result.created}명을 새로 균형 배정했습니다. Next ${result.nextCreated}명, Legacy ${result.legacyCreated}명.`);\n  } else if (action === "active") {\n    if (!confirm("Canary 검증 후 50:50 A/B를 시작합니다.")) return;\n    await platform.adminSetExperiment("pincon-next-ui", { ...uiDefaults(), ...(bundle.config || {}), status: "ACTIVE", allocation: { nextPercent: 50 } });\n  } else if (action === "pause-ui") {\n    await platform.adminSetExperiment("pincon-next-ui", { status: "PAUSED", stableVariant: "legacy" });\n  } else if (action === "rollout") {\n    if (!confirm(`Next를 ${value}%로 배포합니다.`)) return;\n    await platform.adminSetExperiment("pincon-next-ui", { status: "ROLLOUT", stableVariant: "legacy", promotedVariant: "next", rolloutPercent: Number(value) });\n    await platform.adminSetFlag("pincon_next_ui", { enabled: true, rolloutPercent: Number(value), experimentId: "pincon-next-ui", stableVariant: "legacy" });\n  } else if (action === "complete-next") {\n    if (!confirm("Next를 최종 Stable UI로 승격합니다.")) return;\n    await platform.adminSetExperiment("pincon-next-ui", { status: "COMPLETED", stableVariant: "next", promotedVariant: "next", rolloutPercent: 100 });\n  } else if (action === "complete-legacy") {\n    if (!confirm("UI 실험을 종료하고 Legacy를 유지합니다.")) return;\n    await platform.adminSetExperiment("pincon-next-ui", { status: "COMPLETED", stableVariant: "legacy", promotedVariant: "legacy", rolloutPercent: 0 });\n  } else if (action === "rollback") {\n    if (!confirm("즉시 Legacy를 Stable UI로 되돌립니다.")) return;\n    await platform.adminSetExperiment("pincon-next-ui", { status: "PAUSED", stableVariant: "legacy", promotedVariant: "legacy", rolloutPercent: 0 });\n    await platform.adminSetFlag("pincon_next_ui", { enabled: false, rolloutPercent: 0, experimentId: "pincon-next-ui", stableVariant: "legacy" });\n  } else if (action === "set-canary") {\n    for (const uid of targetUids()) await platform.adminSetTarget("pincon-next-ui", uid, "canary");\n  } else if (action === "force-legacy") {\n    const uids = targetUids();\n    if (!uids.length || !confirm(`${uids.length}명을 Legacy로 강제 복귀시킵니다.`)) return;\n    for (const uid of uids) await platform.adminSetTarget("pincon-next-ui", uid, "force_legacy");\n  } else if (action === "seed-notification") {\n    await platform.adminSetExperiment("notification-frequency", notificationDefaults());\n    await platform.adminSetFlag("notification_experiment", { enabled: false, rolloutPercent: 0, experimentId: "notification-frequency", stableVariant: "next" });\n  } else if (action === "start-notification") {\n    if (!confirm("UI 실험이 Next 승격으로 완료된 경우에만 시작됩니다.")) return;\n    await platform.adminSetExperiment("notification-frequency", { ...notificationDefaults(), ...(bundle.config || {}), status: "ACTIVE" });\n    await platform.adminSetFlag("notification_experiment", { enabled: true, rolloutPercent: 100, experimentId: "notification-frequency", stableVariant: "next" });\n  } else if (action === "pause-notification") {\n    await platform.adminSetExperiment("notification-frequency", { status: "PAUSED" });\n    await platform.adminSetFlag("notification_experiment", { enabled: false, rolloutPercent: 0, experimentId: "notification-frequency", stableVariant: "next" });\n  }\n\n  await load();\n}\n\nfunction saveFile(name, type, textValue) {\n  const url = URL.createObjectURL(new Blob([textValue], { type }));\n  const link = document.createElement("a");\n  link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();\n  URL.revokeObjectURL(url);\n}\n\nfunction notificationEventCount(type, participant, period, condition) {\n  return bundle.events.filter((event) => event.eventType === type\n    && event.anonymousParticipant === participant\n    && Number(event.properties?.period || 0) === Number(period)\n    && event.variant === condition).length;\n}\n\nfunction exportCsv() {\n  const sent = eventRows("notification_sent");\n  const participants = [...new Set([\n    ...sent.map((event) => event.anonymousParticipant),\n    ...bundle.assignments.map((assignment) => assignment.anonymousParticipant).filter(Boolean),\n  ])];\n  const lines = [["anonymousParticipant","period","condition","notificationCount","clickRate","open5mRate","open30mRate","open1hRate","targetViewRate","annoyanceScore","usefulnessScore"]];\n  for (const participant of participants) {\n    const assignment = bundle.assignments.find((item) => item.anonymousParticipant === participant);\n    for (let period = 1; period <= 3; period += 1) {\n      const ownSent = sent.filter((event) => event.anonymousParticipant === participant && Number(event.properties?.period || 0) === period);\n      const condition = ownSent[0]?.variant || assignment?.sequence?.[period - 1] || "";\n      const count = ownSent.length;\n      const rate = (type) => count ? notificationEventCount(type, participant, period, condition) / count : 0;\n      const survey = bundle.surveys.find((item) => item.anonymousParticipant === participant && Number(item.period) === period);\n      lines.push([participant, period, condition, count, rate("notification_click"), rate("app_open_after_notification_5m"), rate("app_open_after_notification_30m"), rate("app_open_after_notification_1h"), rate("target_view_after_notification"), survey?.annoyanceScore ?? "", survey?.usefulnessScore ?? ""]);\n    }\n  }\n  const csv = "\ufeff" + lines.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");\n  saveFile("pincon-notification-experiment.csv", "text/csv;charset=utf-8", csv);\n}\n\ndocument.addEventListener("click", (event) => {\n  const tab = event.target.closest("[data-exp-tab]");\n  if (tab) { currentId = tab.dataset.expTab; load(); return; }\n  const button = event.target.closest("[data-exp-action]");\n  if (!button) return;\n  if (button.dataset.expAction === "csv") { exportCsv(); return; }\n  if (button.dataset.expAction === "json") { saveFile(`pincon-${currentId}.json`, "application/json", JSON.stringify(bundle, null, 2)); return; }\n  run(button.dataset.expAction, button.dataset.value).catch((error) => {\n    console.error("[Experiment Admin]", error);\n    alert(error?.message || "실험 설정을 변경하지 못했습니다.");\n  });\n});\n\nnew MutationObserver(render).observe(document.querySelector("#adminApp"), { childList: true, subtree: true });\ngateway.addEventListener("change", render);\nrender();\nload();\n