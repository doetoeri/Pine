let profile={grade:1,classNumber:8,classKey:'1-8'};
export function readClassProfile(){return profile}
export function saveClassProfile(grade,classNumber){profile={grade,classNumber,classKey:`${grade}-${classNumber}`};return profile}
const date=(offset=0)=>{const d=new Date();d.setDate(d.getDate()+offset);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const long='사회적 약자의 정보 접근권과 학교생활 앱의 사용성 평가 및 개선 방안에 관한 탐구 발표';
export class NextDataGateway extends EventTarget{
 constructor(){super();this.data={
 neisTimetables:Array.from({length:18},(_,i)=>({date:date(i-7),periods:['통합사회','공통수학','한국사','한문','통합과학','미술'].map((subject,j)=>({period:j+1,subject,room:j===4?'과학실 2 (본관 4층)':'1학년 8반 교실',materials:j===0?long+' 준비물과 발표문을 담은 파일':j===2?'이어폰과 한국사 학습지':j===3?'한문 노트':'',startTime:`${String(j+9).padStart(2,'0')}:00`,endTime:`${String(j+9).padStart(2,'0')}:50`}))})),
 meals:Array.from({length:12},(_,i)=>({date:date(i-2),mealType:'중식',dishesHtml:'현미밥<br>부대찌개 (1.2.5.6.9.10.12.13.15.16)<br>유기농 저염식 방울토마토와 모차렐라 치즈 샐러드 (1.2.3.4.5.6)<br>가자미살구이<br>배추김치<br>멜론',origin:'쌀: 국내산 · 돼지고기: 국내산'})),
 classAssignments:[{title:'지난 평가',dueDate:date(-2),type:'exam'},...Array.from({length:8},(_,i)=>({title:i===1?long:'영어 도표 분석 수행평가 '+i,dueDate:date(i),subject:i%2?'통사':'공영',type:i===2?'exam':i===3?'preparation':'assessment',description:long+'입니다. 배부한 자료를 확인하세요.',materials:long+' 준비용 노트'})),{title:'날짜 미정 평가',description:long,type:'assessment'}],
 academicSchedules:[{title:'날짜 미정 학사 일정',description:'일정 안내입니다.'},{title:'학교 행사',date:date(5)}],events:[{title:'학급 회의',date:date(2),question:'학급 행사 의견 모으기',status:'open'}]}}
 snapshot(){return {data:this.data,profile,ready:true,online:true,syncing:false,collectionStatus:{}}}
 async start(){this.dispatchEvent(new CustomEvent('change',{detail:this.snapshot()}));return this.snapshot()}
 async retry(){return this.start()}
}
