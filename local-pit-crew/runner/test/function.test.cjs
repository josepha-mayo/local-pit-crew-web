'use strict';
// Real QuickJS/WASM workers. This is not Docker qualification or model efficacy.
const test=require('node:test'),assert=require('node:assert/strict');
const {runCandidateProbe}=require('../probe.cjs');
const {TASK_SCHEMA,FUNCTION_SUITE,FUNCTION_ENTRY,CONTRACT_PATH,createFunctionTask,gradeFunctionObservations,inspectFunctionObservations}=require('../function-contract.cjs');
const spec=(source,cases)=>({schema:TASK_SCHEMA,title:'Own function',instructions:'Return the expected data and preserve the input values.',exportName:'fn',source,cases:cases.map((c,i)=>({label:'Example '+(i+1),...c}))});
const input=task=>({suiteId:FUNCTION_SUITE,files:task.files});
const run=(source,cases)=>runCandidateProbe(input(createFunctionTask(spec(source,cases))));
const check=result=>{assert.equal(result.status,'observed',JSON.stringify(result));assert.equal(result.cleanupConfirmed,true);return result.checks;};
test('shared browser and Node function executor retains the fixed interpreter limits',()=>{
 const {FUNCTION_LIMITS}=require('../function-executor.cjs'),{POLICY}=require('../policy.cjs');
 for(const key of ['guestMemoryBytes','guestStackBytes','guestExecutionMs'])assert.equal(FUNCTION_LIMITS[key],POLICY[key]);
 assert.equal(Object.isFrozen(FUNCTION_LIMITS),true);
});

test('function intake produces one editable module and immutable bounded example data without executing source',()=>{
 const task=createFunctionTask(spec("throw Error('SOURCE_MUST_NOT_RUN_DURING_INTAKE');",[{args:[0],expected:0}]));
 assert.equal(task.id,FUNCTION_SUITE);assert.deepEqual(task.writable,[FUNCTION_ENTRY]);assert.deepEqual(task.checkIds,['case-01']);
 assert.equal(JSON.parse(task.files[CONTRACT_PATH]).cases[0].expected,0);assert.equal(Object.isFrozen(task.files),true);
 let touched=0;const getter=spec('module.exports={fn:x=>x};',[{args:[],expected:null}]);Object.defineProperty(getter,'source',{get(){touched++;throw Error('PRIVATE');}});
 assert.throws(()=>createFunctionTask(getter),/invalid-function-contract/);assert.equal(touched,0);
 for(const bad of [
  {...spec('module.exports={fn:x=>x};',[{args:[],expected:null}]),cases:[]},
  spec('module.exports={fn:x=>x};',Array.from({length:9},()=>({args:[],expected:0}))),
  spec('module.exports={fn:x=>x};',[{args:[],expected:undefined}]),
  spec('module.exports={fn:x=>x};',[{args:[],expected:NaN}]),
  {...spec('module.exports={fn:x=>x};',[{args:[],expected:0}]),execute:'caller callback'},
  {...spec('module.exports={fn:x=>x};',[{args:[],expected:0}]),exportName:'constructor'}
 ])assert.throws(()=>createFunctionTask(bad));
});

test('real function observations preserve JSON types, nested data, Unicode, NUL and object-key order independence',async()=>{
 const examples=[{args:[0],expected:0},{args:[false],expected:false},{args:[null],expected:null},{args:[''],expected:''},
  {args:['日本語 😀 café\u0000tail'],expected:'日本語 😀 café\u0000tail'},{args:[{b:[2,{text:'x'}],a:1}],expected:{a:1,b:[2,{text:'x'}]}}];
 assert.ok(check(await run('module.exports={fn:x=>x};',examples)).every(c=>c.ok));
 const ordered=await run('module.exports={fn:()=>({b:2,a:1})};',[{args:[],expected:{a:1,b:2}}]);assert.equal(check(ordered)[0].ok,true);
});

test('a correct return value cannot conceal input mutation, including nested negative zero',async()=>{
 const sorted=await run('module.exports={fn:items=>items.sort()};',[{args:[['b','a']],expected:['a','b']}]);assert.equal(check(sorted)[0].ok,false);
 const zero=await run('module.exports={fn:obj=>{obj.value=-0;return true;}};',[{args:[{value:0}],expected:true}]);assert.equal(check(zero)[0].ok,false);
 const clean=await run('module.exports={fn:items=>[...items].sort()};',[{args:[['b','a']],expected:['a','b']}]);assert.equal(check(clean)[0].ok,true);
});

test('guest poisoning cannot forge serialization, arguments or expected-answer agreement',async()=>{
 const source="Object.prototype.toJSON=()=>({safe:true});Array.prototype.toJSON=()=>['forged'];JSON.stringify=()=>'{\"safe\":true}';JSON.parse=()=>['forged'];Object.getOwnPropertyDescriptors=()=>({});module.exports={fn:()=>({safe:false})};";
 const result=await run(source,[{args:['actual'],expected:{safe:true}}]);assert.equal(check(result)[0].ok,false);
 assert.equal(result.observations[0].output,'{"safe":false}');assert.equal(result.observations[0].argsAfter,'["actual"]');
 const hidden=await run('module.exports={fn:()=>[typeof expected,typeof contract,typeof process,typeof require,typeof fetch,typeof Worker]};',
  [{args:[],expected:Array(6).fill('undefined')}]);assert.equal(check(hidden)[0].ok,true);
});

