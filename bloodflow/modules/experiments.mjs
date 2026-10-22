import {DualWorld,DEFAULTS,validateConfig} from './engine.mjs';
export const PRESETS={
 N:{name:'N · 전국 공급 정책',question:'권역 간 재배치는 부족률·폐기율을 동시에 개선하는가?',factor:'redistribution',control:'A',treatment:'B',unit:'정책',engineering:'A 지역 내부 · B 인접 권역 · C 전국 통합을 동일 초기 조건·난수·기간으로 계산한다.',biology:'모든 정책에 동일한 제제 수명·적합성·검사·보존 제약을 적용한다. 개선을 미리 가정하지 않는다.'},
 A:{name:'A · 안전재고의 상충관계',question:'안전재고를 늘리면 부족·폐기·평균 재고는 어떻게 달라지는가?',factor:'safetyDays',control:1,treatment:6,unit:'일',engineering:'재고·부족·폐기와 재배치의 관계를 해석한다.',biology:'제제별 만료·적합성·보류가 공급 가능 재고를 제한하는 방식을 해석한다.'},
 B:{name:'B · 수요 불확실성',question:'수요 변동성이 커져도 동일 재고정책은 안정적으로 작동하는가?',factor:'volatility',control:.15,treatment:.9,unit:'로그수요 표준편차',engineering:'평균 성능과 반복 간 변동성을 함께 비교한다.',biology:'변동성이 큰 수요에서 짧은 사용기한의 영향을 검토한다.'},
 C:{name:'C · 생물학적 제약',question:'보존기간과 제제별 적합성이 공급 결과에 어떤 영향을 주는가?',factor:'product',control:'RBC',treatment:'PLT',unit:'제제',engineering:'동일 공급·수요 단위의 가상 비교이며 임상적 용량 비교는 아니다.',biology:'35일 적혈구와 120시간 혈소판의 보존·적합성 차이를 분석한다.'}
};
const TC=[0,12.706,4.303,3.182,2.776,2.571,2.447,2.365,2.306,2.262,2.228,2.201,2.179,2.16,2.145,2.131,2.12,2.11,2.101,2.093,2.086,2.08,2.074,2.069,2.064,2.06,2.056,2.052,2.048,2.045,2.042];
export function statistics(values){
 const v=values.filter(x=>typeof x==='number'&&Number.isFinite(x)),n=v.length;if(!n)return {n:0,mean:null,sd:null,ci95:null};
 const mean=v.reduce((a,b)=>a+b,0)/n,sd=n>1?Math.sqrt(v.reduce((s,x)=>s+(x-mean)**2,0)/(n-1)):null;
 const df=n-1,z=1.95996398454,critical=df<=30?TC[df]:z+(z**3+z)/(4*df)+(5*z**5+16*z**3+3*z)/(96*df**2),margin=n>1?critical*sd/Math.sqrt(n):null;
 return {n,mean,sd,ci95:margin===null?null:[mean-margin,mean+margin]};
}
export function validatePlan(raw={}){
 const preset=PRESETS[raw.experiment??'A'];if(!preset)throw Error('실험 N/A/B/C를 선택하세요.');
 const p={experiment:raw.experiment??'A',factor:raw.factor??preset.factor,control:raw.control??preset.control,treatment:raw.treatment??preset.treatment,days:raw.days??30,repeats:raw.repeats??12,seed:raw.seed??DEFAULTS.seed};
 if(!['safetyDays','volatility','product','shelfFraction','compatibility','delay','redistribution'].includes(p.factor))throw Error('실험 변수를 확인하세요.');
 if(p.experiment==='N'){p.factor='redistribution';p.control='A';p.treatment='B';}
 if(!Number.isInteger(p.days)||p.days<1||p.days>90||!Number.isInteger(p.repeats)||p.repeats<2||p.repeats>60||!Number.isInteger(p.seed)||p.seed<0||p.seed>4294967295)throw Error('기간 1–90일, 반복 2–60회, 정수 시드를 지정하세요.');
 return p;
}
export function makePair(config,data,plan,i){
 const seed=(plan.seed+i*104729)>>>0,rawA={...config,seed,[plan.factor]:plan.control},rawB={...config,seed,[plan.factor]:plan.treatment};
 if(plan.experiment==='N'){rawA.network='nationwide';rawB.network='nationwide';}
 const a=new DualWorld(rawA,data),b=new DualWorld(rawB,data);
 a.advance(plan.days*24);b.advance(plan.days*24);
 const A=a.summary(),B=b.summary();if(!A.verification.passed||!B.verification.passed)throw Error('실험 중 재고 보존 검증에 실패했습니다.');
 if(plan.experiment==='N'){
  const c=new DualWorld({...config,network:'nationwide',seed,redistribution:'C'},data);c.advance(plan.days*24);const C=c.summary();
  if(!C.verification.passed)throw Error('전국 통합 정책의 재고 보존 검증 실패');
  return {repeat:i+1,seed,control:A,treatment:B,integrated:C,regions:{A:a.regionalSummary(),B:b.regionalSummary(),C:c.regionalSummary()}};
 }
 return {repeat:i+1,seed,control:A,treatment:B};
}
export function summarize(pairs,plan,config){
 const keys=['shortageRate','wasteRate','averageInventory','meanTransportHours','unmet','expired','available','held','regionalTransfers','costUnits'],metrics={};
 for(const k of keys)metrics[k]={control:statistics(pairs.map(p=>p.control[k])),treatment:statistics(pairs.map(p=>p.treatment[k])),pairedDifference:statistics(pairs.map(p=>p.treatment[k]===null||p.control[k]===null?null:p.treatment[k]-p.control[k]))};
 if(plan.experiment==='N')for(const k of keys){metrics[k].integrated=statistics(pairs.map(p=>p.integrated[k]));metrics[k].integratedDifference=statistics(pairs.map(p=>p.integrated[k]===null||p.control[k]===null?null:p.integrated[k]-p.control[k]));}
 const clean=({...config,...(plan.experiment==='N'?{network:'nationwide'}:{})});delete clean.realNodes;delete clean.roadHours;delete clean.regions;
 return {format:'BLOODFLOW-PAIRED-1',modelVersion:'2.0.0',createdAt:new Date().toISOString(),plan,config:clean,metrics,pairs,method:'반복별 비율의 평균. 표본 표준편차(n−1), Student t 95% 구간. 정책 차이는 동일 시드의 실험군−기준군을 짝지어 계산. 확률 모형 안의 표본 불확실성이며 실제 혈액 공급망의 예측 오차가 아니다.'};
}
export function runExperiment(config,data,raw,onProgress){
 const plan=validatePlan(raw);if(plan.experiment==='N')config={...config,network:'nationwide'};validateConfig({...config,[plan.factor]:plan.control},data);validateConfig({...config,[plan.factor]:plan.treatment},data);
 const pairs=[];for(let i=0;i<plan.repeats;i++){pairs.push(makePair(config,data,plan,i));onProgress?.((i+1)/plan.repeats);}return summarize(pairs,plan,config);
}
export function csv(rows){const keys=[...new Set(rows.flatMap(r=>Object.keys(r)))],quote=x=>'"'+String(x??'').replaceAll('"','""')+'"';return '\uFEFF'+[keys,...rows.map(r=>keys.map(k=>typeof r[k]==='object'?JSON.stringify(r[k]):r[k]))].map(r=>r.map(quote).join(',')).join('\r\n');}
export function resultRows(result){return result.pairs.flatMap(p=>(result.plan.experiment==='N'?['control','treatment','integrated']:['control','treatment']).map(arm=>({repeat:p.repeat,seed:p.seed,arm,factor:result.plan.factor,value:arm==='integrated'?'C':result.plan[arm],days:result.plan.days,...p[arm],verification:JSON.stringify(p[arm].verification)})));}
