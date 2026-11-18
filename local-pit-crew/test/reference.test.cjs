'use strict';
// All providers, records and corrections in this file are authored test data.
const test=require('node:test');
const assert=require('node:assert/strict');
const {ReferenceController,hash}=require('../src/controller.cjs');
const {LocalDecisionClient,toControllerAction}=require('../src/firebase-local-client.cjs');
const {balancedSchedule,evaluateRecord,summarize}=require('../src/evidence-ledger.cjs');
const {getTasks,runAuthoredChecks}=require('./fixtures.cjs');
const make=(extra={})=>new ReferenceController({
 files:{'src/a.js':'module.exports=0;','src/constants.js':'0'},writable:['src/a.js'],
 taskText:'Fix the requested fixture bug.',suiteId:'public-v1',checkIds:['a'],...extra
});
const act=(c,type,extra={})=>c.decide({revision:c.snapshot().revision,type,...extra});
function read(c,path='src/a.js'){
 const op=act(c,'read',{path});c.complete(op.id,{content:c.filesForReferenceTest()[path]});return'e:'+op.id;
}
function edit(c,replace='1'){return{path:'src/a.js',beforeSha256:hash(c.filesForReferenceTest()['src/a.js']),find:'0',replace};}
function artifact(c,edits){const eid=read(c);const op=act(c,'code',{evidenceIds:[eid],objective:'A next-step hint.'});c.complete(op.id,{edits});return'a:'+op.id;}
function verify(c,checks=[{id:'a',ok:true}]){
 const op=act(c,'test');return c.complete(op.id,{suiteId:op.request.suiteId,workspaceHash:op.request.workspaceHash,checks});
}

test('authored fixture baselines fail and authored corrections pass',async t=>{
 for(const task of getTasks())await t.test(task.id,async()=>{
  const baseline=await runAuthoredChecks(task.id,'baseline');
  const corrected=await runAuthoredChecks(task.id,'corrected');
  assert.equal(baseline.pass,false);assert.equal(corrected.pass,true);
  assert.ok(baseline.checks.some(c=>!c.ok));
 });
 await assert.rejects(()=>runAuthoredChecks('pagination-zero','model-generated'));
});

