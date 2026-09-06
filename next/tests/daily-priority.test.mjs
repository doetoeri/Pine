import test from 'node:test';
import assert from 'node:assert/strict';
import { changesSince,nextClass,todayTasks,informationConflicts,sourceInfo } from '../core/domain/daily-priority.js';
import { PersonalState } from '../core/data/personal-state.js';
import { publicRows,schoolQuery,decodeValue } from '../core/data/public-school.js';
import { academicSchedulesForGrade } from '../../pincon-class-ops-core.js';
import { loginError,withTimeout } from '../core/auth/errors.js';
import { draftFromText } from '../core/domain/notice-draft.js';
import { notificationDelivery,allowsNotification } from '../core/domain/notification-policy.js';
const date='2026-09-07';
const now=(time)=>Date.parse(`${date}T${time}:00+09:00`);
const lessons={neisTimetables:[{date,periods:[{period:1,subject:'수학',startTime:'09:00',endTime:'09:50'},{period:2,subject:'과학',startTime:'10:00',endTime:'10:50'},{period:3,subject:'영어',startTime:'11:50',endTime:'12:40'}]}]};
test('next period covers before school, class end, lunch and dismissal',()=>{
 assert.equal(nextClass(lessons,{now:now('08:53')}).label,'1교시까지 7분');
 assert.equal(nextClass(lessons,{now:now('09:01')}).state,'ongoing');
 assert.equal(nextClass(lessons,{now:now('09:50')}).lesson.period,2);
 assert.equal(nextClass(lessons,{now:now('11:00')}).state,'lunch');
 assert.equal(nextClass(lessons,{now:now('12:40')}).state,'finished');
 assert.equal(nextClass({neisTimetables:[{date,periods:[{period:1,subject:'수학'}]}]},{now:now('09:00')}).state,'untimed');
});
test('room conflicts are not silently resolved; other days cannot change today',()=>{
 const entries=[{id:'a',subject:'과학',type:'CLASSROOM_CHANGE',dueDate:date,classroom:'과학실'},{id:'b',subject:'과학',type:'CLASSROOM_CHANGE',dueDate:date,classroom:'교실'}];
 assert.equal(nextClass(lessons,{now:now('09:50'),subjectEntries:entries}).roomConflict,true);
 entries[1].dueDate='2026-09-08';
 assert.equal(nextClass(lessons,{now:now('09:50'),subjectEntries:entries}).room,'과학실');
});
test('change feed ignores future timestamps, drafts and unchanged records',()=>{
 const data={announcements:[{id:'a',updatedAt:{seconds:20},title:'새 공지'},{id:'b',updatedAtMs:30000,status:'draft'},{id:'c',updatedAtMs:50000}]};
 assert.deepEqual(changesSince(data,10000,40000).map(r=>r.id),['a']);
 assert.deepEqual(changesSince(data,0,40000),[]);
});
test('private state isolates uid/class, persists checks and does not mark visit on construction',()=>{
 const map=new Map();const storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};
 const a=new PersonalState(storage,'A','1-8');assert.equal(a.lastSeenAt,0);assert.equal(map.size,0);
 a.complete(date,'assignment:1',true);a.markSeen(10000);
 assert.equal(new PersonalState(storage,'A','1-8').completed(date,'assignment:1'),true);
 assert.equal(new PersonalState(storage,'B','1-8').completed(date,'assignment:1'),false);
 assert.equal(new PersonalState(storage,'A','1-9').lastSeenAt,0);
 assert.throws(()=>new PersonalState(storage,'','1-8').complete(date,'x',true));
});
test('personal duties are derived without modifying operational completion',()=>{
 const home={today:{cleaning:{id:'c',date,status:'ACCEPTED'},onePersonRole:{id:'r',name:'칠판'}}};
 const tasks=todayTasks({classAssignments:[{id:'x',dueDate:date,title:'제출'},{id:'d',dueDate:date,published:false}]},{date,home});
 assert.equal(tasks.length,3);assert.equal(home.today.cleaning.status,'ACCEPTED');
});
test('schedule normalization removes only Saturday closure, preserving coexisting events',()=>{
 const rows=[{id:'x',events:['토요 휴업일','학교 행사'],eventsByGrade:{1:['토요 휴업일','학교 행사']},title:'토요 휴업일 · 학교 행사'},{title:'토요휴업일'}];
 assert.deepEqual(academicSchedulesForGrade(rows,1).map(r=>r.title),['학교 행사']);
 assert.deepEqual(academicSchedulesForGrade(rows,1)[0].events,['학교 행사']);
});
test('public fallback rejects private collections and discards personal/draft data',()=>{
 assert.throws(()=>schoolQuery('users','1-8',date));
 assert.throws(()=>schoolQuery('evaluationPlans','1-8',date));
 assert.deepEqual(publicRows('announcements',[{id:'a',personalNotification:true},{id:'b',targetStudentNumber:'10804'},{id:'d',published:false},{id:'ok'}],{}),[{id:'ok'}]);
 assert.deepEqual(decodeValue({mapValue:{fields:{a:{integerValue:'42'}}}}),{a:42});
});
test('source conflicts use explicit linkage, URLs do not create verification',()=>{
 const conflicts=informationConflicts({classAssignments:[{id:'a',title:'과학 평가',dueDate:'2026-09-11'}],announcements:[{id:'b',relatedAssignmentId:'a',dueDate:'2026-09-10'}]});
 assert.equal(conflicts.length,1);assert.equal(conflicts[0].values.length,2);
 assert.equal(sourceInfo({sourceUrl:'https://example.com'}).verified,false);
});
test('login errors distinguish credentials, activation, disabled, missing, network, server, Firebase, rate limit and timeout',()=>{
 for(const [error,kind] of [[{code:'auth/invalid-credential'},'credentials'],[{code:'invalid-activation-code'},'activation'],[{code:'auth/user-disabled'},'disabled'],[{code:'auth/user-not-found'},'missing'],[{code:'auth/network-request-failed'},'network'],[{status:503},'server'],[{code:'auth/internal-error'},'firebase'],[{status:429},'rate-limit'],[{name:'AbortError'},'timeout']]) assert.equal(loginError(error).kind,kind);
});
test('auth initialization timeout settles',async()=>{await assert.rejects(withTimeout(new Promise(()=>{}),1),/server-timeout/)});
test('OCR always returns a reviewable unpublished draft with structured fields',()=>{
 const d=draftFromText('과목: 통합과학\n제목: 평가 안내\n제출일: 9월 11일\n준비물: 활동지\n장소: 과학실',2026);
 assert.equal(d.published,false);assert.equal(d.status,'draft');assert.equal(d.dueDate,'2026-09-11');assert.equal(d.materials,'활동지');
});
test('notifications immediately deliver only urgent or same-day changes, honoring category opt-outs',()=>{
 assert.equal(notificationDelivery({type:'CLASSROOM_CHANGE',date},date),'immediate');
 assert.equal(notificationDelivery({type:'CLASSROOM_CHANGE',date:'2026-09-08'},date),'briefing');
 assert.equal(notificationDelivery({type:'assessment',date},date),'briefing');
 assert.equal(allowsNotification({assessment:false},{preference:'assessmentToday'}),false);
});


test('exact subject and title link conflicting source dates without an explicit foreign key', () => {
 const data={classAssignments:[{id:'a',title:'평가',subject:'과학',dueDate:'2026-09-11'}],announcements:[{id:'b',title:'평가',subject:'과학',date:'2026-09-10'}]};
 assert.equal(informationConflicts(data).length,1);
 assert.equal(informationConflicts(data)[0].field,'dueDate');
 data.announcements[0].subject='수학';
 assert.equal(informationConflicts(data).length,0);
});
test('change feed recognizes legacy client timestamps',()=>{
 assert.equal(changesSince({content:[{id:'a',clientCreatedAt:20000}]},10000,30000).length,1);
});
