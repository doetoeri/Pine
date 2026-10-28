import {CATALOG,active,complete,policyCost,type Dataset,type Policy,type PolicyKind} from './model';
import type {PolicySide} from './store';

/** A reproducible teaching example using the existing catalogue, not an optimized
 * or government-endorsed plan. Dates include renewal of short-lived assets. */
export function examplePolicy(data:Dataset):PolicySide {
 const policySet:Policy[]=[];
 const add=(kind:PolicyKind,name:string,start:number,end:number,extra:Partial<Policy>={})=>{
  const region=data.regions.findIndex(r=>r.name===name);
  if(region>=0)policySet.push({id:`example-${kind}-${region}-${end}`,kind,region,start,end,...extra});
 };
 for(const city of ['Rotterdam','Amsterdam','Almere','Haarlemmermeer','Dordrecht','Zaanstad'])add('barrier',city,2026,2041);
 for(const city of ['Rotterdam','Amsterdam','Almere']){
  add('drainage',city,2028,2034);add('drainage',city,2063,2069);
  add('hardening',city,2030,2035);add('hardening',city,2065,2070);
 }
 for(const city of ['Rotterdam','Amsterdam']){
  add('grid',city,2031,2039);add('grid',city,2076,2084);
  add('transport',city,2030,2039);add('transport',city,2080,2089);
 }
 const destination=data.regions.findIndex(r=>r.name==='Apeldoorn');
 if(destination>=0){
  add('greenCity','Apeldoorn',2026,2038);
  for(const city of ['Rotterdam','Almere'])add('relocate',city,2034,2040,{destination,people:30000});
 }
 return {name:'통합 적응 모범안',policySet,budget:40,annualBudget:3};
}

export type PolicyStatus='planned'|'building'|'active'|'expired';
export function policyStatus(p:Policy,year:number):PolicyStatus {
 if(year<p.start)return 'planned';
 if(year<complete(p))return 'building';
 return active(p,year)?'active':'expired';
}
export const STATUS_TEXT:Record<PolicyStatus,string>={planned:'착공 전',building:'공사 중',active:'효력 중',expired:'수명 종료'};
export function policySummary(plan:Policy[],year:number){
 const counts={planned:0,building:0,active:0,expired:0};
 for(const p of plan)counts[policyStatus(p,year)]++;
 return {...counts,nextCompletion:plan.filter(p=>complete(p)>year).reduce((next,p)=>Math.min(next,complete(p)),Infinity),cost:plan.reduce((sum,p)=>sum+policyCost(p),0)};
}
export function policyEffect(p:Policy){
 const s=CATALOG[p.kind];
 if(['barrier','dike','nature'].includes(p.kind))return `지역 방어 한계 +${s.boost}m · 가정`;
 if(p.kind==='drainage')return '일시 홍수 깊이 0.35m 완화 · 가정';
 if(p.kind==='hardening')return '침수 때 전력 공급 가용성 보강 · 가정';
 if(p.kind==='grid')return '인접 지역 송전 용량 2배 · 가정';
 if(p.kind==='transport')return '지역 물류 손실 50% 완화 · 가정';
 if(p.kind==='greenCity')return '이주 도착지 6만 명 수용 · 가정';
 return `준공 때 최대 ${(p.people??30000).toLocaleString('ko-KR')}명 이주 · 가정`;
}
