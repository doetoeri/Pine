import { dateKey, FREQUENCY, isCareerStudy, studyCalendar, studyDefaults, studyPeriodAt } from "../next/experiment/notification-study.js";
import { analyzeStudy } from "../next/experiment/study-analysis.js";
import { notificationAuditMarkup } from "../next/admin/notification-audit-view.js";

export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const pct = (n) => Number.isFinite(n) ? `${(100 * n).toFixed(1)}%` : "—";
const score = (n) => Number.isFinite(n) ? n.toFixed(2) : "—";
export const time = (ms) => ms ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms)) : "기록 없음";
export const label = (condition) => Object.hasOwn(FREQUENCY, condition) ? `${FREQUENCY[condition]}회` : "—";
export const stateLabel = (config) => ({ ACTIVE: "진행 중", PAUSED: "일시정지", COMPLETED: "종료", DRAFT: "시작 전" }[config?.status] || "새 설계 필요");
const phaseLabel = (state) => ({ BASELINE: `기준선 ${state.periodDay}일차`, EXPERIMENT: `조건 기간 ${state.period} · ${state.periodDay}일차`, OFF_DAY: "실험 쉬는 날", COMPLETE: "관측 기간 완료", NOT_STARTED: "시작일 대기" }[state.phase] || "설계 대기");
const stat = (title, value, note = "") => `<article class="stat"><span>${esc(title)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`;
const button = (action, title, primary = false, disabled = false) => `<button type="button" data-action="${action}" ${primary ? 'class="primary"' : ""} ${disabled ? "disabled" : ""}>${title}</button>`;

