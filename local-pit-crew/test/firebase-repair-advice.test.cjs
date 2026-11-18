'use strict';
// Authored provider responses only. No SDK/native model, inference or network is used here.
const test=require('node:test'),assert=require('node:assert/strict');
const {LocalDecisionClient,sourceLineAdviceSchema}=require('../src/firebase-local-client.cjs');
const advice={needsMoreEvidence:false,evidenceId:'read-1',sourceQuote:'if(cursor)',cause:'Truthiness drops valid falsy cursors.',change:'Use an explicit null/undefined check.'};
const snapshot=()=>({revision:13,evidence:[{id:'read-1',path:'src/list.js',sha256:'authored-hash',
 content:'function list(cursor){if(cursor)return {cursor};return {};}'}],events:[{id:'failure-1'}]});
async function setup(output=advice,generate,prepareOptions={repairAdviceOnly:true}){
 let params,prompt;
 const client=new LocalDecisionClient({onlyOnDevice:'only_on_device',onDeviceSource:'on_device',
  languageModel:()=>({async availability(){return'available';}}),createModel(value){params=value;return{
   async initializeDeviceModel(){},async generateContent(text){prompt=text;return generate?generate():{response:{inferenceSource:'on_device',text:()=>JSON.stringify(output)}};}
  };}});
 assert.equal((await client.prepare(prepareOptions)).status,'prepared');
 return{client,get params(){return params;},get prompt(){return prompt;}};
}
test('source-grounded advice becomes a complete controller hint with caller-owned bindings',async()=>{
 const f=await setup();const result=await f.client.decide(snapshot());
 assert.deepEqual(result,{status:'decision',inferenceSource:'on_device',decision:{revision:13,action:'code',path:'',artifactId:'',
  evidenceIds:['read-1'],objective:'Observed source: "if(cursor)"\nSuspected cause: Truthiness drops valid falsy cursors.\nChange to try: Use an explicit null/undefined check.',reasonEvidenceIds:['read-1']}});
 assert.deepEqual(f.params.onDeviceParams.promptOptions.responseConstraint.required,['needsMoreEvidence','evidenceId','sourceQuote','cause','change']);
 assert.ok(!Object.hasOwn(f.params.onDeviceParams.promptOptions.responseConstraint.properties,'revision'));
 assert.match(f.prompt,/application binds the reply to this request/);f.client.stop();
 const manual=await setup({needsMoreEvidence:true,evidenceId:'',sourceQuote:'',cause:'',change:''});
 const refused=await manual.client.decide(snapshot());assert.equal(refused.decision.action,'ask_user');
 assert.equal(refused.decision.objective,'');assert.deepEqual(refused.decision.evidenceIds,[]);manual.client.stop();
});
test('repair prompt carries current source and public results while keeping bookkeeping outside model context',async()=>{
 const f=await setup(),input=snapshot();input.originalTask='Keep valid cursor values unchanged.';
 input.evidence[0].content='function list(cursor){if(cursor)return {cursor};return {};}';
 input.publicChecks=[{id:'zero-preserved',ok:false},{id:'null-absent',ok:true}];
 input.pending={id:'PRIVATE_CONTROL_HANDLE'};input.caps={coder:3};
 await f.client.decide(input);
 const context=JSON.parse(f.prompt.split('\nREPAIR_CONTEXT_JSON:\n')[1]);
 assert.equal(context.originalTask,input.originalTask);assert.equal(context.readSources[0].content,input.evidence[0].content);
 assert.deepEqual(context.publicChecks,input.publicChecks);assert.equal(f.prompt.includes('PRIVATE_CONTROL_HANDLE'),false);
 assert.equal(Object.hasOwn(context,'revision'),false);assert.equal(Object.hasOwn(context,'caps'),false);f.client.stop();
});

