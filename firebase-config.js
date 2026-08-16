// Firebase 콘솔에서 발급받은 웹 앱 설정으로 null을 교체한 뒤 다시 배포하세요.
// Firebase 웹 API 키는 클라이언트 식별 정보이며, 실제 쓰기 권한은 firestore.rules가 보호합니다.
window.PINCON_FIREBASE_CONFIG = null;

window.PINCON_SCHOOL_CONFIG = Object.freeze({
  id: "gochon-high",
  name: "고촌고등학교",
});
