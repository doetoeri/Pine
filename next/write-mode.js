import { NextDataGateway } from "./core/data-gateway.js";
import { TODAY_OPEN_WRITE_CLASS_KEY, TODAY_OPEN_WRITE_UNTIL_MS } from "./core/today-open-write.js";

const gateway = new NextDataGateway();
const appRoot = document.querySelector("#app");
let snapshot = gateway.snapshot();
let queued = false;
let startingGuestEdit = false;

function setText(node, text) {
  if (node && node.textContent !== text) node.textContent = text;
}

function windowOpen() {
  return Date.now() < TODAY_OPEN_WRITE_UNTIL_MS;
}

function eligibleProfile() {
  return snapshot.profile?.classKey === TODAY_OPEN_WRITE_CLASS_KEY && windowOpen();
}

function ensureActions(trust) {
  let actions = trust.querySelector(".trust-actions");
  if (!actions) {
    actions = document.createElement("div");
    actions.className = "trust-actions";
    trust.append(actions);
  }
  return actions;
}

function ensureGuestEditButton(trust) {
  const actions = ensureActions(trust);
  let button = actions.querySelector("#startTodayEdit");
  if (!button) {
    button = document.createElement("md-filled-tonal-button");
    button.id = "startTodayEdit";
    button.innerHTML = '<md-icon slot="icon">edit_square</md-icon>편집 시작';
    actions.prepend(button);
    button.addEventListener("click", async () => {
      if (startingGuestEdit) return;
      startingGuestEdit = true;
      button.disabled = true;
      setText(button, "인증 준비 중…");
      try {
        if (!globalThis.PINCON_GUEST_AUTH?.ensureNamedUserAndSync) {
          throw new Error("편집 인증 모듈을 불러오지 못했습니다. 페이지를 새로고침해 주세요.");
        }
        await globalThis.PINCON_GUEST_AUTH.ensureNamedUserAndSync();
      } catch (error) {
        startingGuestEdit = false;
        button.disabled = false;
        button.innerHTML = '<md-icon slot="icon">edit_square</md-icon>편집 시작';
        const editLine = [...trust.querySelectorAll(".trust-line")].find((line) => line.querySelector("strong")?.textContent?.trim() === "공용 편집");
        setText(editLine?.querySelector("span"), error?.message || "편집 인증을 시작하지 못했습니다.");
      }
    });
  }
  return button;
}

function removeGuestEditButton(trust) {
  trust.querySelector("#startTodayEdit")?.remove();
}

function patchWriteMode() {
  queued = false;
  const trust = document.querySelector("[data-day2-trust]");
  const canWrite = Boolean(snapshot.canManageContent);
  const temporary = Boolean(snapshot.temporaryOpenWrite);
  const profileEligible = eligibleProfile();

  if (trust) {
    const badge = trust.querySelector(".beta-badge");

    if (canWrite) {
      setText(badge, temporary ? "WRITE ENABLED · TODAY" : "WRITE ENABLED");
      removeGuestEditButton(trust);
      trust.querySelectorAll(".trust-line").forEach((line) => {
        const heading = line.querySelector("strong")?.textContent?.trim();
        const body = line.querySelector("span");
        if (heading === "공용 편집") {
          setText(body, temporary
            ? "오늘은 1-8에서 공지·수행·학급 행사를 실제 저장할 수 있습니다. Firebase 인증과 서버 시간 제한을 거치며 변경 기록에 UID와 이름이 남습니다."
            : "공지·수행·학급 행사는 관리자 편집에서 실제 저장할 수 있습니다. 모든 변경은 서버 권한 검사와 변경 기록을 거칩니다.");
        }
        if (heading === "삭제 정책") {
          setText(body, temporary
            ? "오늘 임시 편집자는 생성·수정만 가능합니다. 보관·복원은 기존 회장 계정에서만 가능합니다."
            : "영구 삭제하지 않고 보관한 뒤 복원할 수 있습니다. 보관·복원도 변경 기록에 남습니다.");
        }
      });
      const adminButton = trust.querySelector("#openAdminBeta");
      if (adminButton && adminButton.getAttribute("data-write-label") !== "true") {
        adminButton.innerHTML = '<md-icon slot="icon">edit_square</md-icon>관리자 편집';
        adminButton.setAttribute("data-write-label", "true");
      }
    } else if (profileEligible && !snapshot.access?.signedIn) {
      setText(badge, "EDIT READY · TODAY");
      ensureGuestEditButton(trust);
      trust.querySelectorAll(".trust-line").forEach((line) => {
        const heading = line.querySelector("strong")?.textContent?.trim();
        const body = line.querySelector("span");
        if (heading === "공용 편집") setText(body, "오늘 23:59까지 1-8은 이름을 입력해 Firebase 익명 인증을 하면 공지·수행·학급 행사 생성·수정을 사용할 수 있습니다.");
        if (heading === "삭제 정책") setText(body, "임시 편집에서는 영구 삭제·보관·복원은 열지 않습니다.");
      });
    } else {
      setText(badge, "READ ONLY");
      removeGuestEditButton(trust);
      trust.querySelectorAll(".trust-line").forEach((line) => {
        const heading = line.querySelector("strong")?.textContent?.trim();
        const body = line.querySelector("span");
        if (heading === "공용 편집") {
          setText(body, profileEligible
            ? "편집 인증 상태를 확인하고 있습니다. 새로고침 후에도 읽기 전용이면 편집 시작을 다시 눌러 주세요."
            : "현재 학급 또는 계정에는 공용 콘텐츠 편집 권한이 없습니다.");
        }
      });
    }
  }

  const moreSection = document.querySelector("#more-title")?.closest("section");
  if (moreSection) {
    moreSection.querySelectorAll(".row__support").forEach((node) => {
      if (node.textContent?.includes("공용 데이터는 현재 Next에서 읽기 전용")) {
        setText(node, canWrite ? "학생 화면은 읽기 중심 · 관리자 영역에서 실제 편집 가능" : "학생 화면은 읽기 중심 · 권한 확인 후 편집 가능");
      }
    });
    moreSection.querySelectorAll(".notice-banner p").forEach((node) => {
      if (node.textContent?.includes("공용 데이터 쓰기를 열지 않습니다")) {
        setText(node, canWrite
          ? "운영 계정 또는 오늘 임시 편집 세션의 저장은 Firestore 서버 규칙으로 제한됩니다. 변경은 기록되며 학생 화면은 읽기 중심입니다."
          : "공용 편집은 인증과 서버 권한 확인 뒤에만 열립니다.");
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
