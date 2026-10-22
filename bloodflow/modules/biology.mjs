// Educational component rules; no clinical release or quality-score formula.
export const SOURCES=[
 {id:'KRC',title:'대한적십자사 혈액관리본부 · 혈액 검사·제제·공급',url:'https://bloodinfo.net/knrcbs/cm/cntnts/cntntsView.do?cntntsId=1126&mi=1049',accessed:'2026-10-22',supports:'선택한 국내 제제의 보존기간·온도·혈소판 교반 조건'},
 {id:'ARC',title:'Australian Red Cross Lifeblood · Component compatibility',url:'https://www.lifeblood.com.au/health-professionals/products/component-compatibility',accessed:'2026-10-22',supports:'적혈구·혈장의 ABO/RhD 및 혈소판 공급 시 고려사항'},
 {id:'FAC',title:'대한적십자사 · 오시는 길',url:'https://bloodinfo.net/knrcbs/cm/cntnts/cntntsView.do?cntntsId=1038&mi=1178',accessed:'2026-10-21',supports:'인천혈액원 명칭·주소'},
 {id:'OSM',title:'OpenStreetMap · 저작권과 ODbL',url:'https://www.openstreetmap.org/copyright',accessed:'2026-10-21',supports:'지도·도로 데이터 이용과 출처'},
 {id:'GEO',title:'geoBoundaries / Natural Earth · KOR ADM1',url:'https://www.geoboundaries.org/api/current/gbOpen/KOR/ADM1/',accessed:'2026-10-22',supports:'2021년 경계의 17개 고정 연구권역 · CC BY 4.0 / Natural Earth public domain; 현재 법정 경계 아님'},
 {id:'OSRM',title:'OSRM Route API',url:'https://project-osrm.org/docs/v5.24.0/api/',accessed:'2026-10-21',supports:'도로 경로·거리·프로필 기반 예상시간; 실시간 교통 미반영'}
];
export const PRODUCTS={
 RBC:{name:'농축적혈구',short:'적혈구',color:'#e05b69',lifeHours:35*24,range:[1,6],set:4,clock:'채혈 후 35일',storage:'1–6°C 냉장',function:'산소 운반을 담당하는 적혈구 성분',source:'KRC'},
 PLT:{name:'농축혈소판',short:'혈소판',color:'#c99c36',lifeHours:120,range:[20,24],set:22,clock:'제조 후 120시간',storage:'20–24°C · 교반 보관',function:'지혈에 관여하는 혈소판 성분',source:'KRC'},
 FFP:{name:'신선동결혈장',short:'동결혈장',color:'#55aabb',lifeHours:365*24,range:[-Infinity,-18],set:-25,clock:'채혈 후 1년',storage:'−18°C 이하 동결',function:'응고인자 등 혈장 성분의 공급',source:'KRC'}
};
export const BLOOD_TYPES=['A+','B+','O+','AB+','A-','B-','O-','AB-'];
const split=s=>[s.slice(0,-1),s.slice(-1)];
export function compatible(kind,donor,recipient,mode='compatible'){
 if(!PRODUCTS[kind]||!BLOOD_TYPES.includes(donor)||!BLOOD_TYPES.includes(recipient))return false;
 if(mode==='identical')return donor===recipient;
 const [d,dr]=split(donor),[r,rr]=split(recipient);
 if(kind==='RBC')return (d===r||d==='O'||r==='AB')&&!(dr==='+'&&rr==='-');
 if(kind==='FFP')return d===r||d==='AB'||r==='O';
 // Deliberately conservative classroom model, NOT the complete platelet algorithm.
 return donor===recipient;
}
export function observe(u,end,c){
 if(!u?.dual||end<=u.thermalAt+1e-9||!['ready','queue','truck','review'].includes(u.status))return;
 const product=PRODUCTS[u.kind],start=u.thermalAt;
 // Recorded temperatures are synthetic scenario readings, not predicted damage.
 for(let h=Math.min(end,Math.floor(start)+1);h<=end+1e-8;h=Math.min(end,h+1)){
  if(h<=start+1e-9)break;
  const excursion=c.excursion==='transport'&&u.status==='truck' || c.excursion==='storage'&&u.status!=='truck'&&h>=6&&h<=14;
  const temperature=excursion?30:product.set;
  const agitationMissing=u.kind==='PLT'&&c.agitation===false&&u.status!=='truck';
  u.temperature=temperature;u.minimum=Math.min(u.minimum,temperature);u.maximum=Math.max(u.maximum,temperature);
  if(temperature<product.range[0]||temperature>product.range[1]||agitationMissing){u.review=true;u.reviewReason=agitationMissing?'교반 중단 가상 시나리오':'제제별 보관 범위 이탈 가상 기록';u.outHours+=h-(u.thermalAt??start);}
  const reading={h:+h.toFixed(4),t:temperature,stage:u.status==='truck'?'transport':'storage',synthetic:true};
  if(c.network==='nationwide'&&u.trace.length>=2&&u.trace.at(-1).t===reading.t&&u.trace.at(-2).t===reading.t&&u.trace.at(-1).stage===reading.stage&&u.trace.at(-2).stage===reading.stage)u.trace[u.trace.length-1]=reading;else u.trace.push(reading);
  const traceLimit=c.network==='nationwide'?16:80;if(u.trace.length>traceLimit)u.trace.splice(1,u.trace.length-traceLimit);
  if(u.status==='truck')u.transitHours+=h-u.thermalAt;else u.storageHours+=h-u.thermalAt;
  u.thermalAt=h;if(h>=end-1e-8)break;
 }
}
export const BIO_LIMITS=[
 '임상 의사결정에 사용할 수 없는 교육용 모형이다. 실제 재고·수요·검사 결과를 사용하지 않는다.',
 '적혈구는 ABO/RhD만 고려하며 교차시험·비예기항체·추가 항원·임상 예외는 생략한다.',
 '혈소판은 ABO/RhD 동일형만 허용하는 보수적 가정이다. 혈소판 자체에 Rh 항원이 있다는 뜻이 아니다.',
 '혈장은 동결 상태의 공급까지만 다룬다. 해동·수혈 과정은 계산하지 않는다. 모형의 1년은 365일이다.',
 '운송에도 보관 범위를 적용하는 보수적 가정이다. 실제 운송·출고 허용 기준을 판정하지 않는다.',
 '혈액형은 8종 균등 확률, 공급·수요량과 검사 2시간 지연은 가정이다. 실제 한국 혈액형 분포나 검사 성능을 재현하지 않는다.',
 '온도 이탈은 검토 보류만 유발한다. 혈액의 생존율·안전성·용혈률 또는 임상적 품질을 추정하지 않는다.'
];
