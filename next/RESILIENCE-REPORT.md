# PinCon Next 안정화 작업 보고

## 변경한 구조

- 메인 앱 시작을 `accountReady`에서 분리했다. 인증 장애·응답 지연에도 공개 학교 정보와 앱 shell을 표시하고, 개인 정보·작성·관리자 기능은 인증 상태로 제한한다.
- 데이터 경로에 공개 컬렉션 allowlist, 토요 휴업일 필터, 일정 충돌 계산을 적용했다. Firebase SDK가 실패하면 기존 Firestore 규칙으로 허용된 공개 컬렉션만 비인증 REST로 조회한다.
- 내비게이션과 dialog 요소를 유지하고 본문을 갱신한다. 상세창 종료 시 원래의 보이는 버튼으로 포커스를 돌려주고 스크롤 위치를 유지한다.
- `/next/index.html`을 navigation fallback으로 사용한다. 필수 모듈·Material bundle·manifest·아이콘·로컬 글꼴 191개 경로를 생성된 precache 목록으로 관리한다. HTML/config는 Network First, shell/버전 자산과 이미지는 Cache First를 사용한다.
- 개인 완료·변경사항 읽음 상태는 사용자 UID와 학급별로 분리된 이 기기의 저장소에 보관한다. 관리자에게 전송하지 않는다. 로그아웃·사용자 전환 시 개인 데이터 표시를 초기화한다.

## 삭제한 임시 보정 코드

`ui-regression-fixes.js`, `route-focus-stability.js`, `dialog-focus-stability.js`, `detail-history-stability.js`를 삭제했다. 화면 전체를 감시해 상태 칩이나 행을 삭제하고 inert를 해제하던 처리는 원래 데이터·렌더·dialog lifecycle에 반영했다. Today 공유 기능의 DOM 감시도 앱 렌더 이벤트로 교체했다.

## 새 기능

- 다음 교시: 기존 시간표와 교실 변경·준비물을 합성한다. 교시 시각이 있으면 15초마다 전환하며, 시각이 없으면 등록되지 않았음을 표시한다.
- 지난 방문 이후 변경사항: 저장된 시각 이후의 변경을 계산한다. 사용자가 목록의 읽음 버튼을 눌렀을 때 읽음 시각을 저장한다.
- 오늘 할 일: 수행평가·준비물·기존 개인 학급 운영 데이터를 통합하고 본인만 완료 체크한다.
- 출처·확인 시각과 서로 다른 날짜·교실·준비물 값의 충돌 표시. 명시적 연결 또는 동일 과목·제목으로 비교한다.
- 알림: 여섯 범주별 설정, 아침 브리핑 하루 한 번, 긴급/당일 수업 변경 즉시 알림 분리.
- 사진 공지: 기존 OCR API → 수정 가능한 필드 → 관리자 전용 `noticeDrafts` 저장 → 사람이 게시. 게시 시 초안 상태를 해제한다. 다른 학급 관리자의 초안 이동·조회는 보안 규칙에서 거부한다.

## 수정 파일

| 파일 | 주요 변경 |
|---|---|
| `app-bootstrap.js`, `simple-account-gate.js`, `core/auth/errors.js`, `core/student-auth.js` | 인증 독립 부팅, 열람 모드, 오류 분류·시간 제한 |
| `pincon-class-ops-data.js`, `pincon-class-ops-core.js`, `core/data-gateway.js`, `core/data/public-school.js` | 공개 캐시·조회, 인증 상태 전환, 데이터 정규화 |
| `app.js`, `app-interactions.js`, `app.css`, `index.html`, `today-changes.js` | 홈 카드, 안정적인 dialog·navigation·포커스, 로컬 글꼴 |
| `core/domain/daily-priority.js`, `core/data/personal-state.js` | 변화·다음 교시·할 일·충돌 도메인, 개인 저장 |
| `student-ops.js`, `personal-notification-filter.js` | 기존 운영 정보 연결, 사용자 전환 시 개인정보 초기화 |
| `sw.js`, `registerSW.js`, `precache-manifest.js`, `automation/build-next-precache.mjs` | Next offline shell, 원자적 캐시, 의존 파일 목록 생성 |
| `assets/material-symbols-rounded.woff`, `assets/material-symbols-LICENSE.txt` | 외부 글꼴 실패 시 버튼 겹침 방지, Apache 2.0 라이선스 |
| `core/domain/notification-policy.js`, `automation/class-ops-notifications.mjs`, `automation/neis-sync.mjs` | 브리핑·즉시 알림 분류, 개인 범주 설정 적용 |
| `admin/content-editor-v2.js`, `admin/content-service-v2.js`, `core/data/notice-ocr.js`, `core/domain/notice-draft.js`, `firestore.rules` | OCR 검토·초안·게시 및 서버 권한 보호 |
| `tests/*`, `.github/workflows/next-contracts.yml` | 계약·보안·로그인·반응형·오프라인·자동 교시 전환 회귀 테스트 |

