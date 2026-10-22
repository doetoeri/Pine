"""One bounded OSM extract and 12 cached directed OSRM requests. No tile prefetch."""
from pathlib import Path
import json,urllib.request,urllib.parse,time,datetime
base=Path(__file__).resolve().parents[1];out=base/'public/data'
nodes=json.loads((out/'facilities.json').read_text())
headers={'User-Agent':'BLOODFLOW-Dual-Lab/1.0 (educational research; https://pincon.app/bloodflow)'}
def read(url,timeout=40):
 with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=timeout) as r:return json.load(r)
p=out/'routes.json';routes=json.loads(p.read_text()) if p.exists() else {'provider':'OSRM demo / driving, OpenStreetMap','retrievedAt':'2026-10-21','liveTraffic':False,'license':'ODbL 1.0, © OpenStreetMap contributors','routes':{}}
for a in nodes:
 for b in nodes:
  if a['id']==b['id']:continue
  key=f"{a['id']}>{b['id']}"
  if key in routes['routes']:continue
  coords=f"{a['lon']},{a['lat']};{b['lon']},{b['lat']}"
  url=f'https://router.project-osrm.org/route/v1/driving/{coords}?overview=full&geometries=geojson&steps=false'
  try:
   j=read(url);assert j['code']=='Ok';v=j['routes'][0];assert all(w['distance']<1500 for w in j['waypoints']);assert v['duration']>0
   routes['routes'][key]={'from':a['id'],'to':b['id'],'durationSeconds':v['duration'],'distanceMeters':v['distance'],'geometry':v['geometry'],'waypoints':j['waypoints'],'sourceURL':url,'retrievedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
   p.write_text(json.dumps(routes,ensure_ascii=False,separators=(',',':')));print('route',key,round(v['duration']/60,1),'minutes',flush=True)
  except Exception as e:print('FAILED route',key,str(e),flush=True)
  time.sleep(1.1)
q='[out:json][timeout:40];way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](37.395,126.605,37.49,126.74);out geom;'
p=out/'roads.geojson'
if not p.exists():
 try:
  j=read('https://overpass-api.de/api/interpreter?'+urllib.parse.urlencode({'data':q}),60)
  fs=[{'type':'Feature','properties':{'osmId':e['id'],'name':e.get('tags',{}).get('name',''),'highway':e.get('tags',{}).get('highway','')},'geometry':{'type':'LineString','coordinates':[[g['lon'],g['lat']] for g in e['geometry']]}} for e in j['elements'] if e.get('geometry')]
  assert fs
  p.write_text(json.dumps({'type':'FeatureCollection','license':'ODbL 1.0, © OpenStreetMap contributors','source':'https://overpass-api.de/api/interpreter','retrievedAt':'2026-10-21','features':fs},ensure_ascii=False,separators=(',',':')));print('OSM roads',len(fs),flush=True)
 except Exception as e:
  print('FAILED OSM extract',str(e),flush=True)
  fs=[{'type':'Feature','properties':{'highway':'cached_route'},'geometry':v['geometry']} for v in routes['routes'].values()]
  p.write_text(json.dumps({'type':'FeatureCollection','license':'ODbL 1.0','source':'cached OSRM route geometries only','features':fs},separators=(',',':')))
