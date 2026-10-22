import {validatePlan,makePair,summarize} from './experiments.mjs';
let paused=false,working=false,resumeWaiter=null,send;
async function execute(message){
 if(working){send({type:'error',error:'이미 반복 실험이 진행 중입니다.'});return;}working=true;paused=false;
 try{const {config,data}=message,plan=validatePlan(message.plan),pairs=[];
  for(let i=0;i<plan.repeats;i++){
   while(paused)await new Promise(resolve=>resumeWaiter=resolve);
   pairs.push(makePair(config,data,plan,i));send({type:'progress',progress:(i+1)/plan.repeats});
   await new Promise(resolve=>setTimeout(resolve,0));
  }
  send({type:'result',result:summarize(pairs,plan,config)});
 }catch(e){send({type:'error',error:e.message});}finally{working=false;resumeWaiter=null;}
}
function receive(m){if(m.type==='pause'){paused=true;send({type:'paused',paused:true});}else if(m.type==='resume'){paused=false;resumeWaiter?.();resumeWaiter=null;send({type:'paused',paused:false});}else execute(m);}
if(typeof self!=='undefined'&&typeof self.postMessage==='function'){send=v=>self.postMessage(v);self.onmessage=e=>receive(e.data);}
else{const {parentPort}=await import('node:worker_threads');send=v=>parentPort.postMessage(v);parentPort.on('message',receive);}
