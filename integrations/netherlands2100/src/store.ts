import {create} from 'zustand';
import {persist,createJSONStorage} from 'zustand/middleware';
import type {Policy} from './model';
import type {Mode,ProgressiveRun} from './progressive';
export type Side='left'|'right';
export interface PolicySide {name:string;policySet:Policy[];budget:number;annualBudget:number}
export interface ComparisonState {climateScenario:Mode;currentYear:number;left:PolicySide&{results:ProgressiveRun};right:PolicySide&{results:ProgressiveRun}}
export const blankSide=(side:Side):PolicySide=>({name:side==='left'?'현행 유지':'대안 정책',policySet:[],budget:40,annualBudget:3});
export const cloneSide=(side:PolicySide):PolicySide=>({...side,policySet:side.policySet.map(p=>({...p}))});
interface Scene {
 currentYear:number;playing:boolean;speed:number;climateScenario:Mode;left:PolicySide;right:PolicySide;
 compare:boolean;potential:boolean;temporary:boolean;difference:boolean;policyAreas:boolean;mapOnly:boolean;simple:boolean;autoPause:boolean;loop:boolean;
 presentation:boolean;presentationElapsed:number;presentationCycle:number;panel:'left'|'right'|'sources'|'settings'|null;selected:number;
 set:(patch:Partial<Scene>)=>void;updateSide:(side:Side,patch:Partial<PolicySide>)=>void;copy:(from:Side,to:Side)=>void;swap:()=>void;resetSide:(side:Side)=>void;
}
export const useScene=create<Scene>()(persist((set,get)=>({
 currentYear:2026,playing:false,speed:2,climateScenario:'knmi',left:blankSide('left'),right:blankSide('right'),
 compare:true,potential:true,temporary:true,difference:false,policyAreas:true,mapOnly:false,simple:false,autoPause:true,loop:false,
 presentation:false,presentationElapsed:0,presentationCycle:0,panel:null,selected:-1,set:patch=>set(patch),
 updateSide:(side,patch)=>set(state=>({[side]:{...state[side],...patch,policySet:patch.policySet?patch.policySet.map(p=>({...p})):state[side].policySet}})),
 copy:(from,to)=>set({[to]:cloneSide(get()[from])}),swap:()=>set(state=>({left:cloneSide(state.right),right:cloneSide(state.left)})),resetSide:side=>set({[side]:blankSide(side)})
}),{name:'netherlands2100-comparison-v3',version:3,storage:createJSONStorage(()=>typeof localStorage==='undefined'?{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}:localStorage),partialize:s=>({left:s.left,right:s.right}),merge:(saved,current)=>{
 const source=saved as Partial<Scene>|undefined;
 const valid=(x:PolicySide|undefined)=>x&&typeof x.name==='string'&&Array.isArray(x.policySet)&&x.policySet.every(p=>p&&typeof p.kind==='string'&&Number.isInteger(p.region)&&Number.isInteger(p.start))&&Number.isFinite(x.budget)&&Number.isFinite(x.annualBudget);
 const left=valid(source?.left)?cloneSide(source!.left!):current.left,right=valid(source?.right)?cloneSide(source!.right!):current.right;
 return {...current,left,right,difference:left.policySet.length+right.policySet.length>0||current.difference};
}}));
/** A shared 600-second wall-clock sequence; policies never change between chapters. */
export function presentationAt(seconds:number){
 const elapsed=Math.max(0,Math.min(600,seconds));
 if(elapsed<180)return {mode:'knmi' as const,year:2026+elapsed/180*74,chapter:'01 · 고배출과 잠재 위험'};
 if(elapsed<360)return {mode:'noadapt' as const,year:2026+(elapsed-180)/180*74,chapter:'02 · 저배출과 방어 여유'};
 if(elapsed<540)return {mode:'extreme' as const,year:2026+(elapsed-360)/180*74,chapter:'03 · 방재 실패 가정'};
 return {mode:'extreme' as const,year:2100,chapter:'04 · 같은 조건의 정책 차이'};
}
