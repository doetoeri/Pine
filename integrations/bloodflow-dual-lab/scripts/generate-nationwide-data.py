#!/usr/bin/env python3
"""Regenerate the fixed, explicitly synthetic 100-node teaching dataset.

Default: use the checked-in, SHA-256-pinned 188,886-byte boundary source.
--fetch: fetch that same pinned source; never download map tiles or call OSRM.
No third-party Python dependencies are required.
"""
from pathlib import Path
import argparse
import copy
import hashlib
import json
import math
import random
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'scripts/nationwide-source/geoBoundaries-KOR-ADM1_simplified.geojson'
URL = 'https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/9469f09/releaseData/gbOpen/KOR/ADM1/geoBoundaries-KOR-ADM1_simplified.geojson'
SHA = '7d774c8bb1ee65dde693431985423616fd059ffbe1c1bb497b5fed4f47bcac01'
SEED = 20261022
ROWS = [
    ('11', 'Seoul', '서울특별시', '서울'),
    ('26', 'Busan', '부산광역시', '부산'),
    ('27', 'Daegu', '대구광역시', '대구'),
    ('28', 'Incheon', '인천광역시', '인천'),
    ('29', 'Gwangju', '광주 연구권역', '광주'),
    ('30', 'Daejeon', '대전광역시', '대전'),
    ('31', 'Ulsan', '울산광역시', '울산'),
    ('36', 'Sejong', '세종특별자치시', '세종'),
    ('41', 'Gyeonggi', '경기도', '경기'),
    ('43', 'North Chungcheong', '충청북도', '충북'),
    ('44', 'South Chungcheong', '충청남도', '충남'),
    ('46', 'South Jeolla', '전남 연구권역', '전남'),
    ('47', 'North Gyeongsang', '경상북도', '경북'),
    ('48', 'South Gyeongsang', '경상남도', '경남'),
    ('50', 'Jeju', '제주특별자치도', '제주'),
    ('51', 'Gangwon', '강원특별자치도', '강원'),
    ('52', 'North Jeolla', '전북특별자치도', '전북'),
]
# Study adjacency is a fixed qualitative mainland-border graph, not a route
# graph and not a statement that every neighboring pair has a direct road.
EDGES = [
    ('11','41'), ('28','41'), ('41','51'), ('41','43'), ('41','44'),
    ('51','43'), ('51','47'), ('43','44'), ('43','36'), ('43','30'),
    ('43','52'), ('43','47'), ('44','36'), ('44','30'), ('44','52'),
    ('36','30'), ('52','47'), ('52','48'), ('52','46'), ('46','29'),
    ('46','48'), ('47','48'), ('47','27'), ('47','31'), ('27','48'),
    ('48','31'), ('48','26'), ('31','26'),
]

def area(ring):
    return abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(ring,ring[1:])))/2

def in_ring(x, y, ring):
    inside = False
    a = ring[-1]
    for b in ring:
        if (a[1] > y) != (b[1] > y):
            cross = (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]
            if x < cross:
                inside = not inside
        a = b
    return inside

def in_polygon(x, y, polygon):
    return in_ring(x,y,polygon[0]) and not any(in_ring(x,y,h) for h in polygon[1:])

def sample(polygon, r, used):
    ring = polygon[0]
    xmin,xmax=min(p[0] for p in ring),max(p[0] for p in ring)
    ymin,ymax=min(p[1] for p in ring),max(p[1] for p in ring)
    for _ in range(100000):
        x,y=round(r.uniform(xmin,xmax),6),round(r.uniform(ymin,ymax),6)
        if in_polygon(x,y,polygon) and all(math.hypot(x-u,y-v)>.005 for u,v in used):
            return x,y
    raise RuntimeError('Could not find distinct inland virtual point')

