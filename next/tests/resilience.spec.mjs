import { test, expect } from '@playwright/test';
import { disconnectableOrigin } from './helpers/disconnectable-origin.mjs';
const base='http://127.0.0.1:4173';
const sizes=[[280,700],[320,700],[360,800],[390,844],[768,1024],[1024,768],[1366,768]];
async function prepare(page) {
 await page.route('https://**/*',route=>route.abort());
 await page.addInitScript(()=>{
  localStorage.setItem('pincon-profile-v2',JSON.stringify({grade:1,classNumber:8}));
  if(localStorage.getItem('pincon-test-seeded')) return;
  localStorage.setItem('pincon-test-seeded','true');
  const date=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  localStorage.setItem('pincon-class-ops-cache-v1',JSON.stringify({classKey:'1-8',savedAtMs:Date.now(),data:{announcements:[{id:'notice',title:'회귀 테스트 공지',body:'테스트 전용 공지',createdAtMs:Date.now()}],classAssignments:[{id:'task',title:'회귀 테스트 제출',dueDate:date,published:true}],academicSchedules:[{id:'sat',title:'토요 휴업일',date}],neisTimetables:[{id:'day',date,periods:[{period:1,subject:'회귀 테스트 과목',startTime:'09:00',endTime:'09:50'}]}],meals:[{id:'meal',date,dishesHtml:'회귀 테스트 식단'}]}}));
 });
}
for(const [width,height] of sizes) test(`read-only navigation and dialogs ${width}x${height}`,async({page})=>{
 await page.setViewportSize({width,height}); await prepare(page);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${base}/next/?auth=1#today`);
 await expect(page.locator('#nextClassCard')).toBeVisible();
 await expect(page.getByText('계정 서비스에 연결할 수 없습니다.',{exact:true})).toBeVisible({timeout:12000});
 await expect(page.locator('.status-chip--checking')).toHaveCount(0);
 await expect(page.getByText('토요 휴업일',{exact:true})).toHaveCount(0);
 for(const route of ['timetable','schedule','classroom','more','today']) {
  await page.locator(`[data-route="${route}"]:visible`).click(); await expect(page.locator(`#${route}-title`)).toBeVisible();
 }
 for(const [open,dialog,close] of [['openSearch','searchDialog','closeSearch'],['openNotifications','notificationDialog','closeNotifications']]) {
  await page.locator(`#${open}`).click(); await expect(page.locator(`#${dialog}`)).toBeVisible();
  await page.locator(`#${close}`).click(); await expect(page.locator(`#${dialog}`)).not.toBeVisible();
  await page.locator('[data-route="timetable"]:visible').click(); await expect(page.locator('#timetable-title')).toBeVisible();
  await page.locator('[data-route="today"]:visible').click();
 }
 await page.locator('md-list-item[data-detail-key*="announcement"]:visible').first().click();
 await expect(page.locator('#detailLayer')).toBeVisible(); await page.locator('.detail-header [data-detail-close]').click();
 await expect(page.locator('#detailLayer')).not.toBeVisible();
 await page.locator('[data-route="schedule"]:visible').click();await expect(page.locator('#schedule-title')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true); expect(errors).toEqual([]);
});
test('Next offline reload and navigation preserve public school cache',async({page,context,browserName})=>{
 const origin=await disconnectableOrigin();
 try {
  await prepare(page); await page.goto(`${origin.url}/next/?auth=1#today`);
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true);
  // Verify actual browser offline/online events and the banner on both engines.
  await context.setOffline(true);
  await expect(page.getByText(/오프라인 상태 · 마지막 동기화 데이터 표시 중/)).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText(/오프라인 상태 · 마지막 동기화 데이터 표시 중/)).not.toBeVisible();
  origin.disconnect();
  // Uncached network access must really fail, including the worker's origin.
  expect(await page.evaluate(async()=>{try{await fetch('/outage-probe',{cache:'no-store'});return false;}catch{return true;}})).toBe(true);
  expect(origin.rejected).toBeGreaterThan(0);
  // WebKit's offline emulation fails navigation before SW fallback (#34402).
  // Keep Chromium's emulation too; WebKit uses the real disconnected origin.
  if(browserName==='chromium') await context.setOffline(true);
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(page.locator('#nextClassCard')).toBeVisible();
  for(const route of ['timetable','schedule','classroom','more','today']) {await page.locator(`[data-route="${route}"]:visible`).click();await expect(page.locator(`#${route}-title`)).toBeVisible();}
  await expect(page.getByText('회귀 테스트 식단',{exact:true})).toBeVisible();
  origin.reconnect();await context.setOffline(false);
  await expect(page.getByText(/오프라인 상태 · 마지막 동기화 데이터 표시 중/)).not.toBeVisible();
  expect(await page.evaluate(async()=>{const r=await fetch('/manifest.webmanifest',{cache:'reload'});return r.ok;})).toBe(true);
 } finally {await context.setOffline(false);await origin.close();}
});
test('personal checks require authentication and stay isolated per uid',async({page})=>{
 await prepare(page);await page.goto(`${base}/next/#today`);await expect(page.locator('#today-title')).toBeVisible();
 await page.evaluate(()=>{globalThis.PINCON_ACCOUNT={mode:'legacy',user:{uid:'test-owner'}};window.dispatchEvent(new CustomEvent('pincon-account-ready',{detail:globalThis.PINCON_ACCOUNT}));});
 await page.locator('[data-action="read-changes"]').click();
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('pincon-personal-v1:test-owner:1-8') || '{}').lastSeenAt || 0)).toBeGreaterThan(0);
 await page.locator('[data-todo-key="classAssignments:task"]').click();
 await expect.poll(()=>page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('pincon-personal-v1:test-owner:1-8') || '{}').completed || {})[0]?.['classAssignments:task'])).toBe(true);
 await page.evaluate(()=>{globalThis.PINCON_ACCOUNT={mode:'legacy',user:{uid:'test-other'}};window.dispatchEvent(new CustomEvent('pincon-account-ready',{detail:globalThis.PINCON_ACCOUNT}));});
 await expect(page.locator('[data-todo-key="classAssignments:task"]')).not.toHaveAttribute('checked');
});

