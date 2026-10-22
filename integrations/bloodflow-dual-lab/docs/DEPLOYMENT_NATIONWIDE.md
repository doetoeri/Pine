> 공개 게시 승인 업데이트(2026-10-22): 공개 소스 브랜치와 초안 PR의 게시 승인을 받았습니다. 아래 문서의 게시 승인 대기 설명은 최초 검토 시점의 기록입니다. 운영 배포·병합 승인은 아직 받지 않았습니다.

# 전국 확장 배포 준비와 승인 범위

2026-10-22. 목표 URL은 https://pincon.app/bloodflow 이며 이 파일은 완료된 배포를 주장하지 않는다. 읽기 전용 확인에서 /bloodflow/는 GitHub Pages404였다. PinCon 저장소 doetoeri/Pine의 최신 확인 main은9a55183cd70d3ea66b59a86733b8cda36d1364e9이다. 작업 도중 /new 관리 배너 등의 변경이 추가되어 새 main에서 별도 통합 검토본을 만들었다. 기존 /new, /next, /admin, /research, Firebase, PWA, 루트 서비스워커, CNAME, DNS는 수정하지 않는다.

## 배포 파일

- npm run build → dist/bloodflow 정적 화면. 독립 경로 /bloodflow/nationwide, /engineering, /biology, /research의 index.html을 생성한다. 깊은 링크를 GitHub Pages 디렉터리로 제공한다.
- src, server, public, vendor/ws → Node22+ 단일 권위 서버. 실행은 node server/server.mjs --port8787(실제 CLI는 --port 8787처럼 공백 구분). /bloodflow/api/*, /bloodflow/ws 및 자체 정적 /bloodflow만 처리한다.
- Dockerfile → 동일 서버·영속 볼륨용 추가 구성. Docker 이미지 빌드·실행은 이 환경에서 검증하지 않았다.
- dist/BLOODFLOW_Dual_Lab_Offline.html → 네 화면·지리·엔진·Blob worker를 포함한 단독 시연 파일. 서버 기반 협업과 구분한다.

## 정적 PinCon + 별도 협업 서버

GitHub Pages는 Node 상시 프로세스나 WebSocket 권위 서버를 실행하지 않는다. 별도의 HTTPS Node 호스트와 영속 디스크를 정하고 TLS·WebSocket 업그레이드를 연결해야 한다. `public/runtime-config.js`의 serverOrigin에는 실제 승인된 HTTPS 서버 origin만 설정한다. 서버 BLOODFLOW_ALLOWED_ORIGINS에는 https://pincon.app을 넣는다. 이는 클라이언트 공개 설정이며 비밀 키를 포함하지 않는다. 다른 서비스의 기존 프로젝트나 도메인을 임의로 재사용하지 않는다.

PORT 기본8787, HOST 기본0.0.0.0, BLOODFLOW_DATA는 영속 디스크 경로다. Node서버는 단일 프로세스로 운영한다. 같은 방을 서로 다른 독립 프로세스에 분배하는 다중 인스턴스는 지원하지 않는다. 외부 인터넷 없이 같은 LAN의 PC한대에 실행하는 협업은 가능하다. 서버가 없는 정적 주소에서는 설명을 표시하고 단독 실행은 유지한다.

공개 서버에 실제 환자·기관 운영자료를 넣지 않는다. 교육용6자리 코드는 초대 코드이며 신원 인증이 아니다. 최대12개 저장 방·8개 동시 참가자/방·분당120명령/참가자 등의 현재 한도를 이해해야 한다. 상업적 다중 이용자 인증·방 수명 정책·분산 영속 저장은 별도 확장이 필요하다. 이번 요구의 두 연구자 공동 실험은 단일 방에서 검증했다.

## 지도 공급자

기본 배경은 동봉한 geoBoundaries/Natural Earth2021경계와 인천 OSM도로다. OSM공개 타일은 사용자가 온라인배경을 켰을 때만 현재화면을 요청한다. HTTP기본 캐시를 존중하고 타일 사전 다운로드·우회 프록시·제공자 자동 순환을 사용하지 않는다. 이용권을 확인한 자체/상용 타일 제공자로 바꾸려면 runtime-config.js의 tileProvider 설정과 필수 attribution·termsReviewed를 설정한다. 제공자 서버403/429는 요청 중단 사유다.

공공 타일에는 SLA가 없으므로 운영 안정성은 저장된 벡터 지도를 기본으로 확보한다. file://에서 웹 Referer를 위조하지 않으며 저장 지도를 사용한다. 외부 지도 타일은 서비스워커 캐시 대상으로 삼지 않는다. 기존 PinCon 캐시를 삭제하거나 루트SW를 교체하지 않는다.

## 검토와 적용

통합 패치는 /bloodflow와 /integrations/bloodflow-dual-lab만 추가하도록 준비한다. 배포 전 사용자에게 파일 수·기존 파일 수정 여부·정적 단독/공통 서버 구성·백업 및 복구 방법을 제시하고 승인을 받는다. 공개 GitHub로 코드·예제·보존 원본을 게시하는 승인과 운영 서비스 적용 승인은 구분해야 한다. 앞선 작업의 공개 push는 자동 승인 검토가 명시적 게시 동의 부재로 차단했고 우회하지 않았다. 이번에도 공개 브랜치·PR·운영 배포는 생성하지 않는다.

승인 후 절차: (1) 최신main 재확인 및 패치 충돌 확인 (2) 정적 /bloodflow 추가·원본경로 회귀시험 (3) 승인된 Node호스트와영속디스크·TLS설정 (4) runtime serverOrigin·CORS 정확한 origin설정 (5) 두 실제 태블릿 공동접속·재연결·저장복구·지도출처 확인 (6) 기존 PinCon 정상운영 확인. 배포 후 이슈가 있으면 /bloodflow 신규폴더와협업서버만 되돌리고 기존경로를 유지한다.
