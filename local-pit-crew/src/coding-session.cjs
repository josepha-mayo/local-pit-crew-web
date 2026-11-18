'use strict';
// Provider-neutral in-memory orchestration. No HTTP, shell, eval, file writes or source runner.
const {ReferenceController}=require('./controller.cjs');
const {comparePublicChecks}=require('./public-check-changes.cjs');
const {parseDecision}=require('./firebase-local-client.cjs');
const {PATCH_SCHEMA,validateProfile,validateCoderReceipt,parseCoderResponse}=require('./coder-response.cjs');
const clone=x=>structuredClone(x);
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
function waitForProvider(promise,signal,timeoutMs){
 let timer,abort;
 const boundary=new Promise((_,reject)=>{
  timer=setTimeout(()=>reject(Error('provider-timeout')),timeoutMs);
  abort=()=>reject(Error('provider-cancelled'));
  if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
 });
 return Promise.race([Promise.resolve(promise),boundary]).finally(()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);});
}
class CodingSession{
 #controller;#task;#profile;#coder;#planner;#mode;#timeout;#plannerCap;
 #abort=new AbortController();#epoch=0;#busy=null;#ticket=null;#proposal=null;#checks=[];#events=[];#seq=0;#failure=null;
 #appliedPatchRevision=null;#checksAppliedPatchRevision=null;#publicFeedback=null;
 #lastPublicVerdict=null;#checkChanges=null;#diagnostics=[];
 #invocations={coder:0,planner:0};
 constructor({task,profile,coder,planner,mode='deterministic',providerTimeoutMs=15000,maxPlannerCalls=2,limits={}}={}){
  if(!exact(task,['id','prompt','files','writable','checkIds']))throw Error('invalid-session-task');
  if(!['deterministic','nano-controller'].includes(mode)||!coder||coder.locality!=='local-only'||typeof coder.generate!=='function')throw Error('invalid-session-provider');
  if((mode==='nano-controller'&&!planner)||(planner&&(typeof planner.decide!=='function'||typeof planner.stop!=='function')))throw Error('missing-local-planner');
  if(!Number.isSafeInteger(providerTimeoutMs)||providerTimeoutMs<1||providerTimeoutMs>120000||
   !Number.isSafeInteger(maxPlannerCalls)||maxPlannerCalls<0||maxPlannerCalls>20)throw Error('invalid-session-budget');
  this.#profile=validateProfile(profile);this.#task=clone(task);
  this.#controller=new ReferenceController({files:task.files,writable:task.writable,taskText:task.prompt,suiteId:task.id,checkIds:task.checkIds,limits});
  this.#coder={generate:coder.generate.bind(coder)};
  this.#planner=planner?{decide:planner.decide.bind(planner),stop:planner.stop.bind(planner)}:null;
  this.#mode=mode;this.#timeout=providerTimeoutMs;this.#plannerCap=maxPlannerCalls;
  this.#event('start','In-memory adapter session opened. Runtime locality and model quality are not verified.');
 }
 #event(kind,label){this.#events.push({id:'session-event-'+(++this.#seq),kind,label});}
 get state(){return{
  mode:'in-memory-adapter-contract',controllerMode:this.#mode,callsSourceRunner:false,runtimeVerified:false,
  profile:clone(this.#profile),providerInvocations:clone(this.#invocations),snapshot:this.#controller.snapshot(),
  proposal:clone(this.#proposal),publicChecks:clone(this.#checks),checkDiagnostics:clone(this.#diagnostics),checkChanges:clone(this.#checkChanges),events:clone(this.#events),failure:this.#failure
 };}
 #block(reason){return{status:'blocked',reason};}
 #ready(){
  const s=this.#controller.snapshot();
  if(s.closed)return'closed';
  if(this.#busy||s.pending)return'operation-pending';
  return null;
 }
 #releaseProviders(){
  this.#epoch++;this.#abort.abort();this.#ticket=null;
  try{this.#planner?.stop();}catch{/* A trusted adapter failure must not reopen the session. */}
 }
 #close(reason){
  this.#releaseProviders();this.#controller.cancel();this.#diagnostics=[];
  this.#failure=reason;this.#event('closed',reason);
 }
 cancel(){if(!this.#controller.snapshot().closed)this.#close('closed-by-user');return{status:'closed'};}
 #readCurrentEvidence(){
  for(const file of this.#controller.snapshot().manifest){
   if(this.#controller.snapshot().evidence.some(e=>e.path===file.path&&e.sha256===file.sha256))continue;
   const op=this.#controller.decide({revision:this.#controller.snapshot().revision,type:'read',path:file.path});
   const accepted=this.#controller.complete(op.id,{content:this.#controller.filesForReferenceTest()[file.path]});
   if(!accepted.accepted)throw Error('source-read-rejected');
  }
  const s=this.#controller.snapshot();
  // Re-reading keeps historical evidence in the controller. The coder receives
  // exactly one current version of each task file, in manifest order.
  return s.manifest.map(m=>s.evidence.findLast(e=>e.path===m.path&&e.sha256===m.sha256));
 }
 readFile(path){
  const blocked=this.#ready();if(blocked)return this.#block(blocked);
  try{
   const op=this.#controller.decide({revision:this.#controller.snapshot().revision,type:'read',path});
   const accepted=this.#controller.complete(op.id,{content:this.#controller.filesForReferenceTest()[path]});
   if(!accepted.accepted)throw Error('read-not-accepted');
   this.#event('read','Read current in-memory source evidence.');
   return{status:'read'};
  }catch{return this.#block('source-read-rejected');}
 }
 async generatePatch(){
  const blocked=this.#ready();if(blocked)return this.#block(blocked);
  if(this.#proposal&&!this.#proposal.applied)return this.#block('proposal-awaits-explicit-apply');
  if(this.#controller.snapshot().publicChecksCurrent)return this.#block('public-checks-already-current');
  const token=Symbol('generation'),epoch=this.#epoch;this.#busy=token;
  let failure='source-evidence-failed';
  try{
   const evidence=this.#readCurrentEvidence(),evidenceIds=evidence.map(e=>e.id);
   let objective='Address the immutable original task using the current source evidence. Return only the bounded edit JSON.';
   const repairBranch=this.#appliedPatchRevision!==null&&this.#checksAppliedPatchRevision===this.#appliedPatchRevision&&
    this.#checks.length>0&&this.#checks.some(c=>!c.ok);
   if(this.#mode==='nano-controller'&&repairBranch){
    if(this.#invocations.planner>=this.#plannerCap)return this.#block('planner-budget');
    failure='local-planner-failed';this.#invocations.planner++;
    const snapshot={...this.#controller.snapshot(),evidence:clone(evidence),events:clone(this.#events),publicChecks:clone(this.#checks),
     semanticBranch:'repair-after-public-check-failure',allowedActions:['code','ask_user']};
    const planned=await waitForProvider(this.#planner.decide(clone(snapshot)),this.#abort.signal,this.#timeout);
    if(epoch!==this.#epoch)return{status:'discarded'};
    if(planned?.status!=='decision'||planned.inferenceSource!=='on_device')throw Error('unaccepted-local-planner');
    const decision=parseDecision(JSON.stringify(planned.decision),snapshot.revision);
    const known=new Set([...evidence,...this.#events].map(x=>x.id));
    if(decision.reasonEvidenceIds.some(id=>!known.has(id)))throw Error('invented-planner-reason');
    if(decision.action==='ask_user')return{status:'needs-manual-review'};
    if(decision.action!=='code'||decision.evidenceIds.some(id=>!evidence.some(e=>e.id===id)))throw Error('unaccepted-planner-action');
    // Citations ground the advice; they do not remove dependencies from the
    // next coder request or change the controller's writable-file scope.
    objective=decision.objective;
    this.#event('planner','Received an on-device-labeled repair hint. This label is not network or Nano identity attestation.');
   }
   failure='coder-failed';
   const op=this.#controller.decide({revision:this.#controller.snapshot().revision,type:'code',evidenceIds,objective});
   const packet={requestId:op.id,profileHash:this.#profile.profileHash,originalTask:op.request.originalTask,
    nextStepHint:op.request.nextStepHint,evidence:op.request.evidence,writable:op.request.writable,
    workspaceHash:op.request.workspaceHash,publicFeedback:this.#publicFeedback?.workspaceHash===op.request.workspaceHash?clone(this.#publicFeedback):null,
    responseSchema:clone(PATCH_SCHEMA)};
   this.#invocations.coder++;
   const result=await waitForProvider(this.#coder.generate(clone(packet),{signal:this.#abort.signal}),this.#abort.signal,this.#timeout);
   if(epoch!==this.#epoch)return{status:'discarded'};
   failure='coder-response-rejected';
   if(!exact(result,['raw','receipt']))throw Error('invalid-coder-result');
   const receipt=validateCoderReceipt(result.receipt,{profile:this.#profile,requestId:op.id,workspaceHash:op.request.workspaceHash});
   const artifact=parseCoderResponse(result.raw,{evidence:op.request.evidence,writable:op.request.writable});
   const accepted=this.#controller.complete(op.id,artifact);
   if(!accepted.accepted)throw Error('artifact-not-accepted');
   this.#proposal={artifactId:'a:'+op.id,edits:artifact.edits,receipt,applied:false};
   this.#event('proposal',receipt.kind==='authored-delegate'?'Authored delegate returned a string patch. No model result.':'Provider-reported patch received; locality and correctness remain unverified.');
   return{status:'proposal',proposal:clone(this.#proposal)};
  }catch{
   if(epoch!==this.#epoch)return{status:'discarded'};
   this.#close(failure);return this.#block(failure);
  }finally{if(this.#busy===token)this.#busy=null;}
 }
 applyPatch(artifactId){
  const blocked=this.#ready();if(blocked)return this.#block(blocked);
  if(!this.#proposal||this.#proposal.applied||artifactId!==this.#proposal.artifactId)return this.#block('unknown-or-applied-proposal');
  try{
   const result=this.#controller.decide({revision:this.#controller.snapshot().revision,type:'apply',artifactId});
   this.#proposal.applied=true;this.#checks=[];this.#diagnostics=[];this.#publicFeedback=null;this.#checkChanges=null;
   this.#appliedPatchRevision=this.#controller.snapshot().revision;this.#checksAppliedPatchRevision=null;
   this.#event('apply','Applied patch strings in memory only. No source was executed.');
   return{status:'applied-in-memory',workspaceHash:result.workspaceHash};
  }catch{return this.#block('apply-rejected');}
 }
 // Trusted backend API only, never an LLM action or public HTTP completion endpoint.
 requestPublicChecks(){
  const blocked=this.#ready();if(blocked)return this.#block(blocked);
  try{
   const op=this.#controller.decide({revision:this.#controller.snapshot().revision,type:'test'});
   this.#checkChanges=null;this.#diagnostics=[];
   this.#ticket={id:op.id,epoch:this.#epoch,suiteId:op.request.suiteId,workspaceHash:op.request.workspaceHash,appliedPatchRevision:this.#appliedPatchRevision};
   return{status:'verification-required',ticket:{id:op.id,...clone(op.request),files:this.#controller.filesForReferenceTest()}};
  }catch{return this.#block('public-check-request-rejected');}
 }
 // This method accepts a trusted backend's PUBLIC verdict; it does not attest the backend or perform hidden grading.
 acceptPublicVerdict(ticketId,verdict,diagnostics=[]){
  const ticket=this.#ticket;
  if(!ticket||ticket.id!==ticketId||ticket.epoch!==this.#epoch||this.#controller.snapshot().closed)return{status:'discarded'};
  try{
   const accepted=this.#controller.complete(ticketId,verdict);if(!accepted.accepted)throw Error('verdict-not-accepted');
   this.#ticket=null;this.#checks=clone(verdict.checks);this.#diagnostics=clone(diagnostics);this.#checksAppliedPatchRevision=ticket.appliedPatchRevision;
   this.#publicFeedback={suiteId:ticket.suiteId,workspaceHash:ticket.workspaceHash,checks:clone(this.#checks)};
   this.#checkChanges=comparePublicChecks(this.#lastPublicVerdict,this.#publicFeedback);
   this.#lastPublicVerdict={workspaceHash:ticket.workspaceHash,checks:clone(this.#checks)};
   for(const check of this.#checks)this.#event('public-check','Public check '+check.id+' '+(check.ok?'passed.':'failed.'));
   return{status:'public-verdict-accepted',allPassed:this.#checks.every(c=>c.ok),heldOutCorrectness:false};
  }catch{this.#close('public-verdict-rejected');return this.#block('public-verdict-rejected');}
 }
 finish(){
  const blocked=this.#ready();if(blocked)return this.#block(blocked);
  try{
   this.#controller.decide({revision:this.#controller.snapshot().revision,type:'finish'});
   this.#releaseProviders();
   this.#event('finish','Public-check workflow complete. Not held-out correctness or model-fit evidence.');
   return{status:'public-check-workflow-complete',heldOutCorrectness:false};
  }catch{return this.#block('current-public-checks-required');}
 }
}
module.exports={CodingSession};