export function introMarkup(admin = false) {
  return `<div class="intro"><span class="eyebrow">${admin ? "나의 진로 탐구 · 운영 화면" : "PINCON RESEARCH"}</span><h1>알림은 많을수록<br>효과적인가?</h1><p>하루 0·1·3회. 행동과 경험을 함께 비교해요.</p></div>`;
}
export function loginMarkup(message = "로그인하면 내 실험 조건과 설문을 확인할 수 있어요.") {
  return `${introMarkup()}<section class="card login"><h2>내 계정으로 시작하기</h2><p>${esc(message)}</p><form id="study-login"><label>학번<input name="studentNumber" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" autocomplete="username" required placeholder="예: 10804"></label><label>PIN<input name="pin" type="password" inputmode="numeric" autocomplete="current-password" required></label><button class="primary" type="submit">학생 로그인</button></form><div class="actions">${button("google-login", "관리자 Google 로그인")}${button("retry", "다시 확인")}</div><p class="muted">처음 로그인하거나 PIN 변경이 필요한 경우 <a href="../next/">PinCon 계정 화면</a>을 이용해 주세요.</p></section>`;
}
export function planMarkup(config) {
  const days = studyCalendar(config);
  return `<div class="timeline">${[0, 1, 2, 3].map((period) => {
    const rows = days.filter((row) => row.period === period);
    return `<div><b>${period ? `조건 기간 ${period}` : "기준선"}</b><span>${rows.length ? `${esc(rows[0].date)} ~ ${esc(rows.at(-1).date)}` : "없음"}</span><small>${rows.length}일${period ? " · 순서에 따른 조건 적용" : " · 실험 알림 없음"}</small></div>`;
  }).join("")}</div>`;
}
export function readinessMarkup(bundle, roster = [], now = new Date()) {
  const runtime = bundle.runtime, age = now.getTime() - Number(runtime?.checkedAtMs || 0);
  const fresh = runtime?.status === "ok" && age >= 0 && age < 45 * 60_000;
  const devices = new Map((bundle.devices || []).map((row) => [row.id, row]));
  const ready = roster.filter((row) => devices.get(row.uid)?.pushRegistered).length;
  const optedOut = roster.filter((row) => devices.get(row.uid)?.experimentEnabled === false).length;
  return `<section class="health ${fresh ? "healthy" : "attention"}" aria-label="자동 발송 상태"><div><span class="dot"></span><strong>${runtime?.status === "error" ? "자동 발송 오류" : fresh ? "자동 발송 서버 확인됨" : "자동 발송 확인 필요"}</strong><p>최근 점검 ${esc(time(runtime?.checkedAtMs))} · 발송 가능 기기 등록 ${ready}/${roster.length}명 · 수신 중지 ${optedOut}명</p></div>${button("refresh", "새로고침")}<p class="health-note">서버는 약 10분마다 점검해요. 실행 지연이 있을 수 있어요. 기기 등록과 실제 수신은 다르며, 발송·수신·열기 기록을 각각 확인하세요.</p></section>`;
}
function setupMarkup(bundle, draft, locked) {
  const config = draft || bundle.config || studyDefaults();
  const old = bundle.config && !isCareerStudy(bundle.config), active = bundle.config?.status === "ACTIVE";
  const uiRunning = ["ACTIVE", "CANARY", "ROLLOUT"].includes(bundle.ui?.status);
  return `<section class="card"><div class="section-head"><div><span class="eyebrow">1차시 · 설계</span><h2>비교할 조건을 먼저 고정해요.</h2></div><span class="pill">${esc(stateLabel(bundle.config))}</span></div>
    ${old ? '<p class="callout">이전 알림 실험이 있습니다. 새 설계를 저장하면 기존 설정·배정을 보관하고 새 버전으로 시작해요.</p>' : ""}
    ${uiRunning ? '<p class="callout">이전 UI 실험이 진행 중이에요. 아래 버튼으로 일시정지한 뒤 알림 연구를 시작하세요.</p>' + button("pause-ui", "이전 UI 실험 일시정지") : ""}
    <div class="dose-grid">${[["LOW", "비교 기준"], ["MID", "하루 한 번"], ["HIGH", "분산 알림"]].map(([key, note]) => `<article class="dose"><small>${note}</small><strong>${FREQUENCY[key]}<span>회 / 일</span></strong><p>${key === "LOW" ? "알림 없이 스스로 확인" : key === "MID" ? "세 시간대 중 하나를 날짜별로 회전" : "08시 · 17시 · 19시"}</p></article>`).join("")}</div>
    <form id="study-design"><fieldset ${locked ? "disabled" : ""}><legend class="sr-only">실험 설계</legend><div class="fields">
      <label>실험 종류<select name="studyKind"><option value="formal" ${config.studyKind !== "pilot" ? "selected" : ""}>정식 실험</option><option value="pilot" ${config.studyKind === "pilot" ? "selected" : ""}>예비 실험 · 별도 결과</option></select></label>
      <label>시작일 · 한국 시간<input name="startDate" type="date" value="${esc(config.startDate)}" required></label>
      <label>기준선 · 실험일 수<input name="baselineDays" type="number" min="0" max="14" step="1" value="${Number(config.baselineDays ?? 2)}" required></label>
      <label>각 조건 · 실험일 수<input name="periodDays" type="number" min="1" max="14" step="1" value="${Number(config.periodDays ?? 4)}" required></label>
      <label>대상 학급 · 쉼표로 구분<input name="targetClassKeys" value="${esc((config.targetClassKeys || ["1-8"]).join(", "))}" placeholder="1-8" required></label>
      <label>공휴일·제외일 · 쉼표로 구분<input name="excludedDates" value="${esc((config.excludedDates || []).join(", "))}" placeholder="2026-11-12"></label>
    </div><label class="check"><input type="checkbox" name="schoolDaysOnly" ${config.schoolDaysOnly !== false ? "checked" : ""}>평일만 진행 · 제외일에는 발송과 관측을 쉬어요</label></fieldset>
    <p class="muted">동의는 이미 확보한 참가자를 대상으로 해요. 같은 사람이 세 조건을 경험하도록 여섯 순서에 균형 배정해요. 중요 공지는 모든 조건에 동일하게 제공하며 실험 횟수에 넣지 않아요.</p>
    <div id="study-plan">${planMarkup(config)}</div>
    <p class="muted">기준선 중에는 이용 기록을 모으고 실험 알림은 보내지 않아요. 기준선을 0일로 정해 08시 이후 시작하면, 첫날은 제외하고 다음 실험일부터 온전한 0·1·3회를 비교해요. 일시정지에 걸친 날짜도 분석에서 제외해요.</p>
    <div class="actions">${button("prepare", old && active ? "이전 실험 정지 후 새 설계 저장" : "설계 저장 · 균형 배정", false, locked)}${button("start", bundle.config?.status === "PAUSED" ? "이 실험 재개" : "실험 시작", true, !isCareerStudy(bundle.config) || active || bundle.config?.status === "COMPLETED")}${active ? button("pause", "일시정지") : ""}${isCareerStudy(bundle.config) && bundle.config?.activeStartedAtMs && bundle.config.status !== "COMPLETED" ? button("complete", "실험 종료") : ""}</div>
    ${locked ? '<p class="muted">시작한 설계와 배정은 고정되어 있어요. 새로 비교하려면 먼저 정지하거나 종료한 뒤 새 실험을 만드세요.</p>' : ""}
    ${isCareerStudy(bundle.config) && bundle.config.activeStartedAtMs && !active ? button("new-run", "새 실험 설계하기") : ""}
  </form></section>`;
}
function participantsMarkup(bundle, roster) {
  const assignments = new Map((bundle.assignments || []).filter((row) => row.experimentVersion === bundle.config?.version).map((row) => [row.id, row]));
  const devices = new Map((bundle.devices || []).map((row) => [row.id, row]));
  return `<section class="card"><div class="section-head"><div><span class="eyebrow">대상과 배정</span><h2>${roster.length}명의 준비 상태</h2></div></div><p>미접속 학생도 사전 배정돼요. 푸시 미등록 학생의 이용 기록도 유지해 분석 누락을 줄여요.</p><label class="search">학생 찾기<input type="search" id="member-search" placeholder="학번 또는 이름" autocomplete="off"></label><div class="table-wrap"><table><thead><tr><th>학생</th><th>학급</th><th>기간 1</th><th>기간 2</th><th>기간 3</th><th>기기 등록</th><th>최근 점검</th></tr></thead><tbody>${roster.map((account) => {
    const assignment = assignments.get(account.uid), device = devices.get(account.uid);
    return `<tr data-member="${esc(`${account.studentNumber || ""} ${account.name || ""}`)}"><td><strong>${esc(account.studentNumber || "")}</strong> ${esc(account.name || "계정")}</td><td>${esc(account.classKey)}</td>${[0, 1, 2].map((n) => `<td>${assignment ? label(assignment.sequence[n]) : "미배정"}</td>`).join("")}<td>${!device ? "점검 전" : device.experimentEnabled === false ? "수신 중지" : device.pushRegistered ? "등록됨" : "등록 필요"}</td><td>${esc(time(device?.checkedAtMs))}</td></tr>`;
  }).join("") || '<tr><td colspan="7">설계의 대상 학급에 활성 계정이 없습니다.</td></tr>'}</tbody></table></div><p class="muted">이름과 학번은 관리자 화면에만 표시해요. 내보내는 분석 자료에는 익명 ID를 사용해요.</p></section>`;
}
function resultsMarkup(bundle) {
  const analysis = analyzeStudy(bundle);
  return `<section class="card"><span class="eyebrow">2차시 · 분석</span><h2>어떤 빈도에서 정보를 더 확인했을까?</h2><p>0회 조건도 비교할 수 있도록 참가자별 정보 확인일 비율을 주요 지표로 사용해요. 오늘은 경과 일수에 포함되며 값이 계속 변할 수 있어요.</p><div class="results-grid">${analysis.groups.map((group) => `<article class="result"><span>${group.dailyNotifications}회 조건</span><strong>${pct(group.informationDayRate)}</strong><small>정보 확인일 / 경과 실험일 · 참가자별 평균</small><div class="bar" role="img" aria-label="정보 확인일 비율 ${pct(group.informationDayRate)}"><i style="width:${Number.isFinite(group.informationDayRate) ? Math.min(100, group.informationDayRate * 100) : 0}%"></i></div><p>관측 ${group.observed}명 · 설문 ${group.surveyCount}명</p></article>`).join("")}</div>
    <div class="table-wrap"><table><thead><tr><th>조건</th><th>관측 인원</th><th>이용일 비율</th><th>발송 수락</th><th>알림 클릭률</th><th>피로도 / 5</th><th>유용성 / 5</th></tr></thead><tbody>${analysis.groups.map((g) => `<tr><td>${g.dailyNotifications}회</td><td>${g.observed}</td><td>${pct(g.activeDayRate)}</td><td>${g.notificationCount}</td><td>${pct(g.clickRate)}</td><td>${score(g.annoyanceScore)}</td><td>${score(g.usefulnessScore)}</td></tr>`).join("")}</tbody></table></div>
    <p class="muted">— 는 분모가 없거나 아직 관측되지 않은 값이에요. 0회 조건의 클릭률을 0%로 처리하지 않아요. 클릭률은 알림 ID별로 중복을 제거하며 FCM 수락 건수를 분모로 써요.</p>
    ${analysis.warnings.length ? `<div class="callout"><strong>해석 전에 확인</strong><ul>${analysis.warnings.map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul></div>` : ""}
    <p class="muted">한 학급의 반복 관측이므로 요일·기간 효과와 기기 미등록·설문 미응답을 함께 고려해요. 수신 기록 없음은 미수신의 증거가 아니며 이 화면만으로 유의성이나 최적 빈도를 확정하지 않아요.</p>
    <div class="actions">${button("csv", "분석표 CSV")}${button("json", "익명 원자료 JSON")}${button("report", "탐구 기록 내려받기")}</div></section>`;
}
function reportMarkup(bundle) {
  const notes = bundle.notes || {};
  const fields = [["hypothesis", "1차시 · 나의 가설과 이유"], ["sources", "선행연구 출처·핵심 내용·설계 반영"], ["observations", "2차시 · 관찰한 차이와 가설 비교"], ["recommendation", "3차시 · 개선안과 진로 연결"], ["limitations", "연구 한계와 후속 탐구"]];
  return `<section class="card"><span class="eyebrow">3차시 · 보고서</span><h2>숫자를 나의 해석으로 연결해요.</h2><p>실제 관측값은 내려받는 탐구 기록에 자동으로 들어가요. 가설·선행연구·해석은 아래에 직접 작성하세요.</p><form id="study-notes">${fields.map(([key, title]) => `<label>${title}<textarea name="${key}" rows="4" maxlength="6000">${esc(notes[key] || "")}</textarea></label>`).join("")}<div class="actions"><button type="submit" class="primary" ${!isCareerStudy(bundle.config) ? "disabled" : ""}>내 탐구 메모 저장</button>${button("report", "메모·결과 내려받기")}${button("print", "인쇄 / PDF")}</div></form><p class="muted">메모는 이 실험 버전에 연결해 저장해요. 새 실험을 만들어도 이전 메모는 유지돼요.</p></section>`;
}
export function adminMarkup({ bundle = {}, roster = [], tab = "design", draft, newRun = false, busy = false, now = new Date() } = {}) {
  const config = bundle.config || {}, design = draft || (isCareerStudy(config) ? config : studyDefaults(roster[0]?.classKey || "1-8", now));
  const scoped = roster.filter((row) => (design.targetClassKeys || []).includes(row.classKey));
  const phase = studyPeriodAt(config, now), activeAssignments = (bundle.assignments || []).filter((row) => row.experimentVersion === config.version && scoped.some((account) => account.uid === row.id));
  const accepted = (bundle.receipts || []).filter((row) => row.status === "fcm-accepted").length;
  return `${introMarkup(true)}<div class="overview"><div><span class="pill">${esc(stateLabel(config))}</span><span class="muted">${esc(phaseLabel(phase))} · 버전 ${esc(config.version || "—")}</span></div>${button("refresh", busy ? "확인 중…" : "새로고침", false, busy)}</div><nav class="steps" aria-label="실험 진행 단계">${[["design", "01", "설계"], ["members", "02", "배정"], ["delivery", "03", "발송·반응"], ["results", "04", "결과"], ["report", "05", "보고서"]].map(([key, n, name]) => `<button type="button" data-tab="${key}" ${tab === key ? 'aria-current="page"' : ""}><small>${n}</small>${name}</button>`).join("")}</nav>
    <div class="stats">${stat("대상 계정", `${scoped.length}명`, "선택한 학급의 활성 계정")}${stat("현재 버전 배정", `${activeAssignments.length}명`, "기기 미등록도 포함")}${stat("발송 수락", `${accepted}건`, "FCM 수락 · 도착 보장 아님")}</div>
    ${tab === "design" ? setupMarkup(bundle, design, !newRun && isCareerStudy(config) && Boolean(config.activeStartedAtMs)) : ""}
    ${tab === "members" ? participantsMarkup(bundle, scoped) : ""}
    ${tab === "delivery" ? readinessMarkup(bundle, scoped, now) + `<section class="card"><h2>발송과 반응을 각각 확인해요.</h2><p>자동 발송은 08·17·19시 시간대에 처리해요.</p><div class="actions">${button("device-test", "이 기기 알림 표시 테스트")}${config.status === "ACTIVE" ? button("pause", "실험 일시정지") : ""}</div>${notificationAuditMarkup({ ...bundle, roster: scoped })}</section>` : ""}
    ${tab === "results" ? resultsMarkup(bundle) : ""}${tab === "report" ? reportMarkup(bundle) : ""}
    <footer class="study-footer"><p>데이터 갱신 ${esc(time(bundle.loadedAtMs))} · 기준선과 세 조건은 동일한 PinCon 정보를 이용해요.</p><details><summary>이전 실험 보관 기록 ${(bundle.history || []).length}개</summary>${(bundle.history || []).map((row) => `<p>버전 ${esc(row.config?.version)} · ${esc(row.config?.startDate)} · ${esc(row.config?.status)} · 배정 ${row.assignments?.length || 0}명</p>`).join("") || "보관된 이전 버전이 없어요."}</details></footer>`;
}
export function participantMarkup({ context = {}, enabled = true, surveys = [], permission = "unsupported", now = new Date() } = {}) {
  const config = context.config || {}, state = studyPeriodAt(config, now), calendar = studyCalendar(config);
  const completed = new Set(surveys.filter((row) => row.experimentVersion === context.experimentVersion).map((row) => row.period));
  const hour = new Date(now.getTime() + 9 * 3_600_000).getUTCHours();
  const due = [1, 2, 3].filter((period) => {
    const last = calendar.filter((row) => row.period === period).at(-1);
    return last && (last.date < dateKey(now) || (last.date === dateKey(now) && hour >= 20)) && !completed.has(period);
  });
  return `${introMarkup()}<section class="card"><span class="eyebrow">나의 참여 상태</span><h2>${enabled ? phaseLabel(state) : "연구 알림을 중지했어요"}</h2><p>${context.condition ? `현재 배정은 하루 ${label(context.condition)} 조건이에요.` : context.source === "awaiting-roster" ? "관리자가 참여자 배정을 준비하고 있어요." : "실험이 준비 중이거나 현재 참여 조건에 해당하지 않아요."}</p>
    <div class="dose-grid">${[1, 2, 3].map((period) => `<article class="dose"><small>기간 ${period}</small><strong>${context.sequence?.[period - 1] ? FREQUENCY[context.sequence[period - 1]] : "—"}<span>회 / 일</span></strong><p>${completed.has(period) ? "설문 제출됨" : "배정된 알림 횟수"}</p></article>`).join("")}</div>
    <p>이 기기 알림 권한: <strong>${esc(({ granted: "허용", denied: "차단", default: "아직 선택 안 함", unsupported: "지원 여부 확인 필요" })[permission])}</strong></p><div class="actions">${button("enable-push", "이 기기 푸시 등록", true)}${button("device-test", "알림 표시 테스트")}${button("toggle", enabled ? "연구 알림 수신 중지" : "연구 알림 다시 허용")}</div><p id="experiment-notification-status" class="muted">기기 등록은 푸시를 받을 준비 단계예요. 표시 테스트는 이 기기의 표시만 확인하며 서버 전송 시험과는 달라요. 수신 중지는 모든 기기에 적용돼요.</p><button id="experiment-notification-toggle" type="button" hidden data-action="toggle">수신 설정</button></section>
    <section class="card"><span class="eyebrow">나의 설문</span><h2>${due.length ? "마친 기간을 평가해 주세요." : "기간이 끝나면 설문이 열려요."}</h2><p>기간 마지막 날 20시부터 응답할 수 있어요. 알림이 없는 0회 기간도 같은 문항에 응답해 주세요.</p><div class="actions">${due.map((period) => `<button type="button" class="primary" data-survey="${period}">기간 ${period} · ${label(context.sequence?.[period - 1])} 설문</button>`).join("")}</div><div id="survey-form-host"></div></section><p class="muted">중요 공지와 필수 정보는 연구 알림 설정과 관계없이 제공돼요. 이름과 학번은 다른 참가자에게 표시하지 않아요.</p>`;
}
