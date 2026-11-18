'use strict';
// Authored named programs and supplied verifier protocol only. No model or generated source executes.
const test=require('node:test'),assert=require('node:assert/strict');
const {createReferenceApp}=require('../ui/bridge.cjs'),{CodingSession}=require('../src/coding-session.cjs');
const {getTasks,runAuthoredChecks}=require('./fixtures.cjs');
const task=getTasks().find(t=>t.id==='pagination-zero');
const failures=checks=>checks.filter(c=>!c.ok).map(c=>c.id).sort();
const {comparePublicChecks}=require('../src/public-check-changes.cjs');
const {buildProofRecord,viewModel}=require('../ui/public/app.js');

test('public comparisons require different source hashes and exactly the same named check contract',()=>{
 const before={workspaceHash:'1'.repeat(64),checks:[{id:'old-pass',ok:true},{id:'old-fail',ok:false}]};
 const after={workspaceHash:'2'.repeat(64),checks:[{id:'old-fail',ok:true},{id:'old-pass',ok:false}]};
 assert.deepEqual(comparePublicChecks(before,after),{beforeWorkspaceHash:before.workspaceHash,afterWorkspaceHash:after.workspaceHash,beforePassed:1,afterPassed:1,total:2,regressed:['old-pass'],repaired:['old-fail']});
 for(const invalid of [null,{...after,workspaceHash:before.workspaceHash},{...after,workspaceHash:'not-a-hash'},
  {...after,checks:[]},{...after,checks:[{id:'old-pass',ok:true},{id:'new-check',ok:false}]},
  {...after,checks:[{id:'old-pass',ok:true},{id:'old-pass',ok:false}]},{...after,checks:[{id:'old-pass',ok:1},{id:'old-fail',ok:false}]}])assert.equal(comparePublicChecks(before,invalid),null);
 assert.equal(comparePublicChecks(null,after),null);
});

test('an authored regression trap preserves the pass count while exposing changed failures, then recovers',async()=>{
 const origin='http://127.0.0.1:48122',app=await createReferenceApp({origin});let state,token;
 async function request(method,pathname,body){const r=await app.dispatch({method,pathname,body,headers:{host:'127.0.0.1:48122',origin,'content-type':'application/json','x-pitcrew-token':token}});if(r.body.state)state=r.body.state;return r;}
 token=(await request('GET','/api/bootstrap')).body.sessionToken;
 const act=(action,extra={})=>request('POST','/api/action',{sessionId:state.sessionId,revision:state.snapshot.revision,action,...extra});
 await request('POST','/api/start',{taskId:task.id});
 assert.equal((await act('load-authored-trap')).status,409,'baseline must be checked first');
 await act('test');assert.deepEqual(failures(state.checks),['empty-preserved','zero-preserved']);
 assert.equal((await act('load-authored-trap',{source:'caller-supplied'})).status,409);
 assert.equal((await act('load-authored-trap')).status,200);assert.equal(state.proposal.kind,'regression-trap');assert.equal(state.proposal.applied,false);
 await act('apply');assert.equal((await act('load-authored')).status,409,'inspect the trap checks before loading the correction');
 await act('test');assert.deepEqual(failures(state.checks),['null-absent','undefined-absent']);
 assert.equal(state.checkChanges.beforePassed,4);assert.equal(state.checkChanges.afterPassed,4);
 assert.deepEqual([...state.checkChanges.repaired].sort(),['empty-preserved','zero-preserved']);
 assert.deepEqual([...state.checkChanges.regressed].sort(),['null-absent','undefined-absent']);
 const record=buildProofRecord({...state,checkChanges:{...state.checkChanges,privateSource:'DO-NOT-EXPORT'}});
 assert.deepEqual(record.checkChanges,state.checkChanges);assert.equal(JSON.stringify(record).includes('DO-NOT-EXPORT'),false);
 assert.equal(buildProofRecord({...state,checkChanges:{...state.checkChanges,afterPassed:6}}).checkChanges,null);
 assert.equal(buildProofRecord({...state,snapshot:{...state.snapshot,pending:{id:'pending'}}}).checkChanges,null);
 assert.notEqual(state.checkChanges.beforeWorkspaceHash,state.checkChanges.afterWorkspaceHash);assert.equal((await act('finish')).status,409);
 assert.equal((await act('load-authored')).status,200);assert.equal(state.proposal.kind,'authored-correction');
 await act('apply');assert.equal(state.checkChanges,null);await act('test');
 assert.equal(state.checkChanges.afterPassed,6);assert.deepEqual(state.checkChanges.regressed,[]);
 assert.equal((await act('finish')).status,200);assert.equal(state.modelCalls,0);assert.equal(state.snapshot.counts.patches,2);assert.equal(state.snapshot.counts.tests,3);
 await request('POST','/api/start',{taskId:task.id});assert.equal(state.checkChanges,null);
});

