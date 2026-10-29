import {test,expect} from '@playwright/test';
import path from 'node:path';import fs from 'node:fs';
const qa=process.env.QA_DIR||path.resolve('docs/blue-design-screenshots');fs.mkdirSync(qa,{recursive:true});

test('all five live metrics and differences remain visible with the nationwide plan',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/climate/');await page.getByRole('button',{name:'B 모범 정책',exact:true}).click();await page.getByRole('button',{name:'Scenario 3',exact:true}).click();await page.getByRole('button',{name:'2100',exact:true}).click();
 const expectedA=[17291.356214,11055379.394532,612.104,0,6507.3],expectedB=[2629.389043,3633108.549,206.978,560,1182.7];
 for(let i=0;i<5;i++){
  const a=page.getByTestId('map-metric-left-'+i),b=page.getByTestId('map-metric-right-'+i);
  await expect(a).toBeVisible();await expect(b).toBeVisible();
  expect(Number(await a.getAttribute('data-value'))).toBeCloseTo(expectedA[i],i===0?3:0);
  expect(Number(await b.getAttribute('data-value'))).toBeCloseTo(expectedB[i],i===0?3:0);
  if(i!==3)await expect(b).toContainText('감소');else await expect(b).toContainText('증가');
 }
 await expect(page.getByTestId('comparison-results')).not.toBeVisible();
 await page.getByRole('button',{name:'비교 결과',exact:true}).click();await expect(page.getByTestId('comparison-results')).toBeVisible();
 await page.getByRole('button',{name:'레이어와 이벤트',exact:true}).click();await expect(page.getByTestId('comparison-results')).not.toBeVisible();await expect(page.getByTestId('layer-panel')).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.getByTestId('layer-panel')).not.toBeVisible();await expect(page.getByTestId('current-year')).toHaveText('2100');
 await page.getByRole('button',{name:'정책 B 편집',exact:true}).click();await expect(page.getByTestId('drawer')).toBeVisible();await expect(page.getByTestId('layer-panel')).not.toBeVisible();
 expect(errors).toEqual([]);
});

test('reference surface parameters and accessible icon actions survive the full-screen view',async({page})=>{
 await page.goto('/climate/');
 for(const name of ['출처와 가정','설정','전체화면 (F)'])await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
 const surfaces=page.locator('[data-surface="blue"]');await expect(surfaces).toHaveCount(2);
 for(const panel of await surfaces.all()){
  await expect(panel).toHaveAttribute('data-corner-radius','40');await expect(panel).toHaveAttribute('data-corner-smoothing','0.6');
  expect(await panel.locator('linearGradient stop').evaluateAll(es=>es.map(e=>({offset:e.getAttribute('offset'),color:e.getAttribute('stop-color')})))).toEqual([{offset:'0%',color:'#0067E2'},{offset:'100%',color:'#D0E6FF'}]);
  await expect(panel.locator('feFlood')).toHaveAttribute('flood-opacity','0.5');
 }
 await page.getByRole('button',{name:'지도만 보기 (M)',exact:true}).click();await expect(page.getByTestId('map-metrics-left')).not.toBeVisible();
 await page.keyboard.press('Escape');await expect(page.getByTestId('map-metrics-left')).toBeVisible();
});

test('compact phone layout preserves actions without horizontal document overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/climate/');await expect(page.getByTestId('current-year')).toHaveText('2026');
 await page.getByRole('button',{name:'B 모범 정책',exact:true}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'레이어와 이벤트',exact:true}).click();await expect(page.getByTestId('layer-panel')).toBeVisible();
 await page.getByRole('button',{name:'레이어 닫기',exact:true}).click();await expect(page.getByTestId('layer-panel')).not.toBeVisible();
 await page.screenshot({path:path.join(qa,'mobile-390.jpg'),quality:90,fullPage:true});
});
