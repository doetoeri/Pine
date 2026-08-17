import { f as firebaseApi } from "./assets/firebase-IW9tbrMW.js";

// pincon-next-lite.js는 로그인 전에는 학급 구독을 만들지 않는다.
// Firebase가 저장된 로그인 상태를 복원한 직후 한 번만 가벼운 재동기화 이벤트를 보낸다.
let lastUid = "";
firebaseApi.observeAuth((user) => {
  const uid = user?.uid || "";
  if (!uid || uid === lastUid) return;
  lastUid = uid;
  queueMicrotask(() => window.dispatchEvent(new Event("storage")));
});
