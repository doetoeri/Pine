// Firebase 웹 API 키는 클라이언트 식별 정보이며, 실제 쓰기 권한은 firestore.rules가 보호합니다.
globalThis.PINCON_FIREBASE_CONFIG = Object.freeze({
  apiKey: "AIzaSyClE6MPOCvqZQ_qRsZwLtml_x5TPR9PnGY",
  authDomain: "studio-2803086992-2d4cf.firebaseapp.com",
  projectId: "studio-2803086992-2d4cf",
  storageBucket: "studio-2803086992-2d4cf.firebasestorage.app",
  messagingSenderId: "747632916477",
  appId: "1:747632916477:web:60ad84854cc97deffb8b94",
  measurementId: "G-P73WG74LM9",
  // Firebase 콘솔 → 프로젝트 설정 → 클라우드 메시징 → 웹 푸시 인증서의 공개 키
  vapidKey: "BCZxHuZ-BJKkeo3YsD64ST_FQ_HMzbV2EtmZFQIJ_SjmJBiIleZ8Fx2sDs2eRWa5XFmmEGPloi_DmiZ_swRY3ik",
});

globalThis.PINCON_SCHOOL_CONFIG = Object.freeze({
  id: "gochon-high",
  name: "고촌고등학교",
});

// 학생 PIN, 계정 생성·재발급, 학급 가입 세션과 학급 운영 권한 처리는 Firebase Admin SDK 서버에서 수행합니다.
// PIN/비밀번호는 localStorage나 Firestore에 저장하지 않습니다.
// main 계정 API가 Identity v2와 학급 가입 라우트를 모두 제공하므로 운영 클라이언트는 main을 우선 사용합니다.
globalThis.PINCON_ACCOUNT_API_BASE = "https://pincon-ai-git-main-doeyoungkims-projects.vercel.app";
globalThis.PINCON_ACCOUNT_API_FALLBACKS = Object.freeze([
  "https://pincon-ai-git-feat-pincon-identity-v2-doeyoungkims-projects.vercel.app",
]);