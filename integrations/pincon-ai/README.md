# PinCon AI Gateway

PinCon 데이터를 ChatGPT, Codex, Gemini 및 기타 MCP/Function Calling 클라이언트가 안전하게 읽을 수 있도록 제공하는 독립 서버 패키지입니다.

현재 단계는 **읽기 전용 v0.2**입니다. Firebase Admin을 사용하므로 프런트엔드 Firestore 규칙을 우회하며, 서버가 모든 인증·학급 범위 제한을 직접 적용합니다.

## 인증 방식

두 가지 인증 경로를 지원합니다.

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

사용자는 OAuth 승인 화면에서 Google 계정으로 로그인하고 자신의 학년·반을 선택합니다. 발급된 OAuth 연결은 그 반에 묶이며, MCP 도구가 다른 반의 `classKey`를 요청하면 거부합니다.

액세스 토큰과 새로고침 토큰은 원문을 Firestore 문서 키로 저장하지 않고 SHA-256 해시를 사용해 조회합니다. Authorization Code는 5분, Access Token은 1시간, Refresh Token은 30일을 기본 유효기간으로 사용합니다.

## 제공 REST API

서비스 키 또는 유효한 OAuth Bearer Token으로 호출합니다.

- `GET /api/v1/today?classKey=1-8&date=2026-08-21`
- `GET /api/v1/timetable?classKey=1-8&date=2026-08-21`
- `GET /api/v1/meals?date=2026-08-21`
- `GET /api/v1/assignments?classKey=1-8&startDate=2026-08-21&endDate=2026-08-28`
- `GET /api/v1/notices?classKey=1-8&limit=20`
- `GET /api/v1/events?classKey=1-8&startDate=2026-08-21&endDate=2026-08-28`
- `GET /api/v1/upcoming?classKey=1-8&date=2026-08-21&days=7`

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

`PINCON_ALLOWED_EMAIL_DOMAIN`을 비워두면 개발 단계에서는 모든 Firebase Google 로그인 계정을 허용합니다. 여러 도메인은 쉼표로 구분합니다. 공개 배포 전에는 실제 학교 계정 정책이나 승인 사용자 목록으로 교체하는 것이 좋습니다.

### Firebase에서 추가할 설정

Firebase Console의 Authentication → Settings → Authorized domains에 OAuth 승인 화면이 호스팅되는 도메인을 등록합니다.

```text
pincon-ai.vercel.app
```

커스텀 도메인을 사용할 경우 그 도메인도 추가합니다.

## 개발용 REST 확인

```bash
curl -H "Authorization: Bearer $PINCON_API_KEY" \
  "https://pincon-ai.vercel.app/api/v1/today?classKey=1-8"
```

## ChatGPT / Codex 플러그인

저장소의 `plugins/pincon/`에는 PinCon Plugin manifest와 다음 Skills가 있습니다.

- Daily Brief
- Weekly Planner
- Absence Recovery
- Schedule Change

공개 제출 시 MCP 서버 URL로 `https://pincon-ai.vercel.app/api/mcp`를 사용합니다. ChatGPT Developer Mode에서 로컬 플러그인을 시험하는 경우 먼저 MCP 연결을 등록하고 생성된 `plugin_asdk_app...` 기술 ID를 `.app.json`에 연결해야 합니다.

## 공개 배포 전 남은 보안 작업

1. OAuth 연결 해제/토큰 폐기 UI 및 endpoint 추가
2. 학급 선택을 단순 자기선택이 아니라 PinCon 계정/학교 정책과 검증해 연결
3. Firestore OAuth 토큰 문서에 TTL 정책 적용
4. rate limit과 이상 요청 모니터링 추가
5. 쓰기 도구는 별도 권한 + 사용자 확인 + 변경 기록을 모두 갖춘 뒤 추가
