'use strict';
// Real Docker issuer + real controller. The coder is an explicitly authored
// delegate; these tests do not claim model inference or model-quality evidence.
const test=require('node:test'),assert=require('node:assert/strict');
const {prepareDockerVerifier}=require('./admission.cjs');
const {createVerifierAdmission,parsePublicCheckOutcome}=require('../../src/public-verifier-contract.cjs');
const {workspaceHash}=require('../../src/controller.cjs');
const {createWorkbenchApp}=require('../../ui/workbench-bridge.cjs');
const {getTasks}=require('../../test/fixtures.cjs');
const {TASK_SCHEMA,FUNCTION_SUITE}=require('../function-contract.cjs');
const task=getTasks().find(t=>t.id==='pagination-zero');
const ticket=files=>({id:'real-docker-ticket',suiteId:task.id,workspaceHash:workspaceHash(files),files});
test('trusted build and live qualification issue only an owned, revocable app admission',{timeout:660000},async t=>{
 const registration=await prepareDockerVerifier({socket:process.env.PITCREW_DOCKER_SOCKET});
 try{
  const admission=createVerifierAdmission(registration);
  assert.equal(admission.capabilityFor(task.id).available,true);assert.equal(admission.capabilityFor(task.id).qualified,true);
  assert.equal(admission.capabilityFor(task.id).benchmarkEligible,false);assert.equal(admission.capabilityFor('config-isolation').available,true);
  assert.equal(admission.capabilityFor('latest-request-wins').available,false);
  await t.test('user function intake, immutable contract, stale admission and actual verification through Finish',async()=>{
   const origin='http://127.0.0.1:49195',app=await createWorkbenchApp({origin,functionVerifier:registration});
   let state,token,offer;
   async function request(method,pathname,body,headers={}){
    const result=await app.dispatch({method,pathname,body,headers:{host:'127.0.0.1:49195',origin,'content-type':'application/json','x-pitcrew-token':token,...headers}});
    if(result.body?.state)state=result.body.state;if(result.body?.startAdmissionId)offer=result.body.startAdmissionId;return result;
   }
   const boot=await request('GET','/api/bootstrap');token=boot.body.sessionToken;
   assert.equal(boot.body.capabilities.functionContract.qualified,true);assert.equal(boot.body.capabilities.live.available,false);
   const spec={schema:TASK_SCHEMA,title:'Own sort function',instructions:'Sort a copy; leave input alone.',exportName:'sortCopy',source:'module.exports={sortCopy:xs=>xs.sort()};',cases:[{label:'unsorted',args:[['b','a']],expected:['a','b']}]};
   const oldOffer=offer;
   assert.equal((await request('POST','/api/function/open',{spec,startAdmissionId:offer},{origin:'https://untrusted.invalid'})).status,403);
   assert.equal((await request('POST','/api/function/open',{spec,startAdmissionId:offer})).status,200);
   assert.equal(state.mode,'function-contract');const originalId=state.sessionId;
   assert.equal((await request('POST','/api/function/open',{spec,startAdmissionId:oldOffer})).status,409);
   const act=(action,extra={})=>request('POST','/api/function/action',{sessionId:state.sessionId,revision:state.snapshot.revision,action,...extra});
   assert.equal((await act('test')).status,200);assert.equal(state.checks[0].ok,false);
   assert.equal((await act('propose',{source:'module.exports={sortCopy:xs=>[...xs].sort()};'})).status,200);
   assert.equal((await act('apply')).status,200);assert.equal((await act('test')).status,200);assert.equal(state.checks[0].ok,true);
   assert.equal((await act('finish')).status,200);assert.equal(state.snapshot.closed,true);
   assert.equal((await request('POST','/api/function/open',{spec,startAdmissionId:offer})).status,200);
   const replacement=state.sessionId;assert.notEqual(replacement,originalId);
   await request('POST','/api/workbench/cancel-start',{startAdmissionId:oldOffer});assert.equal(state.sessionId,replacement);assert.equal(state.snapshot.closed,false);
   const recovered=await request('GET','/api/bootstrap');assert.equal(recovered.body.activeConfiguredSession,true);assert.equal(recovered.body.state.sessionId,replacement);
  });
  t.diagnostic(JSON.stringify({image:registration.evidence.image,policy:registration.evidence.policy,qualifiedSuites:registration.evidence.qualifiedSuites}));
  await t.test('copies, inherited records, proxies and hashes cannot reproduce issuer identity',()=>{
   for(const copy of [{...registration},structuredClone(registration.evidence),Object.create(registration),new Proxy(registration,{})])
    assert.equal(createVerifierAdmission(copy).capabilityFor(task.id).available,false);
   assert.throws(()=>{registration.evidence.sourceHashes['worker.cjs']='f'.repeat(64);});
   assert.throws(()=>{registration.evidence.qualifiedSuites.push('caller-suite');});
  });
  await t.test('baseline and correction use actual typed interpreter results with exact ticket binding',async()=>{
   const baselineTicket=ticket(task.files),baseline=await admission.runPublicChecks(baselineTicket);
   const parsed=parsePublicCheckOutcome(baseline,{ticketId:baselineTicket.id,suiteId:task.id,workspaceHash:baselineTicket.workspaceHash});
   assert.equal(parsed.status,'candidate-verdict');assert.equal(parsed.checks.filter(c=>c.ok).length,4);
   const files={...task.files,...task.correction},fixed=await admission.runPublicChecks(ticket(files));
   assert.equal(fixed.status,'candidate-verdict');assert.ok(fixed.checks.every(c=>c.ok));
   assert.equal((await admission.runPublicChecks({...ticket(files),workspaceHash:'0'.repeat(64)})).reason,'protocol-invalid');
  });
  await t.test('settings isolation admission binds its own check IDs and current file hash',async()=>{
   const config=getTasks().find(t=>t.id==='config-isolation');
   const configTicket=files=>({id:'real-config-ticket',suiteId:config.id,workspaceHash:workspaceHash(files),files});
   for(const files of [config.files,{...config.files,...config.correction}]){
    const requested=configTicket(files),result=await admission.runPublicChecks(requested);
    const parsed=parsePublicCheckOutcome(result,{ticketId:requested.id,suiteId:config.id,workspaceHash:requested.workspaceHash});
    assert.equal(parsed.checks.filter(c=>c.ok).length,files===config.files?2:5);
    assert.throws(()=>parsePublicCheckOutcome(result,{ticketId:requested.id,suiteId:task.id,workspaceHash:requested.workspaceHash}));
   }
  });
  for(const [suiteId,baselinePasses]of [['pagination-zero',4],['config-isolation',2]])await t.test('composed '+suiteId+' workflow verifies an explicitly authored delegate patch through Finish',async()=>{
   const selected=getTasks().find(t=>t.id===suiteId),entry=selected.writable[0];
   const profile={kind:'runtime-reported',profileHash:'a'.repeat(64),modelId:'AUTHORED-TEST-ONLY',modelDigest:'b'.repeat(64),engineBuild:'AUTHORED-NOT-MODEL-INFERENCE'};
   const coder={locality:'local-only',async generate(packet){
    const evidence=packet.evidence.find(e=>e.path===entry);
    assert.equal(packet.publicFeedback.suiteId,suiteId);assert.equal(packet.publicFeedback.workspaceHash,packet.workspaceHash);
    return{raw:JSON.stringify({edits:[{path:evidence.path,beforeSha256:evidence.sha256,find:evidence.content,replace:selected.correction[entry]+'\n// authored integration delegate'}]}),
     receipt:{...profile,requestId:packet.requestId,workspaceHash:packet.workspaceHash,provider:'AUTHORED-INTEGRATION-DELEGATE',source:'local-engine'}};
   }};
   const origin='http://127.0.0.1:49195',app=await createWorkbenchApp({origin,live:{profile,coder,coderOnlyPreview:true,providerTimeoutMs:10000,publicVerifier:registration}});
   let state,token,offer;
   async function request(method,pathname,body){
    const result=await app.dispatch({method,pathname,body,headers:{host:'127.0.0.1:49195',origin,'content-type':'application/json','x-pitcrew-token':token}});
    if(result.body?.state)state=result.body.state;if(result.body?.startAdmissionId)offer=result.body.startAdmissionId;return result;
   }
   const boot=await request('GET','/api/bootstrap');token=boot.body.sessionToken;
   assert.equal((await request('POST','/api/workbench/start',{taskId:suiteId,startAdmissionId:offer})).status,200);
   assert.equal(state.canVerify,true);assert.equal(state.verification.qualified,true);
   const action=kind=>request('POST','/api/workbench/action',{sessionId:state.sessionId,revision:state.snapshot.revision,action:kind});
   assert.equal((await action('test')).status,200);assert.equal(state.checks.filter(c=>c.ok).length,baselinePasses);
   assert.equal((await action('generate')).status,200);assert.equal((await action('apply')).status,200);
   assert.equal((await action('test')).status,200);assert.ok(state.checks.every(c=>c.ok));
   assert.equal((await action('finish')).status,200);assert.equal(state.snapshot.closed,true);
   assert.equal(state.runtimeVerified,false);assert.equal(state.providerInvocations.coder,1);
  });
 }finally{await registration.close();}
 assert.equal(createVerifierAdmission(registration).capabilityFor(task.id).available,false);
});
