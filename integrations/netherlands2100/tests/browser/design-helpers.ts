import {expect,type Page} from '@playwright/test';

export async function layer(p:Page,name:string,checked:boolean){
 await p.getByRole('button',{name:'레이어와 이벤트',exact:true}).click();
 await p.getByLabel(name,{exact:true}).setChecked(checked);
 await p.getByRole('button',{name:'레이어 닫기',exact:true}).click();
}
export async function city(p:Page,name:string){
 await p.getByRole('button',{name:'레이어와 이벤트',exact:true}).click();
 await p.getByTestId('layer-panel').getByRole('button',{name,exact:true}).click();
}
export async function resultAction(p:Page,name:string){
 if(!await p.getByTestId('comparison-results').isVisible())await p.getByRole('button',{name:'비교 결과',exact:true}).click();
 await p.getByRole('button',{name,exact:true}).click();
 await p.getByRole('button',{name:'비교 결과 닫기',exact:true}).click();
}
export async function mapLayout(p:Page,width:number,height:number){
 const boxes=await Promise.all(['.masthead','.workspace','.presentation-bar'].map(s=>p.locator(s).boundingBox()));
 for(let i=1;i<boxes.length;i++)expect(boxes[i-1]!.y+boxes[i-1]!.height).toBeLessThanOrEqual(boxes[i]!.y+1);
 const stage=await p.locator('.map-stage').boundingBox();const fraction=stage!.width*stage!.height/(width*height);expect(fraction).toBeGreaterThan(.7);
 console.log('Map-first frame',JSON.stringify({viewport:{width,height},mapFrame:stage,screenFraction:fraction}));
 for(const side of ['left','right']){
  const map=await p.getByTestId('map-'+side).boundingBox(),title=await p.getByTestId('summary-'+side).boundingBox(),metrics=await p.getByTestId('map-metrics-'+side).boundingBox();
  expect(title!.y).toBeGreaterThanOrEqual(map!.y);expect(title!.y+title!.height).toBeLessThan(metrics!.y);
  expect(metrics!.y+metrics!.height).toBeLessThan(map!.y+map!.height);expect(metrics!.x).toBeGreaterThan(map!.x);
  expect(metrics!.x+metrics!.width).toBeLessThan(map!.x+map!.width);
  for(let i=0;i<5;i++)await expect(p.getByTestId(`map-metric-${side}-${i}`)).toBeVisible();
 }
 expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const overflow=await p.locator('.map-metric dd,.map-title-row>strong,.year-card').evaluateAll(es=>es.filter(e=>e.scrollWidth>e.clientWidth+2||e.scrollHeight>e.clientHeight+2).map(e=>e.textContent));
 expect(overflow).toEqual([]);
}
export async function resultLayout(p:Page){
 await p.getByRole('button',{name:'비교 결과',exact:true}).click();
 const results=await p.getByTestId('comparison-results').boundingBox(),table=await p.locator('.comparison-results table').boundingBox();
 expect(table!.y+table!.height).toBeLessThanOrEqual(results!.y+results!.height);
 const overflow=await p.locator('.difference-headline article,.comparison-results td,.comparison-results th').evaluateAll(es=>es.filter(e=>e.scrollWidth>e.clientWidth+2||e.scrollHeight>e.clientHeight+2).map(e=>e.textContent));
 expect(overflow).toEqual([]);
 await p.getByRole('button',{name:'비교 결과 닫기',exact:true}).click();
}
