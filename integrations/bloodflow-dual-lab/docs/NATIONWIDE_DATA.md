# 전국 지리 데이터: 출처·정의·검증

작성·자료 확인: 2026-10-22. 이 파일의 17은 **고정 연구권역 수**이다. 현재 법정 지방자치단체 수나 실제 혈액 공급망 규모를 나타내지 않는다.

## 포함 자료

| 파일 | 내용 | 실행 중 외부 요청 |
| --- | --- | --- |
| `public/data/regions.geojson` | 대한민국의 지리적 형태를 유지하는 17개 고정 연구권역 폴리곤 | 없음 |
| `public/data/nationwide.json` | 권역 정의·인접행렬·100개 가상/기존 실제 거점·데이터 한계 | 없음 |
| `scripts/nationwide-source/geoBoundaries-KOR-ADM1_simplified.geojson` | 생성에 사용한 변경하지 않은 고정 원자료 | 없음 |
| `scripts/nationwide-source/metadata.json` | 다운로드 당시 geoBoundaries 메타데이터 | 없음 |
| `scripts/generate-nationwide-data.py` | 원자료 SHA 확인·결정론적 가상 좌표 생성·검증 | 기본 없음. `--fetch`에서 고정 GeoJSON 1회 요청 |

전국의 새 96개 거점은 **실제 기관이 아닌 교육용 가상 거점**이다. 기관 수와 인구·실제 혈액 공급량에 맞춘 표본 추출이 아니다. 원래 인천 4개 기관의 명칭·주소·좌표·출처를 그대로 보존해 전국 배열에 포함했다. 이들 4개 기관도 재고·수요·차량과 공급 관계는 가상이다.

## 경계의 출처와 라이선스

- geoBoundaries 공식 API: <https://www.geoboundaries.org/api/current/gbOpen/KOR/ADM1/>
- 경계 식별자: `KOR-ADM1-68945753`, 17개 ADM1, 표현 연도 **2021**, 빌드일 **2023-12-12**, 원출처 Natural Earth.
- 변경되지 않는 원본 다운로드: <https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/9469f09/releaseData/gbOpen/KOR/ADM1/geoBoundaries-KOR-ADM1_simplified.geojson>
- 고정 커밋: `9469f09`, 원본 188,886바이트.
- 원본 SHA-256: `7d774c8bb1ee65dde693431985423616fd059ffbe1c1bb497b5fed4f47bcac01`.
- geoBoundaries gbOpen 배포·저작자표시: CC BY 4.0. 공식 안내 <https://www.geoboundaries.org/api.html>.
- 원자료 Natural Earth: public domain. 공식 이용조건 <https://www.naturalearthdata.com/about/terms-of-use/>.
- 지도 화면 권장 표기: **geoBoundaries / Natural Earth · 2021 경계, 교육용 단순화**. geoBoundaries 홈페이지와 라이선스를 링크한다.

원본 geometry 좌표는 변경하지 않았다. 필드 이름·표시 명칭·연구용 식별자를 추가하고 JSON 공백을 제거했다. 좌표계는 GeoJSON 경위도 WGS84, 좌표 순서는 `[경도, 위도]`이다. 작은 도서·해안·경계의 단순화 오차가 있으며 정밀 측량·현재 행정구역 판정에는 사용할 수 없다. 저장된 실제 인천 도로망의 OpenStreetMap 라이선스·출처는 기존 GIS 문서를 따른다.

## 현재 행정구역과의 구분

사용자 요구인 17개 권역의 정책 비교를 유지하기 위해 광주·전남을 별도 **연구권역**으로 고정했다. 2026-10-22 확인한 행정안전부 공식 지자체 누리집은 **전남광주통합특별시**를 표시한다. 따라서 이 앱은 “2026년 현재 17개 법정 시도”라는 주장을 하지 않는다.

- 현행 명칭 확인 자료: <https://www.mois.go.kr/frt/sub/a04/localGovernment/screen.do>
- 별도의 2025-12-31 기준 자료가 2026년에 게시되어 있으므로 게시 연도와 통계 기준일도 구분해야 한다: <https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000055&nttId=128138>.
- 대구의 군위군 편입(2023-07-01)은 2021 geometry에 포함되지 않는다. 대구 공식 연표 <https://www.daegu.go.kr/index.do?menu_id=00000265>.
- 강원특별자치도·전북특별자치도는 표시 명칭만 갱신했다. 이 명칭 변경이 geometry의 최신성을 뜻하지 않는다.
- GeoJSON의 원래 ISO 표기는 `KR-42`(Gangwon), `KR-45`(North Jeolla), `KR-49`(Jeju), `KR-50`(Sejong) 등이다. 연구 데이터의 문자열 ID `51`, `52`, `50`, `36`과는 별도 필드로 기록했다. 이 연구 ID는 앱의 고정 키이며 현재 법령 코드 동기화를 보장하지 않는다.

