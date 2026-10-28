import type {Policy} from './model';
import type {ProgressiveFrame} from './progressive';
import {policySummary} from './examplePolicy';
import {number,people,money} from './format';

interface Props {a:ProgressiveFrame;b:ProgressiveFrame;left:Policy[];right:Policy[];year:number;effect:{year:number;kind:'flood'|'risk';hasDifference:boolean};onEffect:()=>void;onFocus:()=>void}
export function DifferenceSummary({a,b,left,right,year,effect,onEffect,onFocus}:Props){
 const sums=[policySummary(left,year),policySummary(right,year)];
 const metrics:[string,number,number,(n:number)=>string][]=[
  ['침수 영향 · 영구 + 해당 연도 해일',a.permanentArea+a.temporaryArea,b.permanentArea+b.temporaryArea,n=>`${number(n,1)}km²`],
  ['영향 인구 · 균등 분포 추정',a.permanentPeople+a.temporaryPeople,b.permanentPeople+b.temporaryPeople,people],
  ['일시홍수 피해 · 모형',a.base.assetDamage+a.base.productionLoss,b.base.assetDamage+b.base.productionLoss,money]
 ];
 const noPolicies=!left.length&&!right.length;
 const beforeCompletion=!noPolicies&&sums.every(s=>!s.active)&&sums.some(s=>s.planned+s.building>0);
 const equal=JSON.stringify(left.map(({id,name,...p})=>p))===JSON.stringify(right.map(({id,name,...p})=>p));
 const hint=noPolicies?'양쪽 모두 새 정책 없음. B 모범 정책을 적용해 비교하세요.':beforeCompletion?`현재 ${year}년 · 준공 전에는 보호 효과가 없습니다. 첫 준공 ${Math.min(...sums.map(s=>s.nextCompletion))}년.`:equal?'양쪽에 동일한 정책이 적용되어 결과가 같습니다.':a.permanentArea===0&&b.permanentArea===0?'영구 침수는 양쪽 0km²입니다. 기존 제방 유지 가정이며, 해일 피해와 방어 여유는 다를 수 있습니다.':'같은 해수면·해일에서 계산한 차이입니다. 지도 주황은 더 큰 영향, 보라는 더 작은 영향입니다.';
 return <div className="difference-summary" data-testid="difference-summary" data-year={year}>
  <div className="difference-headline">{metrics.map(([label,av,bv,format],i)=>{const delta=av-bv,same=Math.abs(delta)<1e-7;return <article key={label} data-testid={`benefit-${i}`} data-a={av} data-b={bv} data-delta={delta} className={same?'same':delta>0?'benefit':'cost'}><span>{label}</span><strong>{same?'차이 없음':<>B <b>{format(Math.abs(delta))}</b> {delta>0?'↓ 감소':'↑ 증가'}</>}</strong><small>A {format(av)} → B {format(bv)}{!same&&av>0?` · ${number(Math.abs(delta)/av*100,1)}%`:null}</small></article>})}</div>
  <div className="comparison-explanation"><span data-testid="comparison-explanation" title={hint}>{hint}</span><button type="button" data-testid="effect-year" data-year={effect.year} disabled={!effect.hasDifference} title={`같은 기후에서 ${effect.kind==='flood'?'침수 영향 면적':'상대 압력 지수'} 차이가 가장 큰 연도`} onClick={onEffect}>효과 큰 해 · {effect.year}년</button><button type="button" onClick={onFocus}>차이 지역 확대</button></div>
 </div>;
}
