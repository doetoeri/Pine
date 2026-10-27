# Data provenance and licenses

## KNMI’23 · sea-level anchors

Status: acquired

공식 API의 2050·2100년 저배출 L·고배출 H 중앙값과 하한·상한. 해수면 각주 기준은 1995–2014. 연간 경로는 보간 가정.

Official 2050/2100 low/high sea-level anchors and bounds. Sea-level footnote baseline: 1995–2014. Annual trajectory is assumed interpolation.

Resolution: Dutch coast · 2050 / 2100; metres relative to 1995–2014

Version / date: KNMI’23 · endpoint snapshot 2026-10-27

License: KNMI public information / attribution; API does not declare a separate dataset licence

Source: https://www.klimaatscenarios-data.knmi.nl/kerncijfers

## AHN · PDOK / Rijkswaterstaat

Status: acquired

실제 DTM 0.5m 서비스에서 최근접 1km 간격으로 취득. 2×2 표본 중앙값을 2km 분석 셀로 변환. 0.5m 해상도 모형이 아님.

Real DTM service sampled at 1km nearest-neighbour spacing, aggregated to 2km median sample cells. This is not a 0.5m model.

Resolution: Source DTM 0.5m → fetched samples 1000m → analysis 2000m; EPSG:28992, height NAP

Version / date: dtm_05m / WCS v1_0 · snapshot 2026-10-27; source acquisition years not resolved

License: CC0 1.0 (service GetCapabilities)

Source: https://service.pdok.nl/rws/ahn/wcs/v1_0?service=WCS&request=GetCapabilities

## CBS · Wijk- en Buurtkaart 2024

Status: acquired

실제 육지 행정구역 342곳, 인구·주택수·평균 주택가액. water=NEE만 사용하고 결측 센티널을 제외. 전국 관측 인구 17,942,942명.

342 real land municipalities, population, dwellings and average home value. water=NEE only; missing-data sentinels removed. Observed population 17,942,942.

Resolution: Municipality · 2024; source RD / browser CRS84; outline simplified 100m

Version / date: PDOK CBS 2024 · metadata updated 2026-06-03 · fetched 2026-10-27

License: CC BY 4.0 · Statistics Netherlands / Kadaster

Source: https://api.pdok.nl/cbs/wijken-en-buurten-2024/ogc/v1?f=html

## OpenStreetMap · facility samples

Status: acquired

5개 지도 범위의 실제 발전·변전·병원·철도·방재시설과 도로·철도·전력선. 25개 이름 있는 시설과 464개 선분. 전국 완전망이 아님.

Real facilities and line segments in five map extents: 25 named assets and 464 lines. Not a complete national infrastructure network.

Resolution: Five small raw map extracts · CRS84 · facility way/relation centroids

Version / date: OSM API /0.6/map · current snapshot fetched 2026-10-27 (not historical 2026-01 baseline)

License: ODbL 1.0 · © OpenStreetMap contributors; derived database attribution preserved

Source: https://www.openstreetmap.org/copyright

## Natural Earth · geographical context

Status: acquired

주변 국가 배경을 위한 실제 저해상도 경계. 침수 계산에는 쓰지 않음.

Real small-scale surrounding country outlines for context only; excluded from flood calculations.

Resolution: 1:50m Admin 0 · CRS84 · simplified 0.006°

Version / date: natural-earth-vector repository snapshot 2026-10-27; upstream version not pinned

License: Public domain

Source: https://www.naturalearthdata.com/about/terms-of-use/

## Defence heights / hydraulic boundary

Status: unavailable

RWS 전국 제방·방조제 제원과 검증용 수리 침수장을 확보하지 못함. 기존 보호 한계 3.2m NAP를 모든 지역에 가정. 실제 제방 높이로 해석 금지.

National dike/barrier engineering attributes and hydraulic validation fields were not acquired. A uniform 3.2m NAP hypothetical protection gate is used, not real crest height.

Resolution: Unavailable; municipal gate assumption only

Version / date: RWS requests returned 404 / 500 · Climate Impact Atlas not acquired

License: No unacquired data redistributed

Source: https://www.klimaateffectatlas.nl/en/faq

## TenneT · electrical topology & ratings

Status: unavailable

공개 서비스 메타데이터만 확인. 재배포 조건은 모든 권리 유보로 표시되어 자산망을 포함하지 않음. 실제 전기 정전 예측은 불가.

Metadata inspected only. Item license reserves all rights, so network assets are not redistributed. No real electricity-outage prediction.

Resolution: No actual electrical graph or line ratings acquired

Version / date: ArcGIS item 02d4cfaf2a9241b68f9520748081d7e9 · inspected 2026-10-27

License: All rights reserved · TenneT TSO B.V.

Source: https://services-eu1.arcgis.com/WjozPuR5ROn6NZE8/ArcGIS/rest/services/TenneT_Assets_Hoogspanning/FeatureServer

## Research assumptions / 경제·전력·정책

Status: assumption

인구당 경제활동 €55,000/년, 자산 1.3×주택가액, 수요 0.6kW/인, 지역 공급 1.25×수요와 인접 용량을 가정. 실제 GDP·송전망 값이 아님.

Assumed €55k/person-year output, assets at 1.3×housing value, 0.6kW/person demand, generation 1.25×demand, and adjacent transfer capacity. Not observed GDP or grid ratings.

Resolution: Municipality aggregate · annual · constant euros; carbon kt CO₂e

Version / date: Model 0.1.0 · see docs/MODEL.md and ASSUMPTIONS.csv

License: Project code MIT; third-party data retain own licences

Source: src/model.ts

Exact download URLs and SHA-256 hashes: DATA_MANIFEST.json. External basemap: © CARTO and © OpenStreetMap contributors. Base tiles are fetched at runtime, never bulk cached.
