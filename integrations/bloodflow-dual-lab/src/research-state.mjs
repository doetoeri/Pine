import {DualWorld,validateConfig} from './engine.mjs';
import {validatePlan,summarize} from './experiments.mjs';

export const DEFAULT_NOTES=Object.freeze({question:'혈액 부족과 혈액제제 폐기 문제를 함께 줄이기 위한 공급관리 개선 방안',hypothesis:'',engineering:'',biology:'',limitations:'',improvements:''});
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const count=x=>Number.isSafeInteger(x)&&x>=0;
const close=(a,b)=>a===null||b===null?a===b:typeof a==='number'&&Number.isFinite(a)&&Math.abs(a-b)<=1e-10*Math.max(1,Math.abs(b));
const invalid=detail=>{throw Error('저장된 실험 결과를 복원하지 못했습니다: '+detail+'. 현재 연구는 변경하지 않았습니다.');};
const countKeys=['created','served','requested','unmet','expired','rejected','quality','review','shipments','interhospital','initialInventory','receipts','available','held','inTransit'];
const legacyMetrics=['shortageRate','wasteRate','averageInventory','meanTransportHours','unmet','expired','available','held'];

function checkSummary(s,plan,network){
 if(!object(s)||countKeys.some(k=>!count(s[k]))||Object.entries(s).some(([k,v])=>!['network','verification'].includes(k)&&(v!==null&&(typeof v!=='number'||!Number.isFinite(v)||v<0))))invalid('반복별 수치 형식');
 if((s.network??'incheon')!==network||s.timeHours!==plan.days*24||!count(s.demandFingerprint)||s.demandFingerprint>4294967295)invalid('공급망·기간·수요 식별자');
 const v=s.verification;
 if(!object(v)||v.passed!==true||v.balance!==0||v.errors!==0||!count(v.active)||v.active!==s.created-s.served-s.expired-s.quality-s.rejected)invalid('반복별 재고 보존 기록');
 if(s.requested!==s.served+s.unmet||s.created!==s.initialInventory+s.receipts||!close(s.shortageRate,s.requested?s.unmet/s.requested:null)||!close(s.wasteRate,s.created?(s.expired+s.quality+s.rejected)/s.created:null))invalid('부족·폐기 분모와 집계');
}
function checkRegions(rows,regions,summary){
 const counts=['available','queue','held','requested','unmet','served','created','expired','quality','rejected','exported','imported','arrivedImports','expiring'];
 if(!Array.isArray(rows)||rows.length!==regions.length)invalid('권역 목록');
 for(let i=0;i<rows.length;i++){
  const r=rows[i],known=regions[i];
  if(!object(r)||r.id!==known.id||r.name!==known.name||counts.some(k=>!count(r[k]))||!object(r.products)||['RBC','PLT','FFP'].some(k=>!count(r.products[k])))invalid('권역 식별자·수치 형식');
  const receipts=r.created+r.arrivedImports;
  if(r.requested!==r.served+r.unmet||!close(r.shortageRate,r.requested?r.unmet/r.requested:null)||!close(r.wasteRate,receipts?(r.expired+r.quality+r.rejected)/receipts:null))invalid('권역별 분모와 집계');
 }
 for(const key of ['requested','unmet','served','created','expired','quality','rejected','available'])if(rows.reduce((sum,r)=>sum+r[key],0)!==summary[key])invalid('전국·권역 합계');
}
function sameStatistics(actual,expected){
 return object(actual)&&Object.keys(actual).length===4&&actual.n===expected.n&&close(actual.mean,expected.mean)&&close(actual.sd,expected.sd)&&(expected.ci95===null?actual.ci95===null:Array.isArray(actual.ci95)&&actual.ci95.length===2&&actual.ci95.every((x,i)=>close(x,expected.ci95[i])));
}
export function validateStoredResult(raw,data){
 if(raw==null)return null;
 if(!object(raw)||raw.format!=='BLOODFLOW-PAIRED-1'||!['1.0.0','2.0.0'].includes(raw.modelVersion)||!object(raw.plan)||!object(raw.config)||typeof raw.createdAt!=='string'||raw.createdAt.length>40||!Number.isFinite(Date.parse(raw.createdAt))||typeof raw.method!=='string'||raw.method.length>4000)invalid('파일 형식');
 const plan=validatePlan(raw.plan);
 if(Object.keys(plan).some(k=>raw.plan[k]!==plan[k])||raw.modelVersion==='1.0.0'&&plan.experiment==='N'||!Array.isArray(raw.pairs)||raw.pairs.length!==plan.repeats)invalid('실험 설계·반복 수');
 const network=plan.experiment==='N'?'nationwide':raw.config.network??'incheon';
 for(const value of [plan.control,plan.treatment])validateConfig({...raw.config,network,[plan.factor]:value},data);
 const keys=raw.modelVersion==='1.0.0'?legacyMetrics:[...legacyMetrics,'regionalTransfers','costUnits'];
 const arms=plan.experiment==='N'?['control','treatment','integrated']:['control','treatment'];
 for(let i=0;i<raw.pairs.length;i++){
  const p=raw.pairs[i];
  if(!object(p)||p.repeat!==i+1||p.seed!==((plan.seed+i*104729)>>>0))invalid('반복 순서·공통 난수 시드');
  for(const arm of arms){
   checkSummary(p[arm],plan,network);
   if(keys.some(k=>!(k in p[arm])||p[arm][k]===null&&!['shortageRate','wasteRate','meanTransportHours'].includes(k)))invalid('반복별 지표');
  }
  if(plan.experiment==='N'){
   if(!object(p.regions)||p.control.demandFingerprint!==p.treatment.demandFingerprint||p.control.demandFingerprint!==p.integrated.demandFingerprint)invalid('정책 간 수요 기록');
   for(const [j,policy]of ['A','B','C'].entries())checkRegions(p.regions[policy],data.nationwide.regions,p[arms[j]]);
  }
 }
 // Reuse the existing statistical method; do not simulate new outcomes or replace stored values.
 const expected=summarize(raw.pairs,plan,raw.config).metrics,statsArms=[...arms,'pairedDifference',...(plan.experiment==='N'?['integratedDifference']:[])];
 if(!object(raw.metrics)||Object.keys(raw.metrics).length!==keys.length)invalid('통계 지표 목록');
 for(const key of keys){const m=raw.metrics[key];if(!object(m)||Object.keys(m).length!==statsArms.length||statsArms.some(arm=>!sameStatistics(m[arm],expected[key][arm])))invalid('원자료와 평균·변동성·신뢰구간의 일치');}
 return structuredClone(raw);
}
export function prepareResearchRestore(payload,data,currentNotes=DEFAULT_NOTES,{role='local'}={}){
 const world=DualWorld.restore(payload.snapshot,data),notes={...DEFAULT_NOTES,...currentNotes};
 if(payload.notes!=null){
  if(!object(payload.notes)||Object.keys(payload.notes).some(k=>!Object.hasOwn(DEFAULT_NOTES,k)||typeof payload.notes[k]!=='string'||payload.notes[k].length>6000))throw Error('저장된 연구 기록의 형식이 올바르지 않습니다. 현재 연구는 변경하지 않았습니다.');
  for(const [key,value]of Object.entries(payload.notes))if(role==='local'||!['engineering','biology'].includes(key)||key===role)notes[key]=value;
 }
 const result=validateStoredResult(payload.result,data);
 return {world,notes,result};
}