test('reference controller contracts, no real tools or code execution',async t=>{
 const cases=[
  ['unknown shell action rejected',()=>assert.throws(()=>act(make(),'shell',{command:'anything'}))],
  ['model cannot submit verifier completion',()=>assert.throws(()=>act(make(),'complete',{passed:true}))],
  ['read outside exact manifest rejected',()=>assert.throws(()=>act(make(),'read',{path:'../private'}))],
  ['stale revision rejected',()=>assert.throws(()=>make().decide({revision:99,type:'test'}))],
  ['parallel action rejected',()=>{const c=make();act(c,'read',{path:'src/a.js'});assert.throws(()=>act(c,'test'));}],
  ['read content bound to hash',()=>{const c=make();const op=act(c,'read',{path:'src/a.js'});assert.throws(()=>c.complete(op.id,{content:'different'}));}],
  ['invented evidence rejected',()=>assert.throws(()=>act(make(),'code',{evidenceIds:['invented'],objective:'change'}))],
  ['context byte cap enforced',()=>{const c=make({limits:{contextBytes:1}});const id=read(c);assert.throws(()=>act(c,'code',{evidenceIds:[id],objective:'change'}));}],
  ['artifact cannot expand scope',()=>{const c=make();const id=artifact(c,[{...edit(c),path:'src/constants.js'}]);assert.throws(()=>act(c,'apply',{artifactId:id}));}],
  ['extra command field rejected',()=>{const c=make();const id=artifact(c,[{...edit(c),command:'anything'}]);assert.throws(()=>act(c,'apply',{artifactId:id}));}],
  ['stale preimage rejected',()=>{const c=make();const id=artifact(c,[{...edit(c),beforeSha256:'wrong'}]);assert.throws(()=>act(c,'apply',{artifactId:id}));}],
  ['ambiguous replacement rejected',()=>{const c=make({files:{'src/a.js':'00','src/constants.js':'0'}});const id=artifact(c,[edit(c)]);assert.throws(()=>act(c,'apply',{artifactId:id}));}],
  ['finish requires current public checks',()=>assert.throws(()=>act(make(),'finish'))],
  ['wrong verifier revision rejected',()=>{const c=make();const op=act(c,'test');assert.throws(()=>c.complete(op.id,{suiteId:'public-v1',workspaceHash:'wrong',checks:[{id:'a',ok:true}]}));}],
  ['failed public check prevents finish',()=>{const c=make();verify(c,[{id:'a',ok:false}]);assert.throws(()=>act(c,'finish'));}],
  ['current public checks permit workflow finish',()=>{const c=make();verify(c);assert.equal(act(c,'finish').type,'public-checks-complete');}],
  ['patch invalidates checks and source evidence',()=>{const c=make();const id=artifact(c,[edit(c)]),eid=c.snapshot().evidence[0].id;verify(c);act(c,'apply',{artifactId:id});assert.throws(()=>act(c,'finish'));assert.throws(()=>act(c,'code',{evidenceIds:[eid],objective:'change'}));}],
  ['multi-edit validation is atomic',()=>{const c=make({files:{'src/a.js':'0','src/b.js':'0'},writable:['src/a.js','src/b.js']});const before=c.filesForReferenceTest();const id=artifact(c,[edit(c),{path:'src/b.js',beforeSha256:'wrong',find:'0',replace:'1'}]);assert.throws(()=>act(c,'apply',{artifactId:id}));assert.deepEqual(c.filesForReferenceTest(),before);}],
  ['cancel rejects late completion',()=>{const c=make();const op=act(c,'read',{path:'src/a.js'});c.cancel();assert.equal(c.complete(op.id,{content:'module.exports=0;'}).accepted,false);}],
  ['cross-session completion cannot hijack pending operation',()=>{const a=make(),b=make();const x=act(a,'read',{path:'src/a.js'}),y=act(b,'read',{path:'src/a.js'});assert.notEqual(x.id,y.id);assert.equal(b.complete(x.id,{content:'module.exports=0;'}).accepted,false);assert.equal(b.snapshot().pending.id,y.id);}],
  ['missing verifier checks rejected',()=>{const c=make({checkIds:['a','b']});assert.throws(()=>verify(c));}],
  ['duplicate verifier checks rejected',()=>{const c=make({checkIds:['a','b']});assert.throws(()=>verify(c,[{id:'a',ok:true},{id:'a',ok:true}]));}],
  ['malformed proposals consume budget',()=>{const c=make({limits:{decisions:1}});assert.throws(()=>act(c,'shell'));assert.throws(()=>act(c,'test'),/decision budget/);}],
  ['zero decision budget enforced',()=>assert.throws(()=>act(make({limits:{decisions:0}}),'test'))],
  ['original task cannot be replaced by model hint',()=>{const c=make({taskText:'Keep this exact original task.'});const eid=read(c);const op=act(c,'code',{evidenceIds:[eid],objective:'Different model-generated objective'});assert.equal(op.request.originalTask,'Keep this exact original task.');assert.equal(op.request.nextStepHint,'Different model-generated objective');}]
 ];
 for(const [name,fn]of cases)await t.test(name,fn);
});