def label_point(polygon, rid):
    ring=polygon[0]
    crosses=[a[0]*b[1]-b[0]*a[1] for a,b in zip(ring,ring[1:])]
    denominator=3*sum(crosses)
    x=sum((a[0]+b[0])*c for a,b,c in zip(ring,ring[1:],crosses))/denominator
    y=sum((a[1]+b[1])*c for a,b,c in zip(ring,ring[1:],crosses))/denominator
    if in_polygon(x,y,polygon): return round(x,6),round(y,6)
    r=random.Random(SEED+1000000+int(rid))
    return min((sample(polygon,r,[]) for _ in range(512)),key=lambda p:(p[0]-x)**2+(p[1]-y)**2)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--fetch',action='store_true');args=ap.parse_args()
    if args.fetch:
        SOURCE.parent.mkdir(parents=True,exist_ok=True)
        raw=urllib.request.urlopen(URL,timeout=45).read()
        if hashlib.sha256(raw).hexdigest()!=SHA: raise ValueError('Pinned source hash mismatch')
        SOURCE.write_bytes(raw)
    raw=SOURCE.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=SHA: raise ValueError('Pinned source hash mismatch')
    source=json.loads(raw)
    assert len(source['features'])==17
    by_name={f['properties']['shapeName']:f for f in source['features']}
    regions=[];features=[];virtual_centers=[];virtual_hospitals=[];neighbors={row[0]:[] for row in ROWS}
    for a,b in EDGES: neighbors[a].append(b);neighbors[b].append(a)
    for order,(rid,en,name,short) in enumerate(ROWS):
        f=by_name[en];geometry=copy.deepcopy(f['geometry'])
        polys=geometry['coordinates'] if geometry['type']=='MultiPolygon' else [geometry['coordinates']]
        polygon=max(polys,key=lambda p:area(p[0]))
        r=random.Random(SEED+int(rid));used=[]
        # 17 centers + 79 hospitals + 4 preserved real facilities =100.
        count=5 if order<11 else 4
        coords=[]
        for _ in range(count+1):
            xy=sample(polygon,r,used);used.append(xy);coords.append(xy)
        lon,lat=label_point(polygon,rid)
        region={'id':rid,'name':name,'shortName':short,'sourceName':en,
                'lat':lat,'lon':lon,'neighbors':sorted(neighbors[rid]),'virtualCenterId':order,
                'boundaryVintage':'2021','researchRegion':True}
        regions.append(region)
        features.append({'type':'Feature','id':rid,'properties':{
            'id':rid,'regionId':rid,'name':name,'shortName':short,'shapeName':en,
            'sourceShapeISO':f['properties']['shapeISO'],'boundaryVintage':'2021',
            'displayOnly':True,'license':'geoBoundaries CC BY 4.0; Natural Earth public domain'},'geometry':geometry})
        def virtual(kind,seq,xy):
            x,y=xy
            return {'id':None,'osmId':f'BF-VIRTUAL-{rid}-{kind.upper()}-{seq:02d}',
                    'name':f'{short} 가상 '+('공급거점' if kind=='center' else f'수요거점 {seq:02d}'),
                    'type':kind,'lat':y,'lon':x,'regionId':rid,'supplyGroup':rid,
                    'virtual':True,'verification':'synthetic_not_a_medical_institution',
                    'coordinateStatus':'synthetic_point_inside_2021_region_largest_component',
                    'addr':'가상 교육용 거점 · 실제 기관 주소 없음',
                    'source':'BLOODFLOW deterministic virtual geography generator; seed 20261022',
                    'locationNote':'실제 기관이 아님. 2021년 단순화 경계 안의 가상 지점. 실제 도로 접근점이 아님.'}
        virtual_centers.append(virtual('center',0,coords[0]))
        virtual_hospitals.extend(virtual('hospital',i,xy) for i,xy in enumerate(coords[1:],1))
    baseline=json.loads((ROOT/'public/data/facilities.json').read_text())
    assert len(baseline)==4 and baseline[0]['type']=='center'
    real=[]
    for i,n in enumerate(baseline):
        n=copy.deepcopy(n)
        n.update({'baselineId':i,'regionId':'28','supplyGroup':'incheon-validation','virtual':False,
                  'verification':'official_name_address_previously_verified_coordinates_approximate'})
        real.append(n)
    facilities=virtual_centers+[real[0]]+virtual_hospitals+real[1:]
    mapping={}
    for i,n in enumerate(facilities):
        n['id']=i
        if 'baselineId' in n: mapping[str(n['baselineId'])]=i
    assert len(facilities)==100
    assert sum(n['type']=='center' for n in facilities)==18
    assert sum(n['virtual'] for n in facilities)==96
    assert mapping=={'0':17,'1':97,'2':98,'3':99}
    for n in facilities:
        if not n['virtual']: continue
        f=next(f for f in features if f['id']==n['regionId']);g=f['geometry']
        polys=g['coordinates'] if g['type']=='MultiPolygon' else [g['coordinates']]
        assert any(in_polygon(n['lon'],n['lat'],p) for p in polys)
    provenance={
        'boundaryDataset':'geoBoundaries gbOpen KOR ADM1 KOR-ADM1-68945753',
        'boundaryVintage':'2021','boundaryBuildDate':'2023-12-12','boundarySource':'Natural Earth',
        'metadataURL':'https://www.geoboundaries.org/api/current/gbOpen/KOR/ADM1/',
        'pinnedGeometryURL':URL,'pinnedCommit':'9469f09','pinnedSHA256':SHA,
        'license':'geoBoundaries CC BY 4.0; underlying Natural Earth public domain',
        'licenseURL':'https://www.geoboundaries.org/api.html',
        'underlyingLicenseURL':'https://www.naturalearthdata.com/about/terms-of-use/',
        'attribution':'geoBoundaries / Natural Earth · 2021 boundaries, simplified educational map',
        'retrievedAt':'2026-10-22',
        'modelRegionDefinition':'17 fixed study regions based on 2021 boundaries, not current legal local-government enumeration',
        'currentGovernmentListURL':'https://www.mois.go.kr/frt/sub/a04/localGovernment/screen.do',
        'knownChangesNotReflected':[
            '대구 군위군의 2023-07-01 편입은 2021 경계에 반영되지 않음.',
            '2026-10-22 행정안전부 누리집은 전남광주통합특별시를 표시함. 광주와 전남은 과제의 17개 고정 연구권역으로 분리하며 최신 법정 시도 수를 뜻하지 않음.',
            '강원·전북은 표시 명칭만 갱신. geometry를 2026년 경계로 재검증했다는 의미가 아님.',
            '단순화 경계의 해안·도서 및 면적은 정밀 GIS/행정업무에 사용할 수 없음.'
        ]}
    dataset={'version':'BLOODFLOW-NATIONAL-GEOGRAPHY-1','seed':SEED,
             'regionCount':17,'facilityCount':100,'virtualFacilityCount':96,'realFacilityCount':4,
             'geography':provenance,'regions':regions,'facilities':facilities,'realFacilityMap':mapping,
             'adjacencyNote':'고정 연구권역의 육지 경계 인접 모형. 제주에는 육지 인접 권역 없음. 인접성은 실제 직결 도로·운송 가능성을 보장하지 않음.',
             'transportNote':'전국 가상 구간은 도로 라우팅 결과가 아님. 기존 인천4개 기관의 저장된12개 방향 경로만 별도 실제 OSRM 도로 캐시를 사용.',
             'syntheticDataNote':'100은 설계상의 거점 수이며 실제 국내 의료기관 수가 아님. 모든 재고·수요·공급량은 가상.'}
    boundaries={'type':'FeatureCollection','name':'BLOODFLOW 17 fixed study regions','attribution':provenance['attribution'],
                'license':provenance['license'],'source':provenance['pinnedGeometryURL'],
                'boundaryVintage':'2021','features':features}
    for name,value in [('nationwide.json',dataset),('regions.geojson',boundaries)]:
        p=ROOT/'public/data'/name;p.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n')
        print(name,p.stat().st_size,hashlib.sha256(p.read_bytes()).hexdigest())
    print('PASS:17 regions,100 nodes,18 centers,82 hospitals,96 virtual,4 preserved real; all synthetic points inside source boundary')
    print('realFacilityMap',mapping)

if __name__=='__main__':main()
