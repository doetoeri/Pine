import { NextDataGateway } from "../core/data-gateway.js";
import { buildDailyBriefData } from "./daily-brief-data.js";
import { DAILY_BRIEF_SIZE, renderDailyBrief } from "./daily-brief-renderer.js";

const root = document.querySelector("#adminApp");
const gateway = new NextDataGateway();
let lastSummary = null;

function snapshot() {
  return gateway.snapshot();
}

function currentData() {
  return buildDailyBriefData(snapshot());
}

function cardMarkup() {
  const data = currentData();
  return `<section class="admin-card admin-card--wide daily-brief-card" id="dailyBriefImageCard" aria-labelledby="daily-brief-title">
    <div class="daily-brief-card__copy">
      <span class="daily-brief-card__eyebrow">DAILY BRIEF · 4:5</span>
      <h2 id="daily-brief-title">오늘 필요한 내용을 자동으로 한 장에</h2>
      <p>PinCon의 공지·수행·시간표·급식·준비물·내일 첫 수업을 읽어 1080×1350 JPG로 자동 편집합니다. 생성형 AI는 사용하지 않습니다.</p>
      <div class="daily-brief-card__meta">
        <span><md-icon>priority_high</md-icon>핵심 ${data.primary.length}</span>
        <span><md-icon>calendar_view_day</md-icon>${data.timetable.periods.length}교시</span>
        <span><md-icon>restaurant</md-icon>메뉴 ${data.meal.items.length}</span>
        <span><md-icon>checklist</md-icon>체크 ${data.checklist.length}</span>
      </div>
    </div>
    <div class="daily-brief-card__actions">
      <md-filled-tonal-button id="dailyBriefOpen"><md-icon slot="icon">auto_awesome_mosaic</md-icon>미리보기</md-filled-tonal-button>
      <small>같은 데이터는 같은 디자인으로 출력됩니다.</small>
    </div>
    ${dialogMarkup()}
  </section>`;
}

function dialogMarkup() {
  return `<md-dialog id="dailyBriefImageDialog" class="daily-brief-dialog">
    <div slot="headline">오늘 공지 이미지</div>
    <div slot="content" class="daily-brief-dialog__content">
      <div class="daily-brief-preview-head">
        <div><strong>PinCon Daily Brief</strong><span>데이터를 다시 읽을 때마다 내용만 갱신됩니다.</span></div>
        <span class="daily-brief-format">1080 × 1350</span>
      </div>
      <div class="daily-brief-canvas-wrap">
        <canvas id="dailyBriefCanvas" width="${DAILY_BRIEF_SIZE.width}" height="${DAILY_BRIEF_SIZE.height}" aria-label="오늘 공지 이미지 미리보기"></canvas>
      </div>
      <div class="daily-brief-spec">
        <span><md-icon>aspect_ratio</md-icon>4:5 JPG</span>
        <span><md-icon>database</md-icon>실시간 PinCon 데이터</span>
        <span><md-icon>palette</md-icon>Material You Expressive</span>
        <span><md-icon>smart_toy</md-icon>생성형 AI 미사용</span>
      </div>
      <p id="dailyBriefStatus" class="managed-editor-status" role="status"></p>
    </div>
    <div slot="actions">
      <md-text-button id="dailyBriefRefresh"><md-icon slot="icon">refresh</md-icon>데이터 새로 읽기</md-text-button>
      <md-text-button id="dailyBriefClose">닫기</md-text-button>
      <md-filled-button id="dailyBriefDownload"><md-icon slot="icon">download</md-icon>JPG 저장</md-filled-button>
    </div>
  </md-dialog>`;
}

function mount() {
  if (!root || !(snapshot().canManageContent || snapshot().canArchiveContent)) return;
  const overview = root.querySelector("#adminOverview");
  if (!overview) return;
  const html = cardMarkup();
  const existing = root.querySelector("#dailyBriefImageCard");
  if (existing) existing.outerHTML = html;
  else overview.insertAdjacentHTML("afterend", html);

  const quickActions = root.querySelector(".admin-quick-actions");
  if (quickActions && !quickActions.querySelector("[data-daily-brief-open]")) {
    quickActions.insertAdjacentHTML("beforeend", `<button type="button" data-daily-brief-open><md-icon>image</md-icon><span><strong>오늘 공지 이미지</strong><small>4:5 JPG 자동 편집</small></span></button>`);
  }
}

async function renderPreview() {
  const canvas = root?.querySelector("#dailyBriefCanvas");
  const status = root?.querySelector("#dailyBriefStatus");
  if (!canvas) return;
  if (status) {
    status.dataset.kind = "";
    status.textContent = "PinCon 데이터를 정리하는 중입니다.";
  }
  try {
    const data = currentData();
    lastSummary = await renderDailyBrief(canvas, data);
    if (status) {
      status.dataset.kind = "success";
      status.textContent = `핵심 ${lastSummary.taskCount}개 · 수업 ${lastSummary.periodCount}개 · 급식 ${lastSummary.mealCount}개 · 체크 ${lastSummary.checklistCount}개 반영 완료`;
    }
  } catch (error) {
    if (status) {
      status.dataset.kind = "error";
      status.textContent = error?.message || "공지 이미지를 구성하지 못했습니다.";
    }
  }
}

async function openDialog() {
  mount();
  const dialog = root?.querySelector("#dailyBriefImageDialog");
  if (!dialog) return;
  dialog.show?.();
  await renderPreview();
}

function downloadCanvas() {
  const canvas = root?.querySelector("#dailyBriefCanvas");
  const status = root?.querySelector("#dailyBriefStatus");
  if (!canvas) return;
  canvas.toBlob((blob) => {
    if (!blob) {
      if (status) {
        status.dataset.kind = "error";
        status.textContent = "JPG 파일을 만들지 못했습니다.";
      }
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `PinCon-${lastSummary?.today || new Date().toISOString().slice(0, 10)}-daily-brief.jpg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1800);
    if (status) {
      status.dataset.kind = "success";
      status.textContent = "1080×1350 JPG를 저장했습니다.";
    }
  }, "image/jpeg", 0.95);
}

root?.addEventListener("click", (event) => {
  const path = event.composedPath?.() || [];
  const control = path.find((node) => node instanceof HTMLElement && (
    node.id === "dailyBriefOpen"
    || node.id === "dailyBriefRefresh"
    || node.id === "dailyBriefClose"
    || node.id === "dailyBriefDownload"
    || node.hasAttribute("data-daily-brief-open")
  ));
  if (!control) return;
  if (control.id === "dailyBriefOpen" || control.hasAttribute("data-daily-brief-open")) return openDialog();
  if (control.id === "dailyBriefRefresh") return renderPreview();
  if (control.id === "dailyBriefClose") return root.querySelector("#dailyBriefImageDialog")?.close?.();
  if (control.id === "dailyBriefDownload") return downloadCanvas();
}, true);

gateway.addEventListener("change", () => {
  if (root?.querySelector("#dailyBriefImageDialog")?.open) renderPreview();
  else requestAnimationFrame(mount);
});

await gateway.start();
mount();

export { mount as mountDailyBriefImage, renderPreview as renderDailyBriefPreview };
