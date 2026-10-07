# PinCon

고촌고등학교의 공지·시간표·일정·급식·학급 운영을 연결하는 정적 PWA입니다. 메인 주소는 `/next/`이며 루트 주소는 그 화면으로 이동합니다. 학번/PIN과 Google 관리자 로그인, Firebase 실시간 데이터, 교실·자리 배치·TV 화면, NEIS 자동 수집, 알림 빈도 실험을 유지합니다.

## 화면과 실행 구조

- 오늘: 반 공지 → 오늘 바뀐 것 → 다가오는 일정·시간표 → 급식. 학생 계정은 개인 학급 운영 정보를 함께 표시합니다.
- 시간표, 일정, 학급, 더보기: 동일한 화면 틀과 탐색 메뉴를 공유합니다.
- `next/app-bootstrap.js`: 계정 확인 → 화면·필수 기능 → 실험 초기화. 실험 통신을 기다리는 동안에도 기본 화면을 사용할 수 있습니다.
- `next/core/region-renderer.js`: 바뀐 영역만 교체합니다. 메뉴, 검색/알림 대화상자, 변경되지 않은 시간표와 급식, 학급 카드와 평가계획서 라이브러리는 그대로 유지합니다.
- `pincon-class-ops-data.js`: Firestore 변경 알림을 16ms 단위로 합치고 공개 캐시 저장은 750ms 단위로 합칩니다. 비공개 관리자 데이터는 공개 캐시에 넣지 않습니다.
- 탐색 메뉴는 기본 HTML 버튼을 사용하고 입력·목록·대화상자는 기존 Material Web 컴포넌트를 사용합니다.
- 단색 표면과 시스템 글꼴을 기본으로 사용하며 외부 아이콘 글꼴은 앱 시작을 막지 않도록 비동기로 적용합니다. 라이트/다크 모드는 유지하며 지속적인 배경 효과와 광원 조절 패널은 제거했습니다.
- 서비스 워커는 현재 화면을 오프라인에서 여는 데 필요한 48개 파일만 4개씩 내려받습니다. 새 버전 설치 때는 브라우저의 예전 HTTP 캐시를 건너뛰고, 버전이 지정된 파일은 재사용하며 버전 없는 파일과 설정·문서는 재검증합니다.

## 유지하는 별도 서비스

`hanja/`, `voca/`, `word-master-glass-recall/`, `sidedesk/`는 별도 학습 앱입니다. 메인 PinCon에서 연결되지 않는 구버전 셸, 중복 관리자 모듈, Flow/버튼 시안과 누적 스타일 파일은 삭제했습니다. 삭제 이력은 Git에서 확인할 수 있습니다.

## 로컬 확인

```bash
python3 -m http.server 4173
node --test tests/*.test.mjs
node --test next/tests/contracts.test.mjs next/tests/student-auth-contract.test.mjs
npm install --no-save @playwright/test@1.55.0
npx playwright install chromium webkit
npx playwright test next/tests/boot.spec.mjs next/tests/performance.spec.mjs next/tests/render-stability.spec.mjs --browser=chromium
```

자동 테스트의 로컬 읽기 모드는 운영 Firestore를 수정하지 않습니다. 실제 계정 화면은 로컬 주소에 `?auth=1`을 붙여 확인합니다. GitHub Actions의 PinCon Next contracts에서 보안 계약, Chromium/WebKit, 모바일·태블릿·데스크톱 화면과 렌더링 안정성을 검사합니다.

## 운영

Firebase 공개 웹 설정은 `firebase-config.js`에 있고 실제 권한은 `firestore.rules`와 `storage.rules`에서 검사합니다. 학생 계정·관리 API는 `integrations/pincon-ai/`에 있습니다. 비밀키와 서비스 계정은 프런트엔드에 넣지 않습니다.

NEIS/FCM 동기화는 `automation/`과 관련 GitHub Actions를 사용합니다. 알림 빈도 실험의 조건 배정·발송·수신·응답·설문은 기존 흐름을 유지하며 `docs/NOTIFICATION_EXPERIMENT.md`와 `docs/EXPERIMENT_PLATFORM.md`를 참고합니다.

성능 검증은 로컬 데이터로 UI 처리 시간을 확인합니다. 실제 기기의 성능, 운영 네트워크와 Firestore 응답 속도는 별도로 확인해야 합니다.
