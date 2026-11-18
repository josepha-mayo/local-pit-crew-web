// In-memory composition and authored observations, not a browser execution claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserFunctionWorkbench} from '../function-workbench.mjs';
import contracts from '../../runner/function-contract.cjs';
const spec={schema:contracts.TASK_SCHEMA,title:'Private case',instructions:'Return one.',exportName:'fn',source:'module.exports={fn:()=>0};',cases:[{label:'one',args:[],expected:1}]};
function setup(run){
 let referenceState={snapshot:null},referenceGate=null;
 const reference={async dispatch({method,pathname,body}){
  if(pathname==='/api/state'){if(referenceGate)await referenceGate;return{status:200,body:{state:referenceState}};}
  if(pathname==='/api/bootstrap')return{status:200,body:{state:referenceState,tasks:[]}};
  if(pathname==='/api/start'){referenceState={sessionId:'reference',snapshot:{revision:0,closed:false}};return{status:200,body:{state:referenceState}};}
  if(pathname==='/api/action'&&body?.action==='cancel'){referenceState.snapshot.closed=true;return{status:200,body:{state:referenceState}};}
  return{status:404,body:{error:'unknown'}};
 }};
 const verifier={capabilityFor:()=>({available:true,qualified:false,admissionKind:'browser-worker-quickjs'}),close(){},
  runPublicChecks:run??(async ticket=>{const observations=[{id:'case-01',status:'returned',output:ticket.files['src/function.js'].includes('()=>1')?'1':'0',argsAfter:'[]'}];return{status:'candidate-verdict',ticketId:ticket.id,suiteId:ticket.suiteId,workspaceHash:ticket.workspaceHash,observations,checks:contracts.gradeFunctionObservations(observations,ticket.files)};})};
 const app=createBrowserFunctionWorkbench({reference,verifier}),get=pathname=>app.dispatch({method:'GET',pathname}),post=(pathname,body)=>app.dispatch({method:'POST',pathname,body});
 return{app,get,post,holdReference(promise){referenceGate=promise;}};
}
test('browser function composition preserves fixed contracts, explicit manual review and exact Finish through its memory routes',async()=>{
 const f=setup(),boot=await f.get('/api/bootstrap');let response=await f.post('/api/function/open',{spec,startAdmissionId:boot.body.startAdmissionId});
 assert.equal(response.body.openedFunctionSessionId,response.body.state.sessionId);let state=response.body.state;
 const action=async(name,extra={})=>{const result=await f.post('/api/function/action',{sessionId:state.sessionId,revision:state.snapshot.revision,action:name,...extra});state=result.body.state;return result;};
 assert.equal((await action('test')).status,200);assert.equal(state.checks[0].ok,false);assert.equal(state.checkDiagnostics[0].actualReturn,'0');
 assert.equal((await action('finish')).status,409);
 const before=state.snapshot.manifest.find(m=>m.path==='contract.json').sha256;
 await action('propose',{source:'module.exports={fn:()=>1};'});await action('apply');assert.deepEqual(state.checkDiagnostics,[]);
 await action('test');assert.equal(state.checks[0].ok,true);assert.equal(state.snapshot.manifest.find(m=>m.path==='contract.json').sha256,before);
 await action('finish');assert.equal(state.snapshot.closed,true);assert.equal(state.verification.qualified,false);
 const nextOffer=(await action('read',{path:'src/function.js'})).body.startAdmissionId;
 assert.notEqual(nextOffer,boot.body.startAdmissionId);
 const reopened=await f.post('/api/function/open',{spec,startAdmissionId:nextOffer});assert.equal(reopened.status,200);assert.notEqual(reopened.body.state.sessionId,state.sessionId);
 const reference=await f.post('/api/start',{taskId:'reference'});
 assert.equal((await f.post('/api/function/open',{spec,startAdmissionId:reference.body.startAdmissionId})).status,200);
});

