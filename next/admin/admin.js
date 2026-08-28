import { NextDataGateway, readClassProfile } from "../core/data-gateway.js";
import { adminAccessState, archivedRecords, normalizedAuditLogs } from "../core/admin-policy.js";
import { accountRequest } from "../core/student-auth.js";

await import("../../material-official-loader.js");
await globalThis.PINCON_MATERIAL_READY;

const root = document.querySelector("#adminApp");
const gateway = new NextDataGateway();
let snapshot = gateway.snapshot();
let opsOverview = null;
let opsLoading = false;
let searchQuery = "";

const COLLECTION_LABELS = Object.freeze({
  announcements: "공지",
  classAssignments: "수행·숙제",
  evaluationPlans: "평가계획서",
  events: "학급 행사",
  resources: "학습 자료",
  lostItems: "분실물",
  groups: "모둠",
  academicSchedules: "학사일정",
  neisTimetables: "시간표",
  meals: "급식",
  users: "사용자",
  cleaningRequests: "청소 요청",
  subjectEntries: "과목 운영",
  phoneStates: "휴대폰 상태",
  auditLogs: "감사 기록",
  auditLog: "감사 기록",
  auditEvents: "감사 기록",
});

const ADMIN_TARGETS = Object.freeze({
  overview: "#adminOverview",
  users: "#pinconUserManager",
  operations: "#pinconClassOpsSettings",
  content: "[data-managed-editor]",
  access: "#adminRoleManager",
  audit: "#adminAuditExplorer",
  system: "#adminSystemHealth",
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function roleLabel(role) {
  if (role === "system-admin") return "시스템 관리자";
  if (role === "manager") return "학급 관리자";
  if (role === "editor") return "편집자";
  return "학생 · 열람자";
}

function classLabel(profile) {
  return profile ? `${profile.grade}학년 ${profile.classNumber}반` : "학급 미선택";
}

function titleFor(item, fallback = "제목 없음") {
  return item?.title || item?.name || item?.subject || item?.body || item?.id || fallback;
}

function timestampLabel(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "시간 기록 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(number));
}

function collectionLabel(key) {
  return COLLECTION_LABELS[key] || key || "데이터";
}

function visibleCollections(data = {}) {
  return Object.entries(data)
    .filter(([, value]) => Array.isArray(value))
    .filter(([key]) => !["auditLogs", "auditLog", "auditEvents"].includes(key));
}

function activeRows(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && item.deleted !== true && item.status !== "archived");
}

function activeCount(value) {
  return activeRows(value).length;
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function pendingTotal() {
  const counts = opsOverview?.counts || {};
  return Number(counts.pendingSubjects || 0) + Number(counts.pendingCleaning || 0) + Number(counts.phoneChecks || 0);
}

function overdueAssignments(data) {
  const today = localDateKey();
  return activeRows(data?.classAssignments).filter((item) => {
    const due = String(item.dueDate || "");
    return /^\d{4}-\d{2}-\d{2}$/.test(due) && due < today && item.published !== false;
  });
}

function todayTimetable(data) {
  const today = localDateKey();
  return activeRows(data?.neisTimetables).find((item) => item.date === today) || null;
}

function todayMeal(data) {
  const today = localDateKey();
  return activeRows(data?.meals).find((item) => item.date === today) || null;
}

function operationalAlerts(data) {
  const alerts = [];
  if (snapshot.error) alerts.push({ level: "error", icon: "cloud_off", title: "데이터 동기화 오류", body: snapshot.error });
  if (!snapshot.profile && !readClassProfile()) alerts.push({ level: "warning", icon: "school", title: "관리 학급 미선택", body: "관리할 학급을 먼저 선택해야 합니다." });
  if (snapshot.ready && !todayTimetable(data)) alerts.push({ level: "warning", icon: "calendar_clock", title: "오늘 시간표 확인 필요", body: "오늘 날짜 시간표가 보이지 않습니다. 자동 동기화 상태를 확인하세요." });
  if (snapshot.ready && !todayMeal(data)) alerts.push({ level: "info", icon: "restaurant", title: "오늘 급식 데이터 없음", body: "휴일이 아니라면 NEIS 급식 동기화를 확인하세요." });
  const pending = pendingTotal();
  if (pending) alerts.push({ level: "warning", icon: "pending_actions", title: `처리 대기 ${pending}건`, body: "과목 승인, 청소 요청, 휴대폰 확인 필요 항목을 검토하세요.", target: "operations" });
  const overdue = overdueAssignments(data).length;
  if (overdue) alerts.push({ level: "info", icon: "event_busy", title: `마감 지난 항목 ${overdue}건`, body: "끝난 수행·숙제가 계속 공개 중인지 확인하세요.", target: "content" });
  return alerts.slice(0, 6);
}

function loadingMarkup() {
  return `<main class="admin-gate" aria-labelledby="admin-loading-title">
    <section class="admin-gate__card">
      <span class="beta-badge">PinCon · 운영센터</span>
      <h1 id="admin-loading-title">운영 상태를 불러오는 중</h1>
      <p>학급 데이터, 계정 권한, 운영 예외를 한 번에 확인하고 있습니다.</p>
      <md-linear-progress indeterminate></md-linear-progress>
    </section>
  </main>`;
}

function deniedMarkup(accessState) {
  const access = snapshot.access || {};
  return `<main class="admin-gate" aria-labelledby="admin-denied-title">
    <section class="admin-gate__card">
      <span class="beta-badge">관리자 전용</span>
      <h1 id="admin-denied-title">${escapeHtml(accessState.title)}</h1>
      <p>${escapeHtml(accessState.message)}</p>
      <div class="admin-status admin-status--denied" role="status"><md-icon>lock</md-icon><p>현재 역할: <strong>${escapeHtml(roleLabel(access.role))}</strong>. 화면 숨김과 별개로 실제 데이터 권한은 서버 규칙이 강제합니다.</p></div>
      <div class="admin-actions"><md-filled-tonal-button id="backToPincon"><md-icon slot="icon">arrow_back</md-icon>PinCon으로 돌아가기</md-filled-tonal-button></div>
    </section>
  </main>`;
}

function navigationMarkup() {
  const pending = pendingTotal();
  const items = [
    ["overview", "space_dashboard", "개요", ""],
    ["users", "group", "사용자", opsOverview?.counts?.firstLoginPending ? String(opsOverview.counts.firstLoginPending) : ""],
    ["operations", "checklist", "학급 운영", pending ? String(pending) : ""],
    ["content", "edit_note", "콘텐츠", ""],
    ["access", "admin_panel_settings", "권한", ""],
    ["audit", "history", "감사 기록", ""],
    ["system", "monitor_heart", "시스템", ""],
  ];
  return `<nav class="admin-nav" aria-label="관리자 메뉴">${items.map(([key, icon, label, badge]) => `<button type="button" class="admin-nav__item" data-admin-target="${key}" ${key === "overview" ? 'aria-current="page"' : ""}><md-icon>${icon}</md-icon><span>${label}</span>${badge ? `<b>${escapeHtml(badge)}</b>` : ""}</button>`).join("")}</nav>`;
}

function metricMarkup(label, value, icon, support = "") {
  return `<article class="admin-metric"><div class="admin-metric__icon"><md-icon>${icon}</md-icon></div><div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${support ? `<small>${escapeHtml(support)}</small>` : ""}</div></article>`;
}

function alertMarkup(alerts) {
  if (!alerts.length) return `<div class="admin-clear-state"><md-icon>verified</md-icon><div><strong>지금 바로 처리할 경고가 없습니다</strong><span>자동 동기화와 운영 상태가 정상 범위입니다.</span></div></div>`;
  return `<div class="admin-alert-list">${alerts.map((item) => `<button type="button" class="admin-alert admin-alert--${item.level}" ${item.target ? `data-admin-target="${item.target}"` : ""}><md-icon>${item.icon}</md-icon><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.body)}</small></span><md-icon>chevron_right</md-icon></button>`).join("")}</div>`;
}

