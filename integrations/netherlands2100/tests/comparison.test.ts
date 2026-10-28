import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import {runProgressive,riskAt,frameAt} from '../src/progressive';
import {complete,planErrors,DEFAULT_CONFIG,type Dataset,type Policy} from '../src/model';
import {blankSide,cloneSide,presentationAt,useScene} from '../src/store';
import {people,money} from '../src/format';
const data:Dataset=JSON.parse(fs.readFileSync(new URL('../public/data/model.json',import.meta.url),'utf8'));
const rot=data.regions.findIndex(r=>r.name==='Rotterdam'),dest=data.regions.findIndex(r=>r.name==='Apeldoorn');
const dike:Policy={id:'a-dike',kind:'dike',region:rot,start:2030,end:2040,budget:1.2};
const move:Policy[]=[{id:'housing',kind:'greenCity',region:dest,start:2026,end:2035},{id:'move',kind:'relocate',region:rot,destination:dest,people:30000,start:2030,end:2040}];
describe('Mission 03 policy independence and model validity',()=>{
 it('A/B add, copy, swap, reset use distinct policy arrays and keep time',()=>{
  const s=useScene.getState();s.set({left:blankSide('left'),right:blankSide('right'),currentYear:2080});
  s.updateSide('left',{policySet:[dike]});expect(useScene.getState().right.policySet).toEqual([]);
  s.updateSide('right',{policySet:move});expect(useScene.getState().left.policySet).toEqual([dike]);
  s.copy('left','right');expect(useScene.getState().right.policySet).toEqual([dike]);expect(useScene.getState().left.policySet).not.toBe(useScene.getState().right.policySet);
  s.updateSide('left',{policySet:[]});expect(useScene.getState().right.policySet).toEqual([dike]);s.swap();expect(useScene.getState().left.policySet).toEqual([dike]);s.resetSide('left');expect(useScene.getState().right.policySet).toEqual([]);expect(useScene.getState().currentYear).toBe(2080);
 });
 it('independent dike and relocation plans change distinct results',()=>{
  const none=runProgressive(data,'extreme'),a=runProgressive(data,'extreme',[dike]),b=runProgressive(data,'extreme',move);
  expect(a.errors).toEqual([]);expect(b.errors).toEqual([]);expect(a.frames[54].permanentArea).toBeLessThan(none.frames[54].permanentArea);
  // A 2040 dike expires at 2100 under the inherited 60-year service-life assumption.
  expect(a.frames[74].permanentArea).toBe(none.frames[74].permanentArea);
  expect(b.frames[74].base.migrated).toBe(30000);expect(b.frames[74].permanentArea).toBe(none.frames[74].permanentArea);expect(b.frames[74].permanentPeople).toBeLessThan(none.frames[74].permanentPeople);
 },45000); // Three complete 75-year model runs, including both power-flow calculations.
 it('identical policies have identical outputs with shared deterministic storms',()=>{
  const a=runProgressive(data,'knmi',[dike]),b=runProgressive(data,'knmi',cloneSide({...blankSide('right'),policySet:[dike]}).policySet);
  expect(a.frames).toEqual(b.frames);expect([...a.firstWet]).toEqual([...b.firstWet]);
  const no=runProgressive(data,'knmi');expect(a.frames.map(f=>f.base.storm)).toEqual(no.frames.map(f=>f.base.storm));
 });
 it('explicit completion and investment are honored; budgets do not invent protection',()=>{
  expect(complete(dike)).toBe(2040);
  const early=runProgressive(data,'extreme',[{...dike,end:2032,budget:2.4}]);expect(early.frames[6].policyInvestment).toBeCloseTo(2.4);
  const a=runProgressive(data,'extreme',[dike]),b=runProgressive(data,'extreme',[{...dike,budget:2.4}]);expect(a.frames[74].permanentArea).toBe(b.frames[74].permanentArea);expect(b.frames[74].policyInvestment).toBeCloseTo(2.4);
  expect(planErrors(data,[{...dike,end:2030}],DEFAULT_CONFIG).length).toBeGreaterThan(0);
  expect(planErrors(data,[{...dike,budget:-1}],DEFAULT_CONFIG).length).toBeGreaterThan(0);
  expect(planErrors(data,move.filter(p=>p.kind==='relocate'),DEFAULT_CONFIG)).toContain('이주 전에 도착지 신도시가 완공되어야 합니다 / housing prerequisite');
 });
 it('official pathway reveals growing terrain risk without fabricating floods',()=>{
  const run=runProgressive(data,'knmi');expect(run.frames[74].permanentArea).toBe(0);
  expect(run.frames[74].potentialArea).toBeGreaterThan(run.frames[0].potentialArea);expect(run.frames[74].riskIndex).toBeGreaterThan(run.frames[0].riskIndex);expect(run.frames[74].defenceMargin).toBeLessThan(run.frames[0].defenceMargin);
  for(const [index,frame] of run.frames.entries()){const head=(data.meta.baseMeanSeaNAP||0)+frame.slr;const expected=data.cells.filter(c=>c.z<=head&&c.spill<=head).reduce((a,c)=>a+c.area,0);expect(frame.potentialArea).toBeCloseTo(expected,6);if(index)expect(frame.riskIndex).toBeGreaterThanOrEqual(run.frames[index-1].riskIndex)}
  const cell=data.cells.findIndex((c,i)=>riskAt(run,i,2100)>0);expect(riskAt(run,cell,2050.5)).toBeCloseTo((riskAt(run,cell,2050)+riskAt(run,cell,2051))/2);
  expect(frameAt(run,2050.5).slr).toBeCloseTo((run.frames[24].slr+run.frames[25].slr)/2);
 });
 it('low pathway also applies policies and has the correct official anchor',()=>{const run=runProgressive(data,'noadapt',[dike]);expect(run.plan).toEqual([dike]);expect(run.frames[74].slr).toBe(.44);expect(run.frames[74].policyInvestment).toBeCloseTo(1.2)});
 it('600 seconds has four defined chapters and shared climate/year',()=>{expect(presentationAt(0).mode).toBe('knmi');expect(presentationAt(180).mode).toBe('noadapt');expect(presentationAt(360).mode).toBe('extreme');expect(presentationAt(540).year).toBe(2100);expect(presentationAt(600).year).toBe(2100);expect(presentationAt(600).chapter).toContain('04')});
 it('Korean numeric labels retain the currency magnitude',()=>{expect(people(9750000)).toBe('975만 명');expect(money(536)).toBe('5,360억 유로')});
});
