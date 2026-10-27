import {create} from 'zustand';
import {persist} from 'zustand/middleware';
import {DEFAULT_CONFIG,type Config,type Policy} from './model';
interface State {year:number;playing:boolean;speed:number;scenario:'A'|'B'|'C';lang:'ko'|'en';panel:string|null;selected:number;compare:boolean;presentation:boolean;layer:string;terrain:boolean;config:Config;plan:Policy[]|null;set:(v:Partial<State>)=>void;setConfig:(v:Partial<Config>)=>void}
export const useApp=create<State>()(persist((set)=>({year:2026,playing:false,speed:1,scenario:'A',lang:'ko',panel:null,selected:0,compare:false,presentation:false,layer:'potential',terrain:false,config:DEFAULT_CONFIG,plan:null,set:v=>set(v),setConfig:v=>set(s=>({config:{...s.config,...v}}))}),{name:'netherlands2100-v1',partialize:s=>({lang:s.lang,plan:s.plan,config:s.config})}));
