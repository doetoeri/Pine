# Notification Frequency Experiment

## 연구 질문

PinCon의 비필수 알림 빈도가 사용 행동과 알림 피로도에 어떤 영향을 주는지 측정한다.

Experiment ID: `notification-frequency`

조건:

- LOW
- MID
- HIGH

기본 빈도 상한:

- LOW: 하루 0회
- MID: 하루 최대 1회
- HIGH: 하루 최대 3회

값은 experiment config에서 변경할 수 있다.

## 실행 전 조건

UI 실험과 동시에 실행하지 않는다.

Firestore Rules와 서버 dispatcher 모두 다음을 확인한다.

- `pincon-next-ui.status == COMPLETED`
- `pincon-next-ui.promotedVariant == next`

조건이 맞지 않으면 알림 실험 ACTIVE 전환 또는 실험 알림 발송을 거부한다.

## Crossover

6개 순서를 deterministic하게 배정한다.

```text
LOW  -> MID  -> HIGH
MID  -> HIGH -> LOW
HIGH -> LOW  -> MID
LOW  -> HIGH -> MID
HIGH -> MID  -> LOW
MID  -> LOW  -> HIGH
```

기본 기간:

- Baseline: 2일
- Period 1: 4일
- Period 2: 4일
- Period 3: 4일

`baselineDays`, `periodDays`, `startDate`는 config에서 변경할 수 있다.

## 자동 실행

알림 실험 dispatcher는 **학교 급식/시간표 동기화와 분리된** GitHub Actions `.github/workflows/notification-frequency.yml`에서 30분 간격으로 실행된다. 학교 동기화가 실패해도 실험 dispatcher는 독립적으로 실행된다. 현재 KST 슬롯이 실험 대상인지 확인한 뒤 참가자별 조건과 그날의 발송 계획을 결정한다.

따라서 실험 설정이 `ACTIVE`이고 `notification_experiment` flag가 켜져 있으며 UI 실험 종료 조건을 만족하면, 운영자가 매 알림을 직접 보내지 않아도 LOW/MID/HIGH 조건에 따라 자동으로 발송·기록된다. **자동 등록은 활성 계정 전체의 교차 조건 사전배정**을 뜻하며, 푸시 발송은 OS 권한이 허용되고 유효한 FCM 구독이 있는 계정에 한정된다. 참여 동의는 사전에 확보됐다고 가정하지만 브라우저 권한은 별도다.

## 알림 후보

실험 dispatcher는 실제 PinCon 데이터에서 후보를 만든다.

- classAssignments
- events
- announcements

메타데이터:

- notificationId
- experimentId
- experimentVersion
- period
- condition
- category
- priority
- experimentEligible
- targetRoute
- createdAtMs
- scheduledAtMs

## 알림 문구와 시간대

| 한국 시간 | 유형 | 새 콘텐츠가 없을 때 사용하는 중립적 확인 메시지 |
| --- | --- | --- |
| 08:00 | 하루 공지 | 오늘의 학급 일정과 공지를 확인해 보세요. |
| 13:00 | 일정 | 남은 학급 일정과 변경 사항을 확인해 보세요. |
| 17:00 | 수행평가 | 예정된 수행평가와 제출 기한을 확인해 보세요. |
| 19:00 | 준비물 | 학급 준비물과 학습 자료를 확인해 보세요. |

새로 공개된 공지/행사/과제 중 해당 시간대에 맞는 항목이 있으면 실제 제목과 내용을 우선한다.
데이터가 없는 날짜에도 거짓으로 새 소식이 있다고 말하지 않는 중립적 확인 메시지로 노출 횟수를 유지한다.

## 참여자 범위와 수신 거부

서버는 `schools/gochon-high/users`에서 `status=ACTIVE`인 모든 계정을 스캔해 익명 참가자 ID와 교차 순서를 미리 등록한다. 기존에 한 번도 로그인하지 않았어도 배정된다.
발송할 때는 활성 계정의 `classKey`와 구독 문서의 `classKey`가 같은지 재검증한다.
구독 `preferences.notificationExperiment=false`가 어느 기기에든 기록된 계정은 **모든 기기에서 실험 알림을 제외**한다.
참가자는 `/experiments/`의 **연구 알림 수신** 메뉴에서 계정 단위로 언제든 중지하거나 다시 허용할 수 있다. 이 값은 `notificationExperimentPreferences/{uid}`에 사용자 본인만 쓰기 가능하며 서버가 발송 직전에 재확인한다.
`enabled=false` 또는 OS 푸시 허용이 없는 계정에는 실험 알림이 발송되지 않는다.
실험을 중단하면 관리자 `Pause`로 `ACTIVE` 상태와 발송 flag를 해제한다. 예기치 못한 중복 실행 방지를 위해 Firestore 트랜잭션으로 발송 receipt를 먼저 선점한다.
Firebase FCM 수락 이후 DB 기록 실패가 발생한 발송은 자동 재발송하지 않고 수동 확인 대상으로 남긴다.

