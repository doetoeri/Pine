const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp";

function enhancePlanFileField(root = document) {
  const input = root.querySelector?.("#managedPlanFile");
  if (!input) return;
  input.setAttribute("accept", ACCEPT);
  const label = input.closest(".managed-file-field");
  const title = label?.querySelector("span");
  const helper = label?.querySelector("small");
  if (title) title.textContent = "PDF 또는 이미지 · 10MB 이하";
  if (helper && !helper.textContent.startsWith("현재 파일:")) {
    helper.textContent = "PDF·JPG·PNG·WEBP 또는 학교 원문 링크 중 하나는 필요합니다.";
  }
}

enhancePlanFileField();

const observer = new MutationObserver(() => enhancePlanFileField());
observer.observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener("change", (event) => {
  const input = event.target instanceof HTMLInputElement && event.target.id === "managedPlanFile" ? event.target : null;
  if (!input?.files?.[0]) return;
  const file = input.files[0];
  const helper = input.closest(".managed-file-field")?.querySelector("small");
  if (helper) helper.textContent = `선택됨: ${file.name} · ${(file.size / 1024 / 1024).toFixed(1)}MB`;
});

export { ACCEPT, enhancePlanFileField };
