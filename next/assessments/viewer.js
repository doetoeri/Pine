import { previewAttachment, ATTACHMENT_SLOTS } from "./attachments.js?v=20261009-upload2";
import { prepareDialog, openDialog, closeDialog } from "./dialog-motion.js?v=20261009-paper1";

export function mountAttachmentViewer(gateway, { requestSignIn } = {}) {
  let dialog = null, preview = null, reader = null, readAbort = null, token = 0, trigger = null;
  const downloads = new Set();
  if (!document.querySelector('link[href*="assessments/paper-reader.css"]')) {
    const style = document.createElement("link"); style.rel = "stylesheet";
    style.href = new URL("./paper-reader.css?v=20261009-paper1", import.meta.url).href; document.head.append(style);
  }
  function release() {
    token++; readAbort?.abort(); readAbort = null; reader?.destroy(); reader = null;
    preview?.revoke(); preview = null;
  }
  function needsSignIn(error) {
    return requestSignIn && (error.code === "auth/sign-in-required"
      || !gateway.snapshot().user && (!gateway.repository?.api || error.code === "permission-denied"));
  }
  function signInButton(resume) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "학생 로그인";
    button.onclick = () => requestSignIn(resume);
    return button;
  }
  async function open(recordId, slot) {
    const spec = ATTACHMENT_SLOTS[slot];
    if (!spec) return;
    release();
    const pending = token;
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.className = "pc-file-viewer";
      dialog.setAttribute("aria-labelledby", "pc-file-title");
      dialog.innerHTML = '<header><div class="pc-file-heading"><h2 id="pc-file-title" tabindex="-1"></h2><small></small></div><button type="button" data-pc-file-close aria-label="첨부 파일 닫기">×</button></header><div class="pc-file-body"></div><footer><a class="pc-file-download" hidden>원본 다운로드</a></footer>';
      document.body.append(dialog);
      prepareDialog(dialog);
      dialog.querySelector("[data-pc-file-close]").onclick = () => closeDialog(dialog);
      dialog.addEventListener("close", () => {
        if (dialog.open) return;
        release(); dialog.querySelector(".pc-file-body").replaceChildren();
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      });
    }
    dialog.querySelector("h2").textContent = spec.label;
    dialog.querySelector(".pc-file-heading small").textContent = "";
    const content = dialog.querySelector(".pc-file-body"), download = dialog.querySelector("a");
    const wasInContent = content.contains(document.activeElement);
    const title = dialog.querySelector("h2");
    if (wasInContent) title.focus({ preventScroll: true });
    content.classList.remove("pc-paper-reader");
    content.innerHTML = '<p class="pc-file-message" role="status">파일을 불러오는 중…</p>';
    download.hidden = true;
    openDialog(dialog);
    try {
      const loaded = await previewAttachment(gateway, recordId, slot);
      if (pending !== token || !dialog.open || dialog.dataset.dialogMotion === "closing") { loaded.revoke(); return; }
      preview = loaded;
      dialog.querySelector(".pc-file-heading small").textContent = loaded.fileName;
      download.href = loaded.url; download.download = loaded.fileName; download.hidden = false;
      readAbort = new AbortController();
      const signal = readAbort.signal;
      const { mountPaperReader } = await import("./paper-reader.js?v=20261009-paper1");
      if (signal.aborted || pending !== token) return;
      const mounted = await mountPaperReader(content, loaded, { signal });
      if (pending !== token || !dialog.open || dialog.dataset.dialogMotion === "closing") { mounted.destroy(); return; }
      reader = mounted;
    } catch (error) {
      if (pending !== token || !dialog.open || dialog.dataset.dialogMotion === "closing" || error.name === "AbortError") return;
      content.classList.remove("pc-paper-reader");
      const message = document.createElement("p");
      message.className = "pc-file-message";
      message.setAttribute("role", "status");
      const auth = needsSignIn(error);
      message.textContent = auth ? "안내 자료를 보려면 학번과 PIN으로 로그인해 주세요."
        : preview ? (error.name === "InvalidPDFException" ? "PDF 내용을 읽을 수 없어요. 원본 파일을 확인해 주세요." : error.message?.includes("암호") ? error.message : "미리보기를 준비하지 못했어요. 다시 시도하거나 원본을 다운로드해 주세요.")
        : error.message || "파일을 불러오지 못했어요.";
      const resume = () => open(recordId, slot);
      const button = auth ? signInButton(resume) : document.createElement("button");
      if (!auth) {
        button.type = "button";
        button.textContent = "다시 시도";
        button.onclick = resume;
      }
      content.replaceChildren(message, button);
      if (wasInContent && document.activeElement === title) button.focus();
    }
  }
  async function downloadFile(button) {
    const slot = button.dataset.assessmentDownload;
    if (!ATTACHMENT_SLOTS[slot] || button.disabled) return;
    const status = button.closest(".pc-attachment-row")?.querySelector(".pc-attachment-status");
    button.disabled = true; button.setAttribute("aria-busy", "true");
    if (status) { status.hidden = false; status.classList.remove("pc-file-error"); status.textContent = "원본 파일을 준비하는 중…"; }
    try {
      const loaded = await previewAttachment(gateway, button.dataset.assessmentId, slot);
      downloads.add(loaded);
      const link = document.createElement("a"); link.href = loaded.url; link.download = loaded.fileName;
      document.body.append(link); link.click(); link.remove();
      if (status) status.textContent = "다운로드를 시작했어요.";
      setTimeout(() => { loaded.revoke(); downloads.delete(loaded); }, 30000);
    } catch (error) {
      if (status) {
        status.classList.add("pc-file-error");
        if (needsSignIn(error)) {
          const triggerSelector = `[data-assessment-download="${slot}"][data-assessment-id="${CSS.escape(button.dataset.assessmentId)}"]`;
          status.replaceChildren("원본 파일을 받으려면 학번과 PIN으로 로그인해 주세요. ",
            signInButton(() => {
              const current = document.querySelector(triggerSelector);
              if (current) downloadFile(current);
            }));
        } else status.textContent = error?.message || "다운로드하지 못했어요. 다시 눌러 주세요.";
      }
    } finally { button.disabled = false; button.removeAttribute("aria-busy"); }
  }
  document.addEventListener("click", event => {
    const download = event.target.closest?.("[data-assessment-download]");
    if (download) { downloadFile(download); return; }
    const button = event.target.closest?.("[data-assessment-file]");
    if (!button) return;
    trigger = button; open(button.dataset.assessmentId, button.dataset.assessmentFile);
  });
  window.addEventListener("pagehide", () => { release(); downloads.forEach(file => file.revoke()); downloads.clear(); });
}
