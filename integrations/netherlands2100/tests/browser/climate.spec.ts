import {layer,city,resultAction,mapLayout,resultLayout} from './design-helpers';
import {test,expect,type Page} from '@playwright/test';
import fs from 'node:fs';import path from 'node:path';
const qa=process.env.QA_DIR||path.resolve('docs/mission03-screenshots');fs.mkdirSync(qa,{recursive:true});
async function openEditor(page:Page,side:'A'|'B'){await page.getByRole('button',{name:`정책 ${side} 편집`,exact:true}).click();await expect(page.getByTestId(`editor-${side==='A'?'left':'right'}`)).toBeVisible()}
async function chooseRegion(page:Page,label:string,name:string){const select=page.getByLabel(label,{exact:true});const value=await select.locator('option').filter({hasText:new RegExp(`^${name}$`)}).getAttribute('value');expect(value).not.toBeNull();await select.selectOption(value!)}
async function addPolicy(page:Page,kind:string,start='2030',end='2040',region='Rotterdam'){
 await page.getByLabel('정책 유형',{exact:true}).selectOption(kind);await chooseRegion(page,'정책 위치',region);await page.getByLabel('착공 연도',{exact:true}).fill(start);await page.getByLabel('준공 연도',{exact:true}).fill(end);if(kind==='relocate')await chooseRegion(page,'이주 도착지','Apeldoorn');await page.getByRole('button',{name:'정책 추가',exact:true}).click();await expect(page.getByRole('alert')).toHaveCount(0);
}
const summary=(p:Page,side:'left'|'right')=>p.getByTestId(`summary-${side}`);
async function plan(p:Page,side:'left'|'right'){return JSON.parse((await summary(p,side).getAttribute('data-plan'))!)}
async function close(page:Page){await page.getByRole('button',{name:'닫기',exact:true}).click()}
let errors:string[]=[];
test.beforeEach(async({page})=>{errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/climate/');await expect(page.getByTestId('current-year')).toHaveText('2026');await expect(page.getByTestId('map-left')).toHaveAttribute('data-imagery','ready');});
test.afterEach(()=>{expect(errors).toEqual([])});

test('01 A dike is independent; 05 year and camera survive create/load/edit/delete',async({page})=>{
 await page.getByRole('button',{name:'Scenario 3',exact:true}).click();await page.getByRole('button',{name:'2080',exact:true}).click();await city(page,'Rotterdam');const camera=await summary(page,'left').getAttribute('data-camera');
 await openEditor(page,'A');await addPolicy(page,'dike');expect((await plan(page,'left')).length).toBe(1);expect(await plan(page,'right')).toEqual([]);await expect(page.getByTestId('current-year')).toHaveText('2080');expect(JSON.parse((await summary(page,'left').getAttribute('data-camera'))!)).toEqual(JSON.parse(camera!));
 await page.getByRole('button',{name:'제방 증고 수정',exact:true}).click();await page.getByLabel('준공 연도',{exact:true}).fill('2045');await page.getByLabel('정책 투자비',{exact:true}).fill('24');await page.getByRole('button',{name:'정책 수정 저장',exact:true}).click();expect((await plan(page,'left'))[0].end).toBe(2045);expect((await plan(page,'left'))[0].budget).toBe(2.4);
 await page.getByRole('button',{name:'기본 정책 불러오기',exact:true}).click();await expect(page.getByTestId('current-year')).toHaveText('2080');expect(JSON.parse((await summary(page,'left').getAttribute('data-camera'))!)).toEqual(JSON.parse(camera!));expect(await plan(page,'right')).toEqual([]);await page.getByRole('button',{name:'정책 목록 비우기',exact:true}).click();expect(await plan(page,'left')).toEqual([]);
});
test('02 B relocation is independent; 03 independent effects; 04 copy identical results',async({page})=>{
 await page.getByRole('button',{name:'Scenario 3',exact:true}).click();await page.getByRole('button',{name:'2100',exact:true}).click();
 await openEditor(page,'A');await addPolicy(page,'dike','2030','2045');await close(page);const leftPlan=await plan(page,'left'),leftArea=await summary(page,'left').getAttribute('data-area');
 await openEditor(page,'B');await addPolicy(page,'greenCity','2026','2035','Apeldoorn');await addPolicy(page,'relocate');expect(await plan(page,'left')).toEqual(leftPlan);expect(await summary(page,'left').getAttribute('data-area')).toBe(leftArea);expect((await plan(page,'right')).length).toBe(2);await close(page);
 const a=Number(await summary(page,'left').getAttribute('data-area')),b=Number(await summary(page,'right').getAttribute('data-area'));expect(a).toBeLessThan(b);
 await resultAction(page,'A → B 복제');for(const attr of ['data-area','data-people','data-risk','data-investment'])expect(await summary(page,'left').getAttribute(attr)).toBe(await summary(page,'right').getAttribute(attr));
 await openEditor(page,'B');await page.getByRole('button',{name:'제방 증고 삭제',exact:true}).click();await close(page);expect(await plan(page,'left')).toEqual(leftPlan);expect(await plan(page,'right')).toEqual([]);
 await resultAction(page,'A ↔ B 교환');expect(await plan(page,'left')).toEqual([]);expect(await plan(page,'right')).toEqual(leftPlan);await resultAction(page,'B 초기화');expect(await plan(page,'right')).toEqual([]);
});
test('A/B policy names, limits and lists persist separately',async({page})=>{
 await openEditor(page,'A');await page.getByLabel('A 정책안 이름',{exact:true}).fill('A 도시 방재');await page.getByLabel('A 총 예산',{exact:true}).fill('500');await addPolicy(page,'dike');await close(page);await openEditor(page,'B');await page.getByLabel('B 정책안 이름',{exact:true}).fill('B 현행 유지');await page.reload();await expect(summary(page,'left')).toContainText('A 도시 방재');await expect(summary(page,'right')).toContainText('B 현행 유지');expect((await plan(page,'left')).length).toBe(1);expect(await plan(page,'right')).toEqual([]);
});
test('06 official scenario risk grows; 07 risk and modeled flood stay distinct',async({page})=>{
 const initial=Number(await page.getByTestId('risk-left').getAttribute('data-pressure'));const initialPotential=Number(await page.getByTestId('risk-left').getAttribute('data-potential-area'));
 await page.getByRole('button',{name:'2100',exact:true}).click();expect(Number(await summary(page,'left').getAttribute('data-area'))).toBe(0);expect(Number(await page.getByTestId('risk-left').getAttribute('data-pressure'))).toBeGreaterThan(initial);expect(Number(await page.getByTestId('risk-left').getAttribute('data-potential-area'))).toBeGreaterThan(initialPotential);
 await expect(page.getByTestId('risk-left')).toContainText('실제 침수 아님');await expect(page.getByLabel('잠재 위험',{exact:true})).toBeChecked();await expect(page.getByTestId('overlay-left')).toHaveAttribute('data-risk-visible','true');await expect(page.getByTestId('overlay-left')).toHaveAttribute('data-flood-layer','model-only');
 await layer(page,'잠재 위험',false);await expect(page.getByTestId('overlay-left')).toHaveAttribute('data-risk-visible','false');expect(Number(await summary(page,'left').getAttribute('data-area'))).toBe(0);
});
for(const [width,height] of [[1920,1080],[3840,2160]])test(`08 readable comparison and panels without overlap ${width}x${height}`,async({page})=>{
 await page.setViewportSize({width,height});await page.getByRole('button',{name:'Scenario 3',exact:true}).click();await page.getByRole('button',{name:'2100',exact:true}).click();await openEditor(page,'A');await page.getByRole('button',{name:'기본 정책 불러오기',exact:true}).click();await close(page);await layer(page,'차이 강조',true);await page.evaluate(()=>document.fonts.ready);
 await expect.poll(()=>page.getByTestId('overlay-left').evaluate((e:HTMLCanvasElement)=>e.width)).toBeGreaterThan(1);
 await mapLayout(page,width,height);await resultLayout(page);
 expect(await page.locator('.speed button').first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(18);
 await page.screenshot({path:path.join(qa,`comparison-${width}x${height}.png`)});
 await openEditor(page,'A');const panel=await page.getByTestId('drawer').boundingBox(),maps=await page.locator('.map-stage').boundingBox();expect(maps!.x+maps!.width).toBeLessThanOrEqual(panel!.x);await expect(page.getByTestId('event-panel')).toHaveCount(0);await page.screenshot({path:path.join(qa,`policy-${width}x${height}.png`)});
});
test('difference overlay remains visible for small policy effects in official scenario',async({page})=>{
 await page.getByRole('button',{name:'2100',exact:true}).click();await openEditor(page,'A');await addPolicy(page,'dike','2030','2045');await close(page);const a=Number(await summary(page,'left').getAttribute('data-risk')),b=Number(await summary(page,'right').getAttribute('data-risk'));expect(a).toBeLessThan(b);expect(await summary(page,'left').getAttribute('data-area')).toBe(await summary(page,'right').getAttribute('data-area'));
 await layer(page,'차이 강조',true);await expect(page.getByTestId('overlay-left')).toHaveAttribute('data-difference','true');await page.screenshot({path:path.join(qa,'official-risk-difference.png')});
});
test('event resume does not reveal an unrelated regional panel',async({page})=>{
 await layer(page,'일시 홍수',false);
 await page.getByRole('button',{name:'Scenario 3',exact:true}).click();await page.getByRole('button',{name:'8×',exact:true}).click();await page.getByRole('button',{name:'재생',exact:true}).click();await expect(page.getByTestId('event-panel')).toBeVisible();await expect(page.getByTestId('current-year')).toHaveText('2038');await page.screenshot({path:path.join(qa,'event-2038.png')});await page.getByRole('button',{name:'1×',exact:true}).click();await page.getByRole('button',{name:'계속 진행',exact:true}).click();await expect(page.getByRole('button',{name:'일시정지',exact:true})).toBeVisible();await page.keyboard.press('Space');await expect(page.getByTestId('event-panel')).toHaveCount(0);await expect(page.locator('.place-panel')).toHaveCount(0);await expect(page.getByTestId('drawer')).toHaveCount(0);
});
test('camera pan, zoom and timeline are shared by both maps',async({page})=>{
 await city(page,'Rotterdam');await expect.poll(()=>page.locator('.map-title').evaluateAll(es=>new Set(es.map(e=>e.getAttribute('data-camera'))).size)).toBe(1);await close(page);const before=await summary(page,'left').getAttribute('data-camera');const viewport=page.getByTestId('map-left');await viewport.hover();await page.mouse.wheel(0,-240);await expect.poll(()=>summary(page,'left').getAttribute('data-camera')).not.toBe(before);await expect.poll(()=>page.locator('.map-title').evaluateAll(es=>new Set(es.map(e=>e.getAttribute('data-camera'))).size)).toBe(1);const box=await viewport.boundingBox(),centerBefore=JSON.parse((await summary(page,'left').getAttribute('data-camera'))!).center;await page.mouse.move(box!.x+box!.width*.6,box!.y+box!.height*.65);await page.mouse.down();await page.mouse.move(box!.x+box!.width*.6+90,box!.y+box!.height*.65+35,{steps:8});await page.mouse.up();await expect(page.locator('.place-panel')).toHaveCount(0);await expect.poll(async()=>JSON.parse((await summary(page,'left').getAttribute('data-camera'))!).center).not.toEqual(centerBefore);await expect.poll(()=>page.locator('.map-title').evaluateAll(es=>new Set(es.map(e=>e.getAttribute('data-camera'))).size)).toBe(1);await page.getByRole('button',{name:'2080',exact:true}).click();await expect(page.getByTestId('current-year')).toHaveText('2080');
});
test('09 accelerated full 600-second presentation and automatic repeat',async({page})=>{
 await page.getByRole('button',{name:'B 모범 정책',exact:true}).click();const rightPlan=await plan(page,'right');expect(rightPlan).toHaveLength(400);
 await page.clock.install();await page.getByRole('button',{name:'10분 발표 시작',exact:true}).click();
 const epoch=await page.evaluate(()=>Date.now());
 // Shift wall time while allowing real animation frames to render each chapter.
 // Fast-forwarding every MapLibre timer can starve React rendering in software WebGL.
 await page.clock.setSystemTime(epoch+181000);await expect(page.getByTestId('scene')).toHaveAttribute('data-mode','noadapt');
 await page.clock.setSystemTime(epoch+361000);await expect(page.getByTestId('scene')).toHaveAttribute('data-mode','extreme');
 await page.clock.setSystemTime(epoch+541000);await expect(page.getByTestId('current-year')).toHaveText('2100');
 await page.clock.setSystemTime(epoch+602000);await expect(page.getByTestId('scene')).toHaveAttribute('data-cycle','1');await expect(page.getByTestId('scene')).toHaveAttribute('data-mode','knmi');await expect(page.getByTestId('event-panel')).toHaveCount(0);expect(await plan(page,'right')).toEqual(rightPlan);expect(await plan(page,'left')).toEqual([]);
});
test('fullscreen, year and scenario keyboard shortcuts',async({page})=>{await page.getByRole('button',{name:'전체화면 (F)',exact:true}).click();await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(true);await page.keyboard.press('Escape');await page.keyboard.press('ArrowRight');await expect(page.getByTestId('current-year')).toHaveText('2027');await page.keyboard.press('3');await expect(page.getByTestId('scene')).toHaveAttribute('data-mode','extreme');await expect(page.getByTestId('current-year')).toHaveText('2027');});
test('fallback retains photos, risk layer and real inland boundaries',async({page})=>{await page.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type:any,...args:any[]){if(String(type).includes('webgl'))return null;return (get as any).call(this,type,...args)} as any});await page.reload();await expect(page.getByTestId('fallback-left')).toBeVisible();await expect(page.getByTestId('land-border').first()).toBeVisible();await expect(page.getByTestId('overlay-left')).toHaveAttribute('data-risk-visible','true');await page.getByRole('button',{name:'Scenario 3',exact:true}).click();await page.getByRole('button',{name:'2080',exact:true}).click();await page.screenshot({path:path.join(qa,'fallback-2080.png')});});
test('10 PinCon root/next routes and climate resource isolation',async({page})=>{
 const root=await page.request.get('/'),next=await page.request.get('/next/');expect(root.ok()).toBe(true);expect(next.ok()).toBe(true);expect(await root.text()).not.toContain('기후 경로 × 독립 정책 비교');
 const paths=await page.locator('script[src],link[rel=stylesheet]').evaluateAll(es=>es.map(e=>(e as HTMLScriptElement).src||(e as HTMLLinkElement).href));expect(paths.every(p=>new URL(p).pathname.startsWith('/climate/'))).toBe(true);const borders=await page.request.get('/climate/data/land-borders.geojson');expect(borders.ok()).toBe(true);expect(new Set((await borders.json()).features.map((f:any)=>f.properties.neighbor))).toEqual(new Set(['Germany','Belgium']));
});
test('09 real ten-minute unattended presentation',async({page})=>{
 test.skip(process.env.RUN_LONG_PRESENTATION!=='1','Enabled for the dedicated wall-clock endurance run');test.setTimeout(680000);
 await page.getByRole('button',{name:'10분 발표 시작',exact:true}).click();const started=Date.now(),samples:any[]=[];
 while(Date.now()-started<610000){await page.waitForTimeout(10000);samples.push({timestamp:new Date().toISOString(),elapsed:Date.now()-started,mode:await page.getByTestId('scene').getAttribute('data-mode'),year:await page.getByTestId('scene').getAttribute('data-year'),cycle:await page.getByTestId('scene').getAttribute('data-cycle')});await expect(page.getByTestId('scene')).toHaveAttribute('data-presentation','true');await expect(page.getByTestId('event-panel')).toHaveCount(0)}
 expect(new Set(samples.map(s=>s.mode))).toEqual(new Set(['knmi','noadapt','extreme']));expect(samples.some(s=>Number(s.cycle)>=1)).toBe(true);fs.writeFileSync(path.join(qa,'endurance-610s.json'),JSON.stringify({started:new Date(started).toISOString(),elapsed:Date.now()-started,samples},null,2));await page.screenshot({path:path.join(qa,'endurance-610s.png')});
});