function quickActionsMarkup() {
  return `<div class="admin-quick-actions">
    <button type="button" data-admin-action="add-user"><md-icon>person_add</md-icon><span><strong>학생 계정 추가</strong><small>학번·역할·임시 PIN</small></span></button>
    <button type="button" data-admin-action="new-announcement"><md-icon>campaign</md-icon><span><strong>공지 작성</strong><small>학생 화면에 즉시 게시</small></span></button>
    <button type="button" data-admin-target="operations"><md-icon>tune</md-icon><span><strong>학급 운영 설정</strong><small>청소·휴대폰·1인1역</small></span></button>
    <button type="button" data-admin-target="audit"><md-icon>manage_search</md-icon><span><strong>변경 이력 확인</strong><small>계정·운영·콘텐츠</small></span></button>
  </div>`;
}

function pendingInboxMarkup() {
  const pending = opsOverview?.pending || {};
  const rows = [
    ...(pending.subjects || []).map((item) => ({ icon: "fact_check", type: "과목 승인", title: item.title || item.subject || "과목 변경", support: [item.classKey, item.subject, item.type].filter(Boolean).join(" · "), time: item.updatedAtMs })),
    ...(pending.cleaning || []).map((item) => ({ icon: "cleaning_services", type: "청소 요청", title: item.requesterName || "청소 요청", support: [item.classKey, item.departmentId, item.type].filter(Boolean).join(" · "), time: item.createdAtMs })),
    ...(pending.phoneChecks || []).map((item) => ({ icon: "smartphone", type: "휴대폰 확인", title: item.studentName || "확인 필요 학생", support: item.classKey || "", time: item.updatedAtMs })),
  ].sort((a, b) => Number(b.time || 0) - Number(a.time || 0));
  if (!rows.length) return `<div class="admin-clear-state"><md-icon>task_alt</md-icon><div><strong>운영 인박스가 비었습니다</strong><span>승인이나 예외 처리 요청이 생기면 이곳에 모입니다.</span></div></div>`;
  return `<div class="admin-inbox-list">${rows.slice(0, 12).map((item) => `<div class="admin-inbox-row"><md-icon>${item.icon}</md-icon><div><span>${escapeHtml(item.type)}</span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.support)}</small></div><time>${escapeHtml(timestampLabel(item.time))}</time></div>`).join("")}</div>`;
}

