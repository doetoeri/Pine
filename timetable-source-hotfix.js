function patchTimetableSourceLabels() {
  const title = document.getElementById("schedule-title");
  const root = title?.closest(".view-layout");
  if (!root) return;

  const replacements = new Map([
    ["NEIS 자동 동기화", "컴시간 우선 동기화"],
    ["NEIS에 공개된 시간표가 없습니다", "컴시간·NEIS에 공개된 시간표가 없습니다"],
    ["학교가 시간표를 등록하면 자동으로 교시순으로 표시됩니다.", "컴시간 시간표를 우선 반영하고, 없으면 NEIS를 확인합니다."],
  ]);

  root.querySelectorAll("span, p").forEach((element) => {
    const text = element.textContent?.trim();
    const replacement = replacements.get(text);
    if (replacement) element.textContent = replacement;
  });
}

let queued = false;
function queuePatch() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    patchTimetableSourceLabels();
  });
}

new MutationObserver(queuePatch).observe(document.documentElement, {
  childList: true,
  subtree: true,
});

queuePatch();
