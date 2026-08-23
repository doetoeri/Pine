import { NextDataGateway } from "./core/data-gateway.js";

const gateway = new NextDataGateway();
const appRoot = document.querySelector("#app");
let snapshot = gateway.snapshot();
let queued = false;

function setText(node, text) {
  if (node && node.textContent !== text) node.textContent = text;
}

function patchWriteMode() {
  queued = false;
  if (!snapshot.canManageContent) return;

  const trust = document.querySelector("[data-day2-trust]");
  if (trust) {
    const badge = trust.querySelector(".beta-badge");
    setText(badge, "WRITE ENABLED");
    trust.querySelectorAll(".trust-line").forEach((line) => {
      const heading = line.querySelector("strong")?.textContent?.trim();
      const body = line.querySelector("span");
      if (heading === "공용 편집") setText(body, "공지·수행·학급 행사는 관리자 편집에서 실제 저장할 수 있습니다. 모든 변경은 서버 권한 검사와 변경 기록을 거칩니다.");
      if (heading === "삭제 정책") setText(body, "영구 삭제하지 않고 보관한 뒤 복원할 수 있습니다. 보관·복원도 변경 기록에 남습니다.");
    });
    const adminButton = trust.querySelector("#openAdminBeta");
    if (adminButton && adminButton.getAttribute("data-write-label") !== "true") {
      adminButton.innerHTML = '<md-icon slot="icon">edit_square</md-icon>관리자 편집';
      adminButton.setAttribute("data-write-label", "true");
    }
  }

  const moreSection = document.querySelector("#more-title")?.closest("section");
  if (moreSection) {
    moreSection.querySelectorAll(".row__support").forEach((node) => {
      if (node.textContent?.includes("공용 데이터는 현재 Next에서 읽기 전용")) {
        setText(node, "학생 화면은 읽기 중심 · 관리자 영역에서 실제 편집 가능");
      }
    });
    moreSection.querySelectorAll(".notice-banner p").forEach((node) => {
      if (node.textContent?.includes("공용 데이터 쓰기를 열지 않습니다")) {
        setText(node, "운영 계정의 편집은 production Firestore 권한으로 제한되며, 학생·비로그인 사용자는 읽기 전용입니다. 변경은 기록되고 보관 항목은 복원할 수 있습니다.");
      }
    });
  }
}

function queuePatch() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(patchWriteMode);
}

gateway.addEventListener("change", (event) => {
  snapshot = event.detail;
  queuePatch();
});

const observer = new MutationObserver(() => queuePatch());
if (appRoot) observer.observe(appRoot, { childList: true, subtree: true });
queuePatch();
