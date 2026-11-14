import { closeDialog, openDialog, prepareDialog } from "../next/assessments/dialog-motion.js?v=20261115-accessibility";

export function mountAccessibilitySettings() {
  const triggers = document.querySelectorAll("[data-accessibility-settings]");
  const settings = globalThis.PINCON_ACCESSIBILITY;
  if (!triggers.length || !settings) return;
  const dialog = document.createElement("dialog");
  dialog.className = "pc-accessibility";
  dialog.setAttribute("aria-labelledby", "pc-accessibility-title");
  dialog.innerHTML = `<header class="pc-accessibility-heading">
    <h2 id="pc-accessibility-title">접근성 설정</h2>
    <button type="button" data-close aria-label="접근성 설정 닫기">×</button>
  </header>
  <div class="pc-accessibility-controls">
    <div class="pc-accessibility-option">
      <label for="pc-contrast">화면 대비</label>
      <select id="pc-contrast" name="contrast" autofocus>
        <option value="system">기기 설정 따르기</option>
        <option value="normal">기본</option>
        <option value="high">고대비</option>
      </select>
    </div>
    <div class="pc-accessibility-option">
      <label for="pc-large-text">글자 크게</label>
      <input id="pc-large-text" type="checkbox" name="largeText" aria-describedby="pc-large-text-note">
      <small id="pc-large-text-note">글자를 크게 표시하고 커버를 세로 목록으로 보여줘요.</small>
    </div>
    <div class="pc-accessibility-option">
      <label for="pc-motion">동작 줄이기</label>
      <input id="pc-motion" type="checkbox" name="reduceMotion" aria-describedby="pc-motion-note">
      <small id="pc-motion-note">커버·상세창·문서의 애니메이션과 기울기 조작을 줄여요.</small>
    </div>
    <div class="pc-accessibility-option">
      <label for="pc-list">목록 보기</label>
      <input id="pc-list" type="checkbox" name="list" aria-describedby="pc-list-note">
      <small id="pc-list-note">커버를 넘기는 대신 세로로 읽고 바로 열 수 있어요.</small>
    </div>
    <button type="button" data-reset>기본 설정으로 되돌리기</button>
    <p class="sr-only" role="status"></p>
  </div>`;
  document.body.append(dialog);
  prepareDialog(dialog);
  const contrast = dialog.querySelector("select");
  const status = dialog.querySelector('[role="status"]');
  let trigger;

  function sync() {
    const choices = settings.get();
    contrast.value = choices.contrast;
    for (const option of dialog.querySelectorAll('input[type="checkbox"]')) option.checked = choices[option.name];
  }
  dialog.addEventListener("change", event => {
    const option = event.target;
    settings.update({ [option.name]: option.type === "checkbox" ? option.checked : option.value });
  });
  dialog.querySelector("[data-reset]").addEventListener("click", () => {
    settings.reset();
    status.textContent = "기본 접근성 설정으로 되돌렸어요.";
  });
  dialog.querySelector("[data-close]").addEventListener("click", () => closeDialog(dialog));
  dialog.addEventListener("close", () => {
    if (!dialog.open) trigger?.focus({ preventScroll: true });
  });
  document.addEventListener("pincon-accessibility-change", sync);
  for (const button of triggers) {
    button.disabled = false;
    button.addEventListener("click", () => {
      trigger = button;
      sync();
      status.textContent = "";
      openDialog(dialog);
      contrast.focus({ preventScroll: true });
    });
  }
}