function unifiedAudits(data) {
  const legacy = normalizedAuditLogs(data).map((item) => ({
    id: item.id || `${item.collection}-${item.recordId}-${item.createdAtMs}`,
    source: "content",
    action: item.action || "변경",
    collection: item.collection || "",
    recordId: item.recordId || "",
    actorName: item.actorRole || item.actorUid || "사용자",
    createdAtMs: Number(item.occurredAtMs || item.createdAtMs || 0),
  }));
  const server = Array.isArray(opsOverview?.audits) ? opsOverview.audits : [];
  const seen = new Set();
  return [...server, ...legacy]
    .sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0))
    .filter((item) => {
      const key = `${item.source}-${item.id || ""}-${item.action}-${item.createdAtMs}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function auditRows(logs) {
  return logs.slice(0, 80).map((item) => `<div class="admin-row admin-audit-row" data-audit-search="${escapeHtml(`${item.action} ${item.collection} ${item.recordId} ${item.actorName} ${item.note || ""}`.toLowerCase())}"><span class="admin-audit-source">${escapeHtml(item.source === "account" ? "계정" : item.source === "class-ops" ? "운영" : "콘텐츠")}</span><div class="admin-row__main"><strong>${escapeHtml(item.action || "변경")}</strong><span>${escapeHtml(`${collectionLabel(item.collection)} · ${item.recordId || "대상 미상"} · ${item.actorName || "행위자 미상"}`)}</span></div><span class="admin-meta">${escapeHtml(timestampLabel(item.createdAtMs))}</span></div>`).join("");
}

function auditMarkup(data) {
  const logs = unifiedAudits(data);
  if (!logs.length) return `<div class="admin-clear-state"><md-icon>history</md-icon><div><strong>감사 기록이 아직 없습니다</strong><span>계정·학급 운영·콘텐츠 변경이 생기면 이곳에 기록됩니다.</span></div></div>`;
  return `<div class="admin-audit-toolbar"><md-outlined-text-field id="adminAuditFilter" label="감사 기록 필터" type="search" placeholder="작업, 대상, 담당자"></md-outlined-text-field><md-outlined-button id="exportAdminAudit"><md-icon slot="icon">download</md-icon>CSV</md-outlined-button></div><div class="admin-list" id="adminAuditList">${auditRows(logs)}</div>`;
}

function collectionStatusMarkup(data) {
  return `<div class="admin-source-grid">${visibleCollections(data).map(([key, value]) => `<div class="admin-source"><span>${escapeHtml(collectionLabel(key))}</span><strong>${activeCount(value)}</strong><small>전체 ${value.length}개</small></div>`).join("")}</div>`;
}

function systemMarkup(data) {
  const profile = snapshot.profile || readClassProfile();
  const access = snapshot.access || {};
  return `<div class="admin-system-grid">
    <div><span>학급 범위</span><strong>${escapeHtml(classLabel(profile))}</strong><small>${escapeHtml(profile?.classKey || "선택 없음")}</small></div>
    <div><span>데이터 게이트웨이</span><strong>${snapshot.ready ? "READY" : snapshot.syncing ? "SYNCING" : "WAITING"}</strong><small>${snapshot.error ? "오류 있음" : "실시간 연결"}</small></div>
    <div><span>현재 권한</span><strong>${escapeHtml(roleLabel(access.role))}</strong><small>${escapeHtml(access.displayName || "인증 계정")}</small></div>
    <div><span>운영 API</span><strong>${opsOverview ? "READY" : opsLoading ? "SYNCING" : "LIMITED"}</strong><small>${opsOverview?.generatedAtMs ? escapeHtml(timestampLabel(opsOverview.generatedAtMs)) : "기본 데이터만 표시"}</small></div>
  </div>${collectionStatusMarkup(data)}`;
}

function searchIndex(data) {
  const rows = [];
  for (const [collection, items] of visibleCollections(data)) {
    for (const item of activeRows(items).slice(0, 200)) {
      rows.push({ collection, title: titleFor(item), support: [item.subject, item.date, item.dueDate, item.description, item.body].filter(Boolean).join(" · ").slice(0, 240) });
    }
  }
  return rows;
}

function searchResultMarkup(data, query) {
  const normalized = String(query || "").trim().toLocaleLowerCase("ko-KR");
  if (!normalized) return `<div class="admin-search-hint"><md-icon>keyboard_command_key</md-icon><span>공지, 수행평가, 일정, 자료 등 현재 학급 데이터를 검색합니다.</span></div>`;
  const results = searchIndex(data).filter((item) => `${item.title} ${item.support} ${collectionLabel(item.collection)}`.toLocaleLowerCase("ko-KR").includes(normalized)).slice(0, 30);
  if (!results.length) return `<div class="admin-empty"><md-icon>search_off</md-icon><strong>검색 결과가 없습니다</strong><span>다른 키워드로 다시 검색해 보세요.</span></div>`;
  return results.map((item) => `<button type="button" class="admin-search-result" data-admin-search-collection="${escapeHtml(item.collection)}"><md-icon>description</md-icon><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(`${collectionLabel(item.collection)} · ${item.support || "추가 설명 없음"}`)}</small></span><md-icon>arrow_forward</md-icon></button>`).join("");
}

function dashboardMarkup(accessState) {
  const data = snapshot.data || {};
  const profile = snapshot.profile || readClassProfile();
  const access = snapshot.access || {};
  const archived = archivedRecords(data);
  const active = visibleCollections(data).reduce((sum, [, value]) => sum + activeCount(value), 0);
  const alerts = operationalAlerts(data);
  const counts = opsOverview?.counts || {};

  return `<main class="admin-shell" id="adminMain" tabindex="-1">
    <aside class="admin-sidebar"><div class="admin-brand"><div class="admin-brand__mark" aria-hidden="true"><md-icon>shield_person</md-icon></div><div class="admin-brand__copy"><strong>PinCon 운영센터</strong><span>${escapeHtml(classLabel(profile))}</span></div></div>${navigationMarkup()}<div class="admin-sidebar__foot"><span>${escapeHtml(access.displayName || "관리자")}</span><small>${escapeHtml(roleLabel(access.role))}</small></div></aside>
    <div class="admin-workspace">
      <header class="admin-topbar"><div><span class="admin-topbar__eyebrow">고촌고등학교</span><strong>${escapeHtml(classLabel(profile))} 운영</strong></div><div class="admin-topbar__actions"><md-outlined-button id="openAdminSearch"><md-icon slot="icon">search</md-icon>검색 <span class="admin-shortcut">Ctrl K</span></md-outlined-button><md-icon-button id="refreshAdminData" aria-label="관리 데이터 새로고침"><md-icon>refresh</md-icon></md-icon-button><md-text-button id="backToPincon"><md-icon slot="icon">arrow_back</md-icon>학생 화면</md-text-button></div></header>
      <section class="admin-overview" id="adminOverview" aria-labelledby="admin-title"><div class="admin-overview__copy"><p>OPERATIONS CENTER</p><h1 id="admin-title">오늘 필요한 운영만<br />먼저 보이게.</h1><span>${escapeHtml(accessState.message)}</span></div><div class="admin-overview__status"><md-icon>verified_user</md-icon><span><strong>${escapeHtml(accessState.title)}</strong><small>${opsLoading ? "운영 현황 동기화 중" : opsOverview ? "계정·운영 API 연결됨" : "기본 데이터 모드"}</small></span></div></section>
      ${snapshot.error ? `<div class="admin-status admin-status--denied" role="alert"><md-icon>error</md-icon><p>${escapeHtml(snapshot.error)}</p></div>` : ""}
      <section class="admin-metrics" aria-label="운영 핵심 지표">${metricMarkup("활성 계정", counts.activeAccounts ?? "–", "group", counts.firstLoginPending ? `첫 로그인 대기 ${counts.firstLoginPending}명` : "계정 시스템")}${metricMarkup("처리 대기", pendingTotal(), "pending_actions", "승인·예외 인박스")}${metricMarkup("활성 정보", active, "database", `${visibleCollections(data).length}개 데이터 종류`)}${metricMarkup("보관 항목", archived.length, "inventory_2", "영구 삭제 없이 복원 가능")}</section>
      <div class="admin-command-layout"><section class="admin-card admin-card--alerts" aria-labelledby="alerts-title"><div class="admin-card__header"><h2 id="alerts-title">운영 경고</h2><span class="admin-meta">${alerts.length ? `${alerts.length}건 확인` : "정상"}</span></div>${alertMarkup(alerts)}</section><section class="admin-card" aria-labelledby="quick-actions-title"><div class="admin-card__header"><h2 id="quick-actions-title">빠른 작업</h2><span class="admin-meta">자주 쓰는 기능</span></div>${quickActionsMarkup()}</section></div>
      <section class="admin-card admin-card--wide" id="adminOperationsInbox" aria-labelledby="ops-inbox-title"><div class="admin-card__header"><h2 id="ops-inbox-title">운영 인박스</h2><span class="admin-meta">정상 상황은 숨기고 예외만 표시</span></div>${opsLoading && !opsOverview ? `<md-linear-progress indeterminate></md-linear-progress>` : pendingInboxMarkup()}</section>
      <section class="admin-card admin-card--wide" id="adminAuditExplorer" aria-labelledby="audit-title"><div class="admin-card__header"><h2 id="audit-title">통합 감사 기록</h2><span class="admin-meta">계정 · 운영 · 콘텐츠</span></div>${auditMarkup(data)}</section>
      <section class="admin-card admin-card--wide" id="adminSystemHealth" aria-labelledby="system-title"><div class="admin-card__header"><h2 id="system-title">시스템 · 데이터 상태</h2><span class="admin-meta">원본 데이터는 그대로 유지</span></div>${systemMarkup(data)}</section>
      <section class="admin-modules" aria-labelledby="admin-modules-title"><div class="admin-modules__head"><div><span>MANAGEMENT MODULES</span><h2 id="admin-modules-title">세부 관리</h2></div><p>사용자, 학급 운영, 콘텐츠, 권한 설정은 아래 모듈에서 실제 변경합니다.</p></div><div class="admin-grid" id="adminModuleGrid"></div></section>
    </div>
    <md-dialog id="adminSearchDialog" class="admin-search-dialog"><div slot="headline">PinCon 전체 검색</div><div slot="content" class="admin-search-dialog__content"><md-outlined-text-field id="adminGlobalSearch" type="search" label="검색" placeholder="공지, 과목, 일정, 수행평가"></md-outlined-text-field><div id="adminSearchResults" class="admin-search-results">${searchResultMarkup(data, searchQuery)}</div></div><div slot="actions"><md-text-button id="closeAdminSearch">닫기</md-text-button></div></md-dialog>
  </main>`;
}

function eventHost(event, selector) {
  return event.composedPath?.().find((node) => node instanceof Element && node.matches?.(selector)) || null;
}

function scrollToAdminTarget(key) {
  const selector = ADMIN_TARGETS[key];
  const target = selector ? root.querySelector(selector) : null;
  if (!target) return false;
  target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  target.classList.add("admin-focus-pulse");
  window.setTimeout(() => target.classList.remove("admin-focus-pulse"), 700);
  root.querySelectorAll(".admin-nav [data-admin-target][aria-current]").forEach((node) => node.removeAttribute("aria-current"));
  root.querySelector(`.admin-nav [data-admin-target="${key}"]`)?.setAttribute("aria-current", "page");
  return true;
}

function performQuickAction(action) {
  if (action === "add-user") {
    scrollToAdminTarget("users");
    window.setTimeout(() => root.querySelector("#pinconAddUser")?.click(), 260);
  } else if (action === "new-announcement") {
    scrollToAdminTarget("content");
    window.setTimeout(() => root.querySelector('[data-managed-create="announcements"]')?.click(), 260);
  }
}

function csvDownload(name, rows) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function handleDelegatedClick(event) {
  const targetButton = eventHost(event, "[data-admin-target]");
  if (targetButton) {
    scrollToAdminTarget(targetButton.dataset.adminTarget);
    return;
  }
  const actionButton = eventHost(event, "[data-admin-action]");
  if (actionButton) {
    performQuickAction(actionButton.dataset.adminAction);
    return;
  }
  const searchResult = eventHost(event, "[data-admin-search-collection]");
  if (searchResult) {
    root.querySelector("#adminSearchDialog")?.close?.();
    const collection = searchResult.dataset.adminSearchCollection;
    scrollToAdminTarget(["announcements", "classAssignments", "evaluationPlans", "events"].includes(collection) ? "content" : "system");
  }
}

root.addEventListener("click", handleDelegatedClick);

function bindCurrentView() {
  root.querySelector("#backToPincon")?.addEventListener("click", () => { location.href = "../#more"; });
  root.querySelector("#refreshAdminData")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await Promise.all([gateway.retry?.(), loadOpsOverview(true)]);
    } finally {
      button.disabled = false;
    }
  });

  const searchDialog = root.querySelector("#adminSearchDialog");
  root.querySelector("#openAdminSearch")?.addEventListener("click", () => {
    if (!searchDialog?.open && !searchDialog?.hasAttribute?.("open")) searchDialog?.show?.();
    requestAnimationFrame(() => root.querySelector("#adminGlobalSearch")?.focus?.());
  });
  root.querySelector("#closeAdminSearch")?.addEventListener("click", () => searchDialog?.close?.());
  root.querySelector("#adminGlobalSearch")?.addEventListener("input", (event) => {
    searchQuery = event.target.value || "";
    const results = root.querySelector("#adminSearchResults");
    if (results) results.innerHTML = searchResultMarkup(snapshot.data || {}, searchQuery);
  });
  root.querySelector("#adminAuditFilter")?.addEventListener("input", (event) => {
    const query = String(event.target.value || "").trim().toLowerCase();
    root.querySelectorAll(".admin-audit-row").forEach((row) => { row.hidden = Boolean(query) && !String(row.dataset.auditSearch || "").includes(query); });
  });
  root.querySelector("#exportAdminAudit")?.addEventListener("click", () => {
    const rows = unifiedAudits(snapshot.data || {});
    csvDownload(`pincon-audit-${localDateKey()}.csv`, [["시각", "영역", "작업", "컬렉션", "대상", "담당자"], ...rows.map((item) => [new Date(Number(item.createdAtMs || 0)).toISOString(), item.source, item.action, item.collection, item.recordId, item.actorName])]);
  });
}

function render() {
  const accessState = adminAccessState(snapshot.access);
  if (!snapshot.ready && snapshot.syncing) { root.innerHTML = loadingMarkup(); return; }
  if (!snapshot.ready && !snapshot.error) { root.innerHTML = loadingMarkup(); return; }
  root.innerHTML = accessState.allowed ? dashboardMarkup(accessState) : deniedMarkup(accessState);
  bindCurrentView();
}

async function loadOpsOverview(force = false) {
  if (opsLoading || (opsOverview && !force)) return;
  opsLoading = true;
  if (root.querySelector("#adminMain")) render();
  try {
    opsOverview = await accountRequest("/api/class-ops/admin-overview");
  } catch (error) {
    if (error?.status !== 403 && error?.status !== 401) console.warn("PinCon admin overview unavailable", error);
  } finally {
    opsLoading = false;
    render();
  }
}

gateway.addEventListener("change", (event) => {
  snapshot = event.detail;
  render();
});

render();
await gateway.start();
await loadOpsOverview();
