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

function installExtensionUI(){
  const tab=document.createElement('md-primary-tab');
  tab.id='advancedTab';tab.setAttribute('aria-controls','advancedPanel');tab.setAttribute('inline-icon','');
  tab.innerHTML='<md-icon slot="icon">functions</md-icon>심화 검증';
  $('reportTab').before(tab);
  const panel=document.createElement('div');
  panel.id='advancedPanel';panel.className='tab-panel';panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby','advancedTab');panel.hidden=true;
  panel.innerHTML=String.raw`
    <div class="content-heading"><div><h2 class="md-typescale-title-large">심화 실험 · 예측 모델 검증</h2><p class="supporting">포도당 농도와 평균 탈색 시간을 이용해 E 농도의 시간을 예측하고 실측값으로 검증합니다.</p></div><md-icon class="heading-icon" aria-hidden="true">functions</md-icon></div>
    <div class="report-guidance"><md-icon aria-hidden="true">info</md-icon><div><strong>전자기기 사용 범위</strong><p>타이머·계산·기록만 사용합니다. 색 변화는 사람이 직접 관찰하고, 시료는 지도교사가 승인한 방법으로 준비합니다.</p></div></div>
    <h3 class="md-typescale-title-medium">1 · 경험적 속도 지표 1/t</h3>
    <p class="supporting">본실험 A~D의 농도별 평균 탈색 시간을 계산합니다. 1/t는 경험적 지표이지 엄밀한 반응속도상수가 아닙니다.</p>
    <div class="table-scroller"><table><caption>농도별 평균과 탈색 시간의 역수</caption><thead><tr><th>조건</th><th>농도</th><th>유효 측정 수</th><th>평균 t</th><th>1/t (1/초)</th></tr></thead><tbody id="eRateRows"></tbody></table></div>
    <p id="eRateNote" class="supporting" role="status"></p>
    <h3 class="md-typescale-title-medium subsection">2 · E 농도 예측</h3>
    <p class="supporting">측정한 두 농도 사이의 E 농도를 선택합니다. 선형 보간으로 구한 예측값을 실제 E를 관찰하기 <strong>전에</strong> 확정하세요. 농도 단위를 동일하게 입력해야 합니다(예: 1%, 2%, 3%).</p>
    <div class="prediction-row"><md-outlined-text-field id="eConc" label="E 농도 · 예: 1.5%" maxlength="60"></md-outlined-text-field><md-filled-button id="eLock"><md-icon slot="icon">lock</md-icon>예측값 확정</md-filled-button><md-outlined-button id="eClear">검증 초기화</md-outlined-button></div>
    <div id="ePreview" class="prediction-preview" role="status">본실험 기록을 입력하면 예측값이 표시됩니다.</div>
    <p id="eChanged" class="source-warning" hidden>예측값 확정 후 본실험 자료가 변경되었습니다. 예측값은 고정되며, 자료 변경 사실을 보고서에 기록하세요.</p>
    <h3 class="md-typescale-title-medium subsection">3 · E 실제 측정</h3>
    <p class="supporting">측정 탭의 같은 타이머를 이용하고 E 전용 기록 버튼으로 최대 3회 기록합니다. E 결과는 본실험 평균에 합치지 않습니다.</p>
    <md-filled-tonal-button id="eGoMeasure"><md-icon slot="icon">timer</md-icon>타이머로 이동</md-filled-tonal-button>
    <div class="table-scroller e-trial-table"><table><caption>E 검증 기록</caption><thead><tr><th>회차</th><th>상태</th><th>실측 시간</th><th>관찰 메모</th><th>관리</th></tr></thead><tbody id="eTrialRows"></tbody></table></div>
    <h3 class="md-typescale-title-medium subsection">4 · 예측 오차 분석</h3>
    <div class="analysis-summary extension-stats"><div><span>측정 진행</span><strong id="eCount">0/3회</strong></div><div><span>예측 시간</span><strong id="ePred">—</strong></div><div><span>실측 평균</span><strong id="eActual">—</strong></div><div><span>절대 오차</span><strong id="eDiff">—</strong></div><div><span>상대 오차</span><strong id="ePercent">—</strong></div></div>
    <p id="eResultNote" class="supporting" role="status"></p>
    <p class="supporting">상대 오차 = |실측 평균 − 예측값| / 실측 평균 × 100%. E 기록은 JSON 및 CSV 백업에 포함됩니다.</p>
  `;
  $('reportPanel').before(panel);
  const extra=document.createElement('div');
  extra.className='e-capture';
  extra.innerHTML='<strong>추가 실험 E</strong><p class="supporting">심화 검증에서 예측값을 확정한 후 같은 타이머로 E를 측정해 별도 저장합니다.</p><div class="record-controls"><md-filled-tonal-button id="eSave">E 측정값 기록</md-filled-tonal-button><md-outlined-button id="eNone">E 미탈색</md-outlined-button><md-outlined-button id="eTimeout">E 시간 초과</md-outlined-button><md-outlined-button id="eFail">E 측정 실패</md-outlined-button></div>';
  $('measurePanel').append(extra);
  const handoff=document.createElement('div');
  handoff.className='handoff-hint';
  handoff.innerHTML='<strong>연속 측정 분업</strong><span>김선우 · 다음 시료 확인 → 김호준 · 반응 관찰 → 김도영 · 공식 타이머 → 송준혁 · 기록</span><small>다음 시료는 미리 확인하되, 산소 공급을 미리 시작하지 마세요.</small>';
  $('memo').before(handoff);
  const styles=document.createElement('style');
  styles.textContent=String.raw`
.handoff-hint,.e-capture{border-radius:16px;background:var(--md-sys-color-surface-container-low);padding:15px 17px;margin:16px 0}
.handoff-hint strong,.e-capture strong{display:block;font-size:12px;margin-bottom:5px}
.handoff-hint span,.handoff-hint small{display:block;color:var(--md-sys-color-on-surface-variant);font-size:12px;line-height:1.65}
.handoff-hint small{font-size:11px;margin-top:5px}.e-capture{margin-top:19px;background:var(--md-sys-color-secondary-container)}
.e-capture .supporting{margin:5px 0 12px}
.prediction-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:16px 0}
.prediction-row md-outlined-text-field{flex:1 1 210px;min-width:0}
.prediction-preview{padding:17px;border-radius:16px;background:var(--md-sys-color-primary-container);font-weight:650;margin:10px 0 12px}
.source-warning{padding:12px;border-radius:12px;color:var(--md-sys-color-on-error-container);background:var(--md-sys-color-error-container);font-size:12px}
.e-trial-table{margin-top:20px}.extension-stats{grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-top:15px}
.extension-stats strong{font-size:clamp(13px,1.6vw,21px)}
@media(max-width:1100px){.extension-stats{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:570px){.extension-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media print{#advancedPanel{display:block!important}.e-capture,.handoff-hint,.prediction-row,#eGoMeasure{display:none!important}}
`;
  document.head.append(styles);
}

export function initExtension({getData,persist,dialog,elapsed,stopTimer,resetTimer,selectTab}){
  installExtensionUI();
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
