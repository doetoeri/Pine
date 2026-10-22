# 지도 503 분석과 복구 검증

2026-10-22. **원래 사용자 오류의 발생 서버는 확정하지 못했다.** 사용자의 당시 Network/HAR·콘솔 자료를 확보하지 못했고, 현재 브라우저에서는 원래503을 재현하지 못했다. 원인을 추측해 타일 제공자를 교체하거나 접근 제한을 우회하지 않았다.

## 조사 결과

| 구분 | 실제 관측 | 해석 범위 |
| --- | --- | --- |
| 기존 기준 HTML의 온라인 버튼 | `https://tile.openstreetmap.org/13/6978/3175.png` 등을 포함한10개 타일, 모두256px 정상 표시 | 현재 클라우드 Chrome의 관측. 사용자 태블릿의 당시 상태 아님 |
| 개선판 실제 타일 요청 | `https://tile.openstreetmap.org/6/56/24.png` 등15개 논리 fetch, 모두HTTP200, 재시도0 | 브라우저 앱 진단에서 상태·허용된 응답 헤더 확인 |
| PinCon HTTP진단 | `https://pincon.app/bloodflow/` →404, `x-github-request-id` 포함 | BLOODFLOW가 그 시점에 운영 배포되지 않은 별도 문제 |
| OSRM HTTP진단 | 저장 경로와 별개인 단일 예시 Route GET →200 | 런타임 경로 계산은 저장 캐시를 사용하므로 실험 중 이 API를 요청하지 않음 |
| 기존 서비스워커 코드 | 같은 출처의 미캐시 fetch실패를 `Response('Offline',status:503)`으로 반환 | 합성503 가능성을 확인했지만 사용자 오류가 이 경로였다는 증거는 없음 |
| file:// 분기 | 웹 온라인 타일을 의도적으로 사용하지 않음 | 유효한 웹 Referer를 만들 수 없으므로 저장 지도를 기본으로 제공하는 방향 유지 |

독립 HTTP진단의 정확한URL·응답 헤더·시각은 `test-results/map-origin-http-diagnostics.json`에 보존했다. 해당 파일의 `server: envoy` 같은 중계 헤더만으로 원본 서버의 장애를 단정하지 않는다. 브라우저 개발 API는 전체 Network/HAR를 노출하지 않아 앱 안에 직접 응답 상태·기록을 표시했다. 원래 사용자 기기의 정확한503요청 URL과 전체 헤더를 확보했다는 주장은 하지 않는다.

브라우저에서 확인한 실제 OSM200 응답 예:

- Content-Type: `image/png`
- Cache-Control: `max-age=92508, stale-while-revalidate=604800, stale-if-error=604800`
- Expires: `Thu, 22 Oct 2026 05:00:05 GMT`
- 브라우저가 CORS로 노출받지 못하는 헤더는 기록에 존재하지 않을 수 있다. `Failed to fetch`는 CORS·네트워크·취소 등을 구분하지 못하므로 HTTP503이라고 표시하지 않는다.

CSP는 진단한 PinCon404문서에서 제한적인 정책을 관찰했으며 그것을 BLOODFLOW화면의 CSP로 간주하지 않았다. 앱의 실제 OSM fetch는200이었다. PinCon의 프록시·호스팅 설정을 임의로 바꾸지 않았다.

## 구현한 개선

`map-requests.mjs`가 온라인 요청을 제한하고 `map-layer.mjs`가 Leaflet표시를 담당한다. 엔진은 지도 요청 결과를 참조하지 않는다. 전국 경계·인천 도로·경로는 동봉자료이며 온라인 타일보다 먼저 표시한다.

