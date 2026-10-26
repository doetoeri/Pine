export function surveyMarkup(period) {
  const fields = [["usefulnessScore", "알림이 유용했다."], ["annoyanceScore", "알림이 너무 많다고 느꼈다."],
    ["increasedUseScore", "알림 때문에 PinCon을 더 자주 확인했다."], ["continueScore", "이 정도의 알림을 계속 받고 싶다."]];
  return `<form id="period-survey" class="survey" data-period="${Number(period)}"><p class="muted">1 전혀 아니다 · 5 매우 그렇다</p>${fields.map(([name, title], i) => `<fieldset><legend>${i + 1}. ${title}</legend><div class="scale">${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="${name}" value="${n}" required>${n}</label>`).join("")}</div></fieldset>`).join("")}<label>적절한 하루 알림 수<select name="preferredDailyCount" required><option value="">선택해 주세요</option>${["0", "1", "2", "3", "4", "5+"].map((n) => `<option value="${n}">${n}회</option>`).join("")}</select></label><div class="actions"><button type="submit" class="primary">이 기간 설문 제출</button></div></form>`;
}
