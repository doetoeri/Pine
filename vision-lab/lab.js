import { readVisionLab } from "../accessibility/vision-lab-access.js";

const status = document.querySelector("#lab-status");
const content = document.querySelector("#lab-content");
const retry = document.querySelector("#lab-retry");
const selection = document.querySelector("#lab-simulation");
const comparison = document.querySelector(".lab-pair");
const contrast = document.querySelector("#lab-after-contrast");
const before = document.querySelector("#lab-before");
const after = document.querySelector("#lab-after");
let specimens;

function showAfter() {
  if (!specimens) return;
  after.src = `data:image/webp;base64,${contrast.checked ? specimens.highContrast : specimens.after}`;
  after.alt = contrast.checked
    ? "개선 후 PinCon 홈. 같은 카드에 고대비 색상과 키보드 초점 테두리가 보입니다."
    : "개선 후 PinCon 홈. 같은 카드에 키보드 초점 테두리가 보입니다.";
}

async function load() {
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
    status.textContent = "비교 화면을 열었어요.";
    if (document.activeElement === document.body) document.querySelector("#lab-main").focus({ preventScroll: true });
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
document.querySelector("#lab-clear").addEventListener("click", () => {
  selection.value = "normal";
  comparison.dataset.simulation = "normal";
  selection.focus();
});
retry.addEventListener("click", load);
load();
