'use strict';
// Independent-review regressions. All data/providers are authored; no model/network/untrusted code runs.
const test=require('node:test');
const assert=require('node:assert/strict');
const {ReferenceController,hash}=require('../src/controller.cjs');
const {LocalDecisionClient}=require('../src/firebase-local-client.cjs');
const {evaluateRecord,summarize}=require('../src/evidence-ledger.cjs');

function record(){
 const final='f'.repeat(64);
 return{kind:'actual-inference',taskId:'authored-ledger-fixture',arm:'default',
  pins:{comparisonPlanId:'authored-plan',machineAlias:'authored-machine',modelDigest:'authored-digest',
   modelQuant:'authored-quant',engineVersion:'authored-engine',effectiveTemplateHash:'authored-template',
   actualContext:'4096',harnessCommit:'authored-commit',taskInitialHash:'authored-initial',policyHash:'authored-policy'},
  finalWorkspaceHash:final,finalGrade:{kind:'independent-heldout-final',visibleToAgent:false,
   feedbackUsedForSelection:false,workspaceHash:final,checks:[{ok:true}]},
  scopeViolation:false,timedOut:false,wallMs:100,isolationVerified:true,
  localTransport:{remoteModel:false,taskTrafficObserved:true},
  resources:{combinedPeakRamBytes:1024,combinedPeakVramBytes:512,vramApplicable:true,loadOrder:'authored order'}
 };
}
test('review: absent final workspace hashes never qualify',()=>{
 const r=record();delete r.finalWorkspaceHash;delete r.finalGrade.workspaceHash;
 const result=evaluateRecord(r);assert.equal(result.taskVerified,false);assert.equal(result.profileEligible,false);
});
test('review: malformed or non-string workspace hashes never qualify',()=>{
 for(const value of [undefined,null,'',{},[],1,true,'not-a-hash','a'.repeat(63),'g'.repeat(64)]){
  const r=record();r.finalWorkspaceHash=value;r.finalGrade.workspaceHash=value;
  assert.equal(evaluateRecord(r).taskVerified,false);
  assert.equal(evaluateRecord(r).profileEligible,false);
 }
 assert.equal(evaluateRecord(record()).profileEligible,true); // Supplied fixture consistency, not truth attestation.
});
test('review: unknown and prototype-shaped arms rejected before aggregation',()=>{
 const before=Object.getOwnPropertyDescriptors(Object.prototype);
 const invalid=['other','__proto__','constructor',undefined,null].map(arm=>({...record(),arm}));
 for(const r of invalid){assert.equal(evaluateRecord(r).taskVerified,false);assert.equal(evaluateRecord(r).profileEligible,false);}
 let summary;
 assert.doesNotThrow(()=>{summary=summarize([...invalid,record()]);});
 assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype),before);
 assert.equal(summary.rejected.length,invalid.length);
 assert.equal(Object.getPrototypeOf(summary.cohorts),null);
 const groups=Object.values(summary.cohorts);assert.equal(groups.length,1);
 assert.equal(Object.getPrototypeOf(groups[0]),null);
 assert.equal(groups[0].default.records,1);
});
test('review: different policies are not silently pooled for the same arm',()=>{
 const a=record(),b=record();b.pins.policyHash='another-authored-policy';
 const summary=summarize([a,b]);
 assert.equal(Object.keys(summary.cohorts).length,2);
 for(const group of Object.values(summary.cohorts))assert.equal(group.default.records,1);
});

test('review: overlapping exact matches rejected without changing files',()=>{
 const files={'src/a.js':'aaa'};
 const c=new ReferenceController({files,writable:['src/a.js'],taskText:'Authored overlap regression.',
  suiteId:'authored-public',checkIds:['a']});
 const act=(type,extra={})=>c.decide({revision:c.snapshot().revision,type,...extra});
 const read=act('read',{path:'src/a.js'});c.complete(read.id,{content:'aaa'});
 const code=act('code',{evidenceIds:['e:'+read.id],objective:'Authored next-step hint.'});
 c.complete(code.id,{edits:[{path:'src/a.js',beforeSha256:hash('aaa'),find:'aa',replace:'b'}]});
 const before=c.filesForReferenceTest();
 assert.throws(()=>act('apply',{artifactId:'a:'+code.id}),/ambiguous exact replacement/);
 assert.deepEqual(c.filesForReferenceTest(),before);
 assert.equal(c.snapshot().counts.patches,0);
});

function dependencies({omitReturnedSource=false}={}){
 const trace={availability:0,factory:0,generate:0,configs:[]};
 const decision={revision:1,action:'test',path:'',artifactId:'',evidenceIds:[],objective:'',reasonEvidenceIds:[]};
 const deps={
  onlyOnDevice:'only_on_device',onDeviceSource:'on_device',
  languageModel:()=>({availability:async()=>{trace.availability++;return'available';}}),
  createModel:config=>{trace.factory++;trace.configs.push(config);return{
   initializeDeviceModel:async()=>{},
   generateContent:async()=>{
    trace.generate++;
    const result={response:{text:()=>JSON.stringify(decision)}};
    if(!omitReturnedSource)result.response.inferenceSource='on_device';
    return result;
   }
  };}
 };
 return{deps,trace};
}
test('review: missing mode/source dependencies rejected before any provider action',()=>{
 for(const field of ['onlyOnDevice','onDeviceSource']){
  const f=dependencies();delete f.deps[field];
  assert.throws(()=>new LocalDecisionClient(f.deps),TypeError);
  assert.equal(f.trace.availability,0);assert.equal(f.trace.factory,0);assert.equal(f.trace.generate,0);
 }
});
test('review: invalid mode/source constants rejected before any provider action',()=>{
 const cases=[
  ['onlyOnDevice','prefer_on_device'],['onlyOnDevice','only_in_cloud'],['onlyOnDevice','prefer_in_cloud'],
  ['onlyOnDevice','ONLY_ON_DEVICE'],['onlyOnDevice',''],['onlyOnDevice',null],['onlyOnDevice',{}],
  ['onDeviceSource','in_cloud'],['onDeviceSource','ON_DEVICE'],['onDeviceSource',''],['onDeviceSource',null],['onDeviceSource',{}]
 ];
 for(const [field,value]of cases){
  const f=dependencies();f.deps[field]=value;
  assert.throws(()=>new LocalDecisionClient(f.deps),TypeError);
  assert.equal(f.trace.availability,0);assert.equal(f.trace.factory,0);assert.equal(f.trace.generate,0);
 }
});
test('review: missing returned provenance rejected; not a proof of prevented egress',async()=>{
 const f=dependencies({omitReturnedSource:true}),client=new LocalDecisionClient(f.deps);
 assert.equal((await client.prepare()).status,'prepared');
 const result=await client.decide({revision:1});
 assert.equal(f.trace.generate,1); // Fake delegate already ran; rejection is not a pre-transmission claim.
 assert.equal(result.status,'blocked');assert.match(result.reason,/possible egress/);
 assert.equal(client.state.prepared,false);
});
test('review: validated local-only constants cannot change through the caller object',async()=>{
 const f=dependencies(),client=new LocalDecisionClient(f.deps);
 f.deps.onlyOnDevice='prefer_on_device';f.deps.onDeviceSource=undefined;
 assert.equal((await client.prepare()).status,'prepared');
 assert.equal(f.trace.configs[0].mode,'only_on_device');
 assert.equal((await client.decide({revision:1})).status,'decision');
 client.stop();
});