## Critical 제외

urgent/critical 공지와 기존 중대한 시간표 변경 알림은 frequency budget에 포함하지 않는다.

Notification experiment가 ACTIVE일 때 기존 morning/evening 비필수 알림은 중복을 막기 위해 frequency dispatcher가 대신 담당한다.

## 측정 가능한 상태

구분을 엄격하게 유지한다.

- notification_scheduled: 서버가 실험 알림을 예약/선정
- notification_sent: FCM API가 발송을 수락
- notification_received: Service Worker가 background message를 받고 열린 PinCon client에 전달 가능한 경우
- notification_click: 사용자가 알림을 실제 열었음

Web Push 특성상 `notification_sent`를 실제 단말 표시 성공으로 해석하지 않는다.

## 행동 지표

- click rate
- 5분 내 app open
- 30분 내 app open
- 1시간 내 app open
- target view after notification
- DAU/Return Rate

FCM click URL에 notificationId/condition/period/category/targetRoute/sentAt을 넣어 앱 진입 후 attribution한다.

## 알림별 Required Response

실험 알림을 실제로 열면 URL attribution을 지우기 전에 `notificationId`, 조건, Period, 카테고리, target route를 pending response로 저장한다.

PinCon 진입 후 다음 세 선택지 중 하나를 반드시 Response하도록 modal을 표시한다.

- 필요했어요 · 이 알림이 도움이 됐어요
- 보통이에요 · 있어도 없어도 괜찮아요
- 불필요했어요 · 알림이 없어도 됐어요

ESC로 닫거나 건너뛰는 선택지는 제공하지 않는다. 응답은 기존 분석 계약 안에서 `ui_satisfaction` 이벤트에 `source=notification_response`, `value=notification_response:*`로 기록하여 원래 `notification_click` 지표를 중복 집계하지 않는다.

이 의무 Response는 **사용자가 실험 알림을 연 경우**에 적용한다. 알림을 열지 않은 사용자의 응답까지 웹에서 강제로 만들 수는 없으며, 그 경우에는 수신·클릭 여부 자체가 행동 데이터가 된다.

## Period 종료 설문

각 Period 종료 시 다음 5점 문항을 제공한다.

1. 알림이 유용했다.
2. 알림이 너무 많다고 느꼈다.
3. 알림 때문에 PinCon을 더 자주 확인했다.
4. 이 정도의 알림을 계속 받고 싶다.

추가 문항:

- 적절한 하루 알림 수: 0 / 1 / 2 / 3 / 4 / 5+

모든 문항은 기본값 없이 선택해야 하며 `나중에` 버튼을 두지 않는다. Period 경계가 지난 뒤 처음 앱을 열어도 이전 Period의 미응답 설문을 먼저 복구해 표시한다.

응답은 anonymousParticipant와 period/condition에 연결한다.

## Export

운영센터 CSV는 participant-period 단위로 다음 열을 출력한다.

- anonymousParticipant
- period
- condition
- notificationCount
- clickRate
- open5mRate
- open30mRate
- open1hRate
- targetViewRate
- annoyanceScore
- usefulnessScore

JSON export도 제공한다.

## 향후 개인화

이번 실험 중 개인화는 적용하지 않는다.

후속 구조는 다음 프로필을 수용할 수 있다.

- Quiet
- Balanced
- Active

실험 종료 후 집계 결과를 바탕으로 기본 빈도를 결정하고, 별도 개인화 기능은 다음 단계에서 구현한다.

## 2026-09-19 알림 엔진 강화

실험 시작 전 다음 안전장치를 적용한다.