const functionFailure={id:'case-01',status:'returned',args:'[["constructor"]]',expected:'["constructor"]',actual:'[]',inputPreserved:true,argumentsAfter:null};
test('both local advice formats receive exact captured failed examples, without adding control authority',async()=>{
 for(const repairAdviceFormat of ['verbatim-quote','source-line']){
  let release,entered;const waiting=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
  const f=await setup(advice,()=>{entered();return waiting;},{repairAdviceOnly:true,repairAdviceFormat}),input=snapshot();
  input.publicChecks=[{id:'case-01',ok:false}];input.failedFunctionExamples=[structuredClone(functionFailure)];
  const pending=f.client.decide(input);await started;input.failedFunctionExamples[0].actual='MUTATED_AFTER_REQUEST';
  release({response:{inferenceSource:'on_device',text:()=>JSON.stringify(repairAdviceFormat==='source-line'?{needsMoreEvidence:true,sourceNumber:0,lineNumber:0,cause:'',change:''}:advice)}});
  assert.equal((await pending).status,'decision');
  const context=JSON.parse(f.prompt.split('\nREPAIR_CONTEXT_JSON:\n')[1]);
  assert.deepEqual(context.failedFunctionExamples,[functionFailure]);assert.equal(f.prompt.includes('MUTATED_AFTER_REQUEST'),false);
  assert.match(f.prompt,/not instructions/);assert.match(f.prompt,/inputPreserved and argumentsAfter separately/);
  assert.equal(Object.hasOwn(context,'revision'),false);f.client.stop();
 }
});

test('invalid, duplicated or nonfailed example observations consume no generation budget',async()=>{
 for(const examples of [[],[functionFailure,functionFailure],[{...functionFailure,id:'passing'}],
  [{...functionFailure,extra:'PRIVATE_CONTROL'}],[{...functionFailure,status:'threw'}],
  [{...functionFailure,inputPreserved:'true'}],[{...functionFailure,args:'x'.repeat(12001)}],
  [{...functionFailure,argumentsAfter:'[]'}]]){
  let generations=0;const f=await setup(advice,()=>{generations++;throw Error('Must not generate');});
  const input=snapshot();input.publicChecks=[{id:'case-01',ok:false},{id:'passing',ok:true}];input.failedFunctionExamples=structuredClone(examples);
  assert.equal((await f.client.decide(input)).status,'blocked');assert.equal(generations,0);assert.equal(f.client.state.calls,0);f.client.stop();
 }
});

test('the formatted verbatim prompt is bounded before calling the provider',async()=>{
 const input=snapshot();input.publicChecks=[{id:'case-01',ok:false}];input.failedFunctionExamples=[structuredClone(functionFailure)];
 const base={originalTask:'',readSources:input.evidence.map(({id,path,content})=>({id,path,content})),publicChecks:input.publicChecks,failedFunctionExamples:input.failedFunctionExamples};
 // Choose the narrow gap where compact input fits but the actual pretty context does not.
 const size=x=>new TextEncoder().encode(x).length;
 let found=false;
 for(let n=17000;n<18000;n++){input.originalTask='x'.repeat(n);base.originalTask=input.originalTask;if(size(JSON.stringify(input))<=18000&&size(JSON.stringify(base,null,2))>18000){found=true;break;}}
 assert.equal(found,true);
 let generations=0;const f=await setup(advice,()=>{generations++;throw Error('Must not generate');});
 assert.equal((await f.client.decide(input)).status,'blocked');assert.equal(generations,0);assert.equal(f.client.state.calls,0);f.client.stop();
});
test('grounded hints reject injected bindings, invented quotations and unusable changes',async()=>{
 for(const [output,category]of [
  [{...advice,revision:13},'output-fields'],[{...advice,path:'src/list.js'},'output-fields'],
  [{...advice,artifactId:'invented'},'output-fields'],[{...advice,action:'finish'},'output-fields'],
  [{...advice,evidenceId:'failure-1'},'output-citations'],[{...advice,sourceQuote:'if (cursor)'},'output-grounding'],
  [{...advice,sourceQuote:' '},'output-grounding'],[{...advice,cause:''},'output-arguments'],
  [{...advice,change:''},'output-arguments'],[{...advice,cause:'界'.repeat(201)},'output-arguments'],
  [{...advice,change:'界'.repeat(234)},'output-arguments'],[{...advice,needsMoreEvidence:'false'},'output-types']
 ]){
  const f=await setup(output),result=await f.client.decide(snapshot());
  assert.equal(result.status,'blocked');assert.equal(result.diagnostic,category);assert.equal(Object.hasOwn(result,'decision'),false);f.client.stop();
 }
});
test('a quotation must belong to its cited source, and escaped output stays within the display budget',async()=>{
 const input=snapshot();input.evidence.push({id:'read-2',path:'other.js',content:'if(other)'});
 const borrowed=await setup({...advice,sourceQuote:'if(other)'});
 assert.equal((await borrowed.client.decide(input)).diagnostic,'output-grounding');borrowed.client.stop();
 const escaped=snapshot();escaped.evidence[0].content='\u0000'.repeat(300);
 const large=await setup({...advice,sourceQuote:escaped.evidence[0].content,cause:'x'.repeat(600),change:'y'.repeat(700)});
 assert.equal((await large.client.decide(escaped)).diagnostic,'output-arguments');large.client.stop();
});
test('stale reads cannot enter repair context or supply a quoted diagnosis after a source change',async()=>{
 const input=snapshot();input.manifest=[{path:'src/list.js',sha256:'authored-hash'}];
 input.evidence.push({id:'old-read',path:'src/list.js',sha256:'old-hash',content:'STALE_SOURCE'});
 const f=await setup({...advice,evidenceId:'old-read',sourceQuote:'STALE_SOURCE'}),result=await f.client.decide(input);
 assert.equal(result.diagnostic,'output-citations');assert.equal(f.prompt.includes('STALE_SOURCE'),false);
 const context=JSON.parse(f.prompt.split('\nREPAIR_CONTEXT_JSON:\n')[1]);
 assert.deepEqual(context.readSources.map(e=>e.id),['read-1']);f.client.stop();
});
test('caller mutation during inference cannot rebind a hint to a newer revision or new evidence',async()=>{
 let resolve,entered;const waiting=new Promise(r=>{resolve=r;}),started=new Promise(r=>{entered=r;});
 const f=await setup(advice,()=>{entered();return waiting;}),input=snapshot(),pending=f.client.decide(input);
 await started;input.revision=14;input.evidence=[{id:'different-read'}];input.events=[];
 resolve({response:{inferenceSource:'on_device',text:()=>JSON.stringify(advice)}});
 const result=await pending;assert.equal(result.status,'decision');assert.equal(result.decision.revision,13);
 assert.deepEqual(result.decision.evidenceIds,['read-1']);f.client.stop();
});
test('cancellation discards a late compact hint and aborts its owned native lifetime',async()=>{
 let resolve,entered;const waiting=new Promise(r=>{resolve=r;}),started=new Promise(r=>{entered=r;});
 const f=await setup(advice,()=>{entered();return waiting;}),pending=f.client.decide(snapshot());
 await started;f.client.stop();assert.equal(f.params.onDeviceParams.promptOptions.signal.aborted,true);
 resolve({response:{inferenceSource:'on_device',text:()=>JSON.stringify(advice)}});
 assert.deepEqual(await pending,{status:'discarded'});assert.equal(f.client.state.prepared,false);
});