function fakeClient({availability='available',source='on_device',initialize,generate,maxCalls=20}={}){
 const trace={factory:0,initialize:0,generate:0,configs:[],prompts:[]};
 const decision={revision:7,action:'test',path:'',artifactId:'',evidenceIds:[],objective:'',reasonEvidenceIds:[]};
 const client=new LocalDecisionClient({
  languageModel:()=>availability===null?null:{availability:async()=>typeof availability==='function'?availability():availability},
  onlyOnDevice:'only_on_device',onDeviceSource:'on_device',maxCalls,
  createModel:config=>{trace.factory++;trace.configs.push(config);return{
   initializeDeviceModel:async()=>{trace.initialize++;if(initialize)await initialize();},
   generateContent:async prompt=>{trace.generate++;trace.prompts.push(prompt);return generate?await generate(decision):{response:{inferenceSource:source,text:()=>JSON.stringify(decision)}};}
  };}
 });
 return{client,trace,decision};
}
test('local client with fake delegates only, never actual Firebase',async t=>{
 await t.test('missing API creates no SDK instance',async()=>{const f=fakeClient({availability:null});assert.equal((await f.client.prepare()).status,'blocked');assert.equal(f.trace.factory,0);});
 for(const availability of ['unavailable','downloadable','downloading'])await t.test(availability+' blocked before SDK initialization',async()=>{const f=fakeClient({availability});await f.client.prepare();assert.equal(f.trace.factory,0);assert.equal(f.trace.generate,0);});
 await t.test('configured only-device enum and accepted fake source',async()=>{const f=fakeClient();await f.client.prepare();assert.equal(f.trace.configs[0].mode,'only_on_device');assert.equal((await f.client.decide({revision:7})).status,'decision');f.client.stop();});
 await t.test('Close requests both native setup and prompt cancellation for the same owned lifetime',async()=>{
  const f=fakeClient();await f.client.prepare();const params=f.trace.configs[0].onDeviceParams;
  assert.equal(params.promptOptions.signal,params.createOptions.signal);assert.equal(params.promptOptions.signal.aborted,false);
  f.client.stop();assert.equal(params.promptOptions.signal.aborted,true);
 });
 await t.test('repair advice binds grounded semantic output to caller-owned action fields',async()=>{
  const f=fakeClient({generate:async()=>({response:{inferenceSource:'on_device',text:()=>JSON.stringify({needsMoreEvidence:false,evidenceId:'e1',sourceQuote:'if(cursor)',cause:'A truthy guard drops zero.',change:'Use a nullish guard.'})}})});
  await f.client.prepare({repairAdviceOnly:true});assert.equal(f.trace.configs[0].onDeviceParams.promptOptions.responseConstraint.properties.needsMoreEvidence.type,'boolean');
  const result=await f.client.decide({revision:7,allowedActions:['code','ask_user'],evidence:[{id:'e1',content:'if(cursor)'}],events:[]});
  assert.equal(result.decision.revision,7);assert.equal(result.decision.action,'code');assert.equal(result.decision.path,'');assert.equal(result.decision.artifactId,'');
  assert.deepEqual(result.decision.evidenceIds,['e1']);assert.match(result.decision.objective,/Observed source: "if\(cursor\)"/);f.client.stop();
  const invalid=fakeClient();await invalid.client.prepare({repairAdviceOnly:true});
  assert.equal((await invalid.client.decide({revision:7})).diagnostic,'output-fields');
  const full=fakeClient();await full.client.prepare();assert.equal((await full.client.decide({revision:7})).status,'decision');full.client.stop();
 });
 await t.test('unexpected source blocks, without claiming egress prevention',async()=>{const f=fakeClient({source:'fake-cloud'});await f.client.prepare();const r=await f.client.decide({revision:7});assert.equal(r.status,'blocked');assert.match(r.reason,/possible egress/);});
 await t.test('unprepared never generates',async()=>{const f=fakeClient();await f.client.decide({revision:7});assert.equal(f.trace.generate,0);});
 await t.test('stale output rejected',async()=>{const f=fakeClient({generate:async d=>({response:{inferenceSource:'on_device',text:()=>JSON.stringify({...d,revision:6})}})});await f.client.prepare();assert.equal((await f.client.decide({revision:7})).status,'blocked');f.client.stop();});
 await t.test('extra executing command rejected',async()=>{const f=fakeClient({generate:async d=>({response:{inferenceSource:'on_device',text:()=>JSON.stringify({...d,command:'anything'})}})});await f.client.prepare();assert.equal((await f.client.decide({revision:7})).status,'blocked');f.client.stop();});
 await t.test('inference delegate budget enforced',async()=>{const f=fakeClient({maxCalls:1});await f.client.prepare();await f.client.decide({revision:7});await f.client.decide({revision:7});assert.equal(f.trace.generate,1);f.client.stop();});
 await t.test('readiness loss prevents generation',async()=>{let n=0;const f=fakeClient({availability:()=>++n>2?'unavailable':'available'});await f.client.prepare();await f.client.decide({revision:7});assert.equal(f.trace.generate,0);f.client.stop();});
 await t.test('parallel initialization does not create a second model',async()=>{let release;const wait=new Promise(r=>release=r);const f=fakeClient({initialize:()=>wait});const first=f.client.prepare();await Promise.resolve();assert.equal((await f.client.prepare()).reason,'busy');release();assert.equal((await first).status,'prepared');assert.equal(f.trace.factory,1);f.client.stop();});
 await t.test('UTF8 size cap precedes generation',async()=>{const f=fakeClient();await f.client.prepare();assert.equal((await f.client.decide({revision:7,content:'é'.repeat(10000)})).status,'blocked');assert.equal(f.trace.generate,0);f.client.stop();});
 await t.test('unknown evidence citation rejected',async()=>{const f=fakeClient({generate:async d=>({response:{inferenceSource:'on_device',text:()=>JSON.stringify({...d,reasonEvidenceIds:['invented']})}})});await f.client.prepare();assert.equal((await f.client.decide({revision:7,evidence:[]})).status,'blocked');f.client.stop();});
 await t.test('flat decision maps to strict controller action',()=>assert.deepEqual(toControllerAction(fakeClient().decision),{revision:7,type:'test'}));
 await t.test('cancellation discards late output',async()=>{let release;const wait=new Promise(r=>release=r);const f=fakeClient({generate:async d=>{await wait;return{response:{inferenceSource:'on_device',text:()=>JSON.stringify(d)}};}});await f.client.prepare();const pending=f.client.decide({revision:7});await Promise.resolve();f.client.stop();release();assert.equal((await pending).status,'discarded');});
});

