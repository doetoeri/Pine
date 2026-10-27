import {useEffect,useMemo,useRef,useState} from 'react';
import type {Dataset} from './model';
import {riskAt,temporaryMask,visualWet,type ProgressiveRun} from './progressive';
import type {Camera} from './MapView';
import {mercator} from './WaterLayer';
import {asset} from './paths';
let terrainPromise:Promise<any>|undefined;
const terrain=()=>terrainPromise??=(fetch(asset('data/terrain.geojson')).then(r=>{if(!r.ok)throw Error('terrain');return r.json()}).catch(e=>{terrainPromise=undefined;throw e}));
const masks=new WeakMap<ProgressiveRun,{year:number;first:Float32Array;next:Float32Array}>();
function storms(data:Dataset,run:ProgressiveRun,time:number){const year=Math.floor(time);let found=masks.get(run);if(!found||found.year!==year){found={year,first:temporaryMask(data,run,year),next:temporaryMask(data,run,Math.min(2100,year+1))};masks.set(run,found)}return found}
interface Props {data:Dataset;run:ProgressiveRun;otherRun?:ProgressiveRun;time:number;camera:Camera;potential:boolean;temporary:boolean;difference:boolean;name:string}
/** Shared 2D overlay on both map engines. Only exact analysis polygons affect metrics.
 * Subpixel feathering is a display treatment, not an increase in terrain resolution. */
export function FloodOverlay(p:Props){
 const canvas=useRef<HTMLCanvasElement>(null),offscreen=useRef<HTMLCanvasElement|null>(null),last=useRef({at:0,camera:'',run:p.run,other:p.otherRun,potential:p.potential,temporary:p.temporary,difference:p.difference});
 const [geo,setGeo]=useState<any>(null),[size,setSize]=useState([1,1]);
 useEffect(()=>{let alive=true;terrain().then(g=>{if(alive)setGeo(g)}).catch(()=>{});const observer=new ResizeObserver(e=>setSize([Math.round(e[0].contentRect.width),Math.round(e[0].contentRect.height)]));observer.observe(canvas.current!);return()=>{alive=false;observer.disconnect()}},[]);
 const paths=useMemo(()=>geo?.features.map((f:any)=>{const path=new Path2D(),polys=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;for(const poly of polys)for(const ring of poly){ring.forEach((c:number[],i:number)=>{const [x,y]=mercator(c[0],c[1]);if(i)path.lineTo(x,y);else path.moveTo(x,y)});path.closePath()}return path}),[geo]);
 useEffect(()=>{
  if(!paths||size[0]<2||size[1]<2)return;
  const id=JSON.stringify(p.camera),prev=last.current,now=performance.now();
  if(now-prev.at<90&&id===prev.camera&&p.run===prev.run&&p.otherRun===prev.other&&p.potential===prev.potential&&p.temporary===prev.temporary&&p.difference===prev.difference&&Math.abs(p.time-Math.round(p.time))>.015)return;
  last.current={at:now,camera:id,run:p.run,other:p.otherRun,potential:p.potential,temporary:p.temporary,difference:p.difference};
  const width=size[0],height=size[1],dpr=Math.min(1.5,window.devicePixelRatio||1),target=canvas.current!;
  if(target.width!==Math.round(width*dpr)||target.height!==Math.round(height*dpr)){target.width=Math.round(width*dpr);target.height=Math.round(height*dpr)}
  const layer=offscreen.current??(offscreen.current=document.createElement('canvas'));layer.width=target.width;layer.height=target.height;
  const ctx=layer.getContext('2d')!,screen=target.getContext('2d')!,scale=512*2**p.camera.zoom,[cx,cy]=mercator(...p.camera.center),t=p.time-Math.floor(p.time);
  ctx.setTransform(scale*dpr,0,0,scale*dpr,(width/2-cx*scale)*dpr,(height/2-cy*scale)*dpr);
  const temp=p.temporary?storms(p.data,p.run,p.time):null;
  const patternCanvas=document.createElement('canvas');patternCanvas.width=patternCanvas.height=20;const pc=patternCanvas.getContext('2d')!;pc.strokeStyle='rgba(18,112,110,.5)';pc.lineWidth=1;pc.beginPath();pc.moveTo(-5,20);pc.lineTo(20,-5);pc.moveTo(5,25);pc.lineTo(25,5);pc.stroke();const hatch=ctx.createPattern(patternCanvas,'repeat')!;hatch.setTransform(new DOMMatrix().scale(1/(scale*dpr)));
  const gradient=ctx.createLinearGradient(cx-.006,cy-.004,cx+.006,cy+.004);gradient.addColorStop(0,'#246f82');gradient.addColorStop(.53,'#2d7a88');gradient.addColorStop(1,'#194f68');
  // Conditional risk uses a translucent wash + sparse diagonal marks; never a solid flood mask.
  if(p.potential)for(let i=0;i<paths.length;i++){const pressure=riskAt(p.run,i,p.time);if(pressure<=0)continue;const wet=visualWet(p.run.firstWet[i],p.time);ctx.globalAlpha=(.12+Math.sqrt(pressure)*.31)*(1-wet);ctx.fillStyle='#49b8ad';ctx.fill(paths[i],'evenodd');ctx.fillStyle=hatch;ctx.globalAlpha=.35*(1-wet);ctx.fill(paths[i],'evenodd')}
  for(let i=0;i<paths.length;i++){
   const wet=visualWet(p.run.firstWet[i],p.time);
   if(wet>0){ctx.fillStyle=gradient;ctx.globalAlpha=wet*.72;ctx.fill(paths[i],'evenodd')}
   const transient=temp?(temp.first[i]*(1-t)+temp.next[i]*t)*(1-wet):0;
   if(transient>0){ctx.fillStyle='#d9a235';ctx.globalAlpha=transient*.52;ctx.fill(paths[i],'evenodd')}
   if(p.difference&&p.otherRun){const otherWet=visualWet(p.otherRun.firstWet[i],p.time),wetDelta=wet-otherWet,riskDelta=riskAt(p.run,i,p.time)-riskAt(p.otherRun,i,p.time);const diff=Math.abs(wetDelta)>.02?wetDelta:riskDelta;
    if(Math.abs(diff)>.0002){ctx.fillStyle=diff>0?'#df751c':'#8c51c6';ctx.globalAlpha=.35+Math.min(.43,Math.sqrt(Math.abs(diff))*.6);ctx.fill(paths[i],'evenodd')}
   }
  }
  ctx.globalAlpha=1;screen.setTransform(1,0,0,1,0,0);screen.clearRect(0,0,target.width,target.height);screen.filter=`blur(${.65*dpr}px)`;screen.drawImage(layer,0,0);screen.filter='none';
 },[p.time,p.run,p.otherRun,p.camera,p.potential,p.temporary,p.difference,paths,size]);
 return <canvas ref={canvas} className="map-overlay-canvas" aria-label="모형 침수와 잠재 위험 지형 레이어" data-testid={`overlay-${p.name}`} data-risk-visible={p.potential} data-flood-layer="model-only" data-difference={p.difference}/>;
}
