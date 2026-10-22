// Shared by the engine and map. No runtime road API calls are made here.
export const NATIONAL_POLICIES={A:'지역 내부 공급 우선',B:'인접 권역 재배치',C:'전국 통합 공급'};
const rad=x=>x*Math.PI/180;
export function distanceKm(a,b){
 const q=Math.sin(rad(b.lat-a.lat)/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lon-a.lon)/2)**2;
 return 6371*2*Math.atan2(Math.sqrt(q),Math.sqrt(Math.max(0,1-q)));
}
export function networkFacilities(data,network='incheon'){
 if(network==='nationwide'){
  if(data.nationwide?.facilities?.length!==100||data.nationwide.regions?.length!==17)throw Error('전국 100거점·17개 고정 연구권역 자료가 필요합니다.');
  return data.nationwide.facilities;
 }
 if(data.facilities?.length!==4)throw Error('인천 검증용 4개 기관 자료가 필요합니다.');
 return data.facilities;
}
export function routeFor(data,a,b,network='incheon'){
 const oldA=network==='incheon'?a.id:a.baselineId,oldB=network==='incheon'?b.id:b.baselineId;
 const cached=oldA!==undefined&&oldB!==undefined&&data.routes?.routes?.[oldA+'>'+oldB];
 if(cached)return {hours:cached.durationSeconds/3600,distanceKm:cached.distanceMeters/1000,geometry:cached.geometry,estimated:false,label:'저장된 OSRM 도로 경로 · 교통 미반영'};
 if(a.id===b.id)return {hours:0,distanceKm:0,estimated:false};
 if(network==='incheon')throw Error('인천 실제 도로 경로 캐시가 불완전합니다.');
 const distance=distanceKm(a,b)*1.35,island=(a.regionId==='50')!==(b.regionId==='50');
 return {hours:Math.max(.15,distance/60+.25+(island?6:0)),distanceKm:distance,estimated:true,
  geometry:{type:'LineString',coordinates:[[a.lon,a.lat],[b.lon,b.lat]]},
  label:island?'추정 연결선 · 제주 왕래 가상 추가 6시간, 실제 운항 아님':'추정 연결선 · 직선거리×1.35÷60km/h+0.25h'};
}
export function geographyConfig(data,network='incheon'){
 const nodes=networkFacilities(data,network);
 return {realNodes:nodes,roadHours:nodes.map(a=>nodes.map(b=>routeFor(data,a,b,network).hours)),regions:network==='nationwide'?data.nationwide.regions:[],datasetVersion:network==='nationwide'?data.nationwide.version:'incheon-20261021'};
}
export function allowedSource(source,target,policy,regions=[]){
 if(source.regionId===target.regionId)return true;
 if(policy==='C')return true;
 return policy==='B'&&!!regions.find(r=>r.id===target.regionId)?.neighbors.includes(source.regionId);
}
