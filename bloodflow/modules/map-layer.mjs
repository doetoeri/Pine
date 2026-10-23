import {TileScheduler,TileRequestWindow} from './map-requests.mjs';
// Keep the rolling request window through map removal, navigation and background toggles.
// Same-origin templates/names share a limit; no provider rotation or cross-tab storage.
const providerWindows=new Map();
function requestWindowFor(provider){
 const origin=new URL(provider.url,globalThis.location?.href).origin;
 if(!providerWindows.has(origin))providerWindows.set(origin,new TileRequestWindow());
 return providerWindows.get(origin);
}
export function onlineProvider(runtime={},fixture=false){
 if(fixture)return {name:'테스트 전용 503 타일',url:'/bloodflow/qa/tiles/{z}/{x}/{y}.svg',attribution:'BLOODFLOW synthetic fault fixture',fixture:true,maxZoom:15};
 const custom=runtime.tileProvider;
 if(custom){if(!custom.termsReviewed||!custom.attribution||!/^https:\/\//.test(custom.url)||!['{z}','{x}','{y}'].every(k=>custom.url.includes(k)))throw Error('지도 제공자 URL·출처·이용조건 확인 설정이 필요합니다.');return custom;}
 return {name:'OpenStreetMap 표준 타일',url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',maxZoom:18};
}
export function createOnlineLayer(L,provider,onState){
 let disposed=false;const urls=new Set();
 // A limit may close synchronously inside Leaflet's createTile/onAdd stack.
 // Let that stack finish before the UI removes the exhausted layer.
 const scheduler=new TileScheduler({requestWindow:requestWindowFor(provider),onState:s=>queueMicrotask(()=>{if(!disposed)onState({...s,provider:provider.name,fixture:!!provider.fixture});})});
 const Layer=L.GridLayer.extend({
  createTile(coords,done){
   const img=document.createElement('img');img.alt='';img.setAttribute('role','presentation');img.width=img.height=256;
   let finished=false;const complete=error=>{if(finished||disposed||!img.isConnected)return;finished=true;img.onload=img.onerror=null;done(error,img);};
   const url=provider.url.replace('{z}',coords.z).replace('{x}',coords.x).replace('{y}',coords.y);
   img.dataset.requestUrl=url;
   scheduler.request(url).then(blob=>{
    if(disposed||!img.isConnected)return;
    const objectURL=URL.createObjectURL(blob);urls.add(objectURL);img.onload=()=>complete(null);img.onerror=()=>complete(Error('타일 이미지 해석 실패'));img.src=objectURL;
   }).catch(complete);return img;
  },
  onRemove(map){disposed=true;scheduler.stop('저장된 벡터 지도');for(const url of urls)URL.revokeObjectURL(url);urls.clear();L.GridLayer.prototype.onRemove.call(this,map);}
 });
 const layer=new Layer({attribution:provider.attribution,maxZoom:provider.maxZoom??18,updateWhenIdle:true,updateWhenZooming:false,keepBuffer:0});
 layer.on('tileunload',e=>{e.tile.onload=e.tile.onerror=null;scheduler.cancelQueued(e.tile.dataset.requestUrl);if(e.tile.src?.startsWith('blob:')){URL.revokeObjectURL(e.tile.src);urls.delete(e.tile.src);}});
 return {layer,scheduler};
}
