'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createFunctionWorkflow}=require('../../src/function-workflow.cjs');
const {createFunctionTask,TASK_SCHEMA,FUNCTION_ENTRY,CONTRACT_PATH}=require('../function-contract.cjs');
const {runCandidateProbe}=require('../probe.cjs');
const {buildProofRecord,viewModel}=require('../../ui/public/app.js');
const task=()=>createFunctionTask({schema:TASK_SCHEMA,title:'PRIVATE_TITLE',instructions:'PRIVATE_REQUIREMENT',exportName:'fn',
 source:'module.exports={fn:xs=>xs.sort()};',cases:[{label:'PRIVATE_LABEL',args:[['b','a']],expected:['a','b']}]});
// Actual WASM observations, explicitly not a Docker admission or model call.
const verifier={capabilityFor:()=>({available:true,qualified:false,admissionKind:'test-wasm-only'}),async runPublicChecks(ticket,options){
 const result=await runCandidateProbe({suiteId:ticket.suiteId,files:ticket.files},options);
 if(result.status!=='observed')throw Error('WASM observation unavailable');
 return{status:'candidate-verdict',ticketId:ticket.id,suiteId:ticket.suiteId,workspaceHash:ticket.workspaceHash,checks:result.checks,observations:result.observations};
}};
function action(flow,action,extra={}){const state=flow.state();return flow.action({sessionId:state.sessionId,revision:state.snapshot.revision,action,...extra});}

test('a new human counterexample forks the checked source and old contract without importing their passing verdict',async()=>{
 const {createFunctionChallenge}=require('../../src/function-replay.cjs'),{parseContractSource}=require('../function-contract.cjs');
 const selected=createFunctionTask({schema:TASK_SCHEMA,title:'First present',instructions:'Return the first non-null item, preserving falsy values; return null when absent.',exportName:'firstPresent',
  source:'module.exports={firstPresent:values=>values[0]??null};',cases:[{label:'zero',args:[[0]],expected:0},{label:'false',args:[[false]],expected:false},{label:'empty text',args:[['']],expected:''},{label:'absent',args:[[null]],expected:null}]});
 const parent=createFunctionWorkflow({task:selected,verifier});await action(parent,'test');await action(parent,'finish');const original=parent.state();
 const extended=createFunctionChallenge(original,{label:'PRIVATE_NEW_CASE',args:[[null,4]],expected:4});
 assert.deepEqual(parent.state(),original);assert.equal(extended.files[FUNCTION_ENTRY],original.checkedFunction.content);
 const before=parseContractSource(selected.files[CONTRACT_PATH]),after=parseContractSource(extended.files[CONTRACT_PATH]);
 assert.deepEqual(after.cases.slice(0,4),before.cases);assert.equal(after.cases.length,5);
 const child=createFunctionWorkflow({task:extended,verifier});assert.equal(child.state().snapshot.publicChecksCurrent,false);assert.deepEqual(child.state().checks,[]);
 await action(child,'test');assert.deepEqual(child.state().checks.map(c=>c.ok),[true,true,true,true,false]);assert.equal((await action(child,'finish')).status,409);
 await action(child,'propose',{source:'module.exports={firstPresent:values=>{const i=values.findIndex(x=>x!==null);return i<0?null:values[i];}};'});await action(child,'apply');await action(child,'test');await action(child,'finish');
 const record=buildProofRecord(child.state());assert.equal(record.closed,true);assert.equal(record.checks.filter(c=>c.ok).length,5);assert.equal(record.counts.modelCallsTotal,0);
 assert.equal(record.challengeParent.sourceSha256,original.checkedFunction.sha256);assert.equal(record.challengeParent.contractSha256,original.snapshot.manifest.find(m=>m.path===CONTRACT_PATH).sha256);assert.equal(record.challengeParent.caseCount,4);
 assert.equal(JSON.stringify(record).includes('PRIVATE_NEW_CASE'),false);assert.equal(parent.state().snapshot.manifest.find(m=>m.path===CONTRACT_PATH).sha256,record.challengeParent.contractSha256);
 parent.cancel();child.cancel();
});

