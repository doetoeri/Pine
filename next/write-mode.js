import { NextDataGateway } from "./core/data-gateway.js";
import { TODAY_OPEN_WRITE_CLASS_KEY, TODAY_OPEN_WRITE_UNTIL_MS } from "./core/today-open-write.js";

const gateway = new NextDataGateway();
const appRoot = document.querySelector("#app");
let snapshot = gateway.snapshot();
let queued = false;
let startingGuestEdit = false;
let startingGoogleAuth = false;

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

function ensureGoogleButton(trust) {
  const actions = ensureActions(trust);
  let button = actions.querySelector("#signInWithGoogle");
  const currentUser = snapshot.user || null;
  const label = currentUser?.isAnonymous ? "Google 계정으로 전환" : (currentUser ? "다른 Google 계정" : "Google로 로그인");

  if (!button) {
    button = document.createElement("md-outlined-button");
    button.id = "signInWithGoogle";
    actions.prepend(button);
    button.addEventListener("click", async () => {
      if (startingGoogleAuth) return;
      startingGoogleAuth = true;
      button.disabled = true;
      button.textContent = "Google 로그인 중…";
      try {
        if (!globalThis.PINCON_GUEST_AUTH?.signInWithGoogleAndSync) {
          throw new Error("Google 로그인 모듈을 불러오지 못했습니다. 페이지를 새로고침해 주세요.");
        }
        await globalThis.PINCON_GUEST_AUTH.signInWithGoogleAndSync();
      } catch (error) {
        startingGoogleAuth = false;
        button.disabled = false;
        button.innerHTML = `<md-icon slot="icon">account_circle</md-icon>${label}`;
        const roleLine = [...trust.querySelectorAll(".trust-line")].find((line) => line.querySelector("strong")?.textContent?.trim() === "현재 역할");
        setText(roleLine?.querySelector("span"), error?.message || "Google 로그인을 완료하지 못했습니다.");
      }
    });
  }

  if (!startingGoogleAuth) button.innerHTML = `<md-icon slot="icon">account_circle</md-icon>${label}`;
  return button;
}

function removeGoogleButton(trust) {
  trust.querySelector("#signInWithGoogle")?.remove();
}

function ensureGuestEditButton(trust) {
  const actions = ensureActions(trust);
  let button = actions.querySelector("#startTodayEdit");
  if (!button) {
    button = document.createElement("md-filled-tonal-button");
    button.id = "startTodayEdit";
    button.innerHTML = '<md-icon slot="icon">edit_square</md-icon>이름으로 편집';
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
        button.innerHTML = '<md-icon slot="icon">edit_square</md-icon>이름으로 편집';
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
  const user = snapshot.user || null;
  const googleSignedIn = Boolean(user && !user.isAnonymous && user.providerData?.some?.((item) => item?.providerId === "google.com"));

  if (trust) {
    const badge = trust.querySelector(".beta-badge");

    if (!googleSignedIn && (!canWrite || temporary)) ensureGoogleButton(trust);
    else removeGoogleButton(trust);

    if (canWrite) {
      setText(badge, temporary ? "WRITE ENABLED · TODAY" : "WRITE ENABLED");
      removeGuestEditButton(trust);
      trust.querySelectorAll(".trust-line").forEach((line) => {
        const heading = line.querySelector("strong")?.textContent?.trim();
        const body = line.querySelector("span");
        if (heading === "공용 편집") {
          setText(body, temporary
            ? "오늘은 1-8에서 공지·수행·학급 행사를 실제 저장할 수 있습니다. Google 계정으로 전환하면 장기 관리자 역할도 같은 Firebase UID로 확인할 수 있습니다."
            : "공지·수행·학급 행사는 관리자 편집에서 실제 저장할 수 있습니다. 모든 변경은 서버 권한 검사와 변경 기록을 거칩니다.");
        }
        if (heading === "삭제 정책") {
          setText(body, temporary
            ? "오늘 임시 편집자는 생성·수정만 가능합니다. 보관·복원은 실제 관리자 계정에서만 가능합니다."
            : "영구 삭제하지 않고 보관한 뒤 복원할 수 있습니다. 보관·복원도 변경 기록에 남습니다.");
        }
        if (heading === "현재 역할" && googleSignedIn) {
          setText(body, `${user.displayName || user.email || "Google 사용자"} · Google 로그인`);
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
        if (heading === "공용 편집") setText(body, "오늘 23:59까지 1-8은 이름 기반 익명 인증 또는 Google 로그인으로 편집을 시작할 수 있습니다.");
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
            ? "편집 인증 상태를 확인하고 있습니다. Google 계정에 관리자 역할이 있으면 로그인 후 자동으로 권한이 적용됩니다."
            : "현재 학급 또는 계정에는 공용 콘텐츠 편집 권한이 없습니다.");
        }
        if (heading === "현재 역할" && googleSignedIn) {
          setText(body, `${user.displayName || user.email || "Google 사용자"} · Google 로그인`);
        }
      });
    }
  }

  const moreSection = document.querySelector("#more-title")?.closest("section");
  if (moreSection) {
    moreSection.querySelectorAll(".row__support").forEach((node) => {
      if (node.textContent?.includes("공용 데이터는 현재 Next에서 읽기 전용")) {
        setText(node, canWrite ? "학생 화면은 읽기 중심 · 관리자 영역에서 실제 편집 가능" : "학생 화면은 읽기 중심 · Google 로그인 또는 권한 확인 후 편집 가능");
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