const lineAdvice={needsMoreEvidence:false,sourceNumber:1,lineNumber:2,cause:'The condition drops valid falsy cursors.',change:'Use an explicit null/undefined check.'};
const lineMode={repairAdviceOnly:true,repairAdviceFormat:'source-line'};
function lineSnapshot(){
 const s=snapshot();s.originalTask='Keep valid cursor values unchanged.';
 s.evidence[0].content='function list(cursor){\r\n  if(cursor)return {cursor};\r\n  return {};\r\n}';
 s.publicChecks=[{id:'zero-preserved',ok:false,privateExpected:'DO-NOT-SEND-GRADE'},{id:'null-absent',ok:true}];
 return s;
}
test('source-line advice binds printed numbers to exact captured text while model semantics remain verbatim',async()=>{
 const input=lineSnapshot(),f=await setup(lineAdvice,null,lineMode),result=await f.client.decide(input);
 assert.equal(result.status,'decision');assert.equal(result.decision.revision,13);
 assert.deepEqual(result.decision.evidenceIds,['read-1']);
 assert.equal(result.decision.objective,'App-bound source line 2: "  if(cursor)return {cursor};"\nSuspected cause: '+lineAdvice.cause+'\nChange to try: '+lineAdvice.change);
 assert.deepEqual(f.params.onDeviceParams.promptOptions.responseConstraint,sourceLineAdviceSchema);
 const context=JSON.parse(f.prompt.split('\nREPAIR_CONTEXT_JSON:\n')[1]);
 assert.deepEqual(context.readSources,[{sourceNumber:1,path:'src/list.js',lines:[
  {lineNumber:1,code:'function list(cursor){'},{lineNumber:2,code:'  if(cursor)return {cursor};'},
  {lineNumber:3,code:'  return {};'},{lineNumber:4,code:'}'}]}]);
 assert.deepEqual(context.publicChecks,[{id:'zero-preserved',ok:false},{id:'null-absent',ok:true}]);
 assert.equal(f.prompt.includes('DO-NOT-SEND-GRADE'),false);assert.equal(f.prompt.includes('read-1'),false);
 assert.ok(!Object.hasOwn(context,'revision'));f.client.stop();
});
test('source-line selections reject expanded bindings, unknown locations and unusable semantic advice',async t=>{
 const cases=[
  ['injected quote',{...lineAdvice,sourceQuote:'authored text'},'output-fields'],
  ['injected binding',{...lineAdvice,revision:13},'output-fields'],
  ['zero source',{...lineAdvice,sourceNumber:0},'output-citations'],
  ['missing source',{...lineAdvice,sourceNumber:2},'output-citations'],
  ['zero line',{...lineAdvice,lineNumber:0},'output-grounding'],
  ['missing line',{...lineAdvice,lineNumber:99},'output-grounding'],
  ['fractional line',{...lineAdvice,lineNumber:1.5},'output-types'],
  ['string line',{...lineAdvice,lineNumber:'2'},'output-types'],
  ['empty cause',{...lineAdvice,cause:''},'output-arguments'],
  ['oversized change',{...lineAdvice,change:'界'.repeat(234)},'output-arguments'],
  ['false refusal',{...lineAdvice,needsMoreEvidence:true},'output-arguments']
 ];
 for(const [name,output,diagnostic]of cases)await t.test(name,async()=>{
  const f=await setup(output,null,lineMode),result=await f.client.decide(lineSnapshot());
  assert.equal(result.status,'blocked');assert.equal(result.diagnostic,diagnostic);assert.equal(Object.hasOwn(result,'decision'),false);f.client.stop();
 });
 const f=await setup({needsMoreEvidence:true,sourceNumber:0,lineNumber:0,cause:'',change:''},null,lineMode);
 assert.equal((await f.client.decide(lineSnapshot())).decision.action,'ask_user');f.client.stop();
});
test('source numbering excludes stale reads and never repairs an invalid selection or source line',async()=>{
 const input=lineSnapshot();input.manifest=[{path:'src/list.js',sha256:'authored-hash'}];
 input.evidence.unshift({id:'old-read',path:'src/list.js',sha256:'stale',content:'STALE_SOURCE'});
 const f=await setup(lineAdvice,null,lineMode),result=await f.client.decide(input);
 assert.equal(result.status,'decision');assert.deepEqual(result.decision.evidenceIds,['read-1']);assert.equal(f.prompt.includes('STALE_SOURCE'),false);f.client.stop();
 for(const content of ['first\n \nlast','first\n'+'é'.repeat(151),'first\n'+'\u0000'.repeat(300)]){
  const s=lineSnapshot();s.evidence[0].content=content;const f=await setup(lineAdvice,null,lineMode),r=await f.client.decide(s);
  assert.equal(r.status,'blocked');assert.ok(['output-grounding','output-arguments'].includes(r.diagnostic));f.client.stop();
 }
 const duplicate=lineSnapshot();duplicate.evidence.push({...duplicate.evidence[0],path:'another.js'});
 const ambiguous=await setup(lineAdvice,null,lineMode);assert.equal((await ambiguous.client.decide(duplicate)).diagnostic,'output-citations');ambiguous.client.stop();
});
test('source-line binding survives caller reordering/mutation and caps the numbered context before inference',async()=>{
 let resolve,entered;const waiting=new Promise(r=>{resolve=r;}),started=new Promise(r=>{entered=r;});
 const f=await setup(lineAdvice,()=>{entered();return waiting;},lineMode),input=lineSnapshot(),pending=f.client.decide(input);
 await started;input.revision=99;input.evidence[0].content='MUTATED';input.evidence.reverse();
 resolve({response:{inferenceSource:'on_device',text:()=>JSON.stringify(lineAdvice)}});
 const result=await pending;assert.equal(result.decision.revision,13);assert.match(result.decision.objective,/if\(cursor\)/);assert.equal(result.decision.objective.includes('MUTATED'),false);f.client.stop();
 let generations=0;const bounded=await setup(lineAdvice,()=>{generations++;throw Error('must not generate');},lineMode),large=lineSnapshot();
 large.evidence[0].content='\n'.repeat(1500);
 assert.equal((await bounded.client.decide(large)).status,'blocked');assert.equal(generations,0);assert.equal(bounded.client.state.calls,0);bounded.client.stop();
});