test('first visit reads public Firestore data when authentication SDK is unavailable', async({page})=>{
 await page.route('https://**/*', route=>route.abort());
 await page.route('https://firestore.googleapis.com/**', route=>{
  const name=route.request().postDataJSON().structuredQuery.from[0].collectionId;
  const document={name:'projects/test/databases/(default)/documents/schools/test/'+name+'/public',fields:{title:{stringValue:'공개 조회 검증 공지'},body:{stringValue:'서버 공개 데이터'},classKey:{stringValue:'1-8'}}};
  return route.fulfill({json:name==='announcements'?[{document}]:[]});
 });
 await page.addInitScript(()=>localStorage.setItem('pincon-profile-v2',JSON.stringify({grade:1,classNumber:8})));
 await page.goto(`${base}/next/?auth=1#today`);
 await expect(page.getByText('공개 조회 검증 공지',{exact:true}).first()).toBeVisible();
 await expect(page.locator('#nextClassCard')).toBeVisible();
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('pincon-class-ops-cache-v1')).data.announcements[0].title)).toBe('공개 조회 검증 공지');
});

// Only a local test module is replaced; no credentials or mutations reach Firebase.
for(const scenario of [
 {name:'success'},
 {name:'PIN',error:{code:'auth/invalid-credential'},message:'학번 또는 PIN이 맞지 않습니다.'},
 {name:'API',error:{status:503},message:'계정 서버에 연결할 수 없습니다. 학교 정보는 임시 모드로 확인할 수 있습니다.'},
 {name:'Firebase',error:{code:'auth/internal-error'},message:'로그인 연결에 문제가 생겼습니다. 잠시 후 다시 시도해주세요.'},
 {name:'network',error:{code:'auth/network-request-failed'},message:'인터넷 연결을 확인해주세요.'},
 {name:'timeout',error:{code:'server-timeout'},message:'서버 응답이 늦어지고 있습니다. 학교 정보는 임시 모드로 확인할 수 있습니다.'},
]) test(`login UI distinguishes ${scenario.name}`,async({page})=>{
 await prepare(page);
 const stub=`const session={user:{uid:'test-student'},account:{uid:'test-student',grade:1,classNumber:8,number:1,studentNumber:'10801',name:'테스트',mustChangePin:false,roles:['STUDENT']}};
 export async function currentFirebaseUser(){return null;}
 export function isStudentFirebaseUser(){return true;}
 export function normalizeActivationCode(v){return v.replaceAll('-','').toUpperCase();}
 export async function signInStudent(){${scenario.error?`throw Object.assign(new Error('test-only'),${JSON.stringify(scenario.error)});`:'return session;'}}
 export async function studentSession(){return session;}
 export async function claimStudentAccount(){return session;}
 export async function changeStudentPin(){return session;}
 export async function signOutStudent(){}
 export async function accountRequest(){throw new Error('test-only');}
 export const STUDENT_AUTH={};`;
 await page.route('**/next/core/student-auth.js*', route=>route.fulfill({contentType:'application/javascript',body:stub}));
 await page.goto(`${base}/next/?auth=1#today`);
 await page.locator('[data-action="login"]').click();
 await page.locator('#pinconSimpleStudentNumber').locator('input').fill('10801');
 await page.locator('#pinconSimpleCredential').locator('input').fill('246810');
 await page.locator('#pinconSimpleLoginButton').click();
 if(scenario.message){
  await expect(page.locator('[data-account-error]')).toHaveText(scenario.message);
  await page.locator('#pinconReadOnly').click();
 } else {
  await expect(page.locator('.pincon-account-gate')).toHaveCount(0);
  await page.locator('[data-install-later]').click();
  await page.locator('[data-notification-later], [data-notification-done]').click();
 }
 await expect(page.locator('#nextClassCard')).toBeVisible();
 await page.locator('[data-route="timetable"]:visible').click();
 await expect(page.locator('#timetable-title')).toBeVisible();
});

test('next period card advances automatically when the lesson ends', async({page})=>{
 await page.clock.install({time:new Date('2026-09-07T00:49:50Z')});
 await prepare(page);
 await page.addInitScript(()=>{
  const cache=JSON.parse(localStorage.getItem('pincon-class-ops-cache-v1'));
  cache.data.neisTimetables[0].periods.push({period:2,subject:'다음 수업 검증',startTime:'10:00',endTime:'10:50'});
  localStorage.setItem('pincon-class-ops-cache-v1',JSON.stringify(cache));
 });
 await page.goto(`${base}/next/#today`);
 await expect(page.locator('#nextClassCard')).toContainText('1교시 수업 중');
 await page.clock.fastForward(20000);
 await expect(page.locator('#nextClassCard')).toContainText('2교시까지 10분');
 await expect(page.locator('#nextClassCard')).toContainText('다음 수업 검증');
});
