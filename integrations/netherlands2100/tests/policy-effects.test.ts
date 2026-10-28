import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import {examplePolicy,policyStatus,policySummary} from '../src/examplePolicy';
import {CATALOG,complete,planErrors,policyCost,type Dataset} from '../src/model';
import {runProgressive,strongestDifferenceYear} from '../src/progressive';
const data:Dataset=JSON.parse(fs.readFileSync(new URL('../public/data/model.json',import.meta.url),'utf8'));
const example=examplePolicy(data),a=runProgressive(data,'knmi'),b=runProgressive(data,'knmi',example.policySet,example);
describe('Visible policy effects without invented flood area',()=>{
 it('example fits real regions, total/annual limits and housing capacity',()=>{
  expect(example.policySet).toHaveLength(29);
  expect(planErrors(data,example.policySet,{climate:'high',quantile:'median',seed:2100,extraSubsidence:0,budget:40,annualBudget:3,minSeverity:2,stormScale:1})).toEqual([]);
  expect(example.policySet.reduce((n,p)=>n+policyCost(p),0)).toBeCloseTo(29.76);
  expect(example.policySet.filter(p=>p.kind==='relocate').reduce((n,p)=>n+p.people!,0)).toBe(60000);
  expect(example.policySet.every(p=>data.regions[p.region]&&complete(p)>p.start)).toBe(true);
 });
 it('short-life protection renews exactly at expiry, without double counting boosts',()=>{
  for(const kind of ['drainage','hardening','grid','transport'] as const){
   const first=example.policySet.find(p=>p.kind===kind)!;
   const renewal=example.policySet.find(p=>p.kind===kind&&p.region===first.region&&p.id!==first.id)!;
   expect(complete(renewal)).toBe(complete(first)+CATALOG[kind].life);
   expect(policyStatus(first,complete(renewal))).toBe('expired');
   expect(policyStatus(renewal,2100)).toBe('active');
  }
 });
 it('before completion has no protection effect; planned/active/expired are explicit',()=>{
  expect(b.frames[0].permanentArea).toBe(a.frames[0].permanentArea);
  expect(b.frames[0].temporaryArea).toBe(a.frames[0].temporaryArea);
  expect(b.frames[0].base.assetDamage).toBe(a.frames[0].base.assetDamage);
  const p={...example.policySet[0],start:2030,end:2045};
  expect([2026,2030,2045,2120].map(y=>policyStatus(p,y))).toEqual(['planned','building','active','expired']);
  expect(policySummary(example.policySet,2026).nextCompletion).toBe(2034);
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
 it('extreme comparison retains terrain, climate and measurable permanent differences in 2100',()=>{
  const z=data.cells.map(c=>c.z),none=runProgressive(data,'extreme'),withPolicy=runProgressive(data,'extreme',example.policySet,example);
  expect(withPolicy.frames[74].permanentArea).toBeLessThan(none.frames[74].permanentArea);
  expect(withPolicy.frames[74].slr).toBe(none.frames[74].slr);
  expect(data.cells.map(c=>c.z)).toEqual(z);
  expect(examplePolicy(data).policySet).not.toBe(example.policySet);
 });
});
