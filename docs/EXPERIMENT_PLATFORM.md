# PinCon Experiment Platform

## 목적

PinCon의 기능을 바로 전면 배포하지 않고 **Canary → A/B Test → Rollout → Rollback → Completed** 흐름으로 운영하기 위한 공통 실험 계층이다.

현재 첫 실험은 `pincon-next-ui`, 두 번째 실험은 `notification-frequency`다. 두 실험은 동시에 실행하지 않는다.

## 아키텍처

브라우저 공통 계층:

- `next/experiment/constants.js`: 상태, 실험 ID, 이벤트 allowlist
- `next/experiment/assignment-service.js`: deterministic bucket, Sticky Assignment, crossover
- `next/experiment/analytics.js`: 비차단 이벤트 큐와 재전송
- `next/experiment/experiment-service.js`: Firestore config/assignment/admin API
- `next/experiment/bootstrap.js`: 앱 진입 시 실험 초기화와 guardrail 계측

관리자:

- `next/admin/experiments.js`
- `next/admin/experiments.css`

PWA/FCM:

- `sw.js`
- `firebase-messaging-sw.js`

## Firestore 구조

```text
schools/{schoolId}/
  experiments/{experimentId}
    assignments/{uid}
    targets/{uid}
    participants/{uid}/surveyResponses/{period}
  experimentFlags/{flagId}
  experimentParticipants/{uid}
  experimentEvents/{eventId}
  experimentNotifications/{notificationId}
  notificationExperimentReceipts/{notificationId}
```

`experimentParticipants/{uid}`는 인증된 계정과 익명 분석 ID를 연결한다. 분석 이벤트에는 UID, 이름, 학번, 이메일을 저장하지 않는다.

## 실험 상태

지원 상태:

- DRAFT
- CANARY
- ACTIVE
- PAUSED
- ROLLOUT
- COMPLETED
- ABORTED

일반 흐름:

```text
DRAFT -> CANARY -> ACTIVE -> ROLLOUT -> COMPLETED
                  |          |
                  +-> PAUSED <-+
```

## Variant 배정

UI A/B는 `hash(uid + experimentId + version)` 기반 deterministic bucket을 사용한다.

ACTIVE에서 최초 배정이 생성되면 Firestore의 assignment를 우선하는 Sticky Assignment가 된다. 실험 version이 바뀌기 전에는 브라우저를 바꿔도 같은 Variant를 사용한다.

한 학급처럼 모집단이 작을 때는 운영센터의 균형 사전배정 기능으로 현재 분석 participant 집합을 Legacy/Next에 최대한 균형 있게 나눌 수 있다.

## Feature Flag

현재 flag:

- `pincon_next_ui`
- `notification_experiment`

주요 필드:

- enabled
- rolloutPercent
- experimentId
- stableVariant
- updatedAtMs
- updatedBy

설정은 코드 재배포 없이 Firestore에서 변경된다.

## Analytics

공통 필드:

- anonymousParticipant
- experimentId
- experimentVersion
- variant
- eventType
- timestampMs
- sessionId
- deviceCategory
- properties

브라우저 이벤트는 localStorage 큐에 잠시 저장하고 온라인 복귀 시 최대 25개씩 batch upload한다. 동일 eventId 재시도는 내용이 완전히 같은 경우에만 Firestore Rules가 허용한다.

수집하지 않는 항목:

- 메시지 내용
- 입력한 개인 텍스트
- 이름/학번/이메일
- 위치
- 다른 앱 사용 기록
- 불필요한 기기 식별 정보

## Security Rules

`firestore.rules`가 다음을 강제한다.

- 실험 config/flag/target 수정: school admin only
- 일반 사용자는 자신의 participant/최초 assignment만 생성 가능
- raw experimentEvents 조회: school admin only
- analytics event schema/property allowlist
- notification experiment ACTIVE는 UI 실험이 Next 승격으로 COMPLETED여야 함
- notification experiment 실행 중 UI 실험 재활성화 차단

## 실패 안전성

Experiment Platform 초기화나 Next Variant import가 실패하면 `legacy`가 Stable UI로 남는다.

실험 코드가 실패해도 기존 `next/app.js`는 먼저 로드된다.

## PWA / Offline

Service Worker 버전은 Experiment Platform 배포 시 갱신한다. Experiment Platform JS/CSS를 shell cache에 포함한다.

Analytics 전송 실패는 무한 동기 재시도하지 않고 local queue에 유지한다.

## 관리자 사용법

운영센터의 Experiment Platform 섹션에서 다음 작업을 수행한다.

- DRAFT config 생성
- Canary 지정
- 50:50 A/B 시작
- 25/50/75/100 rollout
- 특정 UID 강제 Legacy
- Pause
- Rollback
- Completed 승격
- 집계 지표 확인
- CSV/JSON export

위험 작업에는 확인 대화상자를 둔다.

## 알려진 제한

- Web Push에서는 FCM이 실제 OS 알림창에 표시됐는지 100% 확인할 수 없다.
- `notification_sent`는 FCM API 수락이며 device delivery와 동일하지 않다.
- 익명 participant는 사용자가 실험 플랫폼이 포함된 앱에 한 번 로그인한 뒤 생성된다.
- 운영센터 raw event 로딩은 성능 보호를 위해 최근 데이터에 상한이 있다.


## 공개 베타

UI 실험의 Canary 단계에서는 관리자가 `publicBetaEnabled=true`로 공개 베타를 열 수 있다.

- 사용자는 더보기에서 자발적으로 참여한다.
- enrollment는 `experiments/pincon-next-ui/betaEnrollments/{uid}`에 저장한다.
- 공개 베타 사용자는 Next UI를 사용하지만 analytics `cohort=public-beta`로 태그한다.
- 공개 베타 데이터는 정식 controlled A/B 지표에서 제외한다.
- ACTIVE 전환 시 공개 베타는 자동으로 닫힌다.
- 사용자는 Next UI의 ‘나’ 화면에서 기존 UI로 돌아갈 수 있다.

## 접속 전 사전배정

운영센터는 계정 API의 현재 학급 roster를 기준으로 UI Variant를 미리 생성한다.

- 학생이 PinCon을 열지 않았어도 UID가 존재하면 assignment 생성 가능
- 아직 experimentParticipant가 없다면 assignment의 anonymousParticipant는 빈 문자열
- 실제 분석 이벤트는 최초 접속 후 익명 participant가 생성된 다음부터 기록
- 운영센터에서 Assigned Users와 Activated Users를 분리해서 표시
- ACTIVE/ROLLOUT/COMPLETED 상태에서는 재균형 배정을 금지해 Sticky Assignment를 보존
