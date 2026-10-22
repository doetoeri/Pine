# 지리 데이터

기관은 인천혈액원, 인하대학교병원, 가천대 길병원, 인천적십자병원 4곳입니다. 각 기관의 명칭·도로명주소는 `public/data/facilities.json`의 공식 출처와 대조했습니다. 좌표는 이전 프로젝트의 주소 기반 데이터를 재사용했습니다. **공식 출입구 좌표나 실제 혈액 공급 계약 관계를 확인한 것이 아닙니다.** 좌표의 원래 출처와 한계를 함께 보존했습니다. 인하대병원의 주소 행정구 표기는 최근 심평원 자료의 제물포구 표기를 사용하며 공식 병원 웹페이지에 이전 중구 표기가 남아 있을 수 있습니다.

`routes.json`은 위 네 좌표 사이의 12개 유향 OSRM driving 경로입니다. 원 응답의 기하·거리·시간·snap 지점과 원 요청 URL·취득 시각을 남겼습니다. 왕복 경로를 같은 것으로 가정하지 않습니다. 도로 예상시간이며 실제 교통·신호·응급 우선권·의료 물류를 재현하지 않습니다. 좌표와 도로 snap의 거리가 1.5km 이상이면 데이터 수집 단계에서 실패시킵니다. 실제 출입구 접근 가능 여부는 별도 확인이 필요합니다.

`roads.geojson`은 인천의 한정된 영역에서 수집한 OSM 주요 도로 1,394개 way입니다. 지도 타일을 대량 다운로드한 데이터가 아닙니다. 기본 지도는 이 벡터와 저장된 경로를 그립니다. 온라인 배경은 사용자가 켤 때만 표준 OSM 타일을 요청합니다. 오프라인용 타일 미리받기 기능은 없습니다. 반복 실험은 외부 API를 호출하지 않습니다.

- © OpenStreetMap contributors, ODbL 1.0: https://www.openstreetmap.org/copyright
- ODbL: https://opendatacommons.org/licenses/odbl/1-0/
- 타일 정책: https://operations.osmfoundation.org/policies/tiles/
- OSRM: https://project-osrm.org/docs/v5.24.0/api/
- OSRM demo 사용 정책: https://github.com/Project-OSRM/osrm-backend/wiki/Api-usage-policy
- Overpass: https://overpass-api.de/api/interpreter

수집 스크립트는 이미 저장된 경로를 다시 요청하지 않고, 새 경로 간에 최소 1.1초 간격을 둡니다. 현재 12개만 제한적으로 가져왔으며 실행·몬테카를로 실험에서는 재요청하지 않습니다. 수집 범위를 확장할 때는 자체 라우팅 서비스 또는 이용 가능한 제공자의 정책을 검토해야 합니다.