function syntheticGoodRecord(){
 return{kind:'actual-inference',taskId:'synthetic-fixture',arm:'default',
 pins:{comparisonPlanId:'synthetic-plan',machineAlias:'synthetic-machine',modelDigest:'synthetic-digest',modelQuant:'synthetic-quant',engineVersion:'synthetic-engine',effectiveTemplateHash:'synthetic-template',actualContext:'4096',harnessCommit:'synthetic-commit',taskInitialHash:'synthetic-initial',policyHash:'synthetic-policy'},
 finalWorkspaceHash:'f'.repeat(64),finalGrade:{kind:'independent-heldout-final',visibleToAgent:false,feedbackUsedForSelection:false,workspaceHash:'f'.repeat(64),checks:[{ok:true}]},
 scopeViolation:false,timedOut:false,wallMs:100,isolationVerified:true,
 localTransport:{remoteModel:false,taskTrafficObserved:true},
 resources:{combinedPeakRamBytes:1024,combinedPeakVramBytes:512,vramApplicable:true,loadOrder:'synthetic Nano then coder'}
 };
}
test('evidence ledger uses synthetic records, not measured results',async t=>{
 const schedule=balancedSchedule(['a','b','c']);
 await t.test('27 counterbalanced confirmation runs',()=>{assert.equal(schedule.length,27);for(const task of ['a','b','c'])for(const arm of ['default','deterministic','nano-controller'])for(const position of [1,2,3])assert.equal(schedule.filter(r=>r.taskId===task&&r.arm===arm&&r.position===position).length,1);});
 const cases=[
  ['reference record cannot count as inference',r=>r.kind='reference-only','taskVerified'],
  ['mock delegate cannot qualify profile',r=>r.kind='mock-delegate','profileEligible'],
  ['missing pin rejected',r=>delete r.pins.modelDigest,'taskVerified'],
  ['agent claim is not grading',r=>r.finalGrade.kind='agent-claimed','taskVerified'],
  ['public checks are not final hidden grading',r=>r.finalGrade.kind='public-checks','taskVerified'],
  ['agent-visible grader rejected',r=>r.finalGrade.visibleToAgent=true,'taskVerified'],
  ['confirmation feedback contamination rejected',r=>r.finalGrade.feedbackUsedForSelection=true,'taskVerified'],
  ['stale grading revision rejected',r=>r.finalGrade.workspaceHash='old','taskVerified'],
  ['failed final check rejected',r=>r.finalGrade.checks[0].ok=false,'taskVerified'],
  ['timeout not success',r=>r.timedOut=true,'taskVerified'],
  ['scope violation not success',r=>r.scopeViolation=true,'taskVerified'],
  ['remote localhost model not local fit',r=>r.localTransport.remoteModel=true,'profileEligible'],
  ['missing combined RAM not measured fit',r=>r.resources.combinedPeakRamBytes=null,'profileEligible'],
  ['missing Nano identity not qualifying Nano arm',r=>r.arm='nano-controller','profileEligible']
 ];
 for(const [name,change,key]of cases)await t.test(name,()=>{const r=syntheticGoodRecord();change(r);assert.equal(evaluateRecord(r)[key],false);});
 await t.test('internally consistent supplied record can qualify, not attest truth',()=>assert.equal(evaluateRecord(syntheticGoodRecord()).profileEligible,true));
 await t.test('different machines never pooled',()=>{const a=syntheticGoodRecord(),b=syntheticGoodRecord();b.pins.machineAlias='other';assert.equal(Object.keys(summarize([a,b]).cohorts).length,2);});
 await t.test('synthetic reference summary contains no actual pass',()=>{const r=syntheticGoodRecord();r.kind='reference-only';const group=Object.values(summarize([r]).cohorts)[0].default;assert.equal(group.actualRecords,0);assert.equal(group.taskPasses,0);});
});

