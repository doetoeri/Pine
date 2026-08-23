import { NextDataGateway, readClassProfile } from "../core/data-gateway.js";
import { adminAccessState, archivedRecords, normalizedAuditLogs } from "../core/admin-policy.js";

await import("../../material-official-loader.js");
await globalThis.PINCON_MATERIAL_READY;

const root = document.querySelector("#adminApp");
const gateway = new NextDataGateway();
let snapshot = gateway.snapshot();

const COLLECTION_LABELS = Object.freeze({
  announcements: "공지",
  classAssignments: "수행·숙제",
  events: "학급 행사",
  resources: "학습 자료",
  lostItems: "분실물",
  groups: "모둠",
  academicSchedules: "학사일정",
  neisTimetables: "시간표",
  meals: "급식",
  auditLogs: "감사 기록",
  auditLog: "감사 기록",
  auditEvents: "감사 기록",
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
    year: "numeric",
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

function activeCount(value) {
  if (!Array.isArray(value)) return 0;
  return value.filter((item) => item && item.deleted !== true && item.status !== "archived").length;
}

function loadingMarkup() {
  return `<main class="admin-gate" aria-labelledby="admin-loading-title">
    <section class="admin-gate__card">
      <span class="beta-badge">PINCON NEXT ADMIN</span>
      <h1 id="admin-loading-title">관리 권한을 확인하는 중</h1>
      <p>학급 데이터와 인증 상태를 같은 원본에서 확인하고 있습니다.</p>
      <md-linear-progress indeterminate></md-linear-progress>
    </section>
  </main>`;
}

function deniedMarkup(accessState) {
  const access = snapshot.access || {};
  return `<main class="admin-gate" aria-labelledby="admin-denied-title">
    <section class="admin-gate__card">
      <span class="beta-badge">ACCESS CONTROLLED</span>
      <h1 id="admin-denied-title">${escapeHtml(accessState.title)}</h1>
      <p>${escapeHtml(accessState.message)}</p>
      <div class="admin-status admin-status--denied" role="status">
        <md-icon>lock</md-icon>
        <p>현재 역할: <strong>${escapeHtml(roleLabel(access.role))}</strong>. 화면을 숨기는 것과 별개로 실제 데이터 권한은 Firestore 서버 규칙이 강제합니다.</p>
      </div>
      <div class="admin-actions">
        <md-filled-tonal-button id="backToPincon"><md-icon slot="icon">arrow_back</md-icon>PinCon으로 돌아가기</md-filled-tonal-button>
      </div>
    </section>
  </main>`;
}

function auditMarkup(logs) {
  if (!logs.length) {
    return `<div class="admin-empty">
      <md-icon>history</md-icon>
      <strong>감사 기록이 아직 없습니다</strong>
      <span>서버에서 audit log가 들어오면 변경자·대상·시각을 이곳에서 확인합니다.</span>
    </div>`;
  }

  return `<div class="admin-list" aria-label="감사 기록">
    ${logs.slice(0, 30).map((item) => `<div class="admin-row">
      <span>${escapeHtml(item.action || "변경")}</span>
      <div class="admin-row__main">
        <strong>${escapeHtml(`${collectionLabel(item.collection)} · ${item.recordId || "대상 미상"}`)}</strong>
        <span>${escapeHtml([item.actorRole, item.actorUid, item.reason].filter(Boolean).join(" · ") || "행위자 정보 없음")}</span>
      </div>
      <span class="admin-meta">${escapeHtml(timestampLabel(item.occurredAtMs || item.createdAtMs))}</span>
    </div>`).join("")}
  </div>`;
}

function archiveMarkup(rows) {
  if (!rows.length) {
    return `<div class="admin-empty">
      <md-icon>inventory_2</md-icon>
      <strong>보관된 항목이 없습니다</strong>
      <span>삭제 대신 보관된 데이터가 생기면 여기서 복구 대상을 검토합니다.</span>
    </div>`;
  }

  return `<div class="admin-list" aria-label="복구 대상">
    ${rows.slice(0, 30).map(({ collection, item }) => `<div class="admin-row">
      <span>${escapeHtml(collectionLabel(collection))}</span>
      <div class="admin-row__main">
        <strong>${escapeHtml(titleFor(item))}</strong>
        <span>${escapeHtml(item.deletedBy ? `보관 처리: ${item.deletedBy}` : "보관 처리된 항목")}</span>
      </div>
      <md-outlined-button disabled aria-label="Beta에서 복원 잠김">복원 잠김</md-outlined-button>
    </div>`).join("")}
  </div>`;
}

function dashboardMarkup(accessState) {
  const data = snapshot.data || {};
  const profile = snapshot.profile || readClassProfile();
  const access = snapshot.access || {};
  const collections = visibleCollections(data);
  const active = collections.reduce((sum, [, value]) => sum + activeCount(value), 0);
  const archived = archivedRecords(data);
  const audits = normalizedAuditLogs(data);

  return `<main class="admin-shell" id="adminMain" tabindex="-1">
    <header class="admin-topbar">
      <div class="admin-brand">
        <div class="admin-brand__mark" aria-hidden="true"><md-icon>admin_panel_settings</md-icon></div>
        <div class="admin-brand__copy">
          <strong>PinCon Next 관리자</strong>
          <span>고촌고등학교 · ${escapeHtml(classLabel(profile))}</span>
        </div>
      </div>
      <md-text-button id="backToPincon"><md-icon slot="icon">arrow_back</md-icon>학생 화면</md-text-button>
    </header>

    <section class="admin-hero" aria-labelledby="admin-title">
      <p class="admin-hero__eyebrow">권한 기반 운영 콘솔</p>
      <h1 id="admin-title">운영은 한 곳에서,<br />변경은 기록과 함께.</h1>
      <p>학생 화면과 같은 데이터 원본을 사용합니다. Next Beta에서는 관리자가 들어와도 공용 쓰기·삭제·복원은 잠겨 있어 현황과 감사 가능성부터 검증합니다.</p>
    </section>

    <div class="admin-status" role="status">
      <md-icon>verified_user</md-icon>
      <p><strong>${escapeHtml(accessState.title)}</strong><br />${escapeHtml(accessState.message)}</p>
    </div>

    ${snapshot.error ? `<div class="admin-status admin-status--denied" role="alert"><md-icon>error</md-icon><p>${escapeHtml(snapshot.error)}</p></div>` : ""}

    <div class="admin-grid">
      <section class="admin-card" aria-labelledby="access-title">
        <div class="admin-card__header"><h2 id="access-title">접근 상태</h2><span class="beta-badge">WRITE LOCKED</span></div>
        <div class="admin-list">
          <div class="admin-row"><span>역할</span><div class="admin-row__main"><strong>${escapeHtml(roleLabel(access.role))}</strong><span>${escapeHtml(access.displayName || "인증 계정")}</span></div><span></span></div>
          <div class="admin-row"><span>학급 범위</span><div class="admin-row__main"><strong>${escapeHtml(classLabel(profile))}</strong><span>${escapeHtml(profile?.classKey || "범위 없음")}</span></div><span></span></div>
          <div class="admin-row"><span>공용 쓰기</span><div class="admin-row__main"><strong>잠김</strong><span>운영 규칙을 production에 적용하기 전까지 활성화하지 않습니다.</span></div><span></span></div>
        </div>
      </section>

      <section class="admin-card" aria-labelledby="summary-title">
        <div class="admin-card__header"><h2 id="summary-title">데이터 현황</h2><span class="admin-meta">단일 데이터 게이트웨이</span></div>
        <div class="admin-stat-grid">
          <div class="admin-stat"><span>활성 항목</span><strong>${active}</strong></div>
          <div class="admin-stat"><span>보관 항목</span><strong>${archived.length}</strong></div>
          <div class="admin-stat"><span>감사 기록</span><strong>${audits.length}</strong></div>
        </div>
      </section>

      <section class="admin-card admin-card--wide" aria-labelledby="collections-title">
        <div class="admin-card__header"><h2 id="collections-title">컬렉션 상태</h2><span class="admin-meta">현재 읽힌 배열형 데이터만 표시</span></div>
        ${collections.length ? `<div class="admin-list">${collections.map(([key, value]) => `<div class="admin-row"><span>${escapeHtml(collectionLabel(key))}</span><div class="admin-row__main"><strong>${activeCount(value)}개 활성</strong><span>전체 ${value.length}개</span></div><span></span></div>`).join("")}</div>` : `<div class="admin-empty"><md-icon>database</md-icon><strong>표시할 데이터가 없습니다</strong><span>데이터 동기화가 완료되면 컬렉션 현황이 표시됩니다.</span></div>`}
      </section>

      <section class="admin-card admin-card--wide" aria-labelledby="audit-title">
        <div class="admin-card__header"><h2 id="audit-title">감사 기록</h2><span class="admin-meta">최근 ${Math.min(audits.length, 30)}건</span></div>
        ${auditMarkup(audits)}
      </section>

      <section class="admin-card admin-card--wide" aria-labelledby="archive-title">
        <div class="admin-card__header"><h2 id="archive-title">보관함 · 복구 검토</h2><span class="admin-meta">실제 복원 작업은 Beta에서 잠김</span></div>
        ${archiveMarkup(archived)}
      </section>
    </div>
  </main>`;
}

function bindInteractions() {
  root.querySelector("#backToPincon")?.addEventListener("click", () => {
    location.href = "../#more";
  });
}

function render() {
  const accessState = adminAccessState(snapshot.access);

  if (!snapshot.ready && snapshot.syncing) {
    root.innerHTML = loadingMarkup();
    return;
  }

  if (!snapshot.ready && !snapshot.error) {
    root.innerHTML = loadingMarkup();
    return;
  }

  root.innerHTML = accessState.allowed ? dashboardMarkup(accessState) : deniedMarkup(accessState);
  bindInteractions();
}

gateway.addEventListener("change", (event) => {
  snapshot = event.detail;
  render();
});

render();
await gateway.start();
