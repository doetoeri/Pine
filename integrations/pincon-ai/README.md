# PinCon AI Gateway

PinCon 데이터를 ChatGPT, Codex, Gemini 및 기타 AI 클라이언트가 안전하게 읽을 수 있도록 제공하는 공용 AI 게이트웨이입니다.

현재 단계는 **읽기 전용 v0.3**입니다. 한 개의 PinCon 데이터 계층을 유지하고 플랫폼별로 얇은 어댑터만 둡니다.

## 권장 연결 순서

1. **Remote MCP + OAuth**를 우선 사용합니다.
2. 해당 AI 환경이 Remote MCP를 지원하지 않으면 **OpenAPI / Function Calling fallback**을 사용합니다.
3. 플랫폼마다 별도 PinCon 백엔드를 만들지 않습니다.

공용 주소:

```text
MCP: https://pincon-ai.vercel.app/api/mcp
OpenAPI: https://pincon-ai.vercel.app/openapi.json
OAuth protected resource: https://pincon-ai.vercel.app/.well-known/oauth-protected-resource
OAuth authorization server: https://pincon-ai.vercel.app/.well-known/oauth-authorization-server
```

## 인증 방식

### 1. 개발/운영 테스트용 서비스 키

```http
Authorization: Bearer <PINCON_API_KEY>
```

기존 REST 테스트와 자동화 호환을 위해 유지합니다. 공개 사용자에게 이 키를 공유하지 않습니다.

### 2. 공개 AI 플랫폼 연결용 OAuth 2.1

PinCon MCP는 Authorization Code + PKCE(S256), Dynamic Client Registration(DCR), 액세스 토큰 및 새로고침 토큰을 제공합니다.

- Protected Resource Metadata: `/.well-known/oauth-protected-resource`
- Authorization Server Metadata: `/.well-known/oauth-authorization-server`
- Authorization endpoint: `/oauth/authorize`
- Token endpoint: `/oauth/token`
- Dynamic registration: `/oauth/register`
- Scope: `pincon:read`

사용자는 OAuth 승인 화면에서 Google 계정으로 로그인하고 자신의 학년·반을 입력합니다. `1-8` 또는 `1학년 8반` 형식을 받아 내부에서는 `1-8`로 정규화합니다. 발급된 OAuth 연결은 그 반에 묶이며 다른 반의 `classKey` 요청은 거부합니다.

액세스 토큰과 새로고침 토큰은 원문을 Firestore 문서 키로 저장하지 않고 SHA-256 해시를 사용해 조회합니다. Authorization Code는 5분, Access Token은 1시간, Refresh Token은 30일을 기본 유효기간으로 사용합니다.

## 제공 REST API

서비스 키 또는 유효한 OAuth Bearer Token으로 호출합니다.

- `GET /api/v1/today?classKey=1-8&date=2026-08-22`
- `GET /api/v1/timetable?classKey=1-8&date=2026-08-22`
- `GET /api/v1/meals?date=2026-08-22`
- `GET /api/v1/assignments?classKey=1-8&startDate=2026-08-22&endDate=2026-08-29`
- `GET /api/v1/notices?classKey=1-8&limit=20`
- `GET /api/v1/events?classKey=1-8&startDate=2026-08-22&endDate=2026-08-29`
- `GET /api/v1/upcoming?classKey=1-8&date=2026-08-22&days=7`

날짜를 생략하면 Asia/Seoul 기준 오늘 날짜를 사용합니다.

## MCP

```text
https://pincon-ai.vercel.app/api/mcp
```

제공 도구:

- `get_today`
- `get_timetable`
- `get_meal`
- `get_assignments`
- `get_notices`
- `get_school_events`
- `get_upcoming`

MCP 도구는 모두 `readOnlyHint: true`로 표시하며 OAuth scope `pincon:read`를 선언합니다. OAuth 사용자 연결에서는 `classKey`가 선택 사항이고 서버가 연결된 반을 자동 적용합니다. 서비스 키 요청에서는 기존처럼 `classKey`를 명시해야 합니다.

## OpenAPI fallback

