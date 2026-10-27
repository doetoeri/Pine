"""Retain actual AHN elevations, clip sample cells to CBS land, add actual land borders.
Water normals are a labelled procedural visualization, never hydrological data.
"""
from pathlib import Path
import json,shutil,hashlib,math,argparse
import numpy as np
from rasterio.features import rasterize
from rasterio.transform import from_bounds
from PIL import Image
from shapely.geometry import shape,box,mapping
from shapely import make_valid
from shapely.ops import transform
from pyproj import Transformer
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'public';DATA=OUT/'data'
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source-dir',type=Path,required=True,help='Directory containing land-borders.json, pdok-overview.png and nasa-overview.jpg source exports. Re-run from original pre-clipping data, not the already clipped output.')
SCRATCH=parser.parse_args().source_dir
def save(p,v):p.write_text(json.dumps(v,ensure_ascii=False,separators=(',',':')))
model=json.loads((DATA/'model.json').read_text());terrain=json.loads((DATA/'terrain.geojson').read_text());regions=json.loads((DATA/'municipalities.geojson').read_text())
to_rd=Transformer.from_crs(4326,28992,always_xy=True).transform;to_ll=Transformer.from_crs(28992,4326,always_xy=True).transform
polys=[make_valid(transform(to_rd,shape(f['geometry']))) for f in regions['features']]
for f,c in zip(terrain['features'],model['cells']):
 g=make_valid(transform(to_rd,shape(f['geometry']))).intersection(polys[c['r']])
 f['geometry']=mapping(transform(to_ll,g));c['area']=round(g.area/1e6,6);f['properties']['area']=c['area']
save(DATA/'terrain.geojson',terrain);model['meta']['analysisAreaKm2']=sum(c['area'] for c in model['cells']);model['meta']['modelStatus']='EXPLORATORY / permanent demonstration separate from temporary events';save(DATA/'model.json',model)
raw=json.loads((SCRATCH/'land-borders.json').read_text());borders=[]
for f in raw['features']:
 p=f['properties'];a=p.get('ADM0_A3_L');b=p.get('ADM0_A3_R')
 if 'NLD' not in [a,b] or not any(x in ['DEU','BEL'] for x in [a,b]):continue
 borders.append({'type':'Feature','geometry':f['geometry'],'properties':{'neighbor':'Germany' if 'DEU' in [a,b] else 'Belgium','source':'Natural Earth 1:10m Admin-0 land boundaries · public domain'}})
save(DATA/'land-borders.geojson',{'type':'FeatureCollection','features':borders})
(OUT/'imagery').mkdir(exist_ok=True);(OUT/'textures').mkdir(exist_ok=True)
# One licensed WMS export, masked to CBS land; no tile scraping or tile bundle.
from shapely.ops import unary_union
to3857=Transformer.from_crs(28992,3857,always_xy=True).transform
land=transform(to3857,unary_union(polys))
mask=rasterize([(land,255)],out_shape=(1920,1536),transform=from_bounds(333958.472,6541687.079,834896.181,7170156.294,1536,1920),fill=0,dtype='uint8')
with Image.open(SCRATCH/'pdok-overview.png') as im:
 im=im.convert('RGBA');im.putalpha(Image.fromarray(mask));im.save(OUT/'imagery/netherlands-airphoto-2025.png')
with Image.open(SCRATCH/'nasa-overview.jpg') as im:
 im=im.convert('RGBA');im.save(OUT/'imagery/blue-marble-context.png');im.putalpha(Image.fromarray(255-mask));im.save(OUT/'imagery/outside-context.png')
save(DATA/'imagery.json',{'bbox3857':[333958.472,6541687.079,834896.181,7170156.294],'attribution':'Luchtfoto 2025 · Samenwerkingsverband Beeldmateriaal / PDOK · CC BY 4.0; context NASA GIBS Blue Marble','resolution':'1536 × 1920 WMS overview; live PDOK tiles for zoom; imagery does not change with simulation year','sources':['https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0','https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi']})
# Integer Fourier frequencies give periodic height AND slope at every tile boundary.
n=512;axis=np.arange(n)/n;x,y=np.meshgrid(axis,axis);height=np.zeros((n,n));dx=height.copy();dy=height.copy();rng=np.random.default_rng(2100)
harmonics=[]
for k in range(32):
 kx=int(rng.integers(1,22));ky=int(rng.integers(-8,9));phase=float(rng.random()*2*np.pi);amp=1/(kx*kx+ky*ky)**.6;v=2*np.pi*(kx*x+ky*y)+phase
 height+=amp*np.sin(v);dx+=amp*kx*np.cos(v);dy+=amp*ky*np.cos(v);harmonics.append([kx,ky,phase,amp])
nx=-dx*.12;ny=-dy*.12;nz=np.ones_like(nx);length=np.sqrt(nx*nx+ny*ny+nz*nz)
normal=np.stack([nx/length,ny/length,nz/length],2);rgb=np.uint8(np.clip((normal*.5+.5)*255,0,255));Image.fromarray(rgb).save(OUT/'textures/water-normal.png')
h=(height-height.mean())/(height.std()+1e-8);color=np.clip(np.stack([43+h*3,113+h*6,136+h*7],2),0,255).astype('uint8');Image.fromarray(color).save(OUT/'textures/water-color.png')
save(DATA/'texture.json',{'kind':'procedural visualization, not observed water/depth','license':'MIT / project-generated Fourier normal field','periodMeters':1800,'harmonics':harmonics,'normalSHA256':hashlib.sha256((OUT/'textures/water-normal.png').read_bytes()).hexdigest()})
print('Clipped area km²',model['meta']['analysisAreaKm2'],'land borders',len(borders),'water texture periodic harmonics',len(harmonics))