test('one browser setup failure preserves an applied patch and returns its unstarted check slot',async()=>{
 let attempts=0;
 const f=setup(async ticket=>{
  const binding={ticketId:ticket.id,suiteId:ticket.suiteId,workspaceHash:ticket.workspaceHash};
  if(++attempts===1||attempts===3)return{status:'unavailable',...binding,reason:'browser-setup-unavailable'};
  const observations=[{id:'case-01',status:'returned',output:'1',argsAfter:'[]'}];
  return{status:'candidate-verdict',...binding,observations,checks:contracts.gradeFunctionObservations(observations,ticket.files)};
 });
 try{
  const offer=(await f.get('/api/bootstrap')).body.startAdmissionId;
  let {body:{state}}=await f.post('/api/function/open',{spec,startAdmissionId:offer});
  const action=async(action,extra={})=>{
   const response=await f.post('/api/function/action',{sessionId:state.sessionId,revision:state.snapshot.revision,action,...extra});
   state=response.body.state;
   return response.status;
  };
  await action('propose',{source:'module.exports={fn:()=>1};'});
  await action('apply');
  const manifest=state.snapshot.manifest;
  assert.equal(await action('test'),503);
  assert.equal(state.setupRetryPending,true);
  assert.equal(state.snapshot.pending,null);
  assert.equal(state.snapshot.closed,false);
  assert.equal(state.snapshot.publicChecksCurrent,false);
  assert.equal(state.snapshot.counts.tests,0);
  assert.equal(state.proposal.applied,true);
  assert.deepEqual(state.snapshot.manifest,manifest);
  assert.equal(await action('finish'),409);
  assert.equal(await action('test'),200);
  assert.equal(state.setupRetryPending,false);
  assert.equal(state.snapshot.counts.tests,1);
  assert.equal(state.snapshot.publicChecksCurrent,true);
  assert.equal(await action('test'),503);
  assert.equal(state.snapshot.closed,true);
  assert.equal(state.snapshot.publicChecksCurrent,false);
 }finally{f.app.close();}
});
test('extension rejects stale bindings and malformed examples before replacing the checked parent or consuming admission',async()=>{
 const f=setup(),offer=(await f.get('/api/bootstrap')).body.startAdmissionId;
 const opened=await f.post('/api/function/open',{spec:{...spec,source:'module.exports={fn:()=>1};'},startAdmissionId:offer});let parent=opened.body.state;
 const checked=await f.post('/api/function/action',{sessionId:parent.sessionId,revision:parent.snapshot.revision,action:'test'});parent=checked.body.state;
 const body={sessionId:parent.sessionId,revision:parent.snapshot.revision,startAdmissionId:checked.body.startAdmissionId,example:{label:'new',args:[],expected:1}};
 for(const bad of [{...body,sessionId:'old'},{...body,revision:parent.snapshot.revision-1},{...body,startAdmissionId:offer},{...body,source:'forbidden'},{...body,example:{...body.example,expected:-0}}]){
  assert.ok((await f.post('/api/function/extend',bad)).status>=400);assert.deepEqual((await f.get('/api/state')).body.state,parent);assert.equal((await f.get('/api/bootstrap')).body.startAdmissionId,body.startAdmissionId);
 }
 const extended=await f.post('/api/function/extend',body);assert.equal(extended.status,200);assert.notEqual(extended.body.state.sessionId,parent.sessionId);assert.equal(extended.body.state.task.counterexamples.length,2);
 assert.deepEqual(extended.body.state.checks,[]);assert.equal(extended.body.state.snapshot.publicChecksCurrent,false);assert.equal(extended.body.state.snapshot.counts.tests,0);
 assert.equal(extended.body.state.challengeParent.sourceSha256,parent.checkedFunction.sha256);f.app.close();
});