- 사용자 선택 시 현재 뷰포트만 요청한다. 사전 타일 다운로드·ZIP/MBTiles 구축은 하지 않는다.
- 동시4요청, 분당32회·한 지도 세션80회 한도, 같은 URL중복 공유, 화면 밖 대기 요청 취소.
- 요청별 최대3시도(최초1+재시도2),800ms→1600ms 백오프,7초 요청 시간 초과.
- 연속3실패 또는예산소진 시 회로를 차단하고 저장 지도로 복귀한다. 연결 재시도 버튼은60초간 기다린다.
- 401/403/429는 즉시중단하고 다른 공급자·프록시로 우회하지 않는다. 제공자 자동 순환은 없다.
- HTTP기본 캐시와 브라우저 Referer를 유지한다. `no-cache`요청이나 공개 타일의 별도 오프라인 저장을 하지 않는다.
- 이용권을 확인한 자체/상용 타일은 runtime-config의 명시적 설정으로 사용할 수 있다. 약관 확인 표시·출처가 필요하다. 기본 대체 데이터는 재배포 가능한 저장 벡터이다.
- 기존 서비스워커의 앱캐시 실패는504와`X-Bloodflow-Offline: app-cache-miss`로 구별한다. 외부 타일은 서비스워커의 가로채기/캐시 대상이 아니다.
- 상태·재시도·요청URL·HTTP상태·읽을 수 있는 응답헤더를 지도 아래에 표시하고 진단JSON을 내보낸다. 저장지도·온라인중·오류복구·파일모드를 구분한다.

## 실제 브라우저 장애 주입

테스트 타일은 서버를 `--qa`로 시작한 개발 환경에서만 제공된다. 운영 `npm start`에는 이 플래그가 없다. 합성 타일에는`X-Bloodflow-Fixture`가 있다. 아래 URL은 테스트용 같은 출처이며 공공 OSM서버의503이 아니다.

| 테스트 | 실제 응답·요청 수 | 결과 |
| --- | --- | --- |
| 최초1회만503 | `/bloodflow/qa/tiles/6/54/25.svg?case=once&run=qa-once-final`, 총16요청·성공15·재시도1 | 온라인 지도 복구 |
| 계속503 | `/bloodflow/qa/tiles/6/54/25.svg?case=down&run=qa-down-final`, 총4요청·성공0·재시도2 | 연속실패에서 요청 중단, 저장 벡터 유지, +6시간 진행 성공 |
| 순수 요청 엔진 테스트 |503지속시3요청에서 회로차단,800/1600ms,429한번후중단, 중복·동시수·취소·예산 검증 | Node자동화 통과 |

지속503의 브라우저 응답 헤더는 Content-Type`text/plain`, Cache-Control`no-store`, X-Bloodflow-Fixture`synthetic-503`이었다. 실제 서버 종료 시 두 공유 브라우저의 시간·조작은 잠겼고, 이미 로드한 단독HTML은 +6시간 및4일×2반복×3정책의 BlobWorker계산을 완료했다. OS전체 인터넷 차단·모바일 file://콜드 실행과 PWA콜드 오프라인 재접속은 실제 수행하지 않았다.

## 지도 정확도와 남은 범위

전국은 geoBoundaries/Natural Earth의2021년17개 고정 연구권역이다. 최신 법정구역·도서 접근성·해안 측량자료가 아니다. 신규96곳은 명시적 가상 거점이며 기존 인천4기관은 공식 명칭·주소와 이전 근사좌표를 보존했다. 저장된12개 인천 OSRM경로만 실제 도로로 표시한다. 나머지 전국 선은 추정 연결선이며 실시간 교통·선박·항공을 재현하지 않는다.

원래503을 특정하려면 **오류가 발생한 기기의 정확한 요청 URL·응답/콘솔/HAR**가 추가로 필요하다. 현재 결과는 재현된 프로그램 오류 수정과503복구 검증이며 외부 지도 서비스의 무중단 보장이 아니다.

## 공식 정책·출처

- [OSM 타일 이용정책](https://operations.osmfoundation.org/policies/tiles/): 올바른URL·출처·Referer·기본캐시 준수, 대량/오프라인다운로드 금지, SLA없음.
- [OSRM demo서버](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server): 공용데모의 요청제한·무보장 안내. 이 앱의 반복실험은 요청하지 않는다.
- [geoBoundaries](https://www.geoboundaries.org/api/current/gbOpen/KOR/ADM1/), [Natural Earth 이용조건](https://www.naturalearthdata.com/about/terms-of-use/).
- 추가 공급자 조사와 원본비교는 `MAP_SOURCE_AUDIT.md`, 데이터정의는 `NATIONWIDE_DATA.md`를 참고한다.
