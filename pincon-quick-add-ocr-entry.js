await Promise.resolve(globalThis.PINCON_MATERIAL_READY).catch(() => null);

let mounting = false;

function ensureEntry() {
  if (mounting) return;
  const dialog = document.getElementById("pincon-quick-add-v2");
  const content = dialog?.querySelector("[data-quick-content]");
  const grid = content?.querySelector(".pincon-quick-kind-grid");
  if (!dialog || !content || !grid) return;
  if (content.querySelector("[data-pincon-ocr-entry]")) return;

  mounting = true;
  try {
    const button = document.createElement("md-filled-button");
    button.type = "button";
    button.className = "pincon-quick-ocr-entry";
    button.dataset.pinconOcrEntry = "";
    button.innerHTML = '<md-icon slot="icon">document_scanner</md-icon><span>사진으로 빠르게 등록</span>';
    button.addEventListener("click", async () => {
      try {
        if (!globalThis.PINCON_OCR_CAPTURE?.open) {
          await import("./pincon-ocr-capture.js?v=20260819-ocr2");
        }
        globalThis.PINCON_OCR_CAPTURE?.open?.();
      } catch (error) {
        console.warn("[PinCon OCR Entry]", error);
      }
    });

    const sub = document.createElement("p");
    sub.className = "pincon-quick-ocr-entry-copy";
    sub.dataset.pinconOcrEntryCopy = "";
    sub.textContent = "칠판·프린트·스크린샷을 찍으면 글자를 읽고 등록 항목을 자동으로 채웁니다.";

    grid.insertAdjacentElement("beforebegin", sub);
    sub.insertAdjacentElement("afterend", button);
  } finally {
    mounting = false;
  }
}

const observer = new MutationObserver(() => queueMicrotask(ensureEntry));
observer.observe(document.body, { childList: true, subtree: true });
window.addEventListener("pageshow", () => setTimeout(ensureEntry, 120), { passive: true });
setTimeout(ensureEntry, 0);
