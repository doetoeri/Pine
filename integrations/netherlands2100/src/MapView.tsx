import {useEffect,useMemo,useRef,useState} from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type {Dataset} from './model';
import {visualWet,temporaryMask,type ProgressiveRun} from './progressive';
import {mercator} from './WaterLayer';
import {FloodOverlay} from './FloodOverlay';
import {asset} from './paths';
export interface Camera{center:[number,number];zoom:number;bearing:number;pitch:number}
export interface MapProps{data:Dataset;run:ProgressiveRun;time:number;camera:Camera;onCamera:(c:Camera)=>void;onSelect:(i:number)=>void;selected:number;temporary:boolean;recovery:boolean;name:string;simple:boolean;potential:boolean;difference:boolean;otherRun?:ProgressiveRun}
const imageCorners:[[number,number],[number,number],[number,number],[number,number]]=[[3,54],[7.5,54],[7.5,50.5],[3,50.5]];
export function MapView(p:MapProps){
 const container=useRef<HTMLDivElement>(null),map=useRef<maplibregl.Map|null>(null),live=useRef(p);live.current=p;
 const syncing=useRef(false);
 const [ready,setReady]=useState(false),[fallback,setFallback]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  let m:maplibregl.Map;const markers:maplibregl.Marker[]=[];
  try{m=new maplibregl.Map({container:container.current!,style:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#c2d5d3'}}]},...p.camera,minZoom:5,maxZoom:16,renderWorldCopies:false,attributionControl:{compact:false},dragRotate:false,pitchWithRotate:false,touchPitch:false,canvasContextAttributes:{antialias:true},fadeDuration:200});map.current=m}catch{setFallback(true);return}
  let cancelled=false;
  m.once('style.load',async()=>{
   try{
    const [regions,terrain,borders,facilities]=await Promise.all(['municipalities.geojson','terrain.geojson','land-borders.geojson','facilities.geojson'].map(f=>fetch(asset('data/'+f)).then(r=>{if(!r.ok)throw Error(f);return r.json()})));if(cancelled)return;
    m.addSource('wide-photo',{type:'image',url:asset('imagery/nasa-europe.jpg'),coordinates:[[-12,62],[22,62],[22,45],[-12,45]]});m.addLayer({id:'wide-photo',type:'raster',source:'wide-photo',paint:{'raster-fade-duration':0}});
    m.addSource('overview',{type:'image',url:asset('imagery/netherlands-airphoto-2025.png'),coordinates:imageCorners});m.addLayer({id:'overview',type:'raster',source:'overview',paint:{'raster-fade-duration':0,'raster-saturation':-.1,'raster-brightness-min':.07}});
    m.addSource('airphoto',{type:'raster',tiles:['https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/2025_ortho25/EPSG:3857/{z}/{x}/{y}.jpeg'],tileSize:256,minzoom:7,maxzoom:19,attribution:'© Samenwerkingsverband Beeldmateriaal / PDOK · CC BY 4.0 | NASA GIBS Blue Marble | CBS 2024 · AHN · Natural Earth'});
    m.addLayer({id:'airphoto',type:'raster',source:'airphoto',minzoom:8.5,paint:{'raster-opacity':['interpolate',['linear'],['zoom'],8.5,0,10,1],'raster-fade-duration':220,'raster-saturation':-.07}});
    m.addSource('outside-photo',{type:'image',url:asset('imagery/outside-context.png'),coordinates:imageCorners});m.addLayer({id:'outside-photo',type:'raster',source:'outside-photo',paint:{'raster-fade-duration':0}});
    m.addSource('regions',{type:'geojson',data:regions,promoteId:'id'});m.addLayer({id:'region-click',type:'fill',source:'regions',paint:{'fill-opacity':0}});m.addLayer({id:'municipal-boundaries',type:'line',source:'regions',paint:{'line-color':'#f7fbef','line-opacity':.22,'line-width':.7}});
    m.addSource('borders',{type:'geojson',data:borders});m.addLayer({id:'land-borders-casing',type:'line',source:'borders',paint:{'line-color':'#fff9e9','line-width':5,'line-opacity':.92}});m.addLayer({id:'land-borders',type:'line',source:'borders',paint:{'line-color':'#32463c','line-width':2.1,'line-dasharray':[3,1.8]}});
    m.addLayer({id:'selected-region',type:'line',source:'regions',paint:{'line-color':'#f4e69e','line-width':['case',['boolean',['feature-state','selected'],false],3,0],'line-opacity':.95}});
    m.addSource('facilities',{type:'geojson',data:facilities});m.addLayer({id:'facilities',type:'circle',source:'facilities',minzoom:8.5,paint:{'circle-radius':4.5,'circle-color':['match',['get','kind'],'power','#f1c765','defence','#93e0b8','#edf3ef'],'circle-stroke-color':'#244b51','circle-stroke-width':1.4}});
    for(const name of ['Amsterdam','Rotterdam',"'s-Gravenhage",'Utrecht','Groningen','Almere','Eindhoven']){
     const r=p.data.regions.find(r=>r.name===name);if(!r)continue;const button=document.createElement('button');button.className='map-city';const text=document.createElement('span');text.textContent=name==="'s-Gravenhage"?'Den Haag':name;button.append(text);button.title=name;button.onclick=e=>{e.stopPropagation();live.current.onSelect(r.i)};markers.push(new maplibregl.Marker({element:button,anchor:name==="'s-Gravenhage"?'right':'left',offset:[name==="'s-Gravenhage"?-9:9,name==='Almere'?-22:name==='Rotterdam'?10:0]}).setLngLat([r.lon,r.lat]).addTo(m));
    }
    for(const [text,pos] of [['DEUTSCHLAND',[7.18,52.12]],['BELGIË',[4.8,50.9]]] as [string,[number,number]][]){const el=document.createElement('div');el.className='country-label';el.textContent=text;markers.push(new maplibregl.Marker({element:el}).setLngLat(pos).addTo(m))}
    m.on('click','region-click',e=>{const i=e.features?.[0]?.properties?.i;if(i!==undefined)live.current.onSelect(Number(i))});m.addControl(new maplibregl.NavigationControl({showCompass:false}),'bottom-right');setReady(true);
   }catch(e){if(!cancelled)setError(String(e))}
  });
  m.on('move',()=>{if(syncing.current)return;live.current.onCamera({center:m.getCenter().toArray() as [number,number],zoom:m.getZoom(),bearing:m.getBearing(),pitch:m.getPitch()})});const observer=new ResizeObserver(()=>m.resize());observer.observe(container.current!);
  return()=>{cancelled=true;observer.disconnect();markers.forEach(m=>m.remove());m.remove();map.current=null};
 },[]);
 useEffect(()=>{const m=map.current;if(!m||!ready)return;for(const r of p.data.regions)m.setFeatureState({source:'regions',id:r.id},{selected:r.i===p.selected})},[p.selected,ready]);
 useEffect(()=>{const m=map.current;if(!m||!ready)return;const c=p.camera,cur=m.getCenter();if(Math.abs(cur.lng-c.center[0])>.0001||Math.abs(cur.lat-c.center[1])>.0001||Math.abs(m.getZoom()-c.zoom)>.01){syncing.current=true;m.jumpTo({...c});syncing.current=false}},[p.camera,ready]);
 return <div className="map-view" data-testid={'map-'+p.name} data-renderer={fallback?'svg':'maplibre'} data-imagery={ready||fallback?'ready':'loading'}><div ref={container} className="map-engine"/>{fallback&&<FlatMap {...p}/>}<FloodOverlay {...p}/> {!ready&&!fallback&&!error&&<div className="map-loading">실제 항공영상 · GIS 로딩 중</div>}{error&&<div className="map-loading error">지도를 불러오지 못했습니다. {error}<button onClick={()=>location.reload()}>다시 시도</button></div>}</div>;
}
function svgPath(g:any):string{const line=(xs:number[][])=>xs.map((v,i)=>`${i?'L':'M'}${mercator(v[0],v[1]).join(',')}`).join('')+'Z';return g.type==='Polygon'?g.coordinates.map(line).join(''):g.type==='MultiPolygon'?g.coordinates.flatMap((p:any)=>p.map(line)).join(''):g.type==='LineString'?line(g.coordinates).slice(0,-1):g.type==='MultiLineString'?g.coordinates.map((c:any)=>line(c).slice(0,-1)).join(''):''}
function FlatMap(p:MapProps){
 const [docs,setDocs]=useState<any[]|null>(null),[size,setSize]=useState([1920,1080]);const ref=useRef<HTMLDivElement>(null),drag=useRef<[number,number]|null>(null),ignoreClick=useRef(false);
 useEffect(()=>{Promise.all(['municipalities.geojson','terrain.geojson','land-borders.geojson'].map(f=>fetch(asset('data/'+f)).then(r=>r.json()))).then(setDocs);const ob=new ResizeObserver(e=>setSize([e[0].contentRect.width,e[0].contentRect.height]));ob.observe(ref.current!);return()=>ob.disconnect()},[]);
 const transient=useMemo(()=>temporaryMask(p.data,p.run,p.time),[p.data,p.run,Math.floor(p.time)]);
 const paths=useMemo(()=>docs?.map(d=>d.features.map((f:any)=>({...f,d:svgPath(f.geometry)}))),[docs]);const [cx,cy]=mercator(...p.camera.center),scale=512*2**p.camera.zoom,w=size[0]/scale,h=size[1]/scale;const tl=mercator(3,54),br=mercator(7.5,50.5),unit=Math.min(2,Math.max(.9,window.innerWidth/1920));
 const shift=(dx:number,dy:number)=>{const xx=cx-dx/scale,yy=cy-dy/scale;const center:[number,number]=[xx*360-180,Math.atan(Math.sinh(Math.PI*(1-2*yy)))*180/Math.PI];p.onCamera({...p.camera,center})};
 return <div className="flat-map" ref={ref} data-testid={'fallback-'+p.name}>{paths&&<svg width="100%" height="100%" viewBox={`${cx-w/2} ${cy-h/2} ${w} ${h}`} role="img" aria-label="실제 항공영상과 내륙 국경" onClickCapture={e=>{if(ignoreClick.current){ignoreClick.current=false;e.stopPropagation();e.preventDefault()}}} onPointerDown={e=>{drag.current=[e.clientX,e.clientY]}} onPointerUp={e=>{const d=drag.current;if(d&&Math.hypot(e.clientX-d[0],e.clientY-d[1])>8){ignoreClick.current=true;shift(e.clientX-d[0],e.clientY-d[1])}drag.current=null}} onWheel={e=>p.onCamera({...p.camera,zoom:Math.max(5,Math.min(15,p.camera.zoom+(e.deltaY<0?.2:-.2)))})}>
  <rect x={cx-w/2} y={cy-h/2} width={w} height={h} fill="#bdd5d4"/>
  <image href={asset('imagery/nasa-europe.jpg')} x={mercator(-12,62)[0]} y={mercator(-12,62)[1]} width={mercator(22,45)[0]-mercator(-12,62)[0]} height={mercator(22,45)[1]-mercator(-12,62)[1]} preserveAspectRatio="none"/><image href={asset('imagery/netherlands-airphoto-2025.png')} x={tl[0]} y={tl[1]} width={br[0]-tl[0]} height={br[1]-tl[1]} preserveAspectRatio="none"/>
  {paths[0].map((f:any)=><path key={f.properties.id} d={f.d} fill="transparent" stroke={f.properties.i===p.selected?'#f6edb5':'#ffffff'} strokeWidth={f.properties.i===p.selected?3:.5} strokeOpacity={f.properties.i===p.selected?1:.2} vectorEffect="non-scaling-stroke" fillRule="evenodd" onClick={e=>{e.stopPropagation();p.onSelect(f.properties.i)}}/>)}
  {paths[2].map((f:any,i:number)=><g key={i} data-testid="land-border"><path d={f.d} fill="none" stroke="#fff8df" strokeWidth={6*unit} vectorEffect="non-scaling-stroke"/><path d={f.d} fill="none" stroke="#344b3c" strokeWidth={2.6*unit} strokeDasharray={`${7*unit} ${4*unit}`} vectorEffect="non-scaling-stroke"/></g>)}
  {['Amsterdam','Rotterdam',"'s-Gravenhage",'Utrecht','Groningen','Almere','Eindhoven'].map(name=>{const r=p.data.regions.find(r=>r.name===name);if(!r)return null;const pos=mercator(r.lon,r.lat);return <g key={name} transform={`translate(${pos[0]},${pos[1]})`} onClick={()=>p.onSelect(r.i)}><circle r={3*unit/scale} fill="#fff8ec"/><text textAnchor={name==="'s-Gravenhage"?'end':'start'} x={(name==="'s-Gravenhage"?-9:7)*unit/scale} y={(name==='Almere'?-14:5)*unit/scale} fontSize={17*unit/scale} fontFamily="Arial" paintOrder="stroke" fill="white" stroke="#1a3943" strokeWidth={3*unit/scale}>{name==="'s-Gravenhage"?'Den Haag':name}</text></g>})}
 </svg>}<div className="flat-note">2D 항공영상 · 경계 완화 · 약 2km 모형 · © Beeldmateriaal / PDOK · CC BY 4.0 · NASA GIBS · CBS / AHN / Natural Earth</div><div className="flat-zoom"><button aria-label="확대" onClick={()=>p.onCamera({...p.camera,zoom:p.camera.zoom+.4})}>+</button><button aria-label="축소" onClick={()=>p.onCamera({...p.camera,zoom:p.camera.zoom-.4})}>−</button></div></div>;
}