Remote MCP를 직접 연결할 수 없는 AI 환경을 위해 정적 OpenAPI 3.1 문서를 제공합니다.

```text
https://pincon-ai.vercel.app/openapi.json
```

OpenAPI는 별도 데이터 구현이 아니라 기존 `/api/v1/*` 읽기 전용 엔드포인트를 설명하는 어댑터입니다.

## 플랫폼 패키징

### ChatGPT / Codex

`plugins/pincon/`의 **PinCon Plugin**을 사용합니다. Plugin은 PinCon MCP 앱과 다음 Skills를 묶습니다.

- Daily Brief
- Weekly Planner
- Absence Recovery
- Schedule Change

자세한 내용: `platforms/chatgpt.md`

### Gemini

Gemini Interactions API의 Remote MCP 연결은 동일한 PinCon MCP URL을 사용합니다. Remote MCP를 사용할 수 없는 환경에서는 `openapi.json`을 Function Calling/HTTP tool fallback으로 사용합니다.

Gemini API 클라이언트에서 사용할 tool-use 지침은 `platforms/gemini-system-instruction.md`에 있습니다.

서버 측 개발 테스트 예제:

```bash
GEMINI_API_KEY=<gemini-api-key> \
PINCON_BEARER_TOKEN=<pincon-oauth-access-token> \
npm run test:gemini -- "오늘 뭐 있어?"
```

`PINCON_BEARER_TOKEN`에는 공개 사용자 연결에서는 OAuth access token을 사용합니다. `PINCON_API_KEY`를 대신 넣는 것은 비공개 개발 테스트에서만 허용합니다.

자세한 내용: `platforms/gemini.md`

### 기타 AI

기본 원칙은 동일합니다: **Remote MCP + OAuth 우선, OpenAPI fallback**.

전체 전략: `platforms/README.md`

## 호환성 Smoke Test

```bash
npm run test:compat
```

기본 검사는 OAuth discovery, OpenAPI 공개 여부, 인증 없는 MCP의 OAuth challenge를 확인합니다.

실제 PinCon 데이터와 인증된 MCP initialize까지 검사하려면:

```bash
PINCON_API_KEY=<development-key> \
PINCON_CLASS_KEY=1-8 \
npm run test:compat
```

Preview URL을 검사할 때는 `PINCON_ORIGIN`을 Preview 주소로 지정할 수 있습니다. OAuth metadata의 canonical MCP resource는 기본적으로 production `https://pincon-ai.vercel.app/api/mcp`를 기대하며, 필요하면 `PINCON_RESOURCE`로 바꿀 수 있습니다.

## Vercel 환경 변수

Vercel 프로젝트의 Root Directory를 이 폴더(`integrations/pincon-ai`)로 지정합니다.

필수:

```text
FIREBASE_SERVICE_ACCOUNT_JSON=<Firebase service account JSON 전체>
PINCON_API_KEY=<충분히 긴 임의의 비밀 문자열>
PINCON_SCHOOL_ID=gochon-high
```

권장:

```text
PINCON_PUBLIC_ORIGIN=https://pincon-ai.vercel.app
PINCON_ALLOWED_EMAIL_DOMAIN=<허용할 Google 계정 도메인, 선택 사항>
```

`PINCON_ALLOWED_EMAIL_DOMAIN`을 비워두면 개발 단계에서는 모든 Firebase Google 로그인 계정을 허용합니다. 여러 도메인은 쉼표로 구분합니다.

### Firebase 설정

Firebase Console의 Authentication → Settings → Authorized domains에 다음을 등록합니다.

```text
pincon-ai.vercel.app
```

## 공개 배포 전 남은 보안 작업

1. OAuth 연결 해제/토큰 폐기 UI 및 endpoint 추가
2. 학급 입력을 단순 자기입력에서 PinCon 계정/학교 정책과 검증하는 방식으로 확장
3. Firestore OAuth 토큰 문서에 TTL 정책 적용
4. rate limit과 이상 요청 모니터링 추가
5. 쓰기 도구는 별도 권한 + 사용자 확인 + 변경 기록을 모두 갖춘 뒤 추가
