> 보존 자료: 1.0 검증 기록입니다. 현재 전국 확장 검증은 [VERIFICATION.md](VERIFICATION.md)를 확인하세요.

# BLOODFLOW Dual Lab — 개발·검증 보고서

기록: 2026-10-22T00:08:19+09:00 · 버전 1.0.0

## 결과

실행 가능한 단일 HTML, 공통 WebSocket 서버, Engineering·Biology·Research 화면, 저장된 실제 도로 데이터, 재현 가능한 실험 A/B/C와 출력·직접 작성 도구를 구현했습니다. **pincon.app에 배포한 결과물이 아닙니다.**

기준 소스는 보관된 BLOODFLOW_5_2_Material3.html 안의 5.1로 표시된 모형입니다. 별도 5.1 원본 파일 전체는 확보하지 못했으므로 원본 제공 후 최종 대조가 필요합니다. 원본 HTML과 SHA-256을 보존했고, 사건 힙·난수·기존 World 운송/만료 코드를 확장했습니다. 자세한 재사용·변경 범위는 `docs/PROVENANCE.md`에 구분했습니다.

## 제출물

| 제출 항목 | 파일·구현 |
|---|---|
| 전체 소스 | src/, server/, scripts/, tests/, public/, vendor/ |
| 바로 실행 | dist/BLOODFLOW_Dual_Lab_Offline.html |
| 세 연구실 | /bloodflow/engineering, /biology, /research의 공통 앱 |
| 실제 지리 | 기관 4개, 유향 경로 12개, OSM 도로 1,394개 way |
| 공통 엔진 | DualWorld extends 원래 World, 공통 상태·역할별 명령 |
| 반복 실험 | A/B/C, 동일 시드 쌍, 표본 SD·t 구간, CSV/JSON/SVG |
| 예제 결과 | examples/experiment-A·B·C.json, runs-A·B·C.csv |
| 검증 결과 | test-results/node-tests.txt, long-run.json, browser-qa.json, build-manifest.json |
| 사용법·배포 | README.md, START_BLOODFLOW.bat/.sh, docs/DEPLOYMENT.md |

## 자동 검증

Node v24.19.0 / linux x64. 자동 테스트 **21개 통과, 실패 0개**입니다. 로그에 실제 실행 결과를 포함했습니다.

검증 범위: 원래 모형 추출본의 결정성·보존, 도로 캐시 완전성, 동일 시드 재현, 재고 보존·수요 처리·만료·보류, RBC/PLT/FFP 적합성, 부적합 물품 제외, 운송 중 재고 분리, 배차 실패 rollback, JSON 저장 복원·손상 거부, 외생 수요 난수 분리, 통계·분모·CSV, 검사 전 공급 제외, worker 결과 일치, 계산 일시정지/재개, 150개 응답 캐시를 넘어선 재전송 중복 방지까지 검사했습니다.

실제 WebSocket 클라이언트 두 개를 Node 서버에 연결해 상태 일치, 역할 위반 차단, 동시 수정 충돌, 이벤트 재전송, 연결 해제에 따른 정지, 재접속, 서버 프로세스 재시작·파일 복원, /bloodflow 밖 경로 격리를 검증했습니다. 브라우저 두 탭에서도 같은 방에 연결해 공통 시각과 생명과학 조건 변경을 확인했습니다.

서버는 상태 버전과 설정 revision을 구분합니다. 설정 충돌은 최신 상태를 돌려주며 재확인 후 적용해야 합니다. 클라이언트·역할별 순번과 이벤트 ID를 사용해 재연결 때 명령을 두 번 적용하지 않습니다. 오프라인으로 떨어진 공유 화면은 독립 엔진으로 전환하지 않고 조작을 잠급니다. 실험실 코드는 교육용 참가 권한이며 실명 인증·의료 데이터 인증을 구현한 것은 아닙니다.

## 기존 PinCon 보존 검증

기준 커밋의 기존 계약 테스트는 50개 중 49개 통과·1개 실패였고, 두 폴더 추가 후에도 49개 통과·동일한 1개 실패로 새 실패는 0개입니다. 기존 실패는 `PWA and bootstrap include experiment modules and stable fallback`으로, 이미 제거된 UI 모듈 이름을 요구하는 계약입니다. 이번 작업에서 기존 화면이나 해당 테스트를 수정하지 않았습니다. 기존 추적 파일 수정은 0개이며 변경 범위는 새 폴더 두 개입니다. 운영 사이트 실계정·터치·성능 검증을 대신하지는 않습니다.

## 장기 계산·예제

A/B/C 각각 30일 × 12쌍, 총 72회 계산을 실제 수행했고 모든 반복의 재고 보존이 통과했습니다. 아래는 **이 가상 모형의 예제 결과**이며 실제 기관의 성과·권고가 아닙니다.

| 실험 | 부족률 평균: 기준 → 실험 | 폐기율 평균: 기준 → 실험 | 이 환경 계산시간 |
|---|---|---|---|
| A | 45.48% → 14.41% | 21.05% → 13.41% | 8.64초 |
| B | 12.28% → 15.26% | 11.84% → 12.64% | 7.28초 |
| C | 0.21% → 4.57% | 0.01% → 20.04% | 6.27초 |

A의 이 설정에서는 안전재고를 늘렸을 때 부족과 폐기가 함께 줄었습니다. 두 지표가 항상 상충하도록 결과를 조작하지 않았습니다. 고정 입고·만료·초기 연령·제제 구성·보충 규칙에 따라 패턴이 달라지므로 가정을 바꾸어 비교해야 합니다. C는 수명·적합성 등이 함께 변하는 제품 비교이며 임상 용량 비교가 아닙니다.

