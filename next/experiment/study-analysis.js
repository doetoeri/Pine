import { CONDITIONS, FREQUENCY, dateKey, studyCalendar } from "./notification-study.js";

const INFORMATION = new Set(["assignment_view", "schedule_view", "notice_view", "material_view", "meal_view", "target_information_view"]);
const mean = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const ratio = (a, b) => b > 0 ? a / b : null;
const idOf = (row) => String(row.notificationId || row.id || "");
const currentVersion = (rows, config) => rows.filter((row) => Number(row.experimentVersion) === Number(config.version));

// One row per assigned participant and period, including the zero-notification
// control and students who never open the app. Future periods have null rates.
export function analyzeStudy({ config = {}, assignments = [], events = [], receipts = [], surveys = [], truncated = false } = {}, now = new Date()) {
  const today = dateKey(now);
  const calendar = studyCalendar(config);
  const stopAt = config.status === "PAUSED" ? Number(config.pausedAtMs || 0)
    : config.status === "COMPLETED" ? Number(config.endedAtMs || 0) : 0;
  const stopDate = stopAt ? dateKey(new Date(stopAt)) : "";
  const stopHour = stopAt ? new Date(stopAt + 9 * 3_600_000).getUTCHours() : 24;
  const observable = (row) => config.activeStartedAtMs && row.date <= today
    && (!stopDate || row.date < stopDate || (config.status === "COMPLETED" && stopHour >= 20 && row.date === stopDate));
  const daysByPeriod = new Map([0, 1, 2, 3].map((period) => [period, calendar.filter((row) => row.period === period && observable(row))]));
  const dateState = new Map(calendar.map((row) => [row.date, row]));
  const started = Number(config.activeStartedAtMs || 0);
  const activeEvents = currentVersion(events, config).filter((event) => Number(event.timestampMs) <= now.getTime()
    && (!started || Number(event.timestampMs) >= started) && (!stopAt || Number(event.timestampMs) <= stopAt)
    && dateState.has(dateKey(new Date(event.timestampMs))));
  const activeReceipts = currentVersion(receipts, config);
  const activeSurveys = currentVersion(surveys, config);
  const rows = [];
  const seenParticipants = new Set();
  for (const assignment of currentVersion(assignments, config)) {
    const participant = assignment.anonymousParticipant;
    if (!participant || seenParticipants.has(participant)) continue;
    seenParticipants.add(participant);
    const ownEvents = activeEvents.filter((event) => event.anonymousParticipant === participant);
    for (let period = 1; period <= 3; period++) {
      const condition = assignment.sequence?.[period - 1];
      if (!CONDITIONS.includes(condition)) continue;
      const days = new Set(daysByPeriod.get(period).map((row) => row.date));
      const periodEvents = ownEvents.filter((event) => days.has(dateKey(new Date(event.timestampMs))));
      const accepted = new Map(activeReceipts.filter((receipt) => receipt.anonymousParticipant === participant
        && Number(receipt.period) === period && receipt.condition === condition
        && (receipt.status === "fcm-accepted" || (receipt.status === "send-uncertain" && Number(receipt.acceptedAtMs) > 0))
        && days.has(dateKey(new Date(receipt.scheduledAtMs)))).map((receipt) => [idOf(receipt), receipt]));
      const countType = (type) => new Set(periodEvents.filter((event) => event.eventType === type
        && accepted.has(String(event.properties?.notificationId || ""))).map((event) => event.properties.notificationId)).size;
      const sessionDays = new Set(periodEvents.filter((event) => event.eventType === "session_start").map((event) => dateKey(new Date(event.timestampMs))));
      const viewDays = new Set(periodEvents.filter((event) => INFORMATION.has(event.eventType)).map((event) => dateKey(new Date(event.timestampMs))));
      const survey = activeSurveys.filter((item) => item.anonymousParticipant === participant && Number(item.period) === period && item.condition === condition)
        .sort((a, b) => Number(b.submittedAtMs) - Number(a.submittedAtMs))[0];
      const baselineEvents = ownEvents.filter((event) => dateState.get(dateKey(new Date(event.timestampMs)))?.phase === "BASELINE");
      const baselineDays = new Set(baselineEvents.filter((event) => INFORMATION.has(event.eventType)).map((event) => dateKey(new Date(event.timestampMs))));
      rows.push({ anonymousParticipant: participant, period, condition, dailyNotifications: FREQUENCY[condition],
        exposureDays: days.size, activeDays: sessionDays.size, informationDays: viewDays.size,
        activeDayRate: ratio(sessionDays.size, days.size), informationDayRate: ratio(viewDays.size, days.size),
        baselineInformationDayRate: ratio(baselineDays.size, daysByPeriod.get(0).length),
        notificationCount: accepted.size, receivedCount: countType("notification_received"), clickCount: countType("notification_click"),
        clickRate: ratio(countType("notification_click"), accepted.size),
        open5mRate: ratio(countType("app_open_after_notification_5m"), accepted.size),
        open30mRate: ratio(countType("app_open_after_notification_30m"), accepted.size),
        open1hRate: ratio(countType("app_open_after_notification_1h"), accepted.size),
        targetViewRate: ratio(countType("target_view_after_notification"), accepted.size),
        annoyanceScore: survey?.annoyanceScore ?? null, usefulnessScore: survey?.usefulnessScore ?? null,
        increasedUseScore: survey?.increasedUseScore ?? null, continueScore: survey?.continueScore ?? null,
        preferredDailyCount: survey?.preferredDailyCount ?? null });
    }
  }
  const groups = CONDITIONS.map((condition) => {
    const own = rows.filter((row) => row.condition === condition);
    const observed = own.filter((row) => row.exposureDays > 0);
    const sent = own.reduce((total, row) => total + row.notificationCount, 0);
    return { condition, dailyNotifications: FREQUENCY[condition], assigned: own.length,
      observed: observed.length, exposureDays: observed.reduce((total, row) => total + row.exposureDays, 0),
      activeDayRate: mean(observed.map((row) => row.activeDayRate)), informationDayRate: mean(observed.map((row) => row.informationDayRate)),
      notificationCount: sent, clickRate: ratio(own.reduce((total, row) => total + row.clickCount, 0), sent),
      surveyCount: own.filter((row) => Number.isFinite(row.annoyanceScore)).length,
      annoyanceScore: mean(own.map((row) => row.annoyanceScore).filter(Number.isFinite)),
      usefulnessScore: mean(own.map((row) => row.usefulnessScore).filter(Number.isFinite)) };
  });
  const warnings = [];
  if (truncated) warnings.push("조회 상한에 도달했습니다. 원자료가 일부 누락되어 결과를 확정할 수 없습니다.");
  if (!started) warnings.push("아직 시작하지 않았습니다. 표시된 기간은 계획입니다.");
  if (config.studyKind === "pilot") warnings.push("예비 실험입니다. 정식 실험과 합산하지 않습니다.");
  if (!rows.length || rows.some((row) => row.exposureDays < Number(config.periodDays || 4))) warnings.push("계획한 모든 조건 기간의 관측이 아직 끝나지 않았습니다.");
  if (groups.some((group) => group.surveyCount < group.observed)) warnings.push("설문 미응답이 있습니다. 응답률과 누락을 함께 보고하세요.");
  return { rows, groups, warnings, calendar, participants: seenParticipants.size, complete: calendar.length > 0 && today > calendar.at(-1).date };
}

