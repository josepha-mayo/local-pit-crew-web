'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {checkedFunctionForDownload,buildProofRecord}=require('../ui/public/app.js');
function state(){
 const content='module.exports={fn:()=>"PRIVATE_SOURCE_é"};',sha256=createHash('sha256').update(content).digest('hex');
 return{mode:'function-contract',task:{id:'json-function-v1',counterexamples:[{id:'case-01'}]},checks:[{id:'case-01',ok:true}],
  snapshot:{publicChecksCurrent:true,closed:false,pending:null,manifest:[{path:'src/function.js',sha256}]},
  checkedFunction:{path:'src/function.js',fileName:'fn.checked.js',sha256,content,checkedExamples:1}};
}
test('checked source requires current complete passing cases and a matching source manifest, including after Finish',()=>{
 const s=state();assert.deepEqual(checkedFunctionForDownload(s),s.checkedFunction);s.snapshot.closed=true;
 assert.deepEqual(checkedFunctionForDownload(s),s.checkedFunction);
 assert.equal(JSON.stringify(buildProofRecord(s)).includes('PRIVATE_SOURCE'),false);
 for(const mutate of [s=>s.mode='authored-reference',s=>s.snapshot.publicChecksCurrent=false,s=>s.snapshot.publicChecksCurrent='true',
  s=>s.snapshot.pending={id:'new-check'},s=>s.snapshot.manifest={},s=>s.snapshot.manifest[0].sha256='b'.repeat(64),
  s=>s.checkedFunction=null,s=>s.checkedFunction.path='contract.json',s=>s.checkedFunction.fileName='../escape.js',
  s=>s.checkedFunction.content='',s=>s.checkedFunction.content='é'.repeat(3001),s=>s.checkedFunction.checkedExamples=2,
  s=>s.checks=[],s=>s.checks[0].ok=false,s=>s.checks[0]=null,s=>s.checks[0].id='missing',s=>s.task.counterexamples=[]]){
  const invalid=state();mutate(invalid);assert.equal(checkedFunctionForDownload(invalid),null);
 }
 const duplicate=state();duplicate.checks.push({...duplicate.checks[0]});duplicate.task.counterexamples.push({...duplicate.task.counterexamples[0]});duplicate.checkedFunction.checkedExamples=2;
 assert.equal(checkedFunctionForDownload(duplicate),null);
});
