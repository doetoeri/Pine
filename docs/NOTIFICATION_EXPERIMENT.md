# Notification Frequency Experiment

## 연구 질문

PinCon의 비필수 알림 빈도가 사용 행동과 알림 피로도에 어떤 영향을 주는지 측정한다.

Experiment ID: `notification-frequency`

조건:

- LOW
- MID
- HIGH

기본 빈도 상한:

- LOW: 하루 약 1회
- MID: 하루 약 3회
- HIGH: 하루 약 4회

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

## 설문

각 Period 종료 시 다음 5점 문항을 제공한다.

1. 알림이 유용했다.
2. 알림이 너무 많다고 느꼈다.
3. 알림 때문에 PinCon을 더 자주 확인했다.
4. 이 정도의 알림을 계속 받고 싶다.

추가 문항:

- 적절한 하루 알림 수: 0 / 1 / 2 / 3 / 4 / 5+

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

## 알려진 제한

- OS 수준 delivery receipt는 Web Push만으로 완전하게 확인할 수 없다.
- 여러 기기에 동일 계정 push subscription이 존재하면 기기 수 기준 중복 발송 가능성을 운영 데이터에서 확인해야 한다.
- 실험 시작 전에 각 참여자의 ownerUid가 연결된 push subscription이 정상인지 확인해야 한다.