export function studyCsv(analysis) {
  const fields = ["anonymousParticipant", "period", "condition", "dailyNotifications", "exposureDays", "activeDays", "informationDays",
    "activeDayRate", "informationDayRate", "baselineInformationDayRate", "notificationCount", "receivedCount", "clickCount",
    "clickRate", "open5mRate", "open30mRate", "open1hRate", "targetViewRate", "annoyanceScore", "usefulnessScore", "increasedUseScore", "continueScore", "preferredDailyCount"];
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return "\ufeff" + [fields, ...analysis.rows.map((row) => fields.map((key) => row[key]))].map((row) => row.map(quote).join(",")).join("\r\n");
}

export function anonymousStudyExport(bundle, now = new Date()) {
  const { config = {} } = bundle;
  const analysis = analyzeStudy(bundle, now);
  const participants = new Set(analysis.rows.map((row) => row.anonymousParticipant));
  return { schemaVersion: 3, exportedAt: now.toISOString(),
    design: { version: config.version, studyMode: config.studyMode, studyKind: config.studyKind, startDate: config.startDate,
      baselineDays: config.baselineDays, periodDays: config.periodDays, schoolDaysOnly: config.schoolDaysOnly,
      excludedDates: config.excludedDates || [], frequency: config.frequency, status: config.status },
    analysis,
    events: currentVersion(bundle.events || [], config).filter((row) => participants.has(row.anonymousParticipant)).map((row) => ({
      anonymousParticipant: row.anonymousParticipant, eventType: row.eventType, timestampMs: row.timestampMs,
      variant: row.variant, sessionId: row.sessionId, properties: row.properties })),
    receipts: currentVersion(bundle.receipts || [], config).filter((row) => participants.has(row.anonymousParticipant)).map((row) => ({
      notificationId: idOf(row), anonymousParticipant: row.anonymousParticipant, period: row.period, condition: row.condition,
      status: row.status, scheduledAtMs: row.scheduledAtMs, sentAtMs: row.sentAtMs, acceptedAtMs: row.acceptedAtMs,
      slotIndex: row.slotIndex, category: row.category, attemptCount: row.attemptCount, errorCode: row.errorCode })),
  };
}

