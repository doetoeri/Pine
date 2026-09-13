# PinCon 사용 분석

PinCon의 제품 개선용 사용 분석은 Google Analytics for Firebase를 사용합니다.

## 개인정보 원칙

- 학번, 이름, 이메일, Firebase UID를 Analytics 이벤트로 보내지 않습니다.
- 검색어, 공지/과제/알림의 제목과 본문을 보내지 않습니다.
- 개별 기록 ID도 보내지 않습니다.
- 사용자가 처음 허용하기 전에는 Analytics SDK를 초기화하지 않습니다.
- 사용자가 거부하면 Analytics 수집을 시작하지 않습니다.
- 광고 저장, 광고 사용자 데이터, 광고 개인화 consent는 항상 denied로 설정합니다.
- `setUserId(..., null)`을 적용해 PinCon 계정과 Analytics 사용자를 연결하지 않습니다.

## 수집 이벤트

- `pincon_app_open`: PinCon 분석이 허용된 상태에서 앱을 열었을 때
- `screen_view`, `pincon_route_view`: today / timetable / schedule / assessment / meal / hub 등 화면 단위
- `pincon_action`: 검색, 알림함, 수행 상세, 수업 상세, 급식 날짜 선택, 새로고침, 기존 PinCon 열기 등 기능 단위
- `pwa_installed`: PWA 설치 완료

모든 커스텀 이벤트에는 `app_surface`가 포함됩니다. 사용자 입력 문자열이나 레코드 ID는 이벤트 파라미터에 포함하지 않습니다.

## 설정 변경

클라이언트에서는 다음 API를 사용할 수 있습니다.

```js
PinConAnalytics.choice()
PinConAnalytics.setChoice("granted")
PinConAnalytics.setChoice("denied")
PinConAnalytics.showSettings()
```

분석 데이터는 Firebase / Google Analytics 콘솔에서 확인합니다. 커스텀 운영센터 대시보드는 GA Data API용 서버 인증이 필요하므로 클라이언트 코드에 비밀 키를 넣지 않습니다.
