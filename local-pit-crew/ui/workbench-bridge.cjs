'use strict';
// Composed source host. No server/model/source execution occurs at import/construction.
const crypto=require('node:crypto');
const {createReferenceApp}=require('./bridge.cjs');
const {CodingSession}=require('../src/coding-session.cjs');
const {BrowserPlannerHandoff}=require('../src/browser-planner-handoff.cjs');
const {validateProfile}=require('../src/coder-response.cjs');
const {createVerifierAdmission,parsePublicCheckOutcome}=require('../src/public-verifier-contract.cjs');
const {getTasks}=require('../test/fixtures.cjs');
const {FUNCTION_SUITE,createFunctionTask}=require('../runner/function-contract.cjs');
const {prepareFunctionReplay,createFunctionChallenge}=require('../src/function-replay.cjs');
const {createFunctionWorkflow}=require('../src/function-workflow.cjs');
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const clone=x=>structuredClone(x);
async function createWorkbenchApp({origin,live=null,functionVerifier=null,firebaseConfig=null,browserBundleAvailable=false}={}){
 const coderOnlyPreview=live?.coderOnlyPreview===true;
 try{firebaseConfig=clone(firebaseConfig??live?.firebaseConfig);}catch{firebaseConfig=null;}
 // Default-closed: only the trusted issuer's own identity can admit a runner.
 const verifierAdmission=createVerifierAdmission(functionVerifier??live?.publicVerifier);
 try{if(live)live={profile:clone(live.profile),firebaseConfig:clone(live.firebaseConfig),contentSecurityPolicy:live.contentSecurityPolicy,
  providerTimeoutMs:live.providerTimeoutMs===undefined?15000:live.providerTimeoutMs,
  coder:live.coder?{locality:live.coder.locality,generate:typeof live.coder.generate==='function'?live.coder.generate.bind(live.coder):null}:null};}catch{live=null;}
 const reference=await createReferenceApp({origin}),now=()=>typeof origin==='function'?origin():origin;
 const tasks=getTasks(),byId=new Map(tasks.map(t=>[t.id,t]));
 function plannerCapability(){
  const cfg=firebaseConfig;
  const configReady=exact(cfg,['firebase','appCheckSiteKey','appName'])&&exact(cfg.firebase,['apiKey','projectId','appId'])&&
   Object.values(cfg.firebase).every(v=>typeof v==='string'&&v.length>0&&v.length<=300)&&
   typeof cfg.appCheckSiteKey==='string'&&cfg.appCheckSiteKey.length>0&&cfg.appCheckSiteKey.length<=300&&
   typeof cfg.appName==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(cfg.appName);
  return{available:browserBundleAvailable&&configReady,bundleReady:browserBundleAvailable,configReady:!!configReady,
   firebaseConfig:browserBundleAvailable&&configReady?clone(cfg):null};
 }
 let referenceToken=null,current=null,functionOwner=null,epoch=0,referenceSessionId=null,pendingStart=null;
 // A one-use offer binds Start before it is sent. Close can revoke an offer
 // even if Start is still in transit or its successful response is lost.
 let startAdmissionId=crypto.randomUUID();
 const rotateAdmission=()=>{startAdmissionId=crypto.randomUUID();};
 function capabilities(suiteId=current?.task?.id){
  const missing=[];
  if(!coderOnlyPreview&&!browserBundleAvailable)missing.push('compiled browser entry');
  if(!live||live.coder?.locality!=='local-only'||typeof live.coder?.generate!=='function')missing.push('approved local coder adapter');
  let profile=null;try{profile=validateProfile(live?.profile);if(profile.kind!=='runtime-reported')throw Error('not runtime');}catch{missing.push('pinned runtime profile');}
  const cfg=live?.firebaseConfig;
  if(!coderOnlyPreview&&(!exact(cfg,['firebase','appCheckSiteKey','appName'])||!exact(cfg.firebase,['apiKey','projectId','appId'])||
   !Object.values(cfg.firebase).every(v=>typeof v==='string'&&v.length>0)||typeof cfg.appCheckSiteKey!=='string'||!cfg.appCheckSiteKey||
   typeof cfg.appName!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(cfg.appName)))missing.push('explicit public Firebase/App Check configuration');
  if(!coderOnlyPreview&&(typeof live?.contentSecurityPolicy!=='string'||!live.contentSecurityPolicy||/[\r\n]/.test(live.contentSecurityPolicy)))missing.push('approved browser content policy');
  const providerTimeoutMs=live?.providerTimeoutMs;
  if(!Number.isSafeInteger(providerTimeoutMs)||providerTimeoutMs<1||providerTimeoutMs>120000)missing.push('bounded total provider deadline');
  const verification=verifierAdmission.capabilityFor(suiteId);
  const canVerify=verification.available===true;
  return{available:missing.length===0,missing,canVerify,verification:clone(verification),plannerRequired:!coderOnlyPreview,
   firebaseConfig:missing.length===0&&!coderOnlyPreview?clone(cfg):null,providerTimeoutMs:Number.isSafeInteger(providerTimeoutMs)?providerTimeoutMs:null,runtimeVerified:false};
 }
 const state=()=>{
  if(functionOwner)return functionOwner.flow.state();
  if(!current)return null;
  const raw=current.session.state,proposal=raw.proposal;
  return{mode:'configured-local-unverified',runtimeVerified:false,sessionId:current.id,task:current.task,
   providerProfile:clone(raw.profile),
   snapshot:raw.snapshot,proposal:proposal?{...proposal,source:'Provider-reported patch. Not verified model or benchmark evidence.'}:null,
   checks:raw.publicChecks,checkDiagnostics:raw.checkDiagnostics,checkChanges:raw.checkChanges,events:raw.events,providerInvocations:raw.providerInvocations,canVerify:capabilities(current.task.id).canVerify,
   verification:clone(verifierAdmission.capabilityFor(current.task.id))};
 };
 function closeCurrent(){if(current){current.abort.abort();current.session.cancel();current.handoff.stop();}}
 async function dispatch(request={}){
  const {method,pathname,body}=request;
  const h=Object.create(null);for(const [k,v]of Object.entries(request.headers??{}))h[k.toLowerCase()]=v;
  if(pathname?.startsWith('/api/planner/')){
   return current?current.handoff.dispatch(request):{status:409,body:{error:'No configured local session.'}};
  }
  if(method==='GET'&&pathname==='/api/bootstrap'){
   const r=await reference.dispatch(request);
   if(r.status===200){
    referenceToken=r.body.sessionToken;referenceSessionId=r.body.state.sessionId;
    r.body.capabilities={live:capabilities(),planner:plannerCapability(),functionContract:clone(verifierAdmission.capabilityFor(FUNCTION_SUITE))};
    if(byId.has(FUNCTION_SUITE)){const own=byId.get(FUNCTION_SUITE);r.body.tasks.push({id:FUNCTION_SUITE,title:own.title,prompt:own.prompt});}
    r.body.activeConfiguredSession=!!functionOwner&&!functionOwner.flow.state().snapshot.closed||!!current&&!current.session.state.snapshot.closed;
    if(r.body.activeConfiguredSession)r.body.state=state();
   }
   return r;
  }
  if(!pathname?.startsWith('/api/workbench/')&&!pathname?.startsWith('/api/function/')){
   if(method==='POST'&&pathname==='/api/start'){
    const r=await reference.dispatch(request);
    if(r.status===200){epoch++;rotateAdmission();closeCurrent();current=null;functionOwner?.flow.cancel();functionOwner=null;referenceSessionId=r.body.state.sessionId;}
    return r;
   }
   if(method==='POST'&&pathname==='/api/action'&&body?.action==='cancel'){
    const r=await reference.dispatch(request);
    if(r.status===200){
     rotateAdmission();
     if(pendingStart?.parentReferenceId===body.sessionId)pendingStart.cancelled=true;
    }
    return r;
   }
   return reference.dispatch(request);
  }
  const fail=(status,error)=>({status,body:{error,state:state()}});
  let expected;try{expected=new URL(now());}catch{return{status:503,body:{error:'Local origin unavailable.'}};}
  if(expected.protocol!=='http:'||expected.hostname!=='127.0.0.1'||h.host!==expected.host||h.origin!==expected.origin||
   !referenceToken||h['x-pitcrew-token']!==referenceToken)return{status:403,body:{error:'Workbench request authorization failed.'}};
  if(method!=='POST'||typeof h['content-type']!=='string'||!/^application\/json(?:;|$)/i.test(h['content-type']))return fail(415,'JSON POST required.');
  if(pathname==='/api/function/replay'){
   if(!exact(body,['packet']))return fail(400,'Provide one saved replay case.');
   try{return{status:200,body:{replay:prepareFunctionReplay(JSON.stringify(body.packet))}};}catch{return fail(400,'Replay case invalid. Check its format, size and file hashes.');}
  }
  if(pathname==='/api/function/open'||pathname==='/api/function/extend'){
   const extending=pathname==='/api/function/extend';
   if(!exact(body,extending?['sessionId','revision','example','startAdmissionId']:['spec','startAdmissionId']))return fail(400,'A function start and current admission are required.');
   if(body.startAdmissionId!==startAdmissionId)return fail(409,'Start admission expired or was canceled.');
   const parent=extending?functionOwner?.flow.state():null;
   if(extending&&(!parent||body.sessionId!==parent.sessionId||body.revision!==parent.snapshot.revision))return fail(409,'The checked parent changed. Review the current run.');
   if(!verifierAdmission.capabilityFor(FUNCTION_SUITE).available)return fail(503,'Start a qualified local companion to run your function.');
   let task;try{task=extending?createFunctionChallenge(parent,body.example):createFunctionTask(body.spec);}catch{return fail(400,extending?'Use a current passing function and one bounded new example, with at most eight examples total.':'Invalid function contract. Use one named synchronous export and 1-8 bounded JSON examples.');}
   rotateAdmission();epoch++;closeCurrent();current=null;functionOwner?.flow.cancel();
   functionOwner={admissionId:body.startAdmissionId,flow:createFunctionWorkflow({task,verifier:verifierAdmission})};
   byId.set(task.id,task);
   return{status:200,body:{state:state(),openedFunctionSessionId:functionOwner.flow.state().sessionId}};
  }
  if(pathname==='/api/function/action'){
   if(!functionOwner)return fail(409,'Open your function first.');
   const owner=functionOwner,result=await owner.flow.action(body);
   if(owner!==functionOwner)return fail(409,'Discarded an older function operation.');
   if(body?.action==='cancel'&&result.status===200)rotateAdmission();
   return result;
  }
  if(pathname==='/api/workbench/cancel-start'){
   if(!exact(body,['startAdmissionId'])||typeof body.startAdmissionId!=='string')return fail(400,'A start admission is required.');
   const id=body.startAdmissionId;
   const parentMatches=id===startAdmissionId||pendingStart?.admissionId===id;
   // A canceled or unknown old offer never closes a replacement session.
   if(id===startAdmissionId)rotateAdmission();
   if(pendingStart?.admissionId===id){pendingStart.cancelled=true;epoch++;}
   if(current?.admissionId===id){epoch++;closeCurrent();}
   if(functionOwner?.admissionId===id){epoch++;functionOwner.flow.cancel();}
   if(parentMatches&&referenceSessionId){
    const observed=await reference.dispatch({...request,method:'GET',pathname:'/api/state',body:undefined});
    const parent=observed.body?.state;
    if(parent?.sessionId===referenceSessionId&&parent.snapshot&&!parent.snapshot.closed){
     const closed=await reference.dispatch({...request,pathname:'/api/action',body:{sessionId:parent.sessionId,revision:parent.snapshot.revision,action:'cancel'}});
     return{status:200,body:{state:current?state():closed.body.state,startCanceled:true}};
    }
   }
   return{status:200,body:{state:state(),startCanceled:true}};
  }
  if(pathname==='/api/workbench/start'){
   const cap=capabilities();
   if(!cap.available)return fail(503,'Configured local mode unavailable: '+cap.missing.join(', ')+'.');
   if(!exact(body,['taskId','startAdmissionId'])||!byId.has(body.taskId))return fail(400,'Choose a known sample and its start admission.');
   if(body.startAdmissionId!==startAdmissionId)return fail(409,'Start admission expired or was canceled. Refresh before starting again.');
   rotateAdmission();
   const t=byId.get(body.taskId),id=crypto.randomUUID(),token=crypto.randomBytes(24).toString('base64url');
   const intent={epoch:++epoch,admissionId:body.startAdmissionId,parentReferenceId:current?.session.state.snapshot.closed===false?null:referenceSessionId,cancelled:false};
   pendingStart=intent;closeCurrent();functionOwner?.flow.cancel();functionOwner=null;let handoff=null;
   try{
    const checkIds=t.checkIds??(await require('../test/fixtures.cjs').runAuthoredChecks(t.id,'corrected')).checks.map(c=>c.id);
    if(intent.epoch!==epoch||pendingStart!==intent||intent.cancelled)return fail(409,'Discarded an older admitted start.');
    handoff=new BrowserPlannerHandoff({sessionId:id,authToken:token,companionOrigin:expected.origin,uiOrigin:expected.origin,ttlMs:cap.providerTimeoutMs});
    // Only this trusted backend object can register adapters/verifier. No HTTP body can inject them.
    const session=new CodingSession({task:{id:t.id,prompt:t.prompt,files:t.files,writable:t.writable,checkIds},
     profile:live.profile,coder:live.coder,planner:coderOnlyPreview?null:handoff,mode:coderOnlyPreview?'deterministic':'nano-controller',providerTimeoutMs:cap.providerTimeoutMs});
    current={id,admissionId:intent.admissionId,session,handoff,abort:new AbortController(),task:{id:t.id,title:t.id===FUNCTION_SUITE?t.title:'Local model on authored sample',prompt:t.prompt,...(t.checkLabels?{checkLabels:t.checkLabels}:{}),...(t.id===FUNCTION_SUITE?{counterexamples:JSON.parse(t.files['contract.json']).cases}:{})}};
    return{status:200,body:{state:state(),plannerPair:{sessionId:id,authToken:token}}};
   }catch{
    handoff?.stop();
    if(intent.epoch!==epoch||pendingStart!==intent||intent.cancelled)return fail(409,'Discarded an older admitted start.');
    return fail(503,'Configured local session could not start. No runtime success is claimed.');
   }finally{if(pendingStart===intent)pendingStart=null;}
  }
  if(pathname!=='/api/workbench/action'||!current)return fail(409,'Open a configured local session first.');
  const action=body?.action,keys=action==='read'?['sessionId','revision','action','path']:['sessionId','revision','action'];
  if(!['read','generate','apply','test','finish','cancel'].includes(action)||!exact(body,keys)||body.sessionId!==current.id||
   !Number.isSafeInteger(body.revision))return fail(409,'Stale or malformed configured session.');
  if(action!=='cancel'&&body.revision!==current.session.state.snapshot.revision)return fail(409,'Configured session changed.');
  const owner=current,mine=epoch;
  if(action==='cancel'){epoch++;rotateAdmission();closeCurrent();return{status:200,body:{state:state()}};}
  try{
   let result;
   if(action==='read')result=owner.session.readFile(body.path);
   else if(action==='generate')result=await owner.session.generatePatch();
   else if(action==='apply')result=owner.session.applyPatch(owner.session.state.proposal?.artifactId);
   else if(action==='finish')result=owner.session.finish();
   else{
    if(!capabilities(owner.task.id).canVerify)return fail(409,'No qualified isolated backend is admitted for this sample. Returned code was not executed or verified.');
    const request=owner.session.requestPublicChecks();
    if(request.status!=='verification-required')return fail(409,request.reason??'Public check request blocked.');
    // The trusted issuer owns execution. Test composition supplies authored facts only.
    const outcome=await verifierAdmission.runPublicChecks(clone(request.ticket),{signal:owner.abort.signal});
    if(mine!==epoch||current!==owner)return fail(409,'Discarded results from an older configured session.');
    const parsed=parsePublicCheckOutcome(outcome,{ticketId:request.ticket.id,suiteId:request.ticket.suiteId,workspaceHash:request.ticket.workspaceHash},request.ticket.files);
    if(parsed.status==='unavailable'){
     epoch++;closeCurrent();return fail(503,'Public verification unavailable: '+parsed.reason+'. No candidate verdict was accepted.');
    }
    result=owner.session.acceptPublicVerdict(request.ticket.id,{suiteId:parsed.suiteId,workspaceHash:parsed.workspaceHash,checks:parsed.checks},parsed.diagnostics);
   }
   if(mine!==epoch||current!==owner)return fail(409,'Discarded results from an older configured session.');
   if(result.status==='blocked')return fail(409,result.reason);
   return{status:200,body:{state:state(),result}};
  }catch{
   if(mine!==epoch||current!==owner)return fail(409,'Discarded work from an older configured session.');
   epoch++;closeCurrent();return fail(503,'Configured operation failed; session closed. No result is claimed.');
  }
 }
 return{async dispatch(request){
  const result=await dispatch(request);
  // Planner messages have their own exact wire schema. Adding UI start-offer
  // metadata to {job:null} makes an idle pump reject and stop its Nano client.
  if(result.status!==403&&result.body&&!request.pathname?.startsWith('/api/planner/'))result.body.startAdmissionId=startAdmissionId;
  return result;
 }};
}
module.exports={createWorkbenchApp};
