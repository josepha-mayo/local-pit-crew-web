'use strict';
// Real QuickJS execution. The independent Node comparison accepts only immutable authored variants.
const test=require('node:test'),assert=require('node:assert/strict');
const {getTasks,runAuthoredChecks}=require('../../test/fixtures.cjs');
const {runCandidateProbe,runObservationMatrix}=require('../probe.cjs');
const {CONFIG_DEFAULTS,CONFIG_CHECK_IDS,validateInput,gradeObservations}=require('../policy.cjs');
const task=getTasks().find(t=>t.id==='config-isolation');
const input=source=>({suiteId:task.id,files:{...task.files,'src/config.js':source}});
test('config runner matches independent authored state-leakage checks and resets each candidate context',async()=>{
 assert.equal(task.files['src/defaults.js'],CONFIG_DEFAULTS);
 for(const variant of ['baseline','corrected','baseline']){
  const source=variant==='baseline'?task.files['src/config.js']:task.correction['src/config.js'];
  const expected=await runAuthoredChecks(task.id,variant),observed=await runCandidateProbe(input(source));
  assert.equal(observed.status,'observed');assert.equal(observed.cleanupConfirmed,true);
  assert.deepEqual(observed.checks,expected.checks.map(({id,ok})=>({id,ok})));
  assert.deepEqual(observed.checks.map(c=>c.id),CONFIG_CHECK_IDS);
  assert.equal(observed.checks.filter(c=>c.ok).length,variant==='baseline'?2:5);
 }
});
test('config module scope keeps defaults fixed and refuses extra files, getters and oversized source before execution',()=>{
 const valid=input(task.files['src/config.js']);assert.deepEqual(validateInput(valid).files,valid.files);
 for(const files of [
  {...valid.files,'src/defaults.js':'module.exports={};'},
  {...valid.files,'extra.js':'never execute'},
  {...valid.files,'src/config.js':'x'.repeat(24001)}
 ])assert.throws(()=>validateInput({suiteId:task.id,files}));
 let read=false;const files={...valid.files};Object.defineProperty(files,'src/config.js',{get(){read=true;return'';},enumerable:true});
 assert.throws(()=>validateInput({suiteId:task.id,files}));assert.equal(read,false);
});
test('config candidates have no Node imports or host global access and remain bounded on a loop',async()=>{
 const marker='__PITCREW_CONFIG_GUEST__';assert.equal(Object.hasOwn(globalThis,marker),false);
 const imported=await runCandidateProbe(input("require('node:fs');module.exports={makeConfig(){return {}}};"));
 assert.notEqual(imported.status,'observed');assert.equal(imported.cleanupConfirmed,true);
 const loop=await runCandidateProbe(input('while(true){}'));
 assert.notEqual(loop.status,'observed');assert.equal(loop.cleanupConfirmed,true);
 const marked=await runCandidateProbe(input('globalThis.'+marker+'=true;'+task.correction['src/config.js']));
 assert.equal(marked.status,'observed');assert.equal(marked.checks.every(c=>c.ok),true);
 assert.equal(Object.hasOwn(globalThis,marker),false);
});
test('config facts are independently graded and cannot substitute self-reported success, check IDs or numeric types',async()=>{
 const r=await runCandidateProbe(input(task.correction['src/config.js']));assert.equal(r.status,'observed');
 const facts=structuredClone(r.observations);facts[0].value={type:'string',value:'3'};
 assert.equal(gradeObservations(facts,task.id)[0].ok,false);
 assert.throws(()=>gradeObservations(r.checks,task.id));
 facts[0].id='invented';assert.throws(()=>gradeObservations(facts,task.id));
 await assert.rejects(runObservationMatrix(input(task.files['src/config.js']),[{id:'matrix-a',cursor:{type:'null'},limit:null,read:'cursor'}]),/unsupported-matrix-suite/);
});
