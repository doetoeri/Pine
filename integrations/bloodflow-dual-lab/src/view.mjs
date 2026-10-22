export function viewOf(world){
 const national=world.c.network==='nationwide',active=world.activeUnits(),unitCounts={all:{RBC:0,PLT:0,FFP:0}},groups=new Map();
 for(const u of active){const region=world.nodes[u.node??u.originNode]?.regionId??'local';unitCounts[region]??={RBC:0,PLT:0,FFP:0};unitCounts[region][u.kind]++;unitCounts.all[u.kind]++;const key=region+u.kind;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(u);}
 const listed=national?[...groups.values()].flatMap(g=>g.sort((a,b)=>Number(b.review)-Number(a.review)||a.expiry-b.expiry).slice(0,40)):active;
 const {realNodes,roadHours,regions,...config}=world.c;
 return {t:world.t,c:national?config:world.c,nodes:world.nodes,trucks:world.trucks,metrics:world.metrics,summary:world.summary(),regions:world.regionalSummary(),flows:world.flowTotals,transfers:world.transferLog,logLines:world.logLines,history:world.history,unitCounts,unitListSampled:listed.length<active.length,totalActive:active.length,
  units:listed.map(u=>national?{id:u.id,kind:u.kind,bloodType:u.bloodType,status:u.status,node:u.node,originNode:u.originNode,created:u.created,manufactured:u.manufactured,expiry:u.expiry,temperature:u.temperature,minimum:u.minimum,maximum:u.maximum,review:u.review,reviewReason:u.reviewReason,outHours:u.outHours,trace:u.trace.slice(-4),events:u.events.slice(-3)}:{...u,trace:u.trace.slice(-24),events:u.events.slice(-8)}),reviewDecisions:world.reviewDecisions};
}