test('generated repair sessions expose only changes between accepted source-bound public verdicts',async()=>{
 const profile={kind:'authored-delegate',profileHash:'4'.repeat(64),modelId:'authored-check-change-provider',modelDigest:'none',engineBuild:'none'};let call=0;
 const wrong="const {fetchPage}=require('./adapter');\nfunction list(cursor,limit=20){const params={limit,cursor};return fetchPage(params);}\nmodule.exports={list};\n";
 const s=new CodingSession({task:{id:task.id,prompt:task.prompt,files:task.files,writable:task.writable,checkIds:(await runAuthoredChecks(task.id,'corrected')).checks.map(c=>c.id)},profile,
  coder:{locality:'local-only',async generate(packet){const e=packet.evidence.find(e=>e.path==='src/list.js'),replace=call++===0?wrong:task.correction['src/list.js'];return{
   raw:JSON.stringify({edits:[{path:e.path,beforeSha256:e.sha256,find:e.content,replace}]}),receipt:{...profile,requestId:packet.requestId,workspaceHash:packet.workspaceHash,provider:'authored',source:'authored'}};}}});
 async function verify(variant){const req=s.requestPublicChecks();assert.equal(req.status,'verification-required');const expected=variant==='baseline'?task.files:{...task.files,...(variant==='regression-trap'?{'src/list.js':wrong}:task.correction)};
  assert.deepEqual(req.ticket.files,expected);const result=await runAuthoredChecks(task.id,variant);
  assert.equal(s.acceptPublicVerdict(req.ticket.id,{suiteId:task.id,workspaceHash:req.ticket.workspaceHash,checks:result.checks.map(({id,ok})=>({id,ok}))}).status,'public-verdict-accepted');}
 await verify('baseline');assert.equal(s.state.checkChanges,null);
 assert.equal((await s.generatePatch()).status,'proposal');assert.equal(s.applyPatch(s.state.proposal.artifactId).status,'applied-in-memory');await verify('regression-trap');
 assert.equal(s.state.checkChanges.beforePassed,4);assert.equal(s.state.checkChanges.afterPassed,4);assert.equal(s.state.checkChanges.regressed.length,2);
 assert.equal(s.finish().status,'blocked');assert.equal((await s.generatePatch()).status,'proposal');s.applyPatch(s.state.proposal.artifactId);assert.equal(s.state.checkChanges,null);
 await verify('corrected');assert.equal(s.state.checkChanges.afterPassed,6);assert.equal(s.state.checkChanges.regressed.length,0);
 assert.equal(s.finish().status,'public-check-workflow-complete');
});

test('reference controls reserve the authored trap path and require another explicit patch review',async()=>{
 const origin='http://127.0.0.1:48122',app=await createReferenceApp({origin});let state,token;
 async function request(method,pathname,body){const r=await app.dispatch({method,pathname,body,headers:{host:'127.0.0.1:48122',origin,'content-type':'application/json','x-pitcrew-token':token}});if(r.body.state)state=r.body.state;return r;}
 token=(await request('GET','/api/bootstrap')).body.sessionToken;await request('POST','/api/start',{taskId:task.id});
 const act=action=>request('POST','/api/action',{sessionId:state.sessionId,revision:state.snapshot.revision,action});
 assert.equal(viewModel(state).canLoadTrap,false);await act('test');assert.equal(viewModel(state).canLoadTrap,true);assert.equal(viewModel(state).canTest,false);
 await act('load-authored-trap');assert.equal(viewModel(state).canLoad,false);await act('apply');assert.equal(viewModel(state).canApply,false);assert.equal(viewModel(state).canLoad,false);
 await act('test');assert.equal(viewModel(state).canLoad,true);assert.equal(viewModel(state).canFinish,false);
 await act('load-authored');assert.equal(state.snapshot.counts.patches,1);assert.equal(viewModel(state).canApply,true);assert.equal(state.proposal.applied,false);
 assert.equal(viewModel({...state,mode:'configured-local-unverified'}).canLoadTrap,false);
 await request('POST','/api/start',{taskId:'config-isolation'});assert.equal((await act('load-authored-trap')).status,400);assert.equal(viewModel(state).canLoadTrap,false);
});

test('late authored trap checks cannot populate a canceled or replacement session comparison',async()=>{
 let release,entered;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
 const origin='http://127.0.0.1:48122',app=await createReferenceApp({origin,executeChecks:async(id,variant)=>{if(variant==='regression-trap'){entered();await gate;}return runAuthoredChecks(id,variant);}});let state,token;
 async function request(method,pathname,body){const r=await app.dispatch({method,pathname,body,headers:{host:'127.0.0.1:48122',origin,'content-type':'application/json','x-pitcrew-token':token}});if(r.body.state)state=r.body.state;return r;}
 token=(await request('GET','/api/bootstrap')).body.sessionToken;await request('POST','/api/start',{taskId:task.id});
 const act=action=>request('POST','/api/action',{sessionId:state.sessionId,revision:state.snapshot.revision,action});
 await act('test');await act('load-authored-trap');await act('apply');const pending=act('test');await started;
 await act('cancel');assert.equal(state.checkChanges,null);await request('POST','/api/start',{taskId:'config-isolation'});const replacement=state.sessionId;
 release();assert.equal((await pending).status,409);assert.equal(state.sessionId,replacement);assert.equal(state.checkChanges,null);assert.deepEqual(state.checks,[]);
});
