'use strict';
// Authored regression inputs/verdicts only. No patch contents, model, network or source runner execute.
const test=require('node:test'),assert=require('node:assert/strict');
const {hash}=require('../src/controller.cjs');
const {CodingSession}=require('../src/coding-session.cjs');
const {parseCoderResponse}=require('../src/coder-response.cjs');
const task={id:'branch-gate',prompt:'Keep the original input.',files:{'src/x.js':'function x(v){return v || 1;}'},writable:['src/x.js'],checkIds:['zero']};
const profile={kind:'authored-delegate',profileHash:'8'.repeat(64),modelId:'authored-regression',modelDigest:'none',engineBuild:'none'};
function setup(mode='nano-controller'){
 let plannerCalls=0,coderCalls=0;const packets=[];
 const planner={async decide(snapshot){plannerCalls++;return{status:'decision',inferenceSource:'on_device',decision:{
  revision:snapshot.revision,action:'code',path:'',artifactId:'',evidenceIds:snapshot.evidence.filter(e=>snapshot.manifest.some(m=>m.path===e.path&&m.sha256===e.sha256)).map(e=>e.id),
  objective:'Repair current public failure; preserve the original task.',reasonEvidenceIds:[]}};},stop(){}};
 const coder={locality:'local-only',async generate(packet){
  coderCalls++;packets.push(structuredClone(packet));const e=packet.evidence.find(e=>e.path==='src/x.js');
  return{raw:JSON.stringify({edits:[{path:e.path,beforeSha256:e.sha256,find:e.content,replace:'function x(v){return v;} // authored '+coderCalls}]}),
   receipt:{...profile,requestId:packet.requestId,workspaceHash:packet.workspaceHash,provider:'authored',source:'authored'}};
 }};
 const session=new CodingSession({task,profile,coder,planner,mode});
 function check(ok){
  const request=session.requestPublicChecks();assert.equal(request.status,'verification-required');
  const value={suiteId:task.id,workspaceHash:request.ticket.workspaceHash,checks:[{id:'zero',ok}]};
  return{request,value,result:session.acceptPublicVerdict(request.ticket.id,value)};
 }
 return{session,check,packets,get plannerCalls(){return plannerCalls;},get coderCalls(){return coderCalls;}};
}

test('both repair modes receive the same accepted baseline and post-apply public feedback',async()=>{
 const observations=[];
 for(const mode of ['deterministic','nano-controller']){
  const h=setup(mode),baseline=h.check(false);
  // A caller retaining a verdict or state object cannot rewrite accepted feedback.
  baseline.value.checks[0].ok=true;h.session.state.publicChecks[0].ok=true;
  const first=await h.session.generatePatch();assert.equal(first.status,'proposal');
  assert.deepEqual(h.packets[0].publicFeedback,{suiteId:task.id,workspaceHash:h.packets[0].workspaceHash,checks:[{id:'zero',ok:false}]});
  assert.equal(h.plannerCalls,0);
  h.session.applyPatch(first.proposal.artifactId);
  const postApply=h.check(false);
  assert.notEqual(postApply.request.ticket.workspaceHash,baseline.request.ticket.workspaceHash);
  assert.equal(h.session.acceptPublicVerdict(baseline.request.ticket.id,baseline.value).status,'discarded');
  assert.equal((await h.session.generatePatch()).status,'proposal');
  assert.deepEqual(h.packets[1].publicFeedback,{suiteId:task.id,workspaceHash:h.packets[1].workspaceHash,checks:[{id:'zero',ok:false}]});
  assert.equal(h.plannerCalls,mode==='nano-controller'?1:0);
  observations.push(h.packets.map(p=>p.publicFeedback));h.session.cancel();
 }
 assert.deepEqual(observations[0],observations[1]);
});

test('a Nano citation identifies support without hiding current dependencies or changing patch permissions',async t=>{
 for(const citedPath of ['src/config.js','src/defaults.js'])await t.test(citedPath,async()=>{
  const dependency="module.exports={retry:{attempts:3}};",initial="const defaults=require('./defaults');module.exports=()=>({...defaults});";
  const task={id:'dependency-context',prompt:'Isolate returned configuration state.',files:{'src/defaults.js':dependency,'src/config.js':initial},
   writable:['src/config.js'],checkIds:['isolated-defaults']};
  const packets=[],advice='Inspect the remaining configuration alias while preserving the fixed defaults module.';let citedId;
  const planner={async decide(snapshot){
   const source=snapshot.evidence.find(e=>e.path===citedPath);citedId=source.id;
   return{status:'decision',inferenceSource:'on_device',decision:{revision:snapshot.revision,action:'code',path:'',artifactId:'',
    evidenceIds:[source.id],objective:advice,reasonEvidenceIds:[source.id]}};
  },stop(){}};
  const coder={locality:'local-only',async generate(packet){
   packets.push(structuredClone(packet));const source=packet.evidence.find(e=>e.path==='src/config.js');
   assert.ok(source,'a citation to the dependency does not remove the editable implementation');
   return{raw:JSON.stringify({edits:[{path:source.path,beforeSha256:source.sha256,find:source.content,replace:source.content+'\n// authored '+packets.length}]}),
    receipt:{...profile,requestId:packet.requestId,workspaceHash:packet.workspaceHash,provider:'authored',source:'authored'}};
  }};
  const session=new CodingSession({task,profile,coder,planner,mode:'nano-controller'});
  const first=await session.generatePatch();assert.equal(first.status,'proposal');session.applyPatch(first.proposal.artifactId);
  const check=session.requestPublicChecks();session.acceptPublicVerdict(check.ticket.id,{suiteId:task.id,workspaceHash:check.ticket.workspaceHash,checks:[{id:'isolated-defaults',ok:false}]});
  assert.equal((await session.generatePatch()).status,'proposal');assert.ok(citedId);
  const repair=packets[1];assert.equal(repair.nextStepHint,advice);assert.equal(repair.originalTask,task.prompt);
  assert.deepEqual(repair.writable,['src/config.js']);
  assert.deepEqual(repair.evidence.map(e=>e.path),['src/defaults.js','src/config.js']);
  assert.equal(repair.evidence.find(e=>e.path==='src/defaults.js').content,dependency);
  assert.equal(repair.evidence.find(e=>e.path==='src/config.js').content,initial+'\n// authored 1');
  for(const e of repair.evidence)assert.equal(e.sha256,hash(e.content));
  assert.equal(repair.publicFeedback.workspaceHash,repair.workspaceHash);session.cancel();
 });
});

