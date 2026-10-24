import { notificationPeriodAt } from "../experiment/assignment-service.js";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

const asTime = (value) => {
  const ms = Number(value || 0);
  if (!Number.isFinite(ms) || ms <= 0) return "기록 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(ms));
};

const countedNotificationIds = (events, eventType) => new Set(
  events.filter((event) => event.eventType === eventType)
    .map((event) => String(event.properties?.notificationId || ""))
    .filter(Boolean),
);

export function nextNotificationPeriod(config, now = new Date()) {
  for (let offset = 0; offset <= 45; offset += 1) {
    const date = new Date(now.getTime() + offset * 86_400_000);
    const info = notificationPeriodAt(config || {}, date);
    if (info.phase === "EXPERIMENT") return { ...info, date };
  }
  return null;
}

// Identifying details are joined only in the system-admin browser view.
// The experiment event records themselves remain pseudonymous.
export function buildNotificationAudit({
  config = {}, assignments = [], receipts = [], events = [], roster = [], now = new Date(),
} = {}) {
  const version = Number(config?.version || 1);
  const activeAssignments = assignments.filter((assignment) =>
    Number(assignment.experimentVersion || 0) === version);
  const state = notificationPeriodAt(config, now);
  const next = nextNotificationPeriod(config, now);
  const period = state.phase === "EXPERIMENT" ? state.period : next?.period || 0;
  const matchingReceipts = receipts.filter((receipt) =>
    Number(receipt.experimentVersion || 0) === version);
  const matchingEvents = events.filter((event) =>
    Number(event.experimentVersion || 0) === version);
  const received = countedNotificationIds(matchingEvents, "notification_received");
  const opened = countedNotificationIds(matchingEvents, "notification_click");
  const byParticipant = new Map();
  for (const receipt of matchingReceipts) {
    const key = String(receipt.anonymousParticipant || "");
    if (!key) continue;
    const list = byParticipant.get(key) || [];
    list.push(receipt);
    byParticipant.set(key, list);
  }
  const rosterByUid = new Map(roster.map((account) => [String(account.uid || ""), account]));
  const assignmentsByUid = new Map(activeAssignments.map((assignment) => [String(assignment.id || ""), assignment]));
  const nameByParticipant = new Map(activeAssignments.map((assignment) => {
    const account = rosterByUid.get(String(assignment.id || ""));
    return [String(assignment.anonymousParticipant || ""), account
      ? [account.studentNumber, account.name].filter(Boolean).join(" ")
      : "참가자 " + String(assignment.anonymousParticipant || "").slice(-6)];
  }));

  const subjects = roster.length
    ? roster.filter((account) => account.uid && account.status === "ACTIVE")
    : activeAssignments.map((assignment) => ({ uid: assignment.id, studentNumber: "", name: "" }));
  const members = subjects.map((account) => {
    const assignment = assignmentsByUid.get(String(account.uid || ""));
    const anon = String(assignment?.anonymousParticipant || "");
    const own = byParticipant.get(anon) || [];
    const accepted = own.filter((receipt) => receipt.status === "fcm-accepted");
    const acceptedIds = new Set(accepted.map((receipt) =>
      String(receipt.notificationId || receipt.id || "")).filter(Boolean));
    const receivedCount = [...acceptedIds].filter((id) => received.has(id)).length;
    const openedCount = [...acceptedIds].filter((id) => opened.has(id)).length;
    return {
      uid: account.uid,
      label: [account.studentNumber, account.name].filter(Boolean).join(" ")
        || "참가자 " + anon.slice(-6),
      sequence: Array.isArray(assignment?.sequence) ? assignment.sequence : [],
      currentCondition: assignment?.sequence?.[period - 1] || "",
      accepted: acceptedIds.size,
      received: receivedCount,
      opened: openedCount,
      latest: Math.max(0, ...own.map((receipt) => Number(receipt.acceptedAtMs || receipt.sentAtMs || 0))),
    };
  });

  const recent = matchingReceipts
    .slice()
    .sort((a, b) => Number(b.scheduledAtMs || 0) - Number(a.scheduledAtMs || 0))
    .slice(0, 100)
    .map((receipt) => {
      const id = String(receipt.notificationId || receipt.id || "");
      return {
        ...receipt,
        notificationId: id,
        member: nameByParticipant.get(String(receipt.anonymousParticipant || "")) || "참가자 정보 없음",
        receivedRecorded: received.has(id),
        openedRecorded: opened.has(id),
      };
    });
  return {
    state, next, period, members, recent,
    storedReceipts: matchingReceipts.length,
    accepted: matchingReceipts.filter((receipt) => receipt.status === "fcm-accepted").length,
    received: matchingReceipts.filter((receipt) =>
      received.has(String(receipt.notificationId || receipt.id || ""))).length,
    opened: matchingReceipts.filter((receipt) =>
      opened.has(String(receipt.notificationId || receipt.id || ""))).length,
  };
}

