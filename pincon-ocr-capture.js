await Promise.resolve(globalThis.PINCON_MATERIAL_READY).catch(() => null);

const OCR_ENDPOINT = globalThis.PINCON_OCR_ENDPOINT || "https://pine-lime.vercel.app/api/ocr";
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_DATA_URL_LENGTH = 3_750_000;

let fileInput = null;
let busy = false;

function track(name, params = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") safe[key] = value.slice(0, 60);
    else if (typeof value === "number" && Number.isFinite(value)) safe[key] = value;
    else if (typeof value === "boolean") safe[key] = value;
  }
  window.dispatchEvent(new CustomEvent("pincon-adoption-analytics", { detail: { name, params: safe } }));
}

function ensureInput() {
  if (fileInput?.isConnected) return fileInput;
  fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.setAttribute("capture", "environment");
  fileInput.hidden = true;
  fileInput.setAttribute("aria-hidden", "true");
  document.body.appendChild(fileInput);
  fileInput.addEventListener("change", onFileSelected);
  return fileInput;
}

function chooser() {
  const dialog = document.getElementById("pincon-quick-add-v2");
  const grid = dialog?.querySelector(".pincon-quick-kind-grid");
  return dialog && grid ? { dialog, grid } : null;
}

function statusBox(create = true) {
  const current = chooser();
  if (!current) return null;
  let box = current.dialog.querySelector("[data-pincon-ocr-status]");
  if (!box && create) {
    box = document.createElement("div");
    box.className = "pincon-ocr-status";
    box.dataset.pinconOcrStatus = "";
    current.grid.insertAdjacentElement("afterend", box);
  }
  return box;
}

function setStatus(message, mode = "info", loading = false) {
  const box = statusBox(Boolean(message));
  if (!box) return;
  if (!message) {
    box.remove();
    return;
  }
  box.dataset.mode = mode;
  box.innerHTML = `${loading ? '<md-linear-progress indeterminate></md-linear-progress>' : ""}<div><md-icon>${mode === "error" ? "error" : mode === "success" ? "check_circle" : "document_scanner"}</md-icon><span></span></div>`;
  const span = box.querySelector("span");
  if (span) span.textContent = message;
}

function ensureOcrButton() {
  const current = chooser();
  if (!current || current.grid.querySelector("[data-pincon-ocr-open]")) return;

  const button = document.createElement("md-filled-tonal-button");
  button.type = "button";
  button.dataset.pinconOcrOpen = "";
  button.className = "pincon-ocr-open";
  button.innerHTML = '<md-icon slot="icon">document_scanner</md-icon>사진·스크린샷 OCR';
  button.addEventListener("click", () => {
    if (busy) return;
    if (!navigator.onLine) {
      setStatus("OCR은 인터넷 연결이 있을 때 사용할 수 있습니다.", "error");
      return;
    }
    ensureInput().value = "";
    ensureInput().click();
    track("adoption_ocr_picker_open", {});
  });
  current.grid.appendChild(button);

  const note = document.createElement("div");
  note.className = "pincon-ocr-note";
  note.dataset.pinconOcrNote = "";
  note.innerHTML = '<md-icon>privacy_tip</md-icon><span>사진은 Google Cloud Vision OCR로 전송되며 PinCon·Firestore에는 이미지 자체를 저장하지 않습니다. 인식 결과는 등록 전에 직접 확인하세요.</span>';
  current.grid.insertAdjacentElement("afterend", note);
}

function clamp(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s•·▪■□◆◇▶▷→-]+/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function suggestedKind(text) {
  const value = String(text || "");
  if (/시간표|\d{1,2}\s*교시|교실\s*변경|수업\s*변경|보강|대체\s*수업/.test(value)) return "schedule";
  if (/준비물|지참|챙겨|가져오|준비해/.test(value)) return "supply";
  if (/수행\s*평가|수행평가|시험|제출|마감|발표|행사|프로젝트|보고서/.test(value)) return "event";
  return "notice";
}