test('canceling an extension while its start is pending cannot publish the child or inherit a pass',async()=>{
 const f=setup(),offer=(await f.get('/api/bootstrap')).body.startAdmissionId;
 const opened=await f.post('/api/function/open',{spec:{...spec,source:'module.exports={fn:()=>1};'},startAdmissionId:offer}),s=opened.body.state;
 const checked=await f.post('/api/function/action',{sessionId:s.sessionId,revision:s.snapshot.revision,action:'test'}),parent=checked.body.state;
 let release;const gate=new Promise(r=>{release=r;});f.holdReference(gate);
 const pending=f.post('/api/function/extend',{sessionId:parent.sessionId,revision:parent.snapshot.revision,startAdmissionId:checked.body.startAdmissionId,example:{label:'new',args:[],expected:1}});await Promise.resolve();
 await f.post('/api/workbench/cancel-start',{startAdmissionId:checked.body.startAdmissionId});release();assert.equal((await pending).status,409);
 const current=(await f.get('/api/state')).body.state;assert.equal(current.sessionId,parent.sessionId);assert.equal(current.snapshot.publicChecksCurrent,false);f.app.close();
});
test('canceled start offers and lost-response cancellation cannot close a newer browser function owner',async()=>{
 const f=setup(),boot=await f.get('/api/bootstrap'),offer=boot.body.startAdmissionId;
 await f.post('/api/workbench/cancel-start',{startAdmissionId:offer});assert.equal((await f.post('/api/function/open',{spec,startAdmissionId:offer})).status,409);
 const next=(await f.get('/api/bootstrap')).body.startAdmissionId;
 const opened=await f.post('/api/function/open',{spec,startAdmissionId:next});
 await f.post('/api/workbench/cancel-start',{startAdmissionId:next});assert.equal((await f.get('/api/state')).body.state.snapshot.closed,true);
 const replacementOffer=(await f.get('/api/bootstrap')).body.startAdmissionId;
 const replacement=await f.post('/api/function/open',{spec,startAdmissionId:replacementOffer});
 await f.post('/api/workbench/cancel-start',{startAdmissionId:next});
 const current=(await f.get('/api/state')).body.state;assert.equal(current.sessionId,replacement.body.state.sessionId);assert.notEqual(current.sessionId,opened.body.state.sessionId);assert.equal(current.snapshot.closed,false);
});
test('a reference navigation or canceled admission during a delayed open prevents the old browser function start from committing',async()=>{
 for(const cancel of [false,true]){
  const f=setup();let release;const gate=new Promise(resolve=>release=resolve);f.holdReference(gate);
  const offer=(await f.get('/api/bootstrap')).body.startAdmissionId;
  const pending=f.post('/api/function/open',{spec,startAdmissionId:offer});await Promise.resolve();
  await f.post(cancel?'/api/workbench/cancel-start':'/api/start',cancel?{startAdmissionId:offer}:{taskId:'reference'});
  release();assert.equal((await pending).status,409);
  assert.notEqual((await f.get('/api/state')).body.state?.mode,'function-contract');
 }
});
test('an old browser check cannot render into or grant Finish to a replacement function',async()=>{
 let release;const f=setup(ticket=>new Promise(resolve=>release=()=>resolve({status:'candidate-verdict',ticketId:ticket.id,suiteId:ticket.suiteId,workspaceHash:ticket.workspaceHash,checks:[{id:'case-01',ok:true}],observations:[{id:'case-01',status:'returned',output:'1',argsAfter:'[]'}]})));
 const offer=(await f.get('/api/bootstrap')).body.startAdmissionId,first=await f.post('/api/function/open',{spec,startAdmissionId:offer}),s=first.body.state;
 const pending=f.post('/api/function/action',{sessionId:s.sessionId,revision:s.snapshot.revision,action:'test'});await Promise.resolve();
 const nextOffer=(await f.get('/api/bootstrap')).body.startAdmissionId,next=await f.post('/api/function/open',{spec,startAdmissionId:nextOffer});
 release();assert.equal((await pending).status,409);const current=(await f.get('/api/state')).body.state;
 assert.equal(current.sessionId,next.body.state.sessionId);assert.deepEqual(current.checks,[]);assert.equal(current.snapshot.publicChecksCurrent,false);
});
