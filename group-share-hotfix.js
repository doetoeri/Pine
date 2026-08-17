const SHARE_STYLE_ID = "pincon-group-share-style";
let scheduled = false;

function ensureStyle() {
  if (document.getElementById(SHARE_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = SHARE_STYLE_ID;
  style.textContent = `
    .pincon-share-guide {
      display:flex;
      gap:10px;
      align-items:flex-start;
      padding:12px 14px;
      border-radius:16px;
      color:var(--md-sys-color-on-secondary-container);
      background:var(--md-sys-color-secondary-container);
    }
    .pincon-share-guide md-icon { flex:0 0 auto; margin-top:1px; }
    .pincon-share-guide p { margin:0; }
    .pincon-share-toast {
      position:fixed;
      z-index:1000;
      left:50%;
      bottom:max(92px,calc(env(safe-area-inset-bottom) + 76px));
      transform:translateX(-50%);
      max-width:min(88vw,420px);
      padding:10px 14px;
      border-radius:999px;
      color:var(--md-sys-color-inverse-on-surface,#fff);
      background:var(--md-sys-color-inverse-surface,#2d322b);
      box-shadow:0 8px 28px rgba(0,0,0,.18);
      font-size:.86rem;
      pointer-events:none;
      opacity:0;
      transition:opacity .16s ease;
    }
    .pincon-share-toast.show { opacity:1; }
  `;
  document.head.appendChild(style);
}

function toast(message) {
  let node = document.querySelector(".pincon-share-toast");
  if (!node) {
    node = document.createElement("div");
    node.className = "pincon-share-toast";
    node.setAttribute("role", "status");
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 1700);
}

async function copyText(text, message = "복사했습니다.") {
  const value = String(text || "").trim();
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  toast(message);
}

function cardPayload(card) {
  const title = card.querySelector("h3")?.textContent?.trim() || "Pincon 모둠 공유";
  const anchor = card.querySelector(".pincon-drive-link");
  if (anchor) {
    return {
      kind: "link",
      title,
      url: anchor.href || anchor.textContent?.trim() || "",
      text: anchor.textContent?.trim() || anchor.href || "",
    };
  }
  const body = card.querySelector(".pincon-drive-body")?.textContent?.trim() || "";
  return { kind: "text", title, text: body, url: "" };
}

async function shareCard(card) {
  const payload = cardPayload(card);
  if (navigator.share) {
    try {
      const shareData = payload.kind === "link"
        ? { title: payload.title, text: payload.title, url: payload.url }
        : { title: payload.title, text: `${payload.title}\n\n${payload.text}`.trim() };
      await navigator.share(shareData);
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  await copyText(payload.kind === "link" ? payload.url : `${payload.title}\n\n${payload.text}`.trim(), "공유할 내용을 복사했습니다.");
}

function enhanceDriveCard(card) {
  if (card.dataset.pinconShareEnhanced === "1") return;
  const actions = card.querySelector(".pincon-feature-actions");
  if (!actions) return;
  const payload = cardPayload(card);
  if (!payload.text && !payload.url) return;

  const copy = document.createElement("md-text-button");
  copy.type = "button";
  copy.dataset.shareAction = "copy";
  copy.innerHTML = `<md-icon slot="icon">content_copy</md-icon>${payload.kind === "link" ? "링크 복사" : "텍스트 복사"}`;

  const share = document.createElement("md-text-button");
  share.type = "button";
  share.dataset.shareAction = "share";
  share.innerHTML = `<md-icon slot="icon">share</md-icon>공유`;

  actions.prepend(share);
  actions.prepend(copy);
  card.dataset.pinconShareEnhanced = "1";
}

function replaceExactText(root, from, to) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node.nodeValue?.trim() === from) node.nodeValue = node.nodeValue.replace(from, to);
  }
}

function transformWorkspace() {
  ensureStyle();
  const workspace = document.querySelector(".pincon-workspace");
  if (!workspace) return;

  const driveTab = workspace.querySelector('[data-panel="drive"]');
  if (driveTab) driveTab.textContent = "모둠 공유함";

  const copy = workspace.querySelector(".pincon-workspace-copy");
  if (copy) copy.textContent = "투표 → 모둠 공유함 → 과제를 연결해 반 안에서 결정, 링크·텍스트, 마감을 한 흐름으로 관리합니다.";

  workspace.querySelector('[data-workspace-action="upload-file"]')?.remove();

  const linkButton = workspace.querySelector('[data-workspace-action="new-link"]');
  if (linkButton) linkButton.innerHTML = '<md-icon slot="icon">add_link</md-icon>링크 공유';

  const noteButton = workspace.querySelector('[data-workspace-action="new-note"]');
  if (noteButton) noteButton.innerHTML = '<md-icon slot="icon">text_snippet</md-icon>텍스트 공유';

  workspace.querySelectorAll('[data-action="open-drive"]').forEach((button) => {
    button.innerHTML = '<md-icon slot="icon">folder_shared</md-icon>모둠 공유함';
  });

  replaceExactText(workspace, "모둠 드라이브", "모둠 공유함");
  replaceExactText(workspace, "이 모둠 드라이브는 아직 비어 있습니다.", "이 모둠 공유함은 아직 비어 있습니다. 링크나 텍스트를 공유해 보세요.");

  const drivePanel = workspace.querySelector('[data-workspace-action="new-link"]')?.closest(".pincon-feature-panel");
  if (drivePanel && !drivePanel.querySelector(".pincon-share-guide")) {
    const toolbar = drivePanel.querySelector(".pincon-feature-toolbar");
    const guide = document.createElement("div");
    guide.className = "pincon-share-guide md-typescale-body-medium";
    guide.innerHTML = '<md-icon>share</md-icon><p><strong>파일 대신 링크와 텍스트를 공유합니다.</strong><br>Google Drive·Docs·Slides 같은 자료는 링크로, 회의 내용·조사 결과·역할 분담은 텍스트로 남기면 됩니다. 각 항목은 바로 복사하거나 기기의 공유 메뉴로 보낼 수 있습니다.</p>';
    toolbar?.insertAdjacentElement("afterend", guide);
  }

  workspace.querySelectorAll(".pincon-drive-item").forEach(enhanceDriveCard);

  const linkDialog = document.getElementById("pincon-drive-link-dialog");
  if (linkDialog) {
    const heading = linkDialog.querySelector("h2");
    if (heading) heading.textContent = "링크 공유";
    const submit = linkDialog.querySelector('button[type="submit"]');
    if (submit) submit.textContent = "공유";
  }

  const noteDialog = document.getElementById("pincon-drive-note-dialog");
  if (noteDialog) {
    const heading = noteDialog.querySelector("h2");
    if (heading) heading.textContent = "텍스트 공유";
    const submit = noteDialog.querySelector('button[type="submit"]');
    if (submit) submit.textContent = "공유";
  }
}

function scheduleTransform() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    transformWorkspace();
  });
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest?.("[data-share-action]");
  if (!button) return;
  const card = button.closest(".pincon-drive-item");
  if (!card) return;
  event.preventDefault();
  const payload = cardPayload(card);
  if (button.dataset.shareAction === "copy") {
    await copyText(payload.kind === "link" ? payload.url : payload.text, payload.kind === "link" ? "링크를 복사했습니다." : "텍스트를 복사했습니다.");
  } else {
    await shareCard(card);
  }
});

new MutationObserver(scheduleTransform).observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("pageshow", scheduleTransform);
scheduleTransform();