경로는 별도 표시가 없으면 `next/` 기준이다. 기존 main의 오프라인 개선과 Today 변경 요약 공유 기능도 병합하여 보존했다.

## 테스트 결과

- Node 단위·계약 테스트: **79/79 통과**. 변경 계산, 충돌, 로그인 오류, 평가계획서, 결석자 복귀팩, 권한 계약 포함.
- Firestore emulator: **13/13 통과**. 권한 우회·학생 RBAC·관리자 전용 초안 격리 검증. 로컬 Java 17과 호환되는 Firebase CLI 13.35.1 사용; CI는 Java 21 사용.
- Chromium 전체 기존·추가 브라우저 테스트: **50/50 통과**.
- 이후 추가한 다음 교시 자동 전환과 개인 체크·정상 로그인 재검증: **3/3 통과**. 중복 제외 총 51개 브라우저 시나리오.
- 280×700, 320×700, 360×800, 390×844, 768×1024, 1024×768, 1366×768에서 탭·검색·알림·상세창·가로 넘침 검증.
- 인증 SDK 실패 상태의 공개 조회, 실제 Service Worker 등록·offline reload·navigation·온라인 복구 검증.
- 로그인 성공/PIN/API/Firebase/네트워크/지연은 격리된 테스트 응답으로 검증했다. 실제 학생 계정을 사용하지 않았다.
- 생성된 precache 경로 191개와 `git diff --check` 확인.

## 남아 있는 문제

- WebKit은 이 실행 환경의 시스템 라이브러리 부족으로 로컬 실행하지 못했다. CI에 WebKit 전용 회귀 실행을 추가했으며 결과 확인 전 통과로 간주하지 않는다.
- 실제 기기의 설치 UX, 실계정 로그인, 실제 OCR 인식 품질·FCM 수신은 아직 검증하지 않았다. Lighthouse 목표 점수도 측정 전이다.
- 교시 시작·종료 시각이 없는 학교 데이터에서는 정확한 카운트다운을 만들 수 없다. 방과후 별도 상태는 방과후 원본 시간 데이터 연결이 추가로 필요하다.
- 개인 완료와 lastSeen은 기기별 저장이며 기기 간 동기화하지 않는다.
- 충돌 비교는 연결 ID 또는 과목·제목의 정확한 일치에 한정한다. 표현이 다른 동일 항목의 의미 기반 중복 판정은 하지 않는다.
- 현재 아침 브리핑에는 과목·학교 공지를 연결했으며 개인 청소 배정을 푸시에 포함하는 연결은 남아 있다. 홈의 개인 청소·역할 체크는 기존 데이터를 사용한다.

## 회귀 위험

인증 상태 변경, 기존 root 범위 Service Worker 교체, 관리자 OCR 초안 게시, 실제 알림 스케줄이 주요 영향 범위다. 공개 캐시에는 비공개 평가계획서·개인 데이터가 포함되지 않으므로 해당 정보의 오프라인 표시 범위는 인증·기존 Firestore 캐시에 따른다. 초기 precache에는 한국어 글꼴이 포함되어 설치 다운로드가 증가한다. 운영 병합 전 WebKit 및 실제 기기·서비스 연결 확인이 필요하다.

## PR 게시 후 최신 main 통합

PR #80의 읽기 전용 권한 차단과 학급 캐시 검증 유틸리티·테스트를 보존했다. 앱 부팅은 인증 독립 경로를 유지하며 중복 배너는 로드하지 않는다. 기존 배너 모듈의 DOM 감시는 렌더 이벤트로 교체했다.
