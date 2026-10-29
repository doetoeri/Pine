import type {ProgressiveFrame} from './progressive';
import {number,people,money} from './format';
import {SmoothPanel} from './SmoothPanel';

interface Props {frame:ProgressiveFrame;baseline:ProgressiveFrame;side:'left'|'right'}
export function MapMetrics({frame:f,baseline:a,side}:Props){
 const metrics:[string,number,number,(n:number)=>string][]=[
  ['침수 영향',f.permanentArea+f.temporaryArea,a.permanentArea+a.temporaryArea,n=>`${number(n,0)}km²`],
  ['영향 인구 · 추정',f.permanentPeople+f.temporaryPeople,a.permanentPeople+a.temporaryPeople,people],
  ['일시홍수 피해 · 모형',f.base.assetDamage+f.base.productionLoss,a.base.assetDamage+a.base.productionLoss,money],
  ['정책 투자비',f.policyInvestment,a.policyInvestment,money],
  ['공급 부족 · 모형',f.powerShortage.reduce((x,y)=>x+y,0),a.powerShortage.reduce((x,y)=>x+y,0),n=>`${number(n,0)}MW`]
 ];
 return <SmoothPanel className="map-metrics" data-testid={`map-metrics-${side}`} aria-label={`${side==='left'?'A':'B'} 핵심 결과`}>
  <dl>{metrics.map(([label,value,base,format],i)=>{
   const delta=base-value,same=Math.abs(delta)<1e-6;
   return <div key={label} className={`map-metric metric-${i}`} data-testid={`map-metric-${side}-${i}`} data-value={value} data-delta={delta}>
    <dt>{label}</dt><dd>{format(value)}</dd>
    <small className={side==='left'?'metric-definition':same?'':delta>0?'metric-less':'metric-more'}>
     {side==='left'?(i===0?'영구 + 해당 연도 해일':i===1?'셀 면적에 균등 배분':i===2?'실제 GDP 손실 아님':i===3?'누적 자본비':'가정 용량의 전력망'):
      same?'A와 동일':`A보다 ${format(Math.abs(delta))} ${delta>0?'감소':'증가'}`}
    </small>
   </div>;
  })}</dl>
 </SmoothPanel>;
}