test('scripted-provider pipeline applies authored corrections, not model code',async()=>{
 for(const task of getTasks()){
  const grade=await runAuthoredChecks(task.id,'corrected');
  const controller=new ReferenceController({files:task.files,writable:task.writable,taskText:task.prompt,suiteId:task.id,checkIds:grade.checks.map(c=>c.id)});
  let snapshot;let fakeCalls=0;
  const client=new LocalDecisionClient({
   languageModel:()=>({availability:async()=> 'available'}),onlyOnDevice:'only_on_device',onDeviceSource:'on_device',
   createModel:()=>({initializeDeviceModel:async()=>{},generateContent:async()=>{
    fakeCalls++;const s=snapshot;
    let action='finish',path='',artifactId='',evidenceIds=[],objective='';
    const unread=s.manifest.find(m=>!s.evidence.some(e=>e.path===m.path&&e.sha256===m.sha256));
    if(!s.counts.patches&&unread){action='read';path=unread.path;}
    else if(!s.counts.coder){action='code';evidenceIds=s.evidence.map(e=>e.id);objective=task.prompt;}
    else if(!s.counts.patches){action='apply';artifactId=s.artifacts[0];}
    else if(!s.publicChecksCurrent)action='test';
    return{response:{inferenceSource:'on_device',text:()=>JSON.stringify({revision:s.revision,action,path,artifactId,evidenceIds,objective,reasonEvidenceIds:[]})}};
   }})
  });
  assert.equal((await client.prepare()).status,'prepared');
  for(let turn=0;turn<15&&!controller.snapshot().closed;turn++){
   snapshot=controller.snapshot();
   const r=await client.decide(snapshot);assert.equal(r.status,'decision');
   const op=controller.decide(toControllerAction(r.decision));
   if(op.type==='read')controller.complete(op.id,{content:controller.filesForReferenceTest()[op.request.path]});
   if(op.type==='code'){
    const before=controller.filesForReferenceTest();
    controller.complete(op.id,{edits:Object.entries(task.correction).map(([path,replace])=>({path,beforeSha256:hash(before[path]),find:before[path],replace}))});
   }
   if(op.type==='test'){
    // The test compares actual in-memory bytes to the authored correction before using authored checks.
    assert.deepEqual(controller.filesForReferenceTest(),{...task.files,...task.correction});
    const checks=(await runAuthoredChecks(task.id,'corrected')).checks.map(({id,ok})=>({id,ok}));
    controller.complete(op.id,{suiteId:task.id,workspaceHash:op.request.workspaceHash,checks});
   }
  }
  assert.equal(controller.snapshot().closed,true);
  assert.ok(fakeCalls>0);client.stop();
 }
});
