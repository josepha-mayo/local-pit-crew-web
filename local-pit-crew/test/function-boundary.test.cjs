'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createWorkbenchApp}=require('../ui/workbench-bridge.cjs');
const {createFunctionTask,TASK_SCHEMA,FUNCTION_ENTRY,CONTRACT_PATH}=require('../runner/function-contract.cjs');
const {workspaceHash}=require('../src/controller.cjs');
const {parsePublicCheckOutcome}=require('../src/public-verifier-contract.cjs');
const spec={schema:TASK_SCHEMA,title:'An ordinary function',instructions:'Return the input.',exportName:'fn',source:'module.exports={fn:x=>x};',cases:[{label:'zero',args:[0],expected:0}]};
test('function intake stays closed against caller-declared qualification and never invokes its callback',async()=>{
 let calls=0;const origin='http://127.0.0.1:49195';
 const app=await createWorkbenchApp({origin,functionVerifier:{qualified:true,kind:'runtime-qualified-docker-quickjs',async runPublicChecks(){calls++;throw Error('DO_NOT_RUN');},capabilityFor:()=>({available:true,qualified:true})}});
 const boot=await app.dispatch({method:'GET',pathname:'/api/bootstrap',headers:{host:'127.0.0.1:49195'}});
 assert.equal(boot.body.capabilities.functionContract.available,false);
 const request={method:'POST',pathname:'/api/function/open',body:{spec,startAdmissionId:boot.body.startAdmissionId},headers:{host:'127.0.0.1:49195',origin,'content-type':'application/json','x-pitcrew-token':boot.body.sessionToken}};
 assert.equal((await app.dispatch({...request,headers:{...request.headers,origin:'https://untrusted.invalid'}})).status,403);
 assert.equal((await app.dispatch(request)).status,503);assert.equal(calls,0);
 const extension={...request,pathname:'/api/function/extend',body:{sessionId:'caller-invented-parent',revision:0,example:{label:'one',args:[1],expected:1},startAdmissionId:boot.body.startAdmissionId}};
 assert.equal((await app.dispatch({...extension,headers:{...extension.headers,origin:'https://untrusted.invalid'}})).status,403);
 assert.equal((await app.dispatch(extension)).status,409);
 const unchanged=await app.dispatch({method:'GET',pathname:'/api/bootstrap',headers:request.headers});
 assert.equal(unchanged.body.startAdmissionId,boot.body.startAdmissionId);assert.deepEqual(unchanged.body.state,boot.body.state);assert.equal(calls,0);
});

test('replay preparation preserves authorization and admission without invoking a verifier or opening a session',async()=>{
 const {createFunctionReplay}=require('../src/function-replay.cjs');let calls=0;const origin='http://127.0.0.1:49195';
 const app=await createWorkbenchApp({origin,functionVerifier:{qualified:true,async runPublicChecks(){calls++;throw Error('DO_NOT_RUN');},capabilityFor:()=>({available:true,qualified:true})}});
 const boot=await app.dispatch({method:'GET',pathname:'/api/bootstrap',headers:{host:'127.0.0.1:49195'}}),task=createFunctionTask(spec);
 const packet=createFunctionReplay(task.files,{title:spec.title,instructions:spec.instructions});
 const request={method:'POST',pathname:'/api/function/replay',body:{packet},headers:{host:'127.0.0.1:49195',origin,'content-type':'application/json','x-pitcrew-token':boot.body.sessionToken}};
 assert.equal((await app.dispatch({...request,headers:{...request.headers,origin:'https://untrusted.invalid'}})).status,403);
 const result=await app.dispatch(request);assert.equal(result.status,200);assert.equal(result.body.replay.contextRestored,true);assert.deepEqual(createFunctionTask(result.body.replay.spec).files,task.files);
 assert.equal(result.body.startAdmissionId,boot.body.startAdmissionId);assert.equal(result.body.state,undefined);assert.equal(calls,0);
 const corrupt=structuredClone(packet);corrupt.files[0].content+=' ';
 assert.equal((await app.dispatch({...request,body:{packet:corrupt}})).status,400);assert.equal(calls,0);
 const unchanged=await app.dispatch({method:'GET',pathname:'/api/bootstrap',headers:request.headers});
 assert.deepEqual(unchanged.body.state,boot.body.state);assert.equal(unchanged.body.startAdmissionId,boot.body.startAdmissionId);
 assert.equal((await app.dispatch({...request,pathname:'/api/function/open',body:{spec:result.body.replay.spec,startAdmissionId:boot.body.startAdmissionId}})).status,503);
});
test('function verdict parsing requires the exact source, immutable contract and complete generated check IDs',()=>{
 const task=createFunctionTask(spec),binding={ticketId:'bounded-ticket',suiteId:task.id,workspaceHash:workspaceHash(task.files)};
 const verdict={status:'candidate-verdict',...binding,checks:[{id:'case-01',ok:true}],observations:[{id:'case-01',status:'returned',output:'0',argsAfter:'[0]'}]};
 assert.equal(parsePublicCheckOutcome(verdict,binding,task.files).checks[0].ok,true);
 for(const files of [undefined,{...task.files,[FUNCTION_ENTRY]:spec.source+'\n'},{...task.files,[CONTRACT_PATH]:task.files[CONTRACT_PATH].replace('"expected":0','"expected":1')}])assert.throws(()=>parsePublicCheckOutcome(verdict,binding,files));
 for(const checks of [[],[{id:'self-reported-pass',ok:true}],[{id:'case-01',ok:'true'}],[{id:'case-01',ok:true},{id:'case-01',ok:true}]])assert.throws(()=>parsePublicCheckOutcome({...verdict,checks},binding,task.files));
 // A passing label cannot override contradictory return data or changed input.
 for(const observations of [[],[{id:'case-01',status:'returned',output:'1',argsAfter:'[0]'}],
  [{id:'case-01',status:'returned',output:'0',argsAfter:'[1]'}],
  [{id:'case-01',status:'threw',output:null,argsAfter:'[0]'}]])assert.throws(()=>parsePublicCheckOutcome({...verdict,observations},binding,task.files));
 const missing={...verdict};delete missing.observations;assert.throws(()=>parsePublicCheckOutcome(missing,binding,task.files));
});
