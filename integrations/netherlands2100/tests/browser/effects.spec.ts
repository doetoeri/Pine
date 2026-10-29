import {layer,city,resultAction,mapLayout,resultLayout} from './design-helpers';
import {test,expect,type Page} from '@playwright/test';
import fs from 'node:fs';import path from 'node:path';
const qa=process.env.QA_DIR||path.resolve('docs/policy-effects-screenshots');fs.mkdirSync(qa,{recursive:true});
const summary=(p:Page,side:string)=>p.getByTestId('summary-'+side);
const plan=async(p:Page,side:string)=>JSON.parse((await summary(p,side).getAttribute('data-plan'))!);
async function example(p:Page){await p.getByRole('button',{name:'B 모범 정책',exact:true}).click()}
async function effectYear(p:Page){const button=p.getByTestId('effect-year'),year=await button.getAttribute('data-year');await button.click();await expect(p.getByTestId('current-year')).toHaveText(year!);return year!}
async function pixels(p:Page,side:string){return p.getByTestId('overlay-'+side).evaluate((canvas:HTMLCanvasElement)=>{
 const bytes=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;let orange=0,purple=0;
 for(let i=0;i<bytes.length;i+=4){if(bytes[i+3]<70)continue;if(bytes[i]>245&&bytes[i+1]>90&&bytes[i+1]<190&&bytes[i+2]<80)orange++;if(bytes[i]>140&&bytes[i+2]>220&&bytes[i+1]<170)purple++}
 return {orange,purple};
})}
test.beforeEach(async({page})=>{await page.goto('/climate/');await expect(page.getByTestId('current-year')).toHaveText('2026');await expect(page.getByTestId('map-left')).toHaveAttribute('data-imagery','ready')});

