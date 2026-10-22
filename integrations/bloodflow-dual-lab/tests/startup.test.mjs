import test from 'node:test';import assert from 'node:assert/strict';
import {startApplication} from '../src/startup.mjs';

function fixture(){
 class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.attributes={};this.value='';this._text='';}
  append(...els){this.children.push(...els);}
  prepend(el){this.children.unshift(el);}
  replaceChildren(...els){this.children=els;this._text='';}
  setAttribute(k,v){this.attributes[k]=v;}
  set textContent(v){this._text=String(v);this.children=[];}
  get textContent(){return this._text+this.children.map(el=>el.textContent).join('');}
  set innerHTML(_){assert.fail('Startup diagnostics must use text nodes.');}
 }
 const host=new Element('div');host.id='app';const panel=new Element('section');panel.id='startup-status';panel.textContent='연구실을 준비하고 있습니다…';host.append(panel);
 const find=(el,id)=>el.id===id?el:el.children.map(child=>find(child,id)).find(Boolean);
 const document={getElementById:id=>find(host,id),createElement:tag=>new Element(tag)};
 let reloads=0;const listeners=new Set();
 class Window extends EventTarget{
  addEventListener(type,fn){listeners.add(fn);super.addEventListener(type,fn);}
  removeEventListener(type,fn){listeners.delete(fn);super.removeEventListener(type,fn);}
 }
 const window=new Window();window.location={reload(){reloads++;}};
 Object.defineProperty(window,'localStorage',{get(){assert.fail('Startup must not clear or rewrite saved research.');}});
 const callbacks=[],active=new Set();const setTimer=(fn,ms)=>{callbacks.push({fn,ms});active.add(fn);return fn;},clearTimer=fn=>active.delete(fn);
 const start=load=>startApplication({window,document,load,setTimer,clearTimer});
 return {window,document,host,panel,start,callbacks,active,listeners,get reloads(){return reloads;},fire(){callbacks.at(-1).fn();}};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('a rejected entry or dependency import shows its error as text and reloads only on explicit action',async()=>{
 const f=fixture();let imports=0;const message='Failed to fetch dynamically imported module: /bloodflow/modules/engine.mjs <img src=x onerror=alert(1)>';
 const result=f.start(async()=>{imports++;throw TypeError(message);});assert.equal(await result.completion,false);assert.equal(imports,1);assert.equal(f.reloads,0);
 assert.equal(f.document.getElementById('startup-status').attributes.role,'alert');assert.equal(f.document.getElementById('startup-details').children[1].textContent,message);
 const button=f.document.getElementById('startup-reload');button.onclick();button.onclick();assert.equal(f.reloads,1);assert.equal(button.disabled,true);assert.equal(imports,1);assert.equal(f.active.size,0);assert.equal(f.listeners.size,0);
});

test('synchronous loader errors also end the spinner and expose a recovery action',async()=>{
 const f=fixture();const result=f.start(()=>{throw SyntaxError('Unexpected token in app module');});assert.equal(await result.completion,false);
 assert.match(f.host.textContent,/연구실을 시작하지 못했습니다/);assert.ok(f.document.getElementById('startup-reload'));assert.equal(f.reloads,0);assert.equal(f.active.size,0);
});

test('a stalled import shows a ten-second notice without retrying and late modules continue once',async()=>{
 const f=fixture(),wait=deferred();let imports=0;const result=f.start(()=>{imports++;return wait.promise;});await Promise.resolve();assert.equal(f.callbacks[0].ms,10000);f.fire();
 assert.match(f.host.textContent,/10초 넘게 응답/);assert.equal(f.document.getElementById('startup-status').attributes.role,'status');assert.equal(imports,1);assert.equal(f.reloads,0);
 f.window.dispatchEvent(new Event('bloodflow:module-started'));assert.match(f.host.textContent,/연구 자료를 준비/);assert.equal(f.document.getElementById('startup-reload'),undefined);
 wait.resolve();assert.equal(await result.completion,true);assert.equal(imports,1);assert.equal(f.active.size,0);assert.equal(f.listeners.size,0);
});

test('once the app owns initialization, a late watchdog cannot replace its required-data recovery screen',async()=>{
 const f=fixture(),wait=deferred(),result=f.start(()=>wait.promise);await Promise.resolve();f.window.dispatchEvent(new Event('bloodflow:module-started'));
 const dataError=f.document.createElement('section');dataError.id='required-data-error';dataError.textContent='routes.json HTTP 503 · 자료 다시 받기';f.host.replaceChildren(dataError);f.fire();
 assert.equal(f.host.children[0],dataError);assert.equal(f.document.getElementById('startup-reload'),undefined);wait.resolve();assert.equal(await result.completion,true);assert.equal(f.host.children[0],dataError);
});

test('successful startup removes its watchdog and leaves the ready research UI alone',async()=>{
 const f=fixture();const clock=f.document.createElement('div');clock.id='clock';clock.textContent='D0 06:00';
 const result=f.start(()=>{f.window.dispatchEvent(new Event('bloodflow:module-started'));f.host.replaceChildren(clock);});assert.equal(await result.completion,true);f.fire();
 assert.equal(f.host.children.length,1);assert.equal(f.host.children[0],clock);assert.equal(f.active.size,0);assert.equal(f.listeners.size,0);assert.equal(f.reloads,0);
});

test('an initialization exception preserves existing time and note fields alongside the diagnostic',async()=>{
 const f=fixture(),clock=f.document.createElement('div'),note=f.document.createElement('textarea');clock.id='clock';clock.textContent='D0 06:00';note.id='note-engineering';note.value='연구자가 작성한 해석';
 const result=f.start(()=>{f.window.dispatchEvent(new Event('bloodflow:module-started'));f.host.replaceChildren(clock,note);throw Error('Initialization failed');});assert.equal(await result.completion,false);
 assert.equal(f.document.getElementById('clock'),clock);assert.equal(clock.textContent,'D0 06:00');assert.equal(f.document.getElementById('note-engineering').value,'연구자가 작성한 해석');assert.ok(f.document.getElementById('startup-reload'));assert.equal(f.reloads,0);
});