function extractDate(text) {
  const value = String(text || "");
  let match = value.match(/\b(20\d{2})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})\s*일?\b/);
  if (match) return `${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`;

  match = value.match(/\b(\d{1,2})\s*월\s*(\d{1,2})\s*일\b/);
  if (!match) match = value.match(/\b(\d{1,2})[./-](\d{1,2})\b/);
  if (!match) return "";

  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  let year = now.getUTCFullYear();
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";

  const candidate = Date.parse(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00+09:00`);
  if (candidate < Date.now() - 120 * 86_400_000) year += 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function setField(key, value) {
  if (value === undefined || value === null || value === "") return;
  const field = document.querySelector(`#pincon-quick-add-v2 [data-q="${key}"]`);
  if (!field) return;
  field.value = String(value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

function firstMeaningfulLine(lines) {
  return lines.find((line) => !/^\d{1,2}[./-]\d{1,2}/.test(line) && !/^20\d{2}[./-]/.test(line)) || lines[0] || "";
}

function extractScheduleSubject(text, lines) {
  const arrow = String(text).match(/(?:→|->|⇒)\s*([^\n]{1,40})/);
  if (arrow) return clamp(arrow[1].replace(/\d{1,2}\s*교시.*$/, ""), 40);

  const periodLine = lines.find((line) => /\d{1,2}\s*교시/.test(line));
  if (!periodLine) return "";
  return clamp(periodLine
    .replace(/\d{1,2}\s*교시/g, "")
    .replace(/[월화수목금]\s*요일?/g, "")
    .replace(/시간표|변경|교실|수업/g, "")
    .replace(/(?:→|->|⇒).*/, "")
    .replace(/^[\s:：-]+|[\s:：-]+$/g, ""), 40);
}

function addReviewBanner(kind) {
  const fields = document.querySelector("#pincon-quick-add-v2 .pincon-quick-fields");
  if (!fields || fields.querySelector("[data-pincon-ocr-review]")) return;
  const banner = document.createElement("div");
  banner.className = "pincon-ocr-review";
  banner.dataset.pinconOcrReview = "";
  const labels = { schedule: "시간표 변경", supply: "준비물", event: "수행·일정", notice: "공지" };
  banner.innerHTML = `<md-icon>fact_check</md-icon><div><strong>OCR 자동 입력 · ${labels[kind] || "공지"}</strong><span>오인식될 수 있으니 날짜·과목·내용을 확인한 뒤 등록하세요.</span></div>`;
  fields.prepend(banner);
}

function fillFromText(text, kind) {
  const lines = cleanLines(text);
  const title = firstMeaningfulLine(lines);
  const date = extractDate(text);
  const body = String(text || "").trim();

  const current = chooser();
  const kindButton = current?.grid.querySelector(`[data-quick-kind="${kind}"]`);
  if (!kindButton) throw new Error("빠른 등록 화면을 다시 열어 주세요.");
  kindButton.click();

  window.setTimeout(() => {
    addReviewBanner(kind);

    if (kind === "schedule") {
      const period = String(text).match(/(\d{1,2})\s*교시/)?.[1] || "";
      const day = String(text).match(/([월화수목금])\s*요일?/)?.[1] || "";
      const room = String(text).match(/(?:교실|장소)\s*[:：]?\s*([^\n,]{1,30})/)?.[1] || "";
      setField("period", period);
      setField("day", day);
      setField("subject", extractScheduleSubject(text, lines) || clamp(title, 40));
      setField("room", clamp(room, 40));
    } else if (kind === "supply") {
      const supplyLine = lines.find((line) => /준비물|지참|챙겨|가져오|준비해/.test(line)) || title;
      const supply = supplyLine.replace(/^.*?(?:준비물|지참)\s*[:：]?\s*/i, "");
      setField("title", clamp(supply || title, 60));
      setField("date", date);
      setField("body", clamp(body, 180));
    } else if (kind === "event") {
      setField("title", clamp(title, 70));
      setField("date", date);
      setField("body", clamp(body, 220));
      if (/수행\s*평가|수행평가|시험|제출|마감|발표|프로젝트|보고서/.test(text)) setField("category", "수행평가");
      else if (/행사|축제|체험|대회/.test(text)) setField("category", "학교 행사");
      else setField("category", "기타");
    } else {
      const remaining = lines.slice(1).join("\n") || body;
      setField("title", clamp(title, 70));
      setField("body", String(remaining).slice(0, 500));
      if (/수업\s*변경|시간표|교실\s*변경/.test(text)) setField("category", "수업 변경");
      else if (/준비물|지참/.test(text)) setField("category", "준비물");
      else setField("category", "일반 공지");
    }

    const first = document.querySelector("#pincon-quick-add-v2 [data-q='subject'], #pincon-quick-add-v2 [data-q='title']");
    first?.focus?.();
    track("adoption_ocr_prefill", { item_type: kind, has_date: Boolean(date) });
  }, 40);
}

async function bitmapFromFile(file) {
  if ("createImageBitmap" in window) return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function imageDataUrl(file) {
  const image = await bitmapFromFile(file);
  const sourceWidth = image.width || image.naturalWidth;
  const sourceHeight = image.height || image.naturalHeight;
  if (!sourceWidth || !sourceHeight) throw new Error("이미지를 읽지 못했습니다.");

  let maxSide = 1800;
  let quality = 0.82;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("이미지를 처리하지 못했습니다.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrl.length <= MAX_DATA_URL_LENGTH) {
      image.close?.();
      return dataUrl;
    }
    maxSide = Math.round(maxSide * 0.78);
    quality = Math.max(0.58, quality - 0.07);
  }
  image.close?.();
  throw new Error("사진 용량이 너무 큽니다. 화면을 조금 더 가까이 찍어 다시 시도해 주세요.");
}

async function requestOcr(dataUrl) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(OCR_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataUrl }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = payload?.error || `HTTP_${response.status}`;
      throw new Error(code);
    }
    return String(payload?.text || "").trim();
  } finally {
    clearTimeout(timeout);
  }
}