test('normal throws and non-data returns fail examples without exposing error contents or self-reported verdicts',async()=>{
 for(const source of ["module.exports={fn:()=>{throw Error('PRIVATE_ERROR');}};",'module.exports={fn:()=>undefined};',
  'module.exports={fn:()=>{const x={};x.self=x;return x;}};','module.exports={fn:()=>({get secret(){throw Error("PRIVATE_GETTER");}})};']){
  const result=await run(source,[{args:[],expected:null}]);assert.equal(check(result)[0].ok,false);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
 }
 const task=createFunctionTask(spec('module.exports={fn:x=>x};',[{args:[1],expected:1}]));
 const forged=[{id:'case-01',status:'returned',output:'1',argsAfter:'[1]',passed:true}];assert.throws(()=>gradeFunctionObservations(forged,task.files));
 assert.throws(()=>gradeFunctionObservations([{id:'made-up',status:'returned',output:'1',argsAfter:'[1]'}],task.files));
});

test('an expected application error code still requires an actual throw and unchanged inputs',async()=>{
 const source=`module.exports.fn=input=>{
  if(input==='SLUG')return 'slug';
  if(input.mode==='returned')return{code:'INVALID_SLUG'};
  if(input.mode==='inherited')throw Object.create({code:'INVALID_SLUG'});
  const error=new TypeError('PRIVATE_ERROR_MESSAGE');
  if(input.mode==='getter')Object.defineProperty(error,'code',{get(){input.touched=true;return 'INVALID_SLUG';}});
  else if(input.mode!=='uncoded')error.code=input.mode==='wrong'?'PRIVATE_WRONG_CODE':'INVALID_SLUG';
  if(input.mode==='mutated')input.changed=true;
  throw error;
 };`;
 const modes=['matching','mutated','wrong','getter','inherited','returned','uncoded'];
 const cases=[{args:['SLUG'],expected:'slug'},...modes.map(mode=>({args:[{mode}],throws:'INVALID_SLUG'}))];
 const task=createFunctionTask(spec(source,cases)),result=await runCandidateProbe(input(task));
 assert.deepEqual(check(result).map(row=>row.ok),[true,true,false,false,false,false,false,false]);
 const diagnostics=inspectFunctionObservations(result.observations,task.files);
 assert.equal(diagnostics[2].returnMatches,true);
 assert.equal(diagnostics[2].inputPreserved,false);
 assert.equal(diagnostics[4].inputPreserved,true);
 assert.equal(diagnostics[4].returnMatches,false);
 assert.doesNotMatch(JSON.stringify(diagnostics),/PRIVATE_ERROR_MESSAGE|PRIVATE_WRONG_CODE|errorCode/);
 for(const example of [{throws:true},{throws:'bad-code'},{throws:'A'.repeat(65)},{throws:'INVALID_SLUG',expected:null}]){
  assert.throws(()=>createFunctionTask(spec(source,[{args:[],...example}])),/invalid-function-contract/);
 }
 const exhausted=await run('module.exports.fn=()=>{while(true){}};',[{args:[],throws:'INVALID_SLUG'}]);
 assert.notEqual(exhausted.status,'observed');
});

test('untrusted function loops and allocation remain unavailable outcomes, never fabricated failed examples',async()=>{
 for(const source of ['while(true){};','module.exports={fn:()=>{while(true){}}};',
  'module.exports={fn:()=>{const xs=[];while(true)xs.push(new Array(10000).fill(1));}};']){
  const result=await run(source,[{args:[],expected:0}]);assert.notEqual(result.status,'observed');assert.equal(result.checks,undefined);assert.equal(result.cleanupConfirmed,true);
 }
 assert.ok(check(await run('module.exports={fn:()=>0};',[{args:[],expected:0}])).every(c=>c.ok));
});

test('actual WASM failure details distinguish wrong data, throws, unsupported returns and simultaneous input mutation',async()=>{
 const examples=[{args:[{n:0}],expected:1}];
 for(const [source,status,returnMatches,inputPreserved]of [
  ['module.exports={fn:()=>2};','returned',false,true],
  ['module.exports={fn:()=>{throw Error("PRIVATE_EXCEPTION");}};','threw',false,true],
  ['module.exports={fn:()=>undefined};','unserializable',false,true],
  ['module.exports={fn:x=>{x.n=9;return 2;}};','returned',false,false],
  ['module.exports={fn:x=>{x.n=9;return 1;}};','returned',true,false]
 ]){
  const task=createFunctionTask(spec(source,examples)),observed=await runCandidateProbe(input(task));check(observed);
  const [detail]=inspectFunctionObservations(observed.observations,task.files);
  assert.equal(detail.status,status);assert.equal(detail.returnMatches,returnMatches);assert.equal(detail.inputPreserved,inputPreserved);
  assert.equal(detail.ok,false);assert.equal(JSON.stringify(detail).includes('PRIVATE_EXCEPTION'),false);
  if(!inputPreserved)assert.equal(detail.argumentsAfter,'[{"n":9}]');
 }
 const task=createFunctionTask(spec('module.exports={fn:()=>-0};',[{args:[],expected:0}])),observed=await runCandidateProbe(input(task));
 assert.equal(inspectFunctionObservations(observed.observations,task.files)[0].actualReturn,'-0');
});
