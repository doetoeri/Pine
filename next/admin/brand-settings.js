import { NextDataGateway } from "../core/data-gateway.js";
import {
  BRAND_TAGLINE_MAX_LENGTH,
  brandTaglineFor,
  brandTaglineLength,
} from "../core/brand-settings.js";

const root = document.querySelector("#adminApp");
const gateway = new NextDataGateway();
let snapshot = gateway.snapshot();
let renderQueued = false;
let saving = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function currentTagline() {
  return brandTaglineFor(snapshot.data || {}, snapshot.profile?.classKey || "");
}

function cardMarkup() {
  const tagline = currentTagline();
  const allowed = Boolean(snapshot.canEditBrandSettings);
  const disabled = saving || !allowed;
  const accessNote = allowed
    ? "이 설정은 기존 classSettings 서버 권한과 변경 기록을 사용해 바로 학급 화면에 반영됩니다."
    : "현재 계정은 운영 Firestore 규칙상 이 학급의 classSettings를 수정할 권한이 없습니다.";

  return `<section class="admin-card admin-card--wide" data-brand-settings aria-labelledby="brand-settings-title">
    <div class="admin-card__header">
      <h2 id="brand-settings-title">PinCon 브랜드 문구</h2>
      <span class="admin-meta">학급별 설정</span>
    </div>
    <div class="brand-settings-layout">
      <div class="brand-settings-editor">
        <md-outlined-text-field
          id="brandTaglineField"
          label="PinCon 옆 작은 문구"
          value="${escapeHtml(tagline)}"
          maxlength="${BRAND_TAGLINE_MAX_LENGTH}"
          supporting-text="예: NEXT, 1-8, 우리 반 허브 · 비워두면 문구를 숨깁니다."
          ${disabled ? "disabled" : ""}
        ></md-outlined-text-field>
        <div class="brand-settings-meta">
          <span id="brandTaglineCount">${brandTaglineLength(tagline)}/${BRAND_TAGLINE_MAX_LENGTH}</span>
          <span id="brandTaglineStatus" role="status">${escapeHtml(accessNote)}</span>
        </div>
        <div class="admin-actions">
          <md-filled-button id="saveBrandTagline" ${disabled ? "disabled" : ""}>
            <md-icon slot="icon">save</md-icon>${saving ? "저장 중" : "문구 저장"}
          </md-filled-button>
        </div>
      </div>
      <div class="brand-settings-preview" aria-label="브랜드 문구 미리보기">
        <span class="brand-settings-preview__label">미리보기</span>
        <div class="brand-settings-preview__title">PinCon <span id="brandTaglinePreview" class="beta-badge" ${tagline ? "" : "hidden"}>${escapeHtml(tagline)}</span></div>
        <span>학생 화면 상단과 PC 플로팅바에 같은 문구가 표시됩니다.</span>
      </div>
    </div>
  </section>`;
}

function updatePreview(value) {
  const preview = root?.querySelector("#brandTaglinePreview");
  const count = root?.querySelector("#brandTaglineCount");
  if (!preview || !count) return;
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  preview.textContent = normalized;
  preview.hidden = !normalized;
  count.textContent = `${brandTaglineLength(normalized)}/${BRAND_TAGLINE_MAX_LENGTH}`;
}

function bindCard() {
  const field = root?.querySelector("#brandTaglineField");
  const save = root?.querySelector("#saveBrandTagline");
  const status = root?.querySelector("#brandTaglineStatus");
  if (!field || !save) return;

  field.addEventListener("input", (event) => updatePreview(event.target.value));
  save.addEventListener("click", async () => {
    if (saving) return;
    saving = true;
    save.disabled = true;
    field.disabled = true;
    if (status) status.textContent = "문구를 저장하고 변경 기록을 남기는 중…";
    try {
      const saved = await gateway.updateBrandTagline(field.value);
      field.value = saved;
      updatePreview(saved);
      if (status) status.textContent = "저장되었습니다. 연결된 PinCon 화면에 실시간 반영됩니다.";
    } catch (error) {
      if (status) status.textContent = error?.message || "문구를 저장하지 못했습니다.";
    } finally {
      saving = false;
      field.disabled = !snapshot.canEditBrandSettings;
      save.disabled = !snapshot.canEditBrandSettings;
    }
  });
}

function render() {
  renderQueued = false;
  const grid = root?.querySelector(".admin-grid");
  if (!grid || grid.querySelector("[data-brand-settings]")) return;
  grid.insertAdjacentHTML("afterbegin", cardMarkup());
  bindCard();
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(render);
}

gateway.addEventListener("change", (event) => {
  snapshot = event.detail;
  queueRender();
});

const observer = new MutationObserver(() => queueRender());
if (root) observer.observe(root, { childList: true, subtree: true });
queueRender();