export function studyReport(bundle, now = new Date()) {
  const data = analyzeStudy(bundle, now), config = bundle.config || {};
  const pct = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "산출 불가";
  let report = `# PinCon 진로 탐구 기록\n\n주제: 알림은 많을수록 효과적인가?\n기록 시각: ${now.toISOString()}\n실험 버전: ${config.version || "미설정"} · ${config.studyKind === "pilot" ? "예비" : "정식"}\n\n## 1차시 · 설계\n\n- 독립변인: 하루 비필수 알림 0·1·3회\n- 설계: 6개 순서 균형 무작위 교차 배정, 동일 참가자가 세 조건을 경험\n- 기간: ${config.startDate || "미설정"} 시작, 기준선 ${config.baselineDays ?? "미정"}일 + 조건별 ${config.periodDays ?? "미정"}일\n- 통제: 같은 PinCon 정보 접근, 수업 밖 08·17·19시, 중요 공지는 모든 조건에 동일\n- 주요 지표: 참가자별 정보 확인일 / 경과 실험일의 평균\n- 보조 지표: 이용일 비율, 알림별 클릭률, 유용성·피로도 설문\n- 나의 가설 및 이유: [직접 작성]\n- 선행연구 출처·핵심 내용·설계에 반영한 점: [직접 조사·작성]\n\n## 2차시 · 관측과 분석\n\n| 조건 | 관측 참가자 | 정보 확인일 비율 | 이용일 비율 | 발송 수락 | 클릭률 | 설문 응답 | 피로도(1~5) |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n${data.groups.map((g) => `| ${g.dailyNotifications}회 | ${g.observed} | ${pct(g.informationDayRate)} | ${pct(g.activeDayRate)} | ${g.notificationCount} | ${pct(g.clickRate)} | ${g.surveyCount} | ${g.annoyanceScore?.toFixed(2) ?? "미응답"} |`).join("\n")}\n\n기록 상태: ${data.warnings.join(" / ") || "조회된 기록 기준"}\n\n## 3차시 · 해석과 개선안\n\n- 실제 차이를 관찰한 점: [직접 작성]\n- 나의 가설과 일치하거나 달랐던 점: [직접 작성]\n- PinCon 알림 개선안과 산업경영공학·UI 설계의 연결: [직접 작성]\n- 한계: 한 학급의 작은 표본, 같은 사람의 반복 관측, 요일·기간 효과, 푸시 미등록·설문 미응답, 수신 계측 누락\n- 0회 조건의 클릭률은 분모가 없어 산출하지 않는다. FCM 수락은 실제 도착이나 정독의 증거가 아니다.\n- 본 기록만으로 통계적 유의성이나 인과관계를 확정하지 않는다.\n`;
  const notes = bundle.notes || {};
  const replacements = [
    ["- 나의 가설 및 이유: [직접 작성]", "- 나의 가설 및 이유: ", notes.hypothesis],
    ["- 선행연구 출처·핵심 내용·설계에 반영한 점: [직접 조사·작성]", "- 선행연구 출처·핵심 내용·설계에 반영한 점: ", notes.sources],
    ["- 실제 차이를 관찰한 점: [직접 작성]", "- 실제 차이를 관찰한 점: ", notes.observations],
    ["- PinCon 알림 개선안과 산업경영공학·UI 설계의 연결: [직접 작성]", "- PinCon 알림 개선안과 산업경영공학·UI 설계의 연결: ", notes.recommendation],
  ];
  for (const [placeholder, prefix, value] of replacements) if (value) report = report.replace(placeholder, prefix + String(value));
  if (notes.limitations) report += `\n나의 한계·후속 탐구: ${notes.limitations}\n`;
  return report;
}
