'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {functionCheckDetails,buildProofRecord,repairSnapshot}=require('../ui/public/app.js');
function state(){return{mode:'function-contract',task:{id:'json-function-v1',counterexamples:[{id:'case-01',args:['PRIVATE_INPUT'],expected:'PRIVATE_EXPECTED'}]},
 snapshot:{pending:null,manifest:[],counts:{}},checks:[{id:'case-01',ok:false}],checkDiagnostics:[{id:'case-01',ok:false,status:'returned',returnMatches:false,inputPreserved:false,actualReturn:'"PRIVATE_ACTUAL"',argumentsAfter:'["PRIVATE_CHANGED"]'}]};}
test('counterexample inspector explains both failure dimensions and keeps values out of evidence exports',()=>{
 const s=state(),detail=functionCheckDetails(s,'case-01');
 assert.match(detail.summary,/return value differs/i);assert.match(detail.summary,/Input arguments changed/);
 assert.match(detail.args,/PRIVATE_INPUT/);assert.match(detail.expected,/PRIVATE_EXPECTED/);assert.match(detail.actual,/PRIVATE_ACTUAL/);assert.match(detail.argumentsAfter,/PRIVATE_CHANGED/);
 assert.deepEqual(detail.changedInput,{path:'Argument 1',before:'"PRIVATE_INPUT"',after:'"PRIVATE_CHANGED"'});
 assert.equal(JSON.stringify(buildProofRecord(s)).includes('PRIVATE_'),false);
 s.snapshot.pending={id:'new-check'};assert.equal(functionCheckDetails(s,'case-01'),null);
 s.snapshot.pending=null;s.checks=[];assert.equal(functionCheckDetails(s,'case-01'),null);
});
test('identifies changed nested properties while preserving unknown mutation locations',()=>{
 const s=state(),d=s.checkDiagnostics[0];
 s.task.counterexamples[0].args=[[{id:'a',price:0}]];
 d.argumentsAfter='[[{"price":0,"id":"a"}]]';assert.equal(functionCheckDetails(s,'case-01').changedInput,null);
 d.argumentsAfter='[[{"id":"a","price":-0}]]';assert.deepEqual(functionCheckDetails(s,'case-01').changedInput,{path:'Argument 1[0]["price"]',before:'0',after:'-0'});
 d.argumentsAfter='[[{"id":"a"}]]';assert.deepEqual(functionCheckDetails(s,'case-01').changedInput,{path:'Argument 1[0]["price"]',before:'0',after:'Missing'});
 d.argumentsAfter='[[{"id":"a","price":{"amount":0}}]]';assert.deepEqual(functionCheckDetails(s,'case-01').changedInput,{path:'Argument 1[0]["price"]',before:'0',after:'Object'});
 d.argumentsAfter=null;assert.equal(functionCheckDetails(s,'case-01').changedInput,null);
 assert.match(functionCheckDetails(s,'case-01').summary,/Input arguments became unsupported data/);
});
test('counterexample inspector does not invent a return for a throw, unsupported result, missing facts or another suite',()=>{
 const s=state(),d=s.checkDiagnostics[0];d.status='threw';d.actualReturn=null;d.inputPreserved=true;
 assert.match(functionCheckDetails(s,'case-01').summary,/threw/);assert.match(functionCheckDetails(s,'case-01').actual,/withheld/);
 d.status='unserializable';assert.match(functionCheckDetails(s,'case-01').summary,/supported JSON data limits/);
 d.status='made-up';assert.equal(functionCheckDetails(s,'case-01'),null);
 d.status='returned';d.ok=true;assert.equal(functionCheckDetails(s,'case-01'),null);
 s.task.id='pagination-zero';assert.equal(functionCheckDetails(s,'case-01'),null);
});

test('local diagnosis captures only current failed function details while default exports omit their values',()=>{
 const s=state();Object.assign(s.snapshot,{revision:7,evidence:[{id:'read-1',path:'src/function.js',sha256:'current',content:'PRIVATE_SOURCE'}],manifest:[{path:'src/function.js',sha256:'current'}]});
 s.checks.push({id:'case-02',ok:true});s.task.counterexamples.push({id:'case-02',args:['PASSING_INPUT'],expected:'PASSING_EXPECTED'});
 s.checkDiagnostics.push({id:'case-02',ok:true,status:'returned',returnMatches:true,inputPreserved:true,actualReturn:'"PASSING_EXPECTED"',argumentsAfter:'["PASSING_INPUT"]'});
 const snapshot=repairSnapshot(s);
 assert.deepEqual(snapshot.failedFunctionExamples,[{id:'case-01',status:'returned',args:'[\n  "PRIVATE_INPUT"\n]',expected:'"PRIVATE_EXPECTED"',actual:'"PRIVATE_ACTUAL"',inputPreserved:false,argumentsAfter:'["PRIVATE_CHANGED"]'}]);
 assert.equal(JSON.stringify(snapshot.failedFunctionExamples).includes('PASSING_'),false);
 s.checkDiagnostics[0].status='threw';s.checkDiagnostics[0].actualReturn=null;s.checkDiagnostics[0].inputPreserved=true;
 assert.deepEqual(repairSnapshot(s).failedFunctionExamples[0],{...snapshot.failedFunctionExamples[0],status:'threw',actual:null,inputPreserved:true,argumentsAfter:null});
 assert.equal(JSON.stringify(buildProofRecord(s)).includes('PRIVATE_'),false);
 s.snapshot.pending={id:'new-test'};assert.equal(repairSnapshot(s),null);s.snapshot.pending=null;
 s.snapshot.closed=true;assert.equal(repairSnapshot(s),null);s.snapshot.closed=false;
 s.snapshot.evidence[0].path=s.snapshot.manifest[0].path='contract.json';assert.equal(repairSnapshot(s),null);
 s.snapshot.evidence[0].path=s.snapshot.manifest[0].path='src/function.js';
 s.snapshot.manifest[0].sha256='new-source';assert.equal(repairSnapshot(s),null);
});