- **시간대 편향 제거**: LOW/MID/HIGH의 발송 슬롯을 참가자·날짜별로 결정적으로 회전시킨다. LOW가 항상 아침, HIGH가 항상 저녁을 받는 식의 시간대 혼선을 피한다.
- **하루 후보 중복 방지**: 같은 참가자에게 같은 후보 콘텐츠를 여러 슬롯에서 반복 발송하지 않는다. 후보가 예산보다 적으면 남는 슬롯은 발송하지 않는다.
- **대표 기기 1대**: 동일 계정의 여러 push subscription 중 가장 최근 갱신된 기기 1대를 실험용 대표 기기로 사용한다. 기기 수가 실험 노출 수를 부풀리지 않게 한다.
- **전송 재시도**: 일시적 FCM 실패는 같은 슬롯에서 최대 3회까지 재시도한다. 기존 receipt가 있다는 이유만으로 실패 발송을 영구 차단하지 않는다.
- **만료 토큰 정리**: invalid/registration-token-not-registered 응답은 해당 subscription을 즉시 제거한다.
- **수신 계측 보강**: Service Worker가 실험 push를 받으면 익명 receipt를 IndexedDB에 임시 저장한다. 열린 창이 없던 경우에도 다음 PinCon 실행에서 receipt를 flush하여 `notification_received`를 기록한다.
- **실제 전송 시각 기준 attribution**: 클릭 후 5분/30분/1시간 반응 시간은 예약 시각이 아니라 실제 FCM 전송 시도 시각을 기준으로 계산한다.
- **TTL**: 실험용 비필수 알림은 1시간 TTL을 사용하여 늦게 도착한 오래된 알림이 사용자를 방해하지 않게 한다.

발송 슬롯 기본값(KST, 09:10~13:00 1~4교시, 13:00~14:00 점심, 14:00~16:50 5~7교시 수업을 피하도록 설정):

- 08:00
- 13:00 (점심시간)
- 17:00 (7교시 종료 후)
- 19:00

GitHub Actions dispatcher는 30분 간격으로 실행되며 각 슬롯의 00~35분 구간만 처리한다. 동일 notificationId receipt에 대한 트랜잭션 선점으로 동시 중복 발송을 방지한다. FCM 수락 후 결과 기록 실패는 자동 재시도하지 않아 이중 발송 위험을 피한다.

## 알려진 제한

- OS 수준 delivery receipt는 Web Push만으로 완전하게 확인할 수 없다.
- 여러 기기에 동일 계정 push subscription이 존재하면 기기 수 기준 중복 발송 가능성을 운영 데이터에서 확인해야 한다.
- 실험 시작 전에 각 참여자의 ownerUid가 연결된 push subscription이 정상인지 확인해야 한다.

## 운영 검증

- `node --test tests/*.test.mjs` 및 `node --check automation/notification-frequency-experiment.mjs` 통과 확인
- 배포 뒤 Actions `Notification frequency dispatcher` 실행 로그에서 `rosterAccounts`, `preassigned`, `sent` 확인
- 실험 설정과 flag, Next UI 실험의 `COMPLETED / next` 선행조건 확인
- 반드시 실제 기기에서 Android/브라우저 푸시 권한 및 수신을 시험할 것. FCM accepted는 도착 증명이 아니다.


## 관리자 화면에서 누가 어떤 조건을 받았는지 확인하기

**운영센터:** `https://pincon.app/next/admin/` → 시스템 관리자 로그인 → **실험 · 통계** → **알림 빈도**

- `학생별 조건 및 반응`: 학생별 P1/P2/P3 교차 조건, 현재 또는 다음 실험일 조건, FCM 수락 건수, Service Worker 수신 기록, 알림 열기 기록
- `최근 알림 상세 기록`: 한국 시간, 대상 계정, 조건, 발송 상태, 제목/내용, 수신/열기 이벤트 (최근 최대 100개 표시)
- `CSV`: 기존 익명 참가자-기간 단위 연구 분석 결과 내보내기
- Firestore의 `notificationExperimentReceipts`는 최근 최대 1,200개를 읽으며 그 이전 기록과 이벤트가 더 많으면 화면에 집계되지 않을 수 있다.
- 배정은 **학생별 고정 LOW/MID/HIGH 그룹이 아니다**. P1→P2→P3에 걸쳐 순서대로 조건을 바꾸는 교차 설계다.
- 실험 이벤트는 익명 참가자 ID만 저장하고 실명·학번은 관리자 브라우저에서 별도 계정 명단과 대조한다. 이름별 결과는 연구 참가자에게 공개하거나 학급 단체 채팅에 배포하지 않는다.
- **FCM 수락**은 서버 수락이며 실제 기기 표시를 보장하지 않는다. **수신 기록**은 앱 서비스워커에서 추적 가능한 경우에만 생성되며, 기록이 없다고 미수신으로 단정할 수 없다. **알림 열기**도 알림을 눌러 PinCon에 들어왔다는 뜻이지 본문을 정독했다는 증거는 아니다.
- `title`/`body`는 이 기능 배포 이후 새로 생성되는 발송 기록부터 보관된다. 예전 기록에는 카테고리·후보 키만 존재할 수 있다.

