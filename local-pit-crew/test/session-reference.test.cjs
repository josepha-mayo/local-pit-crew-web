'use strict';
// Authored protocol/orchestration tests only. Patch strings and supplied verdicts are never executed.
const test=require('node:test'),assert=require('node:assert/strict');
const {hash}=require('../src/controller.cjs');
const {parseCoderResponse,validateProfile,validateCoderReceipt}=require('../src/coder-response.cjs');
const {CodingSession}=require('../src/coding-session.cjs');
const task={id:'string-only',prompt:'Return the input unchanged, including zero.',files:{'src/value.js':'function value(x){return x || 1;}'},writable:['src/value.js'],checkIds:['preserves-zero','preserves-text']};
const profile={kind:'authored-delegate',profileHash:'4'.repeat(64),modelId:'authored-string-provider',modelDigest:'none',engineBuild:'none'};
function response(packet,replace='function value(x){return x;}'){
 const source=packet.evidence.find(e=>e.path==='src/value.js');
 return{raw:JSON.stringify({edits:[{path:source.path,beforeSha256:source.sha256,find:source.content,replace}]}),
  receipt:{...profile,requestId:packet.requestId,workspaceHash:packet.workspaceHash,provider:'authored',source:'authored'}};
}
function fixture(options={}){
 const packets=[],signals=[];
 const coder={locality:'local-only',async generate(packet,{signal}){packets.push(structuredClone(packet));signals.push(signal);return response(packet);}};
 const session=new CodingSession({task:structuredClone(task),profile:structuredClone(profile),coder,...options});
 return{session,packets,signals};
}
function verdict(session,ok){
 const request=session.requestPublicChecks();assert.equal(request.status,'verification-required');
 const v={suiteId:request.ticket.suiteId,workspaceHash:request.ticket.workspaceHash,checks:task.checkIds.map(id=>({id,ok}))};
 return{request,result:session.acceptPublicVerdict(request.ticket.id,v)};
}
function decision(snapshot,action='code'){
 return{revision:snapshot.revision,action,path:'',artifactId:'',evidenceIds:action==='code'?snapshot.evidence.filter(e=>snapshot.manifest.some(m=>m.path===e.path&&m.sha256===e.sha256)).map(e=>e.id):[],
  objective:action==='code'?'Repair the remaining public failure without changing the original task.':'',
  reasonEvidenceIds:snapshot.events.filter(e=>e.kind==='public-check').slice(-1).map(e=>e.id)};
}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
test('adapter codec accepts bounded edit data without executing it',()=>{
 const source='aaa',evidence=[{path:'x.js',content:source,sha256:hash(source)}];
 const raw=JSON.stringify({edits:[{path:'x.js',beforeSha256:hash(source),find:'aaa',replace:'globalThis.__PIT_CREW_NEVER_EXECUTE__=true;'}]});
 assert.equal(Object.hasOwn(globalThis,'__PIT_CREW_NEVER_EXECUTE__'),false);
 const artifact=parseCoderResponse(raw,{evidence,writable:['x.js']});
 assert.match(artifact.edits[0].replace,/NEVER_EXECUTE/);
 assert.equal(Object.hasOwn(globalThis,'__PIT_CREW_NEVER_EXECUTE__'),false);
 assert.equal(evidence[0].content,source);
});
test('adapter codec rejects malformed, expansive, stale and ambiguous protocol outputs',async t=>{
 const source='aaa',evidence=[{path:'x.js',content:source,sha256:hash(source)}],edit={path:'x.js',beforeSha256:hash(source),find:'aaa',replace:'bbb'};
 const cases=[
  ['markdown envelope','\x60\x60\x60json\n'+JSON.stringify({edits:[edit]})+'\n\x60\x60\x60'],
  ['response byte cap','x'.repeat(48001)],
  ['extra command',JSON.stringify({edits:[edit],command:'never execute'})],
  ['unknown path',JSON.stringify({edits:[{...edit,path:'../other'}]})],
  ['stale preimage',JSON.stringify({edits:[{...edit,beforeSha256:'0'.repeat(64)}]})],
  ['overlapping matches',JSON.stringify({edits:[{...edit,find:'aa'}]})],
  ['empty edit list',JSON.stringify({edits:[]})],
  ['duplicate path',JSON.stringify({edits:[edit,edit]})],
  ['extra edit field',JSON.stringify({edits:[{...edit,shell:'never execute'}]})]
 ];
 for(const [name,raw]of cases)await t.test(name,()=>assert.throws(()=>parseCoderResponse(raw,{evidence,writable:['x.js']})));
 assert.equal(evidence[0].content,source);
});
test('profile and receipt checks bind declared pins, not actual locality attestation',()=>{
 assert.throws(()=>validateProfile({...profile,profileHash:''}));
 assert.throws(()=>validateProfile({...profile,kind:'runtime-reported'}));
 const packet={requestId:'operation-1',workspaceHash:'5'.repeat(64)},receipt={...profile,...packet,provider:'authored',source:'authored'};
 assert.deepEqual(validateCoderReceipt(receipt,{profile,...packet}),receipt);
 for(const changed of [{requestId:'another'},{workspaceHash:'6'.repeat(64)},{profileHash:'7'.repeat(64)},{source:'cloud'},{modelId:'other'}]){
  assert.throws(()=>validateCoderReceipt({...receipt,...changed},{profile,...packet}));
 }
});
test('session drives actual controller through explicit preview/apply/public tickets, not source execution',async()=>{
 const h=fixture(),s=h.session;
 const generated=await s.generatePatch();assert.equal(generated.status,'proposal');
 assert.equal(s.state.snapshot.counts.patches,0);assert.equal(s.state.snapshot.artifacts.length,1);
 assert.equal(s.state.runtimeVerified,false);assert.equal(s.state.callsSourceRunner,false);
 assert.equal(h.packets.length,1);assert.equal(h.packets[0].originalTask,task.prompt);
 assert.deepEqual(Object.keys(h.packets[0]).sort(),['requestId','profileHash','originalTask','nextStepHint','evidence','writable','workspaceHash','publicFeedback','responseSchema'].sort());
 assert.equal(h.packets[0].publicFeedback,null);
 assert.equal((await s.generatePatch()).reason,'proposal-awaits-explicit-apply');
 assert.equal(s.applyPatch('invented').status,'blocked');
 assert.equal(s.applyPatch(generated.proposal.artifactId).status,'applied-in-memory');
 assert.equal(s.finish().status,'blocked');
 const checked=verdict(s,true);assert.equal(checked.result.status,'public-verdict-accepted');
 assert.equal(checked.result.heldOutCorrectness,false);
 assert.equal(s.finish().status,'public-check-workflow-complete');
 assert.equal(h.signals[0].aborted,true);
 assert.equal(s.state.failure,null);assert.equal(s.state.snapshot.closed,true);
});
test('request clone prevents provider mutation from replacing the original task or evidence',async()=>{
 const s=new CodingSession({task,profile,coder:{locality:'local-only',async generate(packet){
  const result=response(packet);packet.originalTask='injected';packet.evidence[0].content='injected';packet.writable.push('other');
  return result;
 }}});
 const generated=await s.generatePatch();assert.equal(generated.status,'proposal');
 assert.equal(s.state.snapshot.originalTask,task.prompt);
 assert.equal(s.state.snapshot.evidence[0].content,task.files['src/value.js']);
 assert.equal(s.applyPatch(generated.proposal.artifactId).status,'applied-in-memory');
});
test('malformed coder output closes pending operation and never applies source',async()=>{
 const s=new CodingSession({task,profile,coder:{locality:'local-only',async generate(packet){return{...response(packet),raw:'not JSON'};}}});
 const r=await s.generatePatch();assert.equal(r.reason,'coder-response-rejected');
 assert.equal(s.state.snapshot.closed,true);assert.equal(s.state.snapshot.pending,null);
 assert.equal(s.state.snapshot.counts.patches,0);assert.deepEqual(s.state.snapshot.artifacts,[]);
});
test('provider failures do not echo raw errors into shared session state',async()=>{
 const secret='private-error-content-never-log';
 const s=new CodingSession({task,profile,coder:{locality:'local-only',async generate(){throw Error(secret);}}});
 assert.equal((await s.generatePatch()).reason,'coder-failed');
 assert.equal(JSON.stringify(s.state).includes(secret),false);
 assert.equal(s.state.snapshot.pending,null);
});
test('provider wait timeout closes and aborts, without claiming computation stopped',async()=>{
 let signal;
 const s=new CodingSession({task,profile,providerTimeoutMs:10,coder:{locality:'local-only',generate(_packet,options){signal=options.signal;return new Promise(()=>{});}}});
 assert.equal((await s.generatePatch()).reason,'coder-failed');
 assert.equal(signal.aborted,true);assert.equal(s.state.snapshot.closed,true);assert.equal(s.state.snapshot.pending,null);
});
test('cancel rejects a late coder result and competing generation sends no second provider call',async()=>{
 const entered=deferred(),release=deferred();let packet,calls=0,signal;
 const s=new CodingSession({task,profile,coder:{locality:'local-only',async generate(p,options){calls++;packet=p;signal=options.signal;entered.resolve();await release.promise;return response(p);}}});
 const pending=s.generatePatch();await entered.promise;
 assert.equal((await s.generatePatch()).reason,'operation-pending');assert.equal(calls,1);
 s.cancel();release.resolve();
 assert.equal((await pending).status,'discarded');assert.equal(signal.aborted,true);
 assert.deepEqual(s.state.snapshot.artifacts,[]);assert.equal(s.state.snapshot.pending,null);
 assert.equal(s.state.snapshot.originalTask,packet.originalTask);
});
test('Nano adapter invoked only at failed-public-check repair branch; mechanical transitions remain deterministic',async()=>{
 let calls=0,stops=0;const seen=[];
 const planner={async decide(snapshot){calls++;seen.push(snapshot);return{status:'decision',decision:decision(snapshot),inferenceSource:'on_device'};},stop(){stops++;}};
 const h=fixture({mode:'nano-controller',planner}),s=h.session;
 const first=await s.generatePatch();assert.equal(calls,0);
 s.applyPatch(first.proposal.artifactId);assert.equal(verdict(s,false).result.allPassed,false);
 const next=await s.generatePatch();assert.equal(next.status,'proposal');assert.equal(calls,1);
 assert.equal(seen[0].semanticBranch,'repair-after-public-check-failure');
 assert.equal(seen[0].originalTask,task.prompt);assert.ok(seen[0].events.some(e=>/failed/.test(e.label)));
 assert.deepEqual(seen[0].publicChecks,task.checkIds.map(id=>({id,ok:false})));
 assert.ok(seen[0].evidence.every(e=>seen[0].manifest.some(m=>m.path===e.path&&m.sha256===e.sha256)));
 assert.equal(h.packets[1].originalTask,task.prompt);assert.match(h.packets[1].nextStepHint,/remaining public failure/);
 assert.equal(s.state.providerInvocations.planner,1);
 s.applyPatch(next.proposal.artifactId);verdict(s,true);s.finish();assert.equal(stops,1);
 assert.equal(h.signals.every(signal=>signal.aborted),true);
});
test('planner manual-review outcome does not call coder again',async()=>{
 const planner={async decide(snapshot){return{status:'decision',decision:decision(snapshot,'ask_user'),inferenceSource:'on_device'};},stop(){}};
 const h=fixture({mode:'nano-controller',planner}),s=h.session;
 const first=await s.generatePatch();s.applyPatch(first.proposal.artifactId);verdict(s,false);
 assert.equal((await s.generatePatch()).status,'needs-manual-review');
 assert.equal(h.packets.length,1);assert.equal(s.state.snapshot.pending,null);s.cancel();
});
test('unexpected planner source closes without auto fallback or another coder call',async()=>{
 const planner={async decide(snapshot){return{status:'decision',decision:decision(snapshot),inferenceSource:'in_cloud'};},stop(){}};
 const h=fixture({mode:'nano-controller',planner}),s=h.session;
 const first=await s.generatePatch();s.applyPatch(first.proposal.artifactId);verdict(s,false);
 assert.equal((await s.generatePatch()).reason,'local-planner-failed');
 assert.equal(h.packets.length,1);assert.equal(s.state.snapshot.closed,true);
});
test('public verdicts are backend-only tickets, stale tickets cannot complete and invalid verdict closes',()=>{
 const s=fixture().session,first=s.requestPublicChecks();
 assert.equal(first.status,'verification-required');assert.equal(s.state.callsSourceRunner,false);
 assert.equal(s.acceptPublicVerdict('invented',{}).status,'discarded');
 assert.equal(s.state.snapshot.pending.type,'test');
 assert.equal(s.acceptPublicVerdict(first.ticket.id,{suiteId:task.id,workspaceHash:'0'.repeat(64),checks:[]}).reason,'public-verdict-rejected');
 assert.equal(s.state.snapshot.closed,true);assert.equal(s.state.snapshot.pending,null);
 assert.equal(s.acceptPublicVerdict(first.ticket.id,{}).status,'discarded');
});
test('missing local declaration or malformed optional planner fails before provider invocation',()=>{
 let calls=0;const coder={generate(){calls++;}};
 assert.throws(()=>new CodingSession({task,profile,coder}));
 assert.throws(()=>new CodingSession({task,profile,coder:{...coder,locality:'local-only'},planner:{decide(){}}}));
 assert.equal(calls,0);
});
