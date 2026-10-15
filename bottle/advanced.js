/* Supplement: manual observation, stopwatch, calculations and records only. */
const LABEL={measured:'측정 완료',none:'미탈색',timeout:'시간 초과',fail:'측정 실패'};
export const freshExtension=()=>({concentration:'',prediction:null,trials:[]});
export function validateExtension(raw){
  if(raw==null)return freshExtension();
  if(typeof raw!=='object'||Array.isArray(raw))throw Error('심화 실험 형식 오류');
  const p=raw.prediction;
  if(p!=null&&(!Number.isFinite(p.seconds)||p.seconds<=0||p.seconds>86400||typeof p.concentration!=='string'||typeof p.signature!=='string'||p.signature.length>3000||!Array.isArray(p.anchors)||p.anchors.length!==2))throw Error('검증 예측값 오류');
  const trials=raw.trials??[];
  if(!Array.isArray(trials)||trials.length>3||trials.some(t=>!Number.isInteger(t.repeat)||t.repeat<1||t.repeat>3||!Object.hasOwn(LABEL,t.kind)||(t.kind==='measured'?(!Number.isFinite(t.ms)||t.ms<=0||t.ms>86400000):t.ms!=null)||String(t.memo??'').length>3000)||new Set(trials.map(t=>t.repeat)).size!==trials.length)throw Error('E 측정값 오류');
  return {concentration:p?String(p.concentration).slice(0,60):String(raw.concentration??'').slice(0,60),
    prediction:p?{seconds:p.seconds,concentration:String(p.concentration).slice(0,60),signature:p.signature,anchors:p.anchors.slice(0,2),at:String(p.at??'').slice(0,40)}:null,
    trials:trials.map(t=>({repeat:t.repeat,kind:t.kind,ms:t.ms,memo:String(t.memo??''),at:String(t.at??'')}))};
}
export function extensionCSV(d){
  const v=d.extension||freshExtension();
  return [...(v.prediction?[['E 예측',v.concentration,'예측','선형 보간',v.prediction.seconds.toFixed(2),'실제 측정 전에 확정됨']]:[]),
    ...v.trials.map(t=>['E 검증',v.concentration,t.repeat,LABEL[t.kind],t.kind==='measured'?(t.ms/1000).toFixed(2):'',t.memo])];
}
const $=id=>document.getElementById(id);
const el=(tag,value)=>{const a=document.createElement(tag);a.textContent=String(value);return a;};
const fmt=x=>Number.isFinite(x)?Number(x).toFixed(2)+'초':'—';
function conc(raw){
  const s=String(raw??'').replace(/％/g,'%').replace(/\s+/g,'');
  const m=s.match(/^(\d+(?:\.\d+)?)(%|g\/L|mol\/L|g\/100mL)?$/i);
  if(!m)return null;
  const n=Number(m[1]);return Number.isFinite(n)&&n>=0?{n,unit:(m[2]||'').toLowerCase()}:null;
}
function summary(d){
  return d.conditions.map(c=>{
    const times=d.records.filter(r=>r.condition===c.name&&r.kind==='measured'&&Number.isFinite(r.ms)&&r.ms>0).map(r=>r.ms/1000);
    return {name:c.name,label:c.concentration,c:conc(c.concentration),n:times.length,
      t:times.length?times.reduce((a,b)=>a+b,0)/times.length:null};
  });
}
function measured(s){
  const points=s.filter(x=>x.c&&x.c.n>0&&x.t!==null).sort((a,b)=>a.c.n-b.c.n);
  const unitCount=new Set(points.map(x=>x.c.unit)).size;
  return {points,error:unitCount>1?'농도 단위를 통일하세요. 예: 1%, 2%, 3%':points.length<2?'서로 다른 농도의 유효 측정값이 2개 이상 필요합니다.':null};
}
const sign=points=>JSON.stringify(points.map(p=>[p.name,p.c.n,p.c.unit,p.n,Number(p.t.toFixed(6))]));
function predict(points,label){
  const e=conc(label);
  if(!e||e.n<=0)return {error:'검증 E 농도를 양수로 입력하세요. 예: 1.5%'};
  if(points.length<2)return {error:'본실험의 유효한 농도 2개 이상이 필요합니다.'};
  if(e.unit!==points[0].c.unit)return {error:'E와 본실험의 농도 단위를 동일하게 입력하세요.'};
  let lo=null,hi=null;
  for(const p of points){if(p.c.n<e.n)lo=p;if(p.c.n>e.n&&!hi)hi=p;}
  if(!lo||!hi)return {error:'검증 E 농도는 두 측정 농도 사이여야 합니다. 외삽은 하지 않습니다.'};
  const t=lo.t+(hi.t-lo.t)*(e.n-lo.c.n)/(hi.c.n-lo.c.n);
  if(!Number.isFinite(t)||t<=0)return {error:'양의 탈색 시간을 예측하지 못했습니다.'};
  return {seconds:t,concentration:label,signature:sign(points),anchors:[{condition:lo.name,concentration:lo.c.n,seconds:lo.t},{condition:hi.name,concentration:hi.c.n,seconds:hi.t}]};
}
export function initExtension({getData,persist,dialog,elapsed,stopTimer,resetTimer,selectTab}){
  const current=()=>getData().extension;
  function render(){
    const d=getData(),v=current(),s=summary(d),out=measured(s);
    $('eConc').value=v.concentration;$('eConc').disabled=!!v.prediction;
    $('eLock').disabled=!!v.prediction;$('eClear').disabled=!v.prediction&&!v.trials.length;
    for(const id of ['eSave','eNone','eTimeout','eFail'])$(id).disabled=!v.prediction||v.trials.length>=3;
    $('eRateRows').replaceChildren(...s.map(x=>{
      const row=document.createElement('tr');
      [x.name,x.label||'미입력',x.n,fmt(x.t),x.t>0?(1/x.t).toFixed(5):'—'].forEach(v=>row.append(el('td',v)));
      return row;
    }));
    $('eRateNote').textContent=out.error||'1/t는 탈색 시간의 역수이며 화학 반응속도상수와 동일하지 않습니다.';
    const pv=predict(out.points,v.concentration);
    $('ePreview').textContent=v.prediction?'확정 예측: '+fmt(v.prediction.seconds)+' (선형 보간, 변경 불가)':pv.error||'예측 미리보기: '+fmt(pv.seconds)+' (확정 전)';
    $('eChanged').hidden=!(v.prediction&&v.prediction.signature!==sign(out.points));
    $('eTrialRows').replaceChildren(...v.trials.slice().sort((a,b)=>a.repeat-b.repeat).map(t=>{
      const row=document.createElement('tr');
      [t.repeat+'회',LABEL[t.kind],t.kind==='measured'?fmt(t.ms/1000):'—',t.memo||'—'].forEach(value=>row.append(el('td',value)));
      const td=document.createElement('td'),button=el('md-text-button','삭제');
      button.addEventListener('click',async()=>{
        if(await dialog('E 기록 삭제','검증 E '+t.repeat+'회차를 삭제할까요?',{cancel:true,confirmLabel:'삭제'})){
          current().trials=current().trials.filter(x=>x.repeat!==t.repeat);persist();render();
        }
      });
      td.append(button);row.append(td);return row;
    }));
    const times=v.trials.filter(x=>x.kind==='measured').map(x=>x.ms/1000);
    const avg=times.length?times.reduce((a,b)=>a+b,0)/times.length:null;
    $('eCount').textContent=v.trials.length+'/3회';
    $('ePred').textContent=v.prediction?fmt(v.prediction.seconds):'미확정';
    $('eActual').textContent=avg===null?'—':fmt(avg);
    $('eDiff').textContent=avg!==null&&v.prediction?fmt(Math.abs(avg-v.prediction.seconds)):'—';
    $('ePercent').textContent=avg!==null&&v.prediction?(Math.abs(avg-v.prediction.seconds)/avg*100).toFixed(1)+'%':'—';
    $('eResultNote').textContent='E 유효 측정 '+times.length+'회. 미탈색·시간 초과·측정 실패는 평균에서 제외합니다.';
  }
  $('eConc').addEventListener('change',()=>{
    if(current().prediction)return;
    current().concentration=String($('eConc').value||'').trim().slice(0,60);
    persist();render();
  });
  $('eLock').addEventListener('click',async()=>{
    const v=current();if(v.prediction)return;
    v.concentration=String($('eConc').value||'').trim().slice(0,60);
    const out=measured(summary(getData()));
    if(out.error){await dialog('모델 계산 불가',out.error);render();return;}
    const p=predict(out.points,v.concentration);
    if(p.error){await dialog('모델 계산 불가',p.error);render();return;}
    const ok=await dialog('예측값 확정','E('+v.concentration+')의 예측 시간 '+fmt(p.seconds)+'을 실제 측정 전에 확정할까요?',{cancel:true,confirmLabel:'확정'});
    if(!ok)return;
    v.prediction={...p,at:new Date().toISOString()};persist();render();
  });
  $('eClear').addEventListener('click',async()=>{
    if(!(await dialog('E 실험 초기화','예측과 E 측정 기록이 모두 삭제됩니다. JSON 백업 후 초기화하세요.',{cancel:true,confirmLabel:'초기화'})))return;
    getData().extension=freshExtension();persist();render();
  });
  $('eGoMeasure').addEventListener('click',()=>selectTab(0));
  async function capture(kind){
    stopTimer();
    const v=current();
    if(!v.prediction){await dialog('예측 미확정','심화 탭에서 먼저 E의 예측값을 확정하세요.');return;}
    if(v.trials.length>=3){await dialog('검증 측정 완료','E는 3회까지 기록할 수 있습니다.');return;}
    const ms=kind==='measured'?Math.round(elapsed()):null;
    if(kind==='measured'&&(!ms||ms<=0)){await dialog('시간 미측정','타이머로 탈색 시간을 측정한 뒤 기록하세요.');return;}
    const rep=[1,2,3].find(n=>!v.trials.some(t=>t.repeat===n));
    if(!(await dialog('E 검증 기록',String(rep)+'회: '+(kind==='measured'?fmt(ms/1000):LABEL[kind])+'을 저장할까요?',{cancel:true,confirmLabel:'기록'})))return;
    v.trials.push({repeat:rep,kind,ms,memo:String($('memo').value||'').slice(0,3000),at:new Date().toISOString()});
    persist();resetTimer();$('memo').value='';render();selectTab(2);
  }
  for(const [id,kind] of [['eSave','measured'],['eNone','none'],['eTimeout','timeout'],['eFail','fail']])$(id).addEventListener('click',()=>capture(kind));
  return {render};
}
