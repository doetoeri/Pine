# 외부 자료와 라이브러리

- Leaflet 1.9.4: BSD-2-Clause. `public/vendor/leaflet.js`, `leaflet.css`, `LEAFLET_LICENSE.txt`. 원래 프로젝트의 내장 JS를 재사용했고 같은 버전의 CSS·라이선스를 공식 배포 경로에서 확보했습니다.
- ws 8.22.0: MIT. npm의 공식 패키지를 `vendor/ws/`에 포함했습니다. 라이선스는 해당 폴더의 `LICENSE`에 있습니다. 추가 설치 없이 Node 서버에서 사용합니다.
- OpenStreetMap 도로 및 OSRM 도로 경로: © OpenStreetMap contributors, ODbL 1.0. `public/data/`에 취득 경로와 날짜를 보존했습니다. https://www.openstreetmap.org/copyright
- 혈액제제·적합성 자료와 기관 공식 웹사이트: 출처는 앱의 Research 화면 및 `docs/MODEL.md`, `docs/GIS.md`에 기록했습니다. 웹페이지 전체를 복제한 자료가 아니라 모형 규칙과 출처·한계를 정리했습니다.
- 사용자에게 보관돼 있던 BLOODFLOW 5.2 원본은 `original/`에 변경 없이 포함했습니다. 해당 원본의 외부 코드·데이터 표기는 그대로 유지합니다.
