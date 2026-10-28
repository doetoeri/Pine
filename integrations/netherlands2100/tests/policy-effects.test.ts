import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import {examplePolicy,EXAMPLE_REGION_IDS,policyStatus,policySummary} from '../src/examplePolicy';
import {CATALOG,active,complete,planErrors,policyCost,type Dataset} from '../src/model';
import {runProgressive,strongestDifferenceYear} from '../src/progressive';
const data:Dataset=JSON.parse(fs.readFileSync(new URL('../public/data/model.json',import.meta.url),'utf8'));
const example=examplePolicy(data),a=runProgressive(data,'knmi'),b=runProgressive(data,'knmi',example.policySet,example);
describe('Visible policy effects without invented flood area',()=>{
 it('nationwide example fits catalogue durations, real regions and its own budget limits',()=>{
  expect(example.policySet).toHaveLength(400);
  expect(new Set(example.policySet.map(p=>p.region)).size).toBe(100);
  expect(new Set(example.policySet.map(p=>p.id)).size).toBe(400);
  expect(example.budget).toBe(600);expect(example.annualBudget).toBe(40);
  expect(planErrors(data,example.policySet,{climate:'high',quantile:'median',seed:2100,extraSubsidence:0,...example,minSeverity:2,stormScale:1})).toEqual([]);
  expect(example.policySet.reduce((n,p)=>n+policyCost(p),0)).toBeCloseTo(560);
  expect(example.policySet.every(p=>data.regions[p.region]&&complete(p)-p.start===CATALOG[p.kind].design+CATALOG[p.kind].build)).toBe(true);
 });
 it('early protection bridges construction and every dike renews without a gap or double boost',()=>{
  for(const region of new Set(example.policySet.map(p=>p.region))){
   const plan=example.policySet.filter(p=>p.region===region),[first,renewal]=plan.filter(p=>p.kind==='dike');
   expect(complete(renewal)).toBe(complete(first)+CATALOG.dike.life);
   expect(policyStatus(first,2096)).toBe('expired');expect(policyStatus(renewal,2096)).toBe('active');
   for(let year=2035;year<=2100;year++)expect(plan.some(p=>active(p,year))).toBe(true);
   expect(plan.filter(p=>p.kind==='dike'&&active(p,2096))).toHaveLength(1);
   expect(plan.filter(p=>active(p,2100)).map(p=>p.kind).sort()).toEqual(['barrier','dike']);
  }
 });
 it('before completion has no protection effect; planned/active/expired are explicit',()=>{
  expect(b.frames[0].permanentArea).toBe(a.frames[0].permanentArea);
  expect(b.frames[0].temporaryArea).toBe(a.frames[0].temporaryArea);
  expect(b.frames[0].base.assetDamage).toBe(a.frames[0].base.assetDamage);
  const p={...example.policySet[0],start:2030,end:2045};
  expect([2026,2030,2045,2120].map(y=>policyStatus(p,y))).toEqual(['planned','building','active','expired']);
  expect(policySummary(example.policySet,2026).nextCompletion).toBe(2034);
  const fresh=examplePolicy(data);expect(fresh).toEqual(example);expect(fresh.policySet).not.toBe(example.policySet);
  fresh.policySet[0].end=2035;expect(example.policySet[0].end).toBe(2034);
 });
 it('official-pathway peak-difference year has observable benefits without changing climate',()=>{
  const selected=strongestDifferenceYear(a,b),af=a.frames[selected.year-2026],bf=b.frames[selected.year-2026];
  expect(selected.hasDifference).toBe(true);expect(selected.kind).toBe('flood');
  for(let i=0;i<75;i++)expect(Math.abs(a.frames[i].temporaryArea-b.frames[i].temporaryArea)).toBeLessThanOrEqual(Math.abs(af.temporaryArea-bf.temporaryArea)+1e-6);
  console.log('Peak official example',JSON.stringify({year:selected.year,A:{area:af.temporaryArea,people:af.temporaryPeople,damage:af.base.assetDamage+af.base.productionLoss,power:af.powerShortage.reduce((x,y)=>x+y,0)},B:{area:bf.temporaryArea,people:bf.temporaryPeople,damage:bf.base.assetDamage+bf.base.productionLoss,power:bf.powerShortage.reduce((x,y)=>x+y,0)}}));
  expect(af.permanentArea).toBe(0);expect(bf.permanentArea).toBe(0);
  expect(bf.temporaryArea).toBeLessThan(af.temporaryArea-100);
  expect(bf.temporaryPeople).toBeLessThan(af.temporaryPeople-100000);
  expect(bf.base.assetDamage+bf.base.productionLoss).toBeLessThan(af.base.assetDamage+af.base.productionLoss);
  expect(bf.powerShortage.reduce((x,y)=>x+y,0)).toBeLessThan(af.powerShortage.reduce((x,y)=>x+y,0));
 });
 it('storm shortfall is no longer forced to zero when permanent inundation is zero',()=>{
  expect(a.frames.some(f=>f.permanentArea===0&&f.temporaryArea>0&&f.powerShortage.some(v=>v>1))).toBe(true);
  expect(a.frames.map(f=>f.base.storm)).toEqual(b.frames.map(f=>f.base.storm));
  for(const f of b.frames)expect(f.permanentPeople+f.temporaryPeople).toBeLessThanOrEqual(f.base.population+1e-6);
 });
 it('fixed region selection reproduces the baseline area ranking, independent of the active scene',()=>{
  const f=runProgressive(data,'extreme').frames[74];
  const ids=data.regions.map((r,i)=>({id:r.id,area:f.regionalArea[i]+f.regionalTemporaryArea[i]})).sort((a,b)=>b.area-a.area).slice(0,100).map(r=>r.id);
  expect(EXAMPLE_REGION_IDS).toEqual(ids);
 });
 it('extreme 2100 keeps over 91 percent of analyzed land dry without altering terrain or forcing',()=>{
  const z=data.cells.map(c=>c.z),none=runProgressive(data,'extreme'),withPolicy=runProgressive(data,'extreme',example.policySet,example);
  expect(withPolicy.errors).toEqual([]);
  const af=none.frames[74],bf=withPolicy.frames[74],dry=1-(bf.permanentArea+bf.temporaryArea)/withPolicy.areaDenominator;
  expect(af.permanentArea).toBeCloseTo(15067.96481,4);expect(bf.permanentArea).toBeCloseTo(1918.04596,4);
  expect(bf.temporaryArea).toBeCloseTo(711.343083,4);expect(dry).toBeCloseTo(.9158193965,8);
  expect(withPolicy.frames.map(f=>[f.slr,f.base.storm,f.base.waterNAP])).toEqual(none.frames.map(f=>[f.slr,f.base.storm,f.base.waterNAP]));
  // The end-state result must never be presented as safety for the entire timeline.
  expect(withPolicy.frames.some(f=>1-(f.permanentArea+f.temporaryArea)/withPolicy.areaDenominator<.9)).toBe(true);
  expect(data.cells.map(c=>c.z)).toEqual(z);
  console.log('Nationwide extreme 2100',JSON.stringify({A:{permanent:af.permanentArea,temporary:af.temporaryArea},B:{permanent:bf.permanentArea,temporary:bf.temporaryArea},dryPercent:dry*100}));
 });
});