function friendlyError(error) {
  const code = String(error?.message || "");
  if (error?.name === "AbortError") return "OCR 응답이 너무 늦습니다. 잠시 후 다시 시도해 주세요.";
  if (/OCR_NOT_CONFIGURED|OCR_CONFIGURATION_INVALID/.test(code)) return "OCR 서버 설정을 확인해야 합니다.";
  if (/ORIGIN_NOT_ALLOWED/.test(code)) return "현재 주소에서는 OCR을 사용할 수 없습니다.";
  if (/INVALID_IMAGE/.test(code)) return "이 사진은 OCR 서버에서 읽을 수 없는 형식입니다.";
  if (/OCR_PROVIDER_ERROR|OCR_REQUEST_FAILED|HTTP_5/.test(code)) return "Google OCR 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.";
  return code && !/^HTTP_/.test(code) ? code : "사진을 읽지 못했습니다. 다른 사진으로 다시 시도해 주세요.";
}

async function onFileSelected(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type?.startsWith("image/")) {
    setStatus("이미지 파일만 선택할 수 있습니다.", "error");
    return;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    setStatus("사진 원본이 너무 큽니다. 스크린샷이나 더 작은 사진을 사용해 주세요.", "error");
    return;
  }

  busy = true;
  const button = chooser()?.grid.querySelector("[data-pincon-ocr-open]");
  if (button) button.disabled = true;
  setStatus("사진을 가볍게 줄인 뒤 글자를 읽고 있습니다…", "info", true);
  track("adoption_ocr_start", { source: "image" });

  try {
    const dataUrl = await imageDataUrl(file);
    const text = await requestOcr(dataUrl);
    if (!text) throw new Error("사진에서 읽을 수 있는 글자를 찾지 못했습니다.");
    const kind = suggestedKind(text);
    setStatus("글자를 읽었습니다. 자동 입력한 내용을 확인해 주세요.", "success");
    track("adoption_ocr_success", { item_type: kind });
    fillFromText(text, kind);
  } catch (error) {
    setStatus(friendlyError(error), "error");
    track("adoption_ocr_error", { error_type: String(error?.message || "unknown").slice(0, 40) });
  } finally {
    busy = false;
    const currentButton = chooser()?.grid.querySelector("[data-pincon-ocr-open]");
    if (currentButton) currentButton.disabled = false;
    event.target.value = "";
  }
}

const root = document.getElementById("root");
if (root) new MutationObserver(() => ensureOcrButton()).observe(root, { childList: true, subtree: true });
new MutationObserver(() => ensureOcrButton()).observe(document.body, { childList: true, subtree: true });
window.addEventListener("pageshow", () => window.setTimeout(ensureOcrButton, 100), { passive: true });
ensureInput();
ensureOcrButton();

globalThis.PINCON_OCR_CAPTURE = Object.freeze({
  endpoint: OCR_ENDPOINT,
  open: () => {
    globalThis.PINCON_QUICK_ADD_V2?.open?.();
    window.setTimeout(() => {
      ensureOcrButton();
      chooser()?.grid.querySelector("[data-pincon-ocr-open]")?.click?.();
    }, 80);
  },
});