function dispatchStatus(status) {
  return ({
    "fcm-accepted": "FCM 수락",
    "permanent-failure": "발송 영구 실패",
    "send-failed": "발송 실패",
    "send-uncertain": "결과 불확실",
    "sending": "발송 처리 중/미확정",
    "scheduled": "예약 기록",
  })[status] || "상태 미확인";
}

export function notificationAuditMarkup(data = {}) {
  const audit = buildNotificationAudit(data);
  const phase = audit.state.phase;
  const periodLabel = phase === "EXPERIMENT"
    ? "현재 Period " + audit.period
    : audit.next
      ? "다음 실험 Period " + audit.period + " (현재 " + phase + ")"
      : "현재 " + phase + " · 예정된 실험 기간 없음";

  const memberRows = audit.members.map((member) =>
    '<tr><td><strong>' + esc(member.label) + '</strong></td>'
    + [0, 1, 2].map((i) => '<td>' + esc(member.sequence[i] || "미배정") + '</td>').join("")
    + '<td><strong>' + esc(member.currentCondition || "–") + '</strong></td>'
    + '<td>' + member.accepted + '</td><td>' + member.received + '</td>'
    + '<td>' + member.opened + '</td><td>' + esc(asTime(member.latest)) + '</td></tr>'
  ).join("");

  const receiptRows = audit.recent.map((receipt) =>
    '<tr><td>' + esc(asTime(receipt.scheduledAtMs || receipt.createdAtMs)) + '</td>'
    + '<td>' + esc(receipt.member) + '</td>'
    + '<td>' + esc(receipt.condition || "–") + '</td>'
    + '<td><strong>' + esc(receipt.title || "본문 미기록") + '</strong>'
    + '<small class="experiment-audit__secondary">' + esc(receipt.body || receipt.candidateKey || "이전 발송 상세 없음") + '</small></td>'
    + '<td>' + esc(dispatchStatus(receipt.status)) + '</td>'
    + '<td>' + (receipt.receivedRecorded ? "수신 기록" : "기록 없음") + '</td>'
    + '<td>' + (receipt.openedRecorded ? "열기 기록" : "기록 없음") + '</td></tr>'
  ).join("");

  return '<section class="experiment-audit" aria-label="알림 실험 상세 현황">'
    + '<div class="experiment-audit__head"><div><h3>참가자별 배정 및 알림 현황</h3>'
    + '<p>' + esc(periodLabel) + ' · 현재 실험 버전 ' + esc(data.config?.version || 1)
    + ' · 개별 연구 기록은 시스템 관리자에게만 표시됩니다.</p></div></div>'
    + '<div class="experiment-audit__totals"><span>발송 수락 <strong>' + audit.accepted
    + '</strong></span><span>수신 기록 <strong>' + audit.received
    + '</strong></span><span>알림 열기 <strong>' + audit.opened + '</strong></span></div>'
    + '<p class="experiment-note">LOW/MID/HIGH는 학생별 고정 그룹이 아닙니다. '
    + 'Period 1~3에서 조건을 바꿔 경험합니다. 수신 기록 없음은 미수신 증명이 아니며, '
    + '알림 열기도 연결된 내용을 실제 읽었다는 증거는 아닙니다.</p>'
    + '<details class="experiment-audit__details" open><summary>학생별 조건 및 반응 (' + audit.members.length
    + '명)</summary><div class="experiment-table-wrap"><table class="experiment-table experiment-audit__table"><thead>'
    + '<tr><th>학생</th><th>P1</th><th>P2</th><th>P3</th><th>현재/다음</th><th>FCM 수락</th><th>수신 기록</th>'
    + '<th>열기 기록</th><th>마지막 수락</th></tr></thead><tbody>'
    + (memberRows || '<tr><td colspan="9">활성 학생 명단 또는 실험 배정을 불러오지 못했습니다.</td></tr>')
    + '</tbody></table></div></details>'
    + '<details class="experiment-audit__details"><summary>최근 알림 상세 기록 (최근 최대 '
    + audit.recent.length + '건, 보관된 수락 기록 ' + audit.storedReceipts + '건)</summary>'
    + '<div class="experiment-table-wrap"><table class="experiment-table experiment-audit__table"><thead>'
    + '<tr><th>예약 시간(KST)</th><th>대상</th><th>조건</th><th>알림 제목 · 내용</th>'
    + '<th>발송 상태</th><th>기기 수신</th><th>열기</th></tr></thead><tbody>'
    + (receiptRows || '<tr><td colspan="7">기록된 실험 알림이 없습니다. 현재가 BASELINE 또는 OFF_DAY인지 확인하세요.</td></tr>')
    + '</tbody></table></div></details>'
    + '<p class="experiment-audit__foot">통계는 Firestore의 최근 발송 기록 최대 1,200건과 조회된 분석 이벤트를 기준으로 합니다. '
    + '과거 기록에는 실제 알림 문구가 저장되지 않았을 수 있습니다. 수신·열기 계측은 브라우저/네트워크 상태에 따라 누락될 수 있습니다.</p>'
    + '</section>';
}
