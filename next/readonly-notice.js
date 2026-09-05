import { forcedReadonlyMode } from "./core/degraded-readonly.js?v=20260905-readonly1";

const NOTICE_ID = "pinconForcedReadonlyNotice";
let queued = false;

function copyFor(mode) {
  if (mode === "offline-readonly") {
    return {
      icon: "cloud_off",
      title: "오프라인 읽기 전용",
      support: "저장된 학교 정보는 계속 볼 수 있습니다. 연결이 돌아오면 다시 열어 최신 상태를 확인합니다.",
    };
  }
  return {
    icon: "shield_lock",
    title: "로그인 확인 지연 · 읽기 전용",
    support: "로그인 서버 상태를 확인하지 못해 편집 기능만 잠갔습니다. 공개 학교 정보는 계속 볼 수 있습니다.",
  };
}

function render() {
  queued = false;
  const mode = forcedReadonlyMode();
  const existing = document.getElementById(NOTICE_ID);
  if (!mode) {
    existing?.remove();
    return;
  }

  const main = document.querySelector("#mainContent");
  if (!main) return;
  if (existing?.parentElement === main) return;
  existing?.remove();

  const copy = copyFor(mode);
  const notice = document.createElement("div");
  notice.id = NOTICE_ID;
  notice.className = "sync-line sync-line--stale pincon-forced-readonly-notice";
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  notice.innerHTML = `<md-icon>${copy.icon}</md-icon><span><strong>${copy.title}</strong> · ${copy.support}</span><md-text-button data-readonly-reload>다시 확인</md-text-button>`;
  main.prepend(notice);
}

function queueRender() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(render);
}

document.addEventListener("click", (event) => {
  if (!event.target.closest?.("[data-readonly-reload]")) return;
  location.reload();
});

const app = document.querySelector("#app");
if (app) new MutationObserver(queueRender).observe(app, { childList: true, subtree: true });
window.addEventListener("online", queueRender);
window.addEventListener("offline", queueRender);
queueRender();
