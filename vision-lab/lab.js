import { readVisionLab } from "../accessibility/vision-lab-access.js";

const status = document.querySelector("#lab-status");
const content = document.querySelector("#lab-content");
const retry = document.querySelector("#lab-retry");
const selection = document.querySelector("#lab-simulation");
const comparison = document.querySelector(".lab-pair");
const views = document.querySelector("#lab-view");
const contrast = document.querySelector("#lab-after-contrast");
const beforeFigure = document.querySelector("#lab-before-figure");
const afterFigure = document.querySelector("#lab-after-figure");
const before = document.querySelector("#lab-before");
const after = document.querySelector("#lab-after");
const afterCaption = document.querySelector("#lab-after-caption");
let specimens;

function showAfter() {
  if (!specimens) return;
  const highContrast = contrast.checked;
  after.src = `data:image/webp;base64,${highContrast ? specimens.highContrast : specimens.after}`;
  afterCaption.textContent = highContrast ? "고대비 · 노란 초점 테두리" : "기본 대비 · 강조된 카드 경계";
  after.alt = highContrast
    ? "개선 후 PinCon 홈. 어두운 배경에 밝은 글자와 노란 초점 테두리가 보입니다."
    : "개선 후 PinCon 홈. 밝은 중앙 카드에 진한 경계와 파란 초점 테두리가 보입니다.";
}

function showView(view) {
  comparison.dataset.view = view;
  beforeFigure.hidden = view === "after";
  afterFigure.hidden = view === "before";
}

async function load() {
  const retryHadFocus = document.activeElement === retry;
  retry.disabled = true;
  status.textContent = "열람 가능 여부를 확인하는 중…";
  const request = new AbortController();
  let timeout;
  const elapsed = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      request.abort();
      reject(new Error("vision-lab-timeout"));
    }, 12_000);
  });
  try {
    const result = await Promise.race([readVisionLab(undefined, { signal: request.signal }), elapsed]);
    specimens = result.comparison;
    if (!specimens) {
      status.textContent = "현재 체험실을 열람할 수 없어요.";
      return;
    }
    before.src = `data:image/webp;base64,${specimens.before}`;
    showAfter();
    content.hidden = false;
    retry.hidden = true;
    status.classList.add("lab-status-announcement");
    status.textContent = "비교 화면을 열었어요.";
    if (retryHadFocus && document.activeElement === document.body) selection.focus();
  } catch {
    status.textContent = "체험실 연결이 지연됐어요. 잠시 후 다시 시도해 주세요.";
    retry.hidden = false;
  } finally {
    clearTimeout(timeout);
    retry.disabled = false;
  }
}

selection.addEventListener("change", () => { comparison.dataset.simulation = selection.value; });
contrast.addEventListener("change", showAfter);
views.addEventListener("change", event => showView(event.target.value));
document.querySelector("#lab-clear").addEventListener("click", () => {
  selection.value = "normal";
  comparison.dataset.simulation = "normal";
  selection.focus();
});
retry.addEventListener("click", load);
if (matchMedia("(max-width: 38rem)").matches) {
  views.querySelector('[value="after"]').checked = true;
}
showView(views.querySelector(":checked").value);
load();