test('extension requires a complete current checked parent and rejects a ninth or malformed example without mutation',async()=>{
 const {createFunctionChallenge}=require('../../src/function-replay.cjs');
 const selected=createFunctionTask({schema:TASK_SCHEMA,title:'Constant',instructions:'Return zero.',exportName:'fn',source:'module.exports={fn:()=>0};',cases:[{label:'zero',args:[],expected:0}]});
 const parent=createFunctionWorkflow({task:selected,verifier}),example={label:'another',args:[1],expected:0};
 assert.throws(()=>createFunctionChallenge(parent.state(),example));await action(parent,'test');const original=parent.state();
 for(const mutate of [s=>s.snapshot.publicChecksCurrent=false,s=>s.snapshot.pending={id:'waiting'},s=>s.snapshot.manifest[0].sha256='0'.repeat(64),s=>s.checkedFunction.content+=' ',s=>s.checks[0].ok=false,s=>s.checks=[]]){
  const invalid=structuredClone(original);mutate(invalid);assert.throws(()=>createFunctionChallenge(invalid,example));
 }
 for(const invalid of [{...example,source:'module.exports={fn:()=>1};'},{label:'',args:[],expected:0},{...example,args:'not an array'},{...example,expected:-0}])assert.throws(()=>createFunctionChallenge(original,invalid));
 assert.deepEqual(parent.state(),original);parent.cancel();
 const full=createFunctionTask({schema:TASK_SCHEMA,title:'Eight',instructions:'Return zero.',exportName:'fn',source:selected.files[FUNCTION_ENTRY],cases:Array.from({length:8},(_,i)=>({label:'case '+i,args:[i],expected:0}))});
 const flow=createFunctionWorkflow({task:full,verifier});await action(flow,'test');assert.throws(()=>createFunctionChallenge(flow.state(),example));flow.cancel();
});
test('user function workflow requires a reviewed source-bound patch, preserves contract and finishes after actual WASM checks',async()=>{
 const flow=createFunctionWorkflow({task:task(),verifier});
 assert.equal(flow.state().checkedFunction,null);
 assert.equal((await action(flow,'finish')).status,409);
 assert.equal((await action(flow,'test')).status,200);assert.equal(flow.state().checks[0].ok,false);
 assert.equal(flow.state().checkDiagnostics[0].returnMatches,true);assert.equal(flow.state().checkDiagnostics[0].inputPreserved,false);
 assert.equal(flow.state().checkDiagnostics[0].argumentsAfter,'[["a","b"]]');
 assert.equal(flow.state().checkedFunction,null);
 assert.equal((await action(flow,'propose',{source:'module.exports={fn:xs=>[...xs].sort()};'})).status,200);
 assert.equal(flow.state().proposal.applied,false);assert.equal(viewModel(flow.state()).canApply,true);
 assert.equal((await action(flow,'apply')).status,200);assert.equal(flow.state().checks.length,0);
 assert.deepEqual(flow.state().checkDiagnostics,[]);
 assert.equal((await action(flow,'finish')).status,409);
 assert.equal((await action(flow,'test')).status,200);assert.equal(flow.state().checks[0].ok,true);
 assert.deepEqual(flow.state().checkChanges.repaired,['case-01']);
 assert.equal(flow.state().snapshot.manifest.find(m=>m.path===CONTRACT_PATH).sha256,require('../../src/controller.cjs').hash(task().files[CONTRACT_PATH]));
 const record=buildProofRecord(flow.state());assert.equal(record.evidenceKind,'user-function-contract-workflow');
 for(const privateText of ['PRIVATE_TITLE','PRIVATE_REQUIREMENT','PRIVATE_LABEL','module.exports','expected','args'])assert.equal(JSON.stringify(record).includes(privateText),false);
 assert.equal(record.counts.coderCalls,0);assert.equal(record.counts.coder,1);
 assert.equal((await action(flow,'finish')).status,200);assert.equal(flow.state().snapshot.closed,true);
 const file=flow.state().checkedFunction;
 assert.equal(file.fileName,'fn.checked.js');assert.equal(file.content,'module.exports={fn:xs=>[...xs].sort()};');
 assert.equal(file.sha256,flow.state().snapshot.manifest.find(m=>m.path===FUNCTION_ENTRY).sha256);assert.equal(file.checkedExamples,1);
 assert.equal(JSON.stringify(buildProofRecord(flow.state())).includes(file.content),false);
 flow.cancel();assert.equal(flow.state().checkedFunction,null);
});

test('checked source is available for a passing original function, stays on the applied source and clears during changed-source verification',async()=>{
 const good=createFunctionTask({schema:TASK_SCHEMA,title:'Original passes',instructions:'Return zero.',exportName:'fn',source:'module.exports={fn:()=>0};',cases:[{label:'zero',args:[],expected:0}]});
 let hold=false,release,entered;const waiting=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
 const flow=createFunctionWorkflow({task:good,verifier:{...verifier,async runPublicChecks(ticket,options){if(hold){entered();await waiting;}return verifier.runPublicChecks(ticket,options);}}});
 await action(flow,'test');const original=flow.state().checkedFunction;assert.equal(original.content,good.files[FUNCTION_ENTRY]);
 await action(flow,'propose',{source:'module.exports={fn(){return 0;}};'});assert.deepEqual(flow.state().checkedFunction,original);
 await action(flow,'apply');assert.equal(flow.state().checkedFunction,null);
 hold=true;const pending=action(flow,'test');await started;assert.equal(flow.state().checkedFunction,null);release();await pending;
 const changed=flow.state().checkedFunction;assert.equal(changed.content,'module.exports={fn(){return 0;}};');assert.notEqual(changed.sha256,original.sha256);
 flow.cancel();assert.equal(flow.state().checkedFunction,null);
});

