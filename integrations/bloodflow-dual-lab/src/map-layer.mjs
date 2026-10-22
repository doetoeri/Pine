import {TileScheduler} from './map-requests.mjs';
export function onlineProvider(runtime={},fixture=false){
 if(fixture)return {name:'테스트 전용 503 타일',url:'/bloodflow/qa/tiles/{z}/{x}/{y}.svg',attribution:'BLOODFLOW synthetic fault fixture',fixture:true,maxZoom:15};
 const custom=runtime.tileProvider;
 if(custom){if(!custom.termsReviewed||!custom.attribution||!/^https:\/\//.test(custom.url)||!['{z}','{x}','{y}'].every(k=>custom.url.includes(k)))throw Error('지도 제공자 URL·출처·이용조건 확인 설정이 필요합니다.');return custom;}
 return {name:'OpenStreetMap 표준 타일',url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',maxZoom:18};
}
export function createOnlineLayer(L,provider,onState){
 let disposed=false;const urls=new Set();
 const scheduler=new TileScheduler({onState:s=>{if(!disposed)onState({...s,provider:provider.name,fixture:!!provider.fixture});}});
 const Layer=L.GridLayer.extend({
  createTile(coords,done){
   const img=document.createElement('img');img.alt='';img.setAttribute('role','presentation');img.width=img.height=256;
   const url=provider.url.replace('{z}',coords.z).replace('{x}',coords.x).replace('{y}',coords.y);
   img.dataset.requestUrl=url;
   scheduler.request(url).then(blob=>{
    if(disposed||!img.isConnected){done(Error('이동한 지도 타일'),img);return;}
    const objectURL=URL.createObjectURL(blob);urls.add(objectURL);img.onload=()=>done(null,img);img.onerror=()=>done(Error('타일 이미지 해석 실패'),img);img.src=objectURL;
   }).catch(error=>done(error,img));return img;
  },
  onRemove(map){disposed=true;scheduler.stop('저장된 벡터 지도');for(const url of urls)URL.revokeObjectURL(url);urls.clear();L.GridLayer.prototype.onRemove.call(this,map);}
 });
 const layer=new Layer({attribution:provider.attribution,maxZoom:provider.maxZoom??18,updateWhenIdle:true,updateWhenZooming:false,keepBuffer:0});
 layer.on('tileunload',e=>{scheduler.cancelQueued(e.tile.dataset.requestUrl);if(e.tile.src?.startsWith('blob:')){URL.revokeObjectURL(e.tile.src);urls.delete(e.tile.src);}});
 return {layer,scheduler};
}
