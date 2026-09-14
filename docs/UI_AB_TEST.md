# PinCon Next UI A/B Test

## 목적

현재 운영 중인 PinCon을 Variant A로 유지하고 Quiet Flux / Living Spine 디자인을 실제 PinCon 데이터에 연결한 Variant B와 비교한다.

- Variant A: `legacy`
- Variant B: `next`
- Experiment ID: `pincon-next-ui`

## Variant B

`next/experiments/pincon-next-ui.js`와 CSS가 기존 `NextDataGateway`를 사용한다.

연결 데이터:

- 시간표
- 준비물
- 수행·숙제
- 학사일정
- 공지
- 학급 자료
- 급식
- 사용자/권한 상태

디자인 원칙:

- 카드 더미 대신 Living Spine
- 현재 시간에 가까운 정보 강조
- 지나간 수업 축소
- 준비물 Attach
- 가까운 수행/일정 Approach
- 같은 맥락에서 detail 확장
- 하단 drag-select navigation
- prefers-reduced-motion
- 모바일/태블릿/Chromebook/PC 대응

## Canary

1. 운영센터에서 UI 실험 설정을 생성한다.
2. 5~7명의 UID를 Canary target으로 지정한다.
3. 상태를 CANARY로 변경한다.
4. 나머지 사용자는 `stableVariant=legacy`를 유지한다.

검증 대상:

- 로그인
- 시간표
- 급식
- 수행평가/준비물
- 공지/자료
- PWA
- FCM
- navigation
- JS error
- permission error
- cache/update

## A/B 시작

Canary 검증 뒤 운영센터에서 필요하면 **34명 균형 사전배정**을 먼저 실행한다.

그 뒤 상태를 ACTIVE로 변경하고 `allocation.nextPercent=50`을 사용한다.

Sticky Assignment 때문에 같은 experimentVersion 동안 Variant가 임의 변경되지 않는다.

## 핵심 지표

- DAU
- Sessions
- 핵심 정보 도달률
- 주요 작업 성공률
- Time to Information
- Return Rate
- UI 만족도

Task instrumentation:

```text
task_start
  -> target_information_view
```

대상 task:

- schedule
- assignment
- material
- notice

## Guardrail

- js_error
- data_load_failure
- login_failure
- fcm_failure
- navigation_error
- page_load

신 UI가 더 많이 사용되더라도 guardrail이 악화되면 승격하지 않는다.

## 특정 사용자 복귀

운영센터에서 target mode를 `force_legacy`로 지정한다.

사용자 UI에는 Variant 선택 스위치를 제공하지 않는다.

## Rollout

Next 승격 결정 후:

```text
25% -> 50% -> 75% -> 100%
```

`ROLLOUT` 상태와 deterministic rollout bucket을 사용한다. 이미 낮은 rollout 단계에서 Next였던 사용자가 높은 단계에서 다시 Legacy로 돌아가지 않도록 threshold 방식으로 계산한다.

## Rollback

운영센터 Rollback은:

- UI experiment -> PAUSED
- stableVariant -> legacy
- promotedVariant -> legacy
- rolloutPercent -> 0
- `pincon_next_ui.enabled=false`

로 변경한다.

코드 재배포는 필요하지 않다.

## 종료

Next 승격:

- status = COMPLETED
- stableVariant = next
- promotedVariant = next
- rolloutPercent = 100

Legacy 유지:

- status = COMPLETED
- stableVariant = legacy
- promotedVariant = legacy

Notification Frequency Experiment는 Next가 승격된 COMPLETED 상태 이후에만 시작할 수 있다.
