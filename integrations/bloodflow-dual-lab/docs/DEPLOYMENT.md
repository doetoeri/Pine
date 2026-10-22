> 이 문서는 1.0 배포 조사 기록입니다. 현재 2.0 전국 확장 배포는 [DEPLOYMENT_NATIONWIDE.md](DEPLOYMENT_NATIONWIDE.md)를 따르세요.

# PinCon에 적용하는 절차와 변경 범위

현재 결과는 로컬 실행·배포용 소스와 빌드입니다. `https://pincon.app/bloodflow`에 배포했다고 주장하지 않습니다.

## 조사 결과

실제 저장소는 https://github.com/doetoeri/Pine 입니다. 기준 커밋은 `d7faa3c7d6b9e0562fac838675b706a3b21ef0c2`이며 루트 `CNAME`은 pincon.app입니다. 공개 사이트 응답의 GitHub Pages 헤더와 루트 정적 PWA 구조를 확인했습니다. 기존 메인 `/next/`, 수행평가 `/new/`, Firebase 기능을 유지하는 구조입니다.

PinCon 통합안은 `bloodflow/` 정적 앱과 `integrations/bloodflow-dual-lab/` 소스·Node 서버를 추가하는 별도 검토 브랜치로 준비합니다. 루트 CNAME·기존 서비스워커·기존 화면·Firebase 규칙을 수정할 필요가 없습니다. 운영 브랜치 병합·DNS 변경·서비스 배포는 사용자 승인 전 수행하지 않습니다.

## 적용 전 필요한 자료

GitHub Pages에 정적 화면을 추가할 변경안은 준비됐습니다. 온라인 협업에는 HTTPS Node 서버와 영속 저장소를 제공할 호스팅 연결이 추가로 필요합니다. 기존 사이트 전체를 이 빌드로 덮어쓰면 안 됩니다. 운영 적용 전에는 아래 변경 범위와 대상 커밋/설정을 사용자에게 제시하고 승인받습니다.

## 상시 Node 서버가 가능한 환경

이 프로젝트를 별도 폴더·프로세스로 실행하고 기존 사이트의 `/bloodflow` 경로만 전달합니다. Node 22 이상, 기본 포트 8787, 쓰기 가능한 영속 저장소가 필요합니다. `BLOODFLOW_DATA`로 데이터 폴더를 지정할 수 있습니다. 하나의 서버 프로세스가 권위 상태를 관리하므로 동일 폴더를 공유하는 여러 독립 프로세스로 무작정 수평 확장하면 안 됩니다.

Nginx를 쓰는 기존 환경의 **추가 구간 예시**:

```nginx
location = /bloodflow { return 308 /bloodflow/; }
location /bloodflow/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
    client_max_body_size 24m;
}
```

이는 기존 서버 설정 전체가 아닙니다. 기존 `/`, `/new`, 다른 앱·API·정적 파일의 location과 서비스워커를 보존해야 합니다. 기존 서비스워커가 모든 경로를 가로챈다면 BLOODFLOW 경로 제외 규칙을 먼저 검토해야 합니다. 새 서비스워커의 scope와 cache 처리는 `/bloodflow/` 안으로 한정했습니다.

다중 연결 상태는 WebSocket `/bloodflow/ws`, 생성은 POST `/bloodflow/api/rooms`, 확인은 GET `/bloodflow/api/health`입니다. 같은 origin에서 사용하도록 구성했습니다. HTTPS 역방향 프록시 아래에서는 WSS를 사용합니다. 실험실 코드는 교육용 방 참가 권한이며 실제 개인·의료 데이터용 인증 시스템이 아닙니다.

## 정적 호스팅 또는 서버리스만 가능한 환경

`dist/bloodflow/`를 기존 사이트의 해당 하위 경로로 추가하면 단독 실험이 가능합니다. `/bloodflow/engineering`, `/biology`, `/research`가 index를 제공하도록 경로를 맞춰야 합니다. 정적 파일만으로 공통 서버 협업이 제공되지는 않습니다. Vercel 일반 함수나 단순 정적 Sites에 이 Node WebSocket 서버를 그대로 업로드한다고 상시 서버가 생기지 않습니다. 별도의 단일 권위 Node 서비스와 영속 디스크, 또는 분산 상태 조정·영속 저장을 구현한 호스팅 어댑터가 필요합니다. Vercel은 현재 Functions WebSocket을 지원하지만, 여러 인스턴스의 방 상태를 외부 저장소로 조정해야 하므로 이 단일 Node/파일 저장 서버를 그대로 복제해 배포하면 안 됩니다. 공식 자료: https://vercel.com/docs/functions/websockets 이 패키지에는 Cloudflare Durable Objects 등 다른 플랫폼용 어댑터를 구현하지 않았습니다.

## 배포 후 검증

기존 `/`, `/new`와 기존 API의 응답·화면을 배포 전 결과와 비교합니다. 세 Lab 직접 접속, 두 기기 역할별 연결, 충돌, 일시정지, 연결 해제·복구, 프로세스 재시작·저장 복원, 외부 인터넷이 없는 LAN 시연을 확인합니다. 실제 Tab S8/S8+에서 터치·회전·브라우저 파일 실행·장시간 사용 검증을 추가합니다. 이번 로컬 테스트가 운영 서버나 실제 태블릿 테스트를 대신하지 않습니다.

## GitHub Pages + 별도 협업 서버 연결

현재 GitHub Pages는 정적 화면을 제공하며 Node 프로세스를 실행하지 않습니다. 협업 서버를 호스팅한 뒤 정적 `bloodflow/runtime-config.js`의 `serverOrigin`에 승인된 HTTPS origin만 지정합니다. 예: `https://bloodflow-server.example`(실제 제공된 주소로 교체).

서버에는 `BLOODFLOW_ALLOWED_ORIGINS=https://pincon.app,https://www.pincon.app`을 설정합니다. 허용된 출처만 API preflight와 WebSocket upgrade를 통과하며 기본값은 같은 origin만 허용합니다. 모형 데이터나 역할 토큰을 runtime-config에 넣지 않습니다. 현재 기본값은 빈 문자열이며, 공개 온라인 협업 서버는 아직 연결하지 않았습니다.