test('reading a file again keeps one current source per path in both coder modes',async()=>{
 for(const mode of ['deterministic','nano-controller']){
  const h=setup(mode);h.session.readFile('src/x.js');h.session.readFile('src/x.js');
  const first=await h.session.generatePatch();assert.equal(first.status,'proposal');
  assert.equal(h.packets[0].evidence.length,1);
  h.session.applyPatch(first.proposal.artifactId);h.check(false);
  h.session.readFile('src/x.js');h.session.readFile('src/x.js');
  assert.equal((await h.session.generatePatch()).status,'proposal');
  const current=h.session.state.snapshot.manifest.find(e=>e.path==='src/x.js');
  assert.equal(h.packets[1].evidence.length,1);assert.equal(h.packets[1].evidence[0].sha256,current.sha256);
  assert.notEqual(h.packets[0].evidence[0].sha256,current.sha256);
  h.session.cancel();
 }
});

test('applying a patch clears prior public feedback until the changed source is checked',async()=>{
 const h=setup();h.check(false);
 const first=await h.session.generatePatch();h.session.applyPatch(first.proposal.artifactId);
 assert.equal((await h.session.generatePatch()).status,'proposal');
 assert.equal(h.packets[1].publicFeedback,null);assert.equal(h.plannerCalls,0);h.session.cancel();
});
test('session review: failed baseline checks never invoke Nano on initial generation',async()=>{
 const h=setup();assert.equal(h.check(false).result.allPassed,false);
 const first=await h.session.generatePatch();
 assert.equal(first.status,'proposal');assert.equal(h.coderCalls,1);assert.equal(h.plannerCalls,0);
 assert.equal(h.session.state.providerInvocations.planner,0);
 h.session.cancel();
});
test('session review: only a current post-apply failed verdict activates Nano repair',async()=>{
 const h=setup(),baseline=h.check(false),first=await h.session.generatePatch();
 assert.equal(h.plannerCalls,0);assert.equal(h.session.applyPatch(first.proposal.artifactId).status,'applied-in-memory');
 const current=h.session.requestPublicChecks();assert.equal(current.status,'verification-required');
 assert.notEqual(current.ticket.id,baseline.request.ticket.id);
 const before=h.session.state;
 assert.equal(h.session.acceptPublicVerdict(baseline.request.ticket.id,baseline.value).status,'discarded');
 assert.deepEqual(h.session.state,before);
 assert.equal(h.session.acceptPublicVerdict(current.ticket.id,{suiteId:task.id,workspaceHash:current.ticket.workspaceHash,checks:[{id:'zero',ok:false}]}).allPassed,false);
 const repaired=await h.session.generatePatch();
 assert.equal(repaired.status,'proposal');assert.equal(h.plannerCalls,1);assert.equal(h.coderCalls,2);
 assert.equal(h.session.state.snapshot.originalTask,task.prompt);
 h.session.cancel();
});
test('session review: raw duplicate keys use documented last-wins parsing with final scope checks',()=>{
 const content='aaa',evidence=[{path:'x.js',content,sha256:hash(content)}];
 const rest='"beforeSha256":"'+hash(content)+'","find":"aaa","replace":"bbb"';
 const allowed='{"edits":[{"path":"../outside","path":"x.js",'+rest+'}]}';
 const parsed=parseCoderResponse(allowed,{evidence,writable:['x.js']});
 assert.equal(parsed.edits[0].path,'x.js');assert.equal(evidence[0].content,content);
 const forbidden='{"edits":[{"path":"x.js","path":"../outside",'+rest+'}]}';
 assert.throws(()=>parseCoderResponse(forbidden,{evidence,writable:['x.js']}),/invalid-patch-path/);
 const duplicateEnvelope='{"edits":[],"edits":[{"path":"x.js",'+rest+'}]}';
 assert.equal(parseCoderResponse(duplicateEnvelope,{evidence,writable:['x.js']}).edits.length,1);
});