test('browser-reported cloud drafts require exact current source and contract bindings before consuming a proposal',async()=>{
 const selected=task(),flow=createFunctionWorkflow({task:selected,verifier}),hash=require('../../src/controller.cjs').hash;
 await action(flow,'test');const before=flow.state(),source='module.exports={fn:xs=>[...xs].sort()};';
 const generation={model:'gemini-3.5-flash-lite',inferenceSource:'in_cloud',revision:before.snapshot.revision,
  beforeSourceSha256:hash(selected.files[FUNCTION_ENTRY]),contractSha256:hash(selected.files[CONTRACT_PATH]),sourceSha256:hash(source)};
 for(const change of [{model:'other-model'},{inferenceSource:'on_device'},{revision:generation.revision+1},
  {beforeSourceSha256:'0'.repeat(64)},{contractSha256:'0'.repeat(64)},{sourceSha256:'0'.repeat(64)},{path:CONTRACT_PATH}]){
  const result=await action(flow,'propose-cloud',{source,generation:{...generation,...change},explanation:'PRIVATE_MODEL_RATIONALE'});
  assert.equal(result.status,409);assert.deepEqual(flow.state().snapshot,before.snapshot);assert.equal(flow.state().proposal,null);
 }
 assert.equal((await action(flow,'propose-cloud',{source,generation,explanation:'PRIVATE_MODEL_RATIONALE'})).status,200);
 const proposed=flow.state();assert.equal(proposed.proposal.kind,'browser-cloud-draft');assert.equal(proposed.proposal.applied,false);
 assert.deepEqual(proposed.proposal.generation,generation);assert.match(proposed.proposal.source,/Browser-reported/);assert.equal(proposed.modelCalls,0);
 assert.equal(proposed.snapshot.manifest.find(m=>m.path===FUNCTION_ENTRY).sha256,generation.beforeSourceSha256);
 await action(flow,'apply');await action(flow,'test');assert.equal(flow.state().checks[0].ok,true);
 assert.equal(flow.state().checkedFunction.sha256,generation.sourceSha256);await action(flow,'finish');
 const record=JSON.stringify(buildProofRecord(flow.state()));assert.equal(record.includes('PRIVATE_MODEL_RATIONALE'),false);assert.equal(record.includes(source),false);
});
test('cancellation discards a late verifier result and never grants Finish',async()=>{
 let release,entered;const started=new Promise(resolve=>entered=resolve);
 const flow=createFunctionWorkflow({task:task(),verifier:{...verifier,async runPublicChecks(ticket){entered();return new Promise(resolve=>{release=()=>resolve({status:'candidate-verdict',ticketId:ticket.id,suiteId:ticket.suiteId,workspaceHash:ticket.workspaceHash,checks:[{id:'case-01',ok:true}]});});}}});
 const pending=action(flow,'test');await started;flow.cancel();release();assert.equal((await pending).status,409);
 assert.equal(flow.state().checks.length,0);assert.equal(flow.state().snapshot.publicChecksCurrent,false);
});
test('invalid replacement source never changes current manifest or consumes a proposal',async()=>{
 const flow=createFunctionWorkflow({task:task(),verifier}),before=flow.state().snapshot.manifest;
 for(const source of ['',null,'x'.repeat(6001)])assert.equal((await action(flow,'propose',{source})).status,409);
 assert.deepEqual(flow.state().snapshot.manifest,before);assert.equal(flow.state().proposal,null);
 assert.equal((await action(flow,'read',{path:FUNCTION_ENTRY})).status,200);
});
test('the labeled authored tag example reproduces prototype-name and non-string failures with real WASM',async()=>{
 const {functionExample}=require('../../ui/public/app.js');
 const selected=createFunctionTask({schema:TASK_SCHEMA,...functionExample});
 const baseline=await runCandidateProbe({suiteId:selected.id,files:selected.files});
 assert.equal(baseline.status,'observed');assert.deepEqual(baseline.checks.map(c=>c.ok),[false,true,false,true,true]);
 const source='module.exports={uniqueTags(tags){const seen=new Set();return tags.filter(tag=>{if(typeof tag!=="string")return false;const key=tag.trim().toLowerCase();if(!key||seen.has(key))return false;seen.add(key);return true;});}};';
 const corrected=await runCandidateProbe({suiteId:selected.id,files:{...selected.files,[FUNCTION_ENTRY]:source}});
 assert.equal(corrected.status,'observed');assert.ok(corrected.checks.every(c=>c.ok));
});
