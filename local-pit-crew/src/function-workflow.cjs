'use strict';
// Source stays data here; the selected verifier executes bounded guest code.
const crypto=require('node:crypto');
const {ReferenceController,hash,workspaceHash}=require('./controller.cjs');
const {comparePublicChecks}=require('./public-check-changes.cjs');
const {parsePublicCheckOutcome}=require('./public-check-codec.cjs');
const {FUNCTION_SUITE,FUNCTION_ENTRY,CONTRACT_PATH,validateFunctionFiles}=require('../runner/function-contract.cjs');
const {createFunctionReplay}=require('./function-replay.cjs');
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
function createFunctionWorkflow({task,verifier}){
 const controller=new ReferenceController({files:task.files,writable:task.writable,taskText:task.prompt,suiteId:FUNCTION_SUITE,checkIds:task.checkIds});
 const sessionId=crypto.randomUUID(),abort=new AbortController();
 let epoch=0,proposal=null,checks=[],diagnostics=[],checkChanges=null,lastVerdict=null,events=[];
 let setupRetryUsed=false,setupRetryPending=false;
 const event=(kind,label)=>events.push({id:'event-'+(events.length+1),kind,label});
 event('start',task.challengeParent?'Started a new run with the previously checked source, every existing example and one added example. No model has been called.':'Opened your function and immutable counterexamples. No model has been called.');
 const state=()=>{
  const snapshot=controller.snapshot(),checked=snapshot.publicChecksCurrent&&!snapshot.pending&&checks.length===task.checkIds.length&&checks.every(c=>c.ok);
  const files=!snapshot.pending&&checks.length===task.checkIds.length?controller.filesForReferenceTest():null;
  const failed=files&&!snapshot.closed&&checks.some(c=>!c.ok)&&lastVerdict?.workspaceHash===workspaceHash(files);
  const replay=checked||failed?createFunctionReplay(files,{title:task.title,instructions:task.instructions}):null;
  const content=checked?files[FUNCTION_ENTRY]:null;
  return{mode:'function-contract',aiRunning:false,modelCalls:0,sessionId,
  task:{id:task.id,title:task.title,prompt:task.prompt,checkLabels:task.checkLabels,counterexamples:JSON.parse(task.files[CONTRACT_PATH]).cases},snapshot,
  checkedFunction:checked?{path:FUNCTION_ENTRY,fileName:JSON.parse(task.files[CONTRACT_PATH]).exportName+'.checked.js',sha256:hash(content),content,checkedExamples:checks.length}:null,
  checkedReplay:checked?replay:null,failedReplay:failed?replay:null,
  challengeParent:task.challengeParent?structuredClone(task.challengeParent):null,setupRetryPending,
  proposal:structuredClone(proposal),checks:structuredClone(checks),checkDiagnostics:structuredClone(diagnostics),checkChanges:structuredClone(checkChanges),events:structuredClone(events),
  verification:structuredClone(verifier.capabilityFor(FUNCTION_SUITE))};
 };
 function cancel(){epoch++;abort.abort();controller.cancel();checks=[];diagnostics=[];checkChanges=null;setupRetryPending=false;}
 const fail=(status,error)=>({status,body:{error,state:state()}});
 async function action(body){
  const keys=body?.action==='read'?['sessionId','revision','action','path']:body?.action==='propose'?['sessionId','revision','action','source']:body?.action==='propose-cloud'?['sessionId','revision','action','source','generation','explanation']:['sessionId','revision','action'];
  if(!exact(body,keys)||body.sessionId!==sessionId||!Number.isSafeInteger(body.revision))return fail(409,'Stale or malformed function session.');
  if(body.action==='cancel'){cancel();event('cancel','Closed the function session.');return{status:200,body:{state:state()}};}
  if(body.revision!==controller.snapshot().revision)return fail(409,'Function session changed. Refresh before retrying.');
  const act=(type,extra={})=>controller.decide({revision:controller.snapshot().revision,type,...extra});
  const read=path=>{const op=act('read',{path});controller.complete(op.id,{content:controller.filesForReferenceTest()[path]});};
  const mine=epoch;
  try{
   if(body.action==='read')read(body.path);
   else if(body.action==='propose'||body.action==='propose-cloud'){
    // Validate the complete next manifest before consuming controller operations.
    const before=controller.filesForReferenceTest(),next=validateFunctionFiles({...before,[FUNCTION_ENTRY]:body.source});
    const cloud=body.action==='propose-cloud',g=body.generation;
    if(cloud&&(!exact(g,['model','inferenceSource','revision','beforeSourceSha256','contractSha256','sourceSha256'])||
     g.model!=='gemini-3.5-flash-lite'||g.inferenceSource!=='in_cloud'||g.revision!==body.revision||
     g.beforeSourceSha256!==hash(before[FUNCTION_ENTRY])||g.contractSha256!==hash(before[CONTRACT_PATH])||g.sourceSha256!==hash(next[FUNCTION_ENTRY])||
     typeof body.explanation!=='string'||!body.explanation.trim()||new TextEncoder().encode(body.explanation).length>1200))return fail(409,'Cloud draft binding is stale or malformed.');
    if(next[FUNCTION_ENTRY]===before[FUNCTION_ENTRY])return fail(400,'The proposed function is unchanged.');
    if(proposal&&!proposal.applied)return fail(409,'Apply the reviewed proposal or reopen your function.');
    for(const m of controller.snapshot().manifest)if(!controller.snapshot().evidence.some(e=>e.path===m.path&&e.sha256===m.sha256))read(m.path);
    const s=controller.snapshot(),evidenceIds=s.manifest.map(m=>s.evidence.findLast(e=>e.path===m.path&&e.sha256===m.sha256).id);
    const op=act('code',{evidenceIds,objective:cloud?'Review a browser-reported cloud function replacement. This action performs no inference.':'Review a user-pasted function replacement. No inference is requested.'});
    const edits=[{path:FUNCTION_ENTRY,beforeSha256:hash(before[FUNCTION_ENTRY]),find:before[FUNCTION_ENTRY],replace:next[FUNCTION_ENTRY]}];
    controller.complete(op.id,{edits});proposal={artifactId:'a:'+op.id,kind:cloud?'browser-cloud-draft':'user-pasted',applied:false,
     source:cloud?'Browser-reported Firebase cloud draft · gemini-3.5-flash-lite.':'User-pasted patch. No inference was requested by this action.',edits,
     ...(cloud?{generation:structuredClone(g),explanation:body.explanation}:{})};
    event('proposal',cloud?'Prepared a browser-reported cloud replacement for diff review. The contract is unchanged.':'Prepared your pasted replacement for review. The counterexamples cannot be edited.');
   }else if(body.action==='apply'){
    if(!proposal||proposal.applied)return fail(409,'Review a new patch first.');
    act('apply',{artifactId:proposal.artifactId});proposal.applied=true;checks=[];diagnostics=[];checkChanges=null;
    event('apply','Applied the reviewed function in run memory.');
   }else if(body.action==='test'){
    const capability=verifier.capabilityFor(FUNCTION_SUITE);
    if(!capability.available)return fail(503,'The function verifier is unavailable.');
    const files=controller.filesForReferenceTest(),op=act('test');checks=[];diagnostics=[];checkChanges=null;
    setupRetryPending=false;
    try{
     const outcome=await verifier.runPublicChecks({id:op.id,suiteId:FUNCTION_SUITE,workspaceHash:op.request.workspaceHash,files},{signal:abort.signal});
     if(mine!==epoch)return fail(409,'Discarded checks from a closed function session.');
     const parsed=parsePublicCheckOutcome(outcome,{ticketId:op.id,suiteId:FUNCTION_SUITE,workspaceHash:op.request.workspaceHash},files);
     if(parsed.status==='unavailable'&&parsed.reason==='browser-setup-unavailable'&&capability.admissionKind==='browser-worker-quickjs'&&
      !setupRetryUsed&&controller.releaseUnstartedTest(op.id)){
      setupRetryUsed=true;setupRetryPending=true;
      event('error','The browser verifier could not start. The current source and examples are ready for one setup retry.');
      return fail(503,'The browser verifier could not start. Retry verification to keep this run and its current source.');
     }
     if(parsed.status!=='candidate-verdict')throw Error('verification-unavailable');
     if(!controller.complete(op.id,{suiteId:FUNCTION_SUITE,workspaceHash:parsed.workspaceHash,checks:parsed.checks}).accepted)throw Error('verdict-rejected');
     const verdict={workspaceHash:parsed.workspaceHash,checks:parsed.checks};
     checkChanges=comparePublicChecks(lastVerdict,verdict);lastVerdict=structuredClone(verdict);checks=parsed.checks;diagnostics=parsed.diagnostics;
     event('test',checks.every(c=>c.ok)?'Your JSON examples passed, including input preservation. This is not proof for untested inputs.':'Your JSON examples found a mismatch or changed input.');
    }catch{
     if(mine!==epoch)return fail(409,'Discarded checks from a closed function session.');
     cancel();event('error','Verification was unavailable. No candidate verdict was accepted.');
     return fail(503,'Function verification unavailable; reopen to retry.');
    }
   }else if(body.action==='finish'){act('finish');event('finish','Finished with current passing counterexamples. Untested behavior remains unknown.');}
   else return fail(400,'Unknown function action.');
   return{status:200,body:{state:state()}};
  }catch{return fail(409,'Function operation rejected. Check the current revision, scope and remaining budget.');}
 }
 return{state,action,cancel,task};
}
module.exports={createFunctionWorkflow};
