# PinCon AI Gateway

PinCon 데이터를 ChatGPT, Gemini 및 기타 MCP/Function Calling 클라이언트가 안전하게 읽을 수 있도록 제공하는 독립 서버 패키지입니다.

현재 단계는 **읽기 전용 v0.1**입니다. Firebase Admin을 사용하므로 프런트엔드 Firestore 규칙을 우회하지만, 모든 HTTP/MCP 요청은 `PINCON_API_KEY` Bearer 인증을 통과해야 하며 응답에서는 UID·이메일·토큰·작성자 식별 필드를 제거합니다.

## 제공 REST API

모든 요청에 다음 헤더가 필요합니다.

```http
Authorization: Bearer <PINCON_API_KEY>
```

- `GET /api/v1/today?classKey=1-8&date=2026-08-21`
- `GET /api/v1/timetable?classKey=1-8&date=2026-08-21`
- `GET /api/v1/meals?date=2026-08-21`
- `GET /api/v1/assignments?classKey=1-8&startDate=2026-08-21&endDate=2026-08-28`
- `GET /api/v1/notices?classKey=1-8&limit=20`
- `GET /api/v1/events?classKey=1-8&startDate=2026-08-21&endDate=2026-08-28`
- `GET /api/v1/upcoming?classKey=1-8&date=2026-08-21&days=7`

날짜를 생략하면 Asia/Seoul 기준 오늘 날짜를 사용합니다.

## MCP

MCP 엔드포인트는 다음입니다.

```text
POST /api/mcp
```

제공 도구:

- `get_today`
- `get_timetable`
- `get_meal`
- `get_assignments`
- `get_notices`
- `get_school_events`
- `get_upcoming`

MCP 서버는 `@modelcontextprotocol/server` v2의 `createMcpHandler`를 사용하고, Node 런타임에서는 `@modelcontextprotocol/node`의 `toNodeHandler`로 연결합니다.

## 환경 변수

Vercel 프로젝트의 Root Directory를 이 폴더(`integrations/pincon-ai`)로 지정하고 다음 환경 변수를 등록합니다.

```text
FIREBASE_SERVICE_ACCOUNT_JSON=<Firebase service account JSON 전체>
PINCON_API_KEY=<충분히 긴 임의의 비밀 문자열>
PINCON_SCHOOL_ID=gochon-high
```

`FIREBASE_SERVICE_ACCOUNT_JSON`과 `PINCON_API_KEY`는 저장소나 프런트엔드에 커밋하지 않습니다.

## 배포 후 확인

```bash
curl -H "Authorization: Bearer $PINCON_API_KEY" \
  "https://<deployment>/api/v1/today?classKey=1-8"
```

MCP 클라이언트에는 `https://<deployment>/api/mcp`를 등록합니다.

## 다음 단계

1. OAuth 2.1 + PKCE 기반 사용자 인증
2. PinCon 계정의 학교/학년/반을 토큰과 연결해 `classKey` 자동 결정
3. 읽기 권한을 사용자·학급별로 제한
4. 쓰기 도구는 별도 권한 + 사용자 확인 + 변경 기록을 모두 갖춘 뒤 추가
5. `pincon.app/mcp` 또는 `ai.pincon.app/mcp` 같은 공식 주소로 연결
