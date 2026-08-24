# PinCon 문제은행 AI 작성 규약

AI가 문제를 추가할 때는 `next/data/problem-bank.schema.json`을 기준으로 `next/data/problem-bank.json`의 `problems` 배열에 항목을 추가합니다.

## 원칙

- 기존 문제를 삭제하거나 ID를 바꾸지 않습니다.
- `id`는 `pb-YYYYMMDD-과목영문-번호` 형태의 고유 ID를 사용합니다.
- 새 AI 생성 문제는 먼저 `status: "draft"`로 추가합니다.
- 검토가 끝난 문제만 `status: "published"`로 변경합니다.
- AI 생성 문제는 `source.kind: "ai-generated"`로 표시합니다.
- 교재·문제집의 문항을 그대로 복제하지 않습니다. 직접 만든 문제, 교사 승인 문제, 공개 라이선스 자료만 사용합니다.
- 객관식 정답은 `choices` 안의 항목과 정확히 일치하게 작성합니다.
- 해설은 정답의 근거를 짧고 검증 가능하게 적습니다.

## AI에게 바로 줄 프롬프트

다음 JSON Schema에 맞는 PinCon 문제를 만들어라: `next/data/problem-bank.schema.json`.
대상 학급은 1-8이다. 기존 문제와 겹치지 않게 작성하고, 새 문제는 모두 `status`를 `draft`, `source.kind`를 `ai-generated`로 설정하라. 객관식은 선택지 4개를 권장하고 정답 문자열은 선택지 중 하나와 정확히 일치시켜라. 저작권이 있는 문제집 문장을 복제하지 말고 새 문항을 작성하라. 출력은 설명 없이 추가할 `problems` JSON 배열만 반환하라.

## 검토 체크

1. 정답이 실제로 맞는가
2. 질문만으로 풀이 조건이 충분한가
3. 난이도 표기가 적절한가
4. 해설이 정답과 모순되지 않는가
5. 저작권 있는 원문을 그대로 베끼지 않았는가
6. 검토 후에만 `published`로 바꿨는가
