import {CATALOG,active,complete,policyCost,type Dataset,type Policy} from './model';
import type {PolicySide} from './store';

/** Fixed CBS municipality IDs, ranked by the unmodified extreme-demo baseline's
 * 2100 permanent + current-year temporary inundation area (seed 2100).
 * Area priority is a teaching choice, not a population/cost optimum. Keeping this
 * selection fixed makes the preset independent of the live climate, year and A/B. */
export const EXAMPLE_REGION_IDS=[
 'GM1900','GM0171','GM1966','GM1940','GM1911','GM1969','GM1970','GM0303','GM1708','GM1952',
 'GM1963','GM1949','GM1714','GM1979','GM1924','GM0050','GM0995','GM0715','GM0080','GM1895',
 'GM0599','GM1959','GM1960','GM0098','GM1676','GM0363','GM0394','GM0086','GM1978','GM0677',
 'GM0074','GM0014','GM0441','GM1950','GM0737','GM1931','GM0148','GM1709','GM1961','GM0851',
 'GM0716','GM0448','GM0034','GM0654','GM0166','GM0717','GM0484','GM0180','GM1992','GM0420',
 'GM0090','GM0361','GM0736','GM1719','GM0193','GM1773','GM1904','GM0703','GM0214','GM0758',
 'GM0344','GM0059','GM0505','GM1680','GM0439','GM1690','GM1730','GM1699','GM0632','GM0569',
 'GM1901','GM1896','GM0297','GM0664','GM1598','GM1695','GM1891','GM0479','GM0796','GM1783',
 'GM0047','GM1930','GM0263','GM0331','GM1696','GM1884','GM0085','GM0518','GM0797','GM0177',
 'GM0310','GM0748','GM1892','GM1655','GM0093','GM0269','GM1980','GM0867','GM0037','GM0267',
] as const;

/** Nationwide teaching example using unchanged catalogue costs, construction
 * periods and lifetimes. Not a validated or government-endorsed defence plan. */
export function examplePolicy(data:Dataset):PolicySide {
 const regions=new Map(data.regions.map((r,i)=>[r.id,i]));
 const policySet:Policy[]=EXAMPLE_REGION_IDS.flatMap(id=>{
  const region=regions.get(id);
  if(region===undefined)throw new Error(`모범 정책의 행정구역 자료가 없습니다: ${id}`);
  return [
   {id:`example-nature-${id}-2034`,kind:'nature',region,start:2026,end:2034},
   {id:`example-dike-${id}-2036`,kind:'dike',region,start:2026,end:2036},
   {id:`example-barrier-${id}-2041`,kind:'barrier',region,start:2026,end:2041},
   {id:`example-dike-${id}-2096`,kind:'dike',region,start:2086,end:2096},
  ];
 });
 return {name:'전국 방재 모범안',policySet,budget:600,annualBudget:40};
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