test('example changes only B and preserves climate, year and synchronized camera',async({page})=>{
 await page.getByRole('button',{name:'2080',exact:true}).click();const camera=await summary(page,'left').getAttribute('data-camera');await example(page);await expect(page.getByTestId('current-year')).toHaveText('2080');await effectYear(page);
 expect(await plan(page,'left')).toEqual([]);expect(await plan(page,'right')).toHaveLength(400);await expect(page.getByTestId('scene')).toHaveAttribute('data-mode','knmi');
 expect(await summary(page,'left').getAttribute('data-camera')).toBe(camera);expect(await summary(page,'right').getAttribute('data-camera')).toBe(camera);
 await expect(page.getByLabel('일시 홍수',{exact:true})).toBeChecked();await expect(page.getByLabel('차이 강조',{exact:true})).toBeChecked();await expect(page.getByLabel('잠재 위험',{exact:true})).not.toBeChecked();
 expect(Number(await page.getByTestId('benefit-0').getAttribute('data-delta'))).toBeGreaterThan(100);expect(Number(await page.getByTestId('benefit-1').getAttribute('data-delta'))).toBeGreaterThan(100000);await expect(page.getByTestId('benefit-0')).toContainText('감소');
 await page.reload();expect(await plan(page,'left')).toEqual([]);expect(await plan(page,'right')).toHaveLength(400);
});
test('before completion is explained and the effect button explicitly seeks without changing climate',async({page})=>{
 await example(page);await expect(page.getByTestId('current-year')).toHaveText('2026');await expect(page.getByTestId('comparison-explanation')).toContainText('준공 전');await expect(page.getByTestId('policy-status-right')).toContainText('공사 중');
 await effectYear(page);await expect(page.getByTestId('scene')).toHaveAttribute('data-mode','knmi');await expect(page.getByTestId('policy-status-right')).toContainText('효력 중');await expect(page.getByTestId('comparison-explanation')).toContainText('영구 침수는 양쪽 0');
});
test('rendered pixels highlight real storm differences and clear with identical policies',async({page})=>{
 await example(page);await effectYear(page);await expect.poll(async()=>(await pixels(page,'left')).orange).toBeGreaterThan(100);await expect.poll(async()=>(await pixels(page,'right')).purple).toBeGreaterThan(100);await expect(page.getByTestId('policy-overlay-right')).toHaveAttribute('data-regions','100');
 const before=await summary(page,'left').getAttribute('data-camera');await page.getByRole('button',{name:'차이 지역 확대',exact:true}).click();await expect.poll(()=>summary(page,'left').getAttribute('data-camera')).not.toBe(before);expect(await summary(page,'left').getAttribute('data-camera')).toBe(await summary(page,'right').getAttribute('data-camera'));await page.screenshot({path:path.join(qa,'difference-focus.jpg'),quality:90});
 await resultAction(page,'B → A 복제');await expect(page.getByTestId('comparison-explanation')).toContainText('동일한 정책');await expect.poll(async()=>{const a=await pixels(page,'left'),b=await pixels(page,'right');return a.orange+a.purple+b.orange+b.purple}).toBe(0);
});
for(const [width,height] of [[1920,1080],[3840,2160]])test(`clear effects and map-only presentation ${width}x${height}`,async({page})=>{
 await page.setViewportSize({width,height});await example(page);await page.getByRole('button',{name:'Scenario 3',exact:true}).click();await page.getByRole('button',{name:'2100',exact:true}).click();await page.evaluate(()=>document.fonts.ready);
 await expect(page.getByLabel('잠재 위험',{exact:true})).not.toBeChecked();expect(Number(await page.getByTestId('benefit-0').getAttribute('data-a'))).toBeCloseTo(17291.356214,3);expect(Number(await page.getByTestId('benefit-0').getAttribute('data-b'))).toBeCloseTo(2629.389043,3);
 await mapLayout(page,width,height);await resultLayout(page);
 await expect.poll(async()=>(await pixels(page,'left')).orange).toBeGreaterThan(100);await page.screenshot({path:path.join(qa,`effects-${width}x${height}.jpg`),quality:90});
 const year=await page.getByTestId('scene').getAttribute('data-year'),camera=await summary(page,'left').getAttribute('data-camera'),left=await plan(page,'left'),right=await plan(page,'right');
 await page.getByRole('button',{name:'지도만 보기 (M)',exact:true}).click();await expect(page.getByTestId('scene')).toHaveAttribute('data-map-only','true');
 for(const s of ['.masthead','.climate-ribbon','.comparison-results','.timeline-dock','.risk-readout'])await expect(page.locator(s).first()).not.toBeVisible();
 const maps=await page.locator('.map-stage').boundingBox();expect(maps!.height).toBeGreaterThan(height*.98);expect(maps!.width).toBeGreaterThan(width*.98);await expect(page.getByRole('button',{name:'조작 보기 (M)',exact:true})).toBeVisible();await page.screenshot({path:path.join(qa,`map-only-${width}x${height}.jpg`),quality:90});
 await page.keyboard.press('m');await expect(page.getByTestId('scene')).toHaveAttribute('data-map-only','false');expect(await page.getByTestId('scene').getAttribute('data-year')).toBe(year);expect(await plan(page,'left')).toEqual(left);expect(await plan(page,'right')).toEqual(right);expect(await summary(page,'left').getAttribute('data-camera')).toBe(camera);
});
test('map-only mode keeps playback running and Escape restores controls',async({page})=>{
 await page.getByRole('button',{name:'10분 발표 시작',exact:true}).click();await page.keyboard.press('m');await expect(page.getByTestId('scene')).toHaveAttribute('data-map-only','true');await expect(page.getByTestId('scene')).toHaveAttribute('data-presentation','true');
 const initial=Number(await page.getByTestId('scene').getAttribute('data-elapsed'));await expect.poll(async()=>Number(await page.getByTestId('scene').getAttribute('data-elapsed'))).toBeGreaterThan(initial+1);await page.keyboard.press('Escape');await expect(page.getByTestId('scene')).toHaveAttribute('data-map-only','false');await expect(page.getByRole('button',{name:'일시정지',exact:true})).toBeVisible();await page.keyboard.press('Space');
});
test('applying the example to A works independently and an expired dike is clearly labeled',async({page})=>{
 await page.getByRole('button',{name:'정책 A 편집',exact:true}).click();await expect(page.getByTestId('editor-left')).toContainText('전국 방재 모범안');await page.getByRole('button',{name:'모범 정책 적용',exact:true}).click();expect(await plan(page,'left')).toHaveLength(400);expect(await plan(page,'right')).toEqual([]);await expect(page.getByLabel('A 총 예산',{exact:true})).toHaveValue('6000');await expect(page.getByLabel('A 연간 예산',{exact:true})).toHaveValue('400');await expect(page.getByRole('alert')).toHaveCount(0);await page.getByRole('button',{name:'닫기',exact:true}).click();await effectYear(page);await expect(page.getByTestId('benefit-0')).toContainText('증가');
 await resultAction(page,'A 초기화');await page.getByRole('button',{name:'정책 A 편집',exact:true}).click();await page.getByLabel('착공 연도',{exact:true}).fill('2030');await page.getByLabel('준공 연도',{exact:true}).fill('2040');await page.getByRole('button',{name:'정책 추가',exact:true}).click();await page.getByRole('button',{name:'닫기',exact:true}).click();await page.getByRole('button',{name:'2100',exact:true}).click();await expect(page.getByTestId('policy-status-left')).toContainText('수명 종료');await expect(summary(page,'left')).toContainText('사용자 정책');
});
