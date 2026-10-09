import { previewAttachment, ATTACHMENT_SLOTS } from "./attachments.js?v=20261009-upload2";
import { prepareDialog, openDialog, closeDialog, revealDialogContent } from "./dialog-motion.js?v=20261009-motion2";

export function mountAttachmentViewer(gateway) {
  let dialog = null, preview = null, token = 0, trigger = null;
  function release() { token++; preview?.revoke(); preview = null; }
  async function open(recordId, slot) {
    const spec = ATTACHMENT_SLOTS[slot];
    if (!spec) return;
    release();
    const pending = token;
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.className = "pc-file-viewer";
      dialog.setAttribute("aria-labelledby", "pc-file-title");
      dialog.innerHTML = '<header><h2 id="pc-file-title"></h2><button type="button" data-pc-file-close aria-label="첨부 파일 닫기">×</button></header><div class="pc-file-body"></div><footer><a class="pc-file-download" hidden>다운로드</a></footer>';
      document.body.append(dialog);
      prepareDialog(dialog);
      dialog.querySelector("[data-pc-file-close]").onclick = () => closeDialog(dialog);
      dialog.addEventListener("close", () => { if (dialog.open) return; release(); dialog.querySelector(".pc-file-body").replaceChildren(); trigger?.isConnected && trigger.focus(); });
    }
    dialog.querySelector("h2").textContent = spec.label;
    const content = dialog.querySelector(".pc-file-body"), download = dialog.querySelector("a");
    content.textContent = "파일을 불러오는 중…"; content.setAttribute("role", "status"); download.hidden = true;
    openDialog(dialog);
    try {
      const loaded = await previewAttachment(gateway, recordId, slot);
      if (pending !== token || !dialog.open || dialog.dataset.dialogMotion === "closing") { loaded.revoke(); return; }
      preview = loaded;
      const isImage = loaded.contentType.startsWith("image/");
      const node = document.createElement(isImage ? "img" : "iframe");
      node.src = loaded.url; node.setAttribute(isImage ? "alt" : "title", loaded.fileName);
      content.removeAttribute("role"); content.replaceChildren(node);
      revealDialogContent(dialog);
      download.href = loaded.url; download.download = loaded.fileName; download.hidden = false;
    } catch (error) {
      if (pending !== token || !dialog.open || dialog.dataset.dialogMotion === "closing") return;
      content.replaceChildren(document.createTextNode(error?.message || "파일을 불러오지 못했습니다."));
      const button = document.createElement("button"); button.type = "button"; button.textContent = "다시 시도"; button.onclick = () => open(recordId, slot); content.append(button);
    }
  }
  document.addEventListener("click", event => {
    const button = event.target.closest?.("[data-assessment-file]");
    if (!button) return;
    trigger = button;
    open(button.dataset.assessmentId, button.dataset.assessmentFile);
  });
  window.addEventListener("pagehide", release);
}
