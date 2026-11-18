'use strict';
// Transport-independent authored workflow. Never accepts caller-supplied programs.
const crypto=require('node:crypto');
const {ReferenceController,hash}=require('./controller.cjs');
const {comparePublicChecks}=require('./public-check-changes.cjs');
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const sameFiles=(a,b)=>Object.keys(a).length===Object.keys(b).length&&Object.keys(b).every(p=>Object.hasOwn(a,p)&&a[p]===b[p]);
const titles={'pagination-zero':'Keep a zero cursor','config-isolation':'Stop settings leaking','latest-request-wins':'Keep the newest search'};
async function createReferenceWorkflow({definitions,executeChecks,contractChecks=executeChecks}={}){
 if(!Array.isArray(definitions)||typeof executeChecks!=='function')throw Error('Explicit authored catalog and checker required');
 const byId=new Map(definitions.map(t=>[t.id,t]));
 const contracts=new Map();
 for(const task of definitions)contracts.set(task.id,(await contractChecks(task.id,'corrected')).checks.map(c=>c.id));
 let current=null,task=null,sessionId=null,epoch=0,proposal=null,checks=[],events=[],eventSeq=0;
 let lastPublicVerdict=null,checkChanges=null;
 const event=(kind,label)=>events.push({id:'event-'+(++eventSeq),kind,label});
 const state=()=>({
  mode:'authored-reference',aiRunning:false,modelCalls:0,
  sessionId,task:task?{id:task.id,title:titles[task.id],prompt:task.prompt,hasRegressionTrap:!!task.regressionTrap}:null,
  snapshot:current?current.snapshot():null,
  proposal:proposal?structuredClone(proposal):null,checks:structuredClone(checks),checkChanges:structuredClone(checkChanges),events:structuredClone(events)
 });
 const response=(status,body)=>({status,body});
 const fail=(status,message)=>response(status,{error:message,state:state()});
 async function dispatch({method,pathname,body}={}){
  if(method==='GET'&&pathname==='/api/bootstrap')return response(200,{tasks:definitions.map(t=>({id:t.id,title:titles[t.id],prompt:t.prompt})),state:state()});
  if(method==='GET'&&pathname==='/api/state')return response(200,{state:state()});
  if(method!=='POST')return fail(404,'Unknown reference route.');
  if(pathname==='/api/start'){
   if(!exact(body,['taskId'])||!byId.has(body.taskId))return fail(400,'Choose a known authored sample.');
   current?.cancel();epoch++;
   task=byId.get(body.taskId);sessionId=crypto.randomUUID();proposal=null;checks=[];events=[];eventSeq=0;
   lastPublicVerdict=null;checkChanges=null;
   current=new ReferenceController({files:task.files,writable:task.writable,taskText:task.prompt,suiteId:task.id,checkIds:contracts.get(task.id)});
   event('start','Opened an authored sample. No AI is running.');
   return response(200,{state:state()});
  }
  if(pathname!=='/api/action')return fail(404,'Unknown reference route.');
  if(!current)return fail(409,'Open an authored sample first.');
  const allowed=['read','load-authored','load-authored-trap','apply','test','finish','cancel'];
  if(!body||!allowed.includes(body.action))return fail(400,'Unknown reference action.');
  const fields=body.action==='read'?['sessionId','revision','action','path']:['sessionId','revision','action'];
  if(!exact(body,fields)||body.sessionId!==sessionId||!Number.isSafeInteger(body.revision))return fail(409,'Stale or malformed reference session.');
  if(body.action!=='cancel'&&body.revision!==current.snapshot().revision)return fail(409,'State changed. Refresh before retrying.');
  if(body.action==='cancel'){
   epoch++;current.cancel();event('cancel','Closed the reference session. There was no model to stop.');
   return response(200,{state:state()});
  }
  const c=current,startedEpoch=epoch;
  const act=(type,extra={})=>c.decide({revision:c.snapshot().revision,type,...extra});
  const read=path=>{
   const op=act('read',{path});c.complete(op.id,{content:c.filesForReferenceTest()[path]});
   event('read','Read '+path+' from the in-memory sample.');
  };
  try{
   if(body.action==='read')read(body.path);
   else if(body.action==='load-authored'||body.action==='load-authored-trap'){
    const trap=body.action==='load-authored-trap';
    if(trap){
     if(!task.regressionTrap)return fail(400,'This authored drill has no regression trap.');
     if(proposal||c.snapshot().counts.patches||c.snapshot().counts.tests!==1||!checks.some(check=>!check.ok)||!sameFiles(c.filesForReferenceTest(),task.files))return fail(409,'Run the baseline once before loading the authored regression trap.');
    }else if(proposal&&!(proposal.kind==='regression-trap'&&proposal.applied&&c.snapshot().counts.tests===2&&checks.some(check=>!check.ok)))return fail(409,'The authored example patch is already loaded. Run the applied trap checks before its correction.');
    for(const m of c.snapshot().manifest)if(!c.snapshot().evidence.some(e=>e.path===m.path&&e.sha256===m.sha256))read(m.path);
    const snapshot=c.snapshot(),evidenceIds=snapshot.manifest.map(m=>snapshot.evidence.findLast(e=>e.path===m.path&&e.sha256===m.sha256).id);
    const op=act('code',{evidenceIds,objective:trap?'Load the explicitly authored regression trap for this reference sample only.':'Load the authored example correction for this reference sample only.'});
    const before=c.filesForReferenceTest();
    const edits=Object.entries(trap?task.regressionTrap:task.correction).map(([path,replace])=>({path,beforeSha256:hash(before[path]),find:before[path],replace}));
    c.complete(op.id,{edits});
    proposal={artifactId:'a:'+op.id,kind:trap?'regression-trap':'authored-correction',applied:false,source:trap?'Authored regression trap, not model output':'Authored example correction, not model output',edits};
    event('proposal',trap?'Loaded an authored regression trap. No model generated it.':'Loaded an authored example patch. No model generated it.');
   }else if(body.action==='apply'){
    if(!proposal||proposal.applied)return fail(409,'Load an unapplied authored example patch first.');
    act('apply',{artifactId:proposal.artifactId});proposal.applied=true;checks=[];checkChanges=null;
    event('apply','Applied the authored patch to the in-memory sample only.');
   }else if(body.action==='test'){
    const files=c.filesForReferenceTest();
    const corrected={...task.files,...task.correction};
    const variant=sameFiles(files,task.files)?'baseline':sameFiles(files,corrected)?'corrected':task.regressionTrap&&sameFiles(files,{...task.files,...task.regressionTrap})?'regression-trap':null;
    if(!variant)return fail(422,'Unrecognized source. The reference runner will not execute it.');
    const op=act('test');checkChanges=null;
    try{
     const result=await executeChecks(task.id,variant);
     if(epoch!==startedEpoch||current!==c)return fail(409,'Discarded results from an older reference session.');
     const trustedChecks=result.checks.map(({id,ok})=>({id,ok}));
     const accepted=c.complete(op.id,{suiteId:task.id,workspaceHash:op.request.workspaceHash,checks:trustedChecks});if(!accepted.accepted)throw Error('Reference verdict not accepted');
     const verdict={workspaceHash:op.request.workspaceHash,checks:trustedChecks};
     checkChanges=comparePublicChecks(lastPublicVerdict,verdict);lastPublicVerdict=structuredClone(verdict);
     checks=result.checks.map(({id,ok,message})=>({id,ok,message:message??''}));
     event('test',checks.every(x=>x.ok)?'Authored public reference checks passed. Not a benchmark result.':'Authored public reference checks found the seeded bug.');
    }catch{
     if(epoch!==startedEpoch||current!==c)return fail(409,'Discarded failed checks from an older reference session.');
     epoch++;c.cancel();checks=[];checkChanges=null;
     event('error','Authored public check runner failed. Closed this sample; reopen it to retry.');
     return fail(503,'Authored reference check runner failed. Reopen this sample to retry.');
    }
   }else if(body.action==='finish'){
    act('finish');event('finish','Completed the public-check reference workflow.');
   }
   return response(200,{state:state()});
  }catch(error){return fail(409,String(error.message??error));}
 }
 return{dispatch};
}
module.exports={createReferenceWorkflow};
