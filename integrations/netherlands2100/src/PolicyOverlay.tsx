import {useEffect,useMemo,useState} from 'react';
import type {Dataset,Policy} from './model';
import {policyStatus,STATUS_TEXT,type PolicyStatus} from './examplePolicy';
import type {Camera} from './MapView';
import {mercator} from './WaterLayer';
import {asset} from './paths';

let boundaries:Promise<any>|undefined;
const getBoundaries=()=>boundaries??=(fetch(asset('data/municipalities.geojson')).then(r=>{if(!r.ok)throw Error('policy boundaries');return r.json()}).catch(e=>{boundaries=undefined;throw e}));
const priority:Record<PolicyStatus,number>={expired:0,planned:1,building:2,active:3};
const colors:Record<PolicyStatus,string>={active:'#b8f779',building:'#ffe09a',planned:'#ffffff',expired:'#c4c7c3'};
interface Props {data:Dataset;plan:Policy[];time:number;camera:Camera;name:string}
/** Real municipal boundaries describe the model's policy jurisdiction. They are
 * not surveyed dike alignments, construction footprints, or added flood area. */
export function PolicyOverlay({data,plan,time,camera,name}:Props){
 const [geo,setGeo]=useState<any>(null),[size,setSize]=useState([1,1]);
 const [node,setNode]=useState<SVGSVGElement|null>(null);
 useEffect(()=>{let alive=true;getBoundaries().then(g=>{if(alive)setGeo(g)}).catch(()=>{});return()=>{alive=false}},[]);
 useEffect(()=>{if(!node)return;const ob=new ResizeObserver(es=>setSize([es[0].contentRect.width,es[0].contentRect.height]));ob.observe(node);return()=>ob.disconnect()},[node]);
 const paths=useMemo(()=>geo?.features.map((f:any)=>{
  const polygons=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
  return {region:Number(f.properties.i),d:polygons.flatMap((p:number[][][])=>p.map(ring=>ring.map((c,i)=>`${i?'L':'M'}${mercator(c[0],c[1]).join(',')}`).join('')+'Z')).join('')};
 }),[geo]);
 const year=Math.floor(time),regions=useMemo(()=>{
  const result=new Map<number,PolicyStatus>();
  for(const p of plan){const status=policyStatus(p,year),previous=result.get(p.region);if(!previous||priority[status]>priority[previous])result.set(p.region,status);if(p.kind==='relocate'&&p.destination!==undefined&&!result.has(p.destination))result.set(p.destination,status)}
  return result;
 },[plan,year]);
 const [cx,cy]=mercator(...camera.center),scale=512*2**camera.zoom,w=size[0]/scale,h=size[1]/scale,unit=Math.max(.9,Math.min(2,window.innerWidth/1920));
 return <svg ref={setNode} className="policy-overlay" viewBox={`${cx-w/2} ${cy-h/2} ${w} ${h}`} aria-label="정책 적용 행정구역 · 실제 공사 위치 아님" data-testid={`policy-overlay-${name}`} data-regions={regions.size}>
  {paths?.filter((p:{region:number})=>regions.has(p.region)).map((p:{region:number;d:string})=>{const status=regions.get(p.region)!;return <g key={p.region} data-status={status}><title>{data.regions[p.region]?.name} · {STATUS_TEXT[status]} · 정책 적용 행정구역</title><path d={p.d} fill="none" stroke="#183e34" strokeWidth={5*unit} strokeOpacity=".65" vectorEffect="non-scaling-stroke"/><path d={p.d} fill={status==='active'?'#b8f779':'none'} fillOpacity=".08" stroke={colors[status]} strokeWidth={2.5*unit} strokeDasharray={status==='active'?undefined:`${7*unit} ${5*unit}`} vectorEffect="non-scaling-stroke" fillRule="evenodd"/></g>})}
 </svg>;
}