365일 가상 진행: 약 **43.76초**. 생성 10,291 = 활성 1,235 + 공급 6,606 + 만료 2,450 + 기타 제외 0, 보존 오차 0. 요청 7,598 = 공급 6,606 + 부족 992. 저장 JSON은 약 11.87MB입니다. 종료 시 heap 사용 약 141.1MiB이며 최대 메모리 측정값은 아닙니다. 이는 Node 계산 성능이고 태블릿 브라우저 성능이 아닙니다.

## 브라우저·오프라인 확인

- 클라우드 Chromium에서 세 화면과 지도·시간 조작·기관·제제 선택·반복 계산을 확인했습니다. 단독 HTML을 HTTP로 제공한 단일 파일에서도 지도·자동 저장 복원·Blob worker 반복 계산을 확인했습니다.
- 1280×800 Engineering iframe에서 가로 넘침 없음, 지도 높이 340px·하단 약 787px로 화면 안에 들어왔습니다.
- 1400×876 Biology iframe에서 가로 넘침 없음, 제제 카드 3개, 표시된 버튼 높이는 모두 44px 이상이었습니다.
- 실제 Tab S8/S8+·Android Chrome의 파일 열기·터치·장시간 사용은 **미검증**입니다. iframe은 화면 크기 검증이며 실제 하드웨어·DPR·성능을 재현하지 않습니다.
- 실제 180초 전체 발표 타이머와 서비스워커의 네트워크 차단 후 재접속은 브라우저에서 끝까지 검증하지 않았습니다. 위기 시나리오 계산 자체는 별도 재현성 검증을 포함합니다.

## 과학적·지리적 한계

의학적 정보, 가상 조건, 계산 결과를 화면에서 구분합니다. 대한적십자사와 Lifeblood의 선택 제품·적합성 자료를 사용했지만 임상 예외·추가 항원·교차시험·해동·검사 정확도·치료 효과는 생략했습니다. 운송에도 보관 범위를 적용하는 보수적 가정이며 온도 이탈은 검토 보류만 만듭니다. 품질 감소율이나 실제 사용 승인 판정은 없습니다.

기관 명칭·주소는 공식 자료로 대조했지만 좌표는 이전 주소 기반 자료이며 출입구나 실제 혈액 운송 관계를 검증하지 않았습니다. OSRM 경로와 시간은 실시간 교통을 반영하지 않습니다. 배경은 저장된 OSM 벡터이며 타일을 대량 저장하지 않았습니다. 기본 재배치는 조건부 휴리스틱으로, 기본 시나리오에서 활성화되지 않을 수도 있습니다.

## 운영 배포·미완료 항목

기존 PinCon 사이트·DNS·실서비스 코드는 변경하지 않았습니다. 실제 doetoeri/Pine 저장소와 CNAME pincon.app, GitHub Pages 정적 구성을 확인했습니다. 기준 커밋은 d7faa3c7d6b9e0562fac838675b706a3b21ef0c2입니다. bloodflow/와 integrations/bloodflow-dual-lab/ 두 폴더를 추가하는 검토용 통합안이며 기존 추적 파일은 바꾸지 않습니다. 운영 브랜치에 병합하지 않았습니다. 기존 사이트의 로컬 계약 테스트 결과는 test-results/pincon-regression-baseline.txt와 pincon-regression-integration.txt에 기록합니다. 운영 네트워크·실계정 회귀는 수행하지 않았습니다.

실서비스 적용에는 최종 배포 승인과 HTTPS 협업 서버·영속 저장소의 호스팅 연결이 필요합니다. 이 결과물은 별도 Node 상시 서버 또는 정적 단독 배포용입니다. Cloudflare Durable Objects 등 플랫폼별 협업 어댑터는 미구현입니다. 적용 시 /bloodflow와 해당 API/WebSocket만 추가하고 기존 /new 등 경로와 기존 서비스워커를 보존해야 합니다. 변경 범위와 최종 대상이 구체화되면 사용자의 배포 승인을 받아야 합니다.

별도 5.1 원본과의 전체 회귀 대조, 정확한 출입구·기관 관계 확인, 실제 태블릿·학교 LAN 실증, 운영 사이트 통합·배포가 남아 있습니다. 보고서 자동 대필 기능은 만들지 않았습니다.

## 근거·재실행

- 제제: https://bloodinfo.net/knrcbs/cm/cntnts/cntntsView.do?cntntsId=1126&mi=1049
- 적합성: https://www.lifeblood.com.au/health-professionals/products/component-compatibility
- 혈액원 주소: https://bloodinfo.net/knrcbs/cm/cntnts/cntntsView.do?cntntsId=1038&mi=1178
- 인하대병원: https://www.inha.com/
- 길병원: https://grc.gilhospital.com/
- 인천적십자병원: https://www.rch.or.kr/web/rchincheon/main
- 지도: https://www.openstreetmap.org/copyright
- 경로: https://project-osrm.org/docs/v5.24.0/api/

`npm test`로 자동 테스트, `npm run build`로 단일 HTML과 정적 빌드, `node scripts/verify-long-run.mjs`로 예제·장기 계산을 재생성합니다. 생물학적 규칙·분모·난수 흐름·데이터 한계는 docs/MODEL.md와 docs/GIS.md에 명시했습니다.