## 100개 거점의 구성

| 구분 | 공급 거점 | 수요 거점 | 합계 |
| --- | ---: | ---: | ---: |
| 명시적 가상 거점 | 17 | 79 | 96 |
| 기존 인천 실제 명칭 거점 | 1 | 3 | 4 |
| 합계 | 18 | 82 | 100 |

100은 성능·연구 설계의 수이며 한국 의료기관 또는 혈액원 수의 추정값이 아니다. 가상 거점은 모두 `virtual: true`, `verification: synthetic_not_a_medical_institution`이며 이름에 “가상”이 포함된다. 주소에는 “실제 기관 주소 없음”을 기록한다. 모든 권역의 가장 큰 폴리곤 안에서 고정 시드 **20261022**로 좌표를 생성한다. 이는 도로·도심·실제 건물 위치를 검증한 좌표가 아니다. 가상 점을 큰 육지에 한정하므로 작은 도서의 공급 접근성은 대표하지 않는다.

배열은 공급 거점 18개를 먼저, 수요 거점 82개를 뒤에 둔다. 기존 엔진의 공급·수요 시설 구분과 맞춘다.

| 기존 인천 ID | 전국 배열 ID | 기존 명칭 | 공급 그룹 |
| --- | ---: | --- | --- |
| 0 | 17 | 대한적십자사 인천혈액원 | `incheon-validation` |
| 1 | 97 | 인하대학교병원 | `incheon-validation` |
| 2 | 98 | 가천대 길병원 | `incheon-validation` |
| 3 | 99 | 인천적십자병원 | `incheon-validation` |

실제 4개에는 `baselineId`를 남겼다. `realFacilityMap`으로 저장된 인천 `0>1` 등의 실제 OSRM 경로 캐시에 연결할 수 있다. **공식 명칭·주소를 이전 단계에서 확인했지만, 좌표는 주소 기반 근삿값이며 정문·적재장 위치를 측량하거나 재검증하지 않았다.** 기존 `facilities.json`, `routes.json`, `roads.geojson`은 변경하지 않았다.

나머지 가상 거점의 `supplyGroup`은 `regionId`와 같다. 그룹은 교육용 공급 정책 구현을 위한 키이며 실제 기관 사이의 계약·관리·공급 관계가 아니다.

## 인접 권역과 운송의 의미

`regions[].neighbors`는 육지 경계를 공유하는 고정 연구권역의 대칭 모형이다. 제주에는 육지 인접 권역이 없다. 이것은 경로 데이터가 아니다. 경계 인접성이 실제 직결 도로, 통행 가능성, 다리·선박·항공 운송, 운송 허가를 보장하지 않는다.

전국의 가상 구간에는 도로 경로를 지어내어 “실제 도로”라고 표시하면 안 된다. 전국 운송은 별도의 명시적 시간·거리 가정으로 처리하고 지도에 **추정 연결선**으로 구분해야 한다. 도로가 없는 제주~육지 구간은 특히 해상·항공을 포함한 가상 연결이라는 설명이 필요하다. 실제 도로 기반으로 확인된 것은 기존 인천 4개 기관 사이의 저장된 12개 방향 경로뿐이다. 두 파일 모두 전국 all-pairs API 호출이나 지도 타일을 포함하지 않는다.

## 재생성과 수행 검증

`python3 scripts/generate-nationwide-data.py`는 체크인된 원본으로 두 JSON을 다시 생성하며, Python 표준 라이브러리만 사용한다. `--fetch`는 위 고정 원본을 한 번 다운로드하고 SHA 일치 여부를 확인한다. 실행 중 실험에서는 이 스크립트를 호출하지 않는다.

실제로 수행한 검증:

- 원본 SHA-256·188,886바이트 일치.
- 17개의 고유 연구권역, 100개의 고유 거점, 공급 18·수요 82, 가상 96·기존 실제 4 확인.
- 가상 좌표 96개 전부 해당 원본 권역 폴리곤 안에 있음. 고정 시드 재생성 결과 바이트 일치.
- 실제 4개 거점의 기존 필드(명칭·주소·좌표·출처)는 배열 ID를 제외하고 원본과 일치.
- 전국 경계의 geometry는 지역 이름에 대응하는 원본 geometry와 일치.
- 인접 목록의 자기 연결 없음·대칭성·기존 권역 참조 확인.

검증하지 않은 항목: 최신 법정 경계와의 정밀 대조, 도서·해안의 정밀 지도 정확성, 실제 기관 정문 및 물류 연결, 가상 거점의 실도로 접근성, 실제 전국 공급·수요 규모 및 기관별 관계. 이 데이터의 합성 수요·재고는 의료기관 운영 의사결정에 사용할 수 없다.
