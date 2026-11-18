'use strict';
// Pure source-bound outcome codec, shared with the browser worker workflow.
const {CONFIG_CHECK_IDS,SUPPORTED_SUITES}=require('../runner/policy.cjs');
const {FUNCTION_SUITE,CONTRACT_PATH,validateFunctionFiles,parseContractSource,checkIds,inspectFunctionObservations,LIMITS}=require('../runner/function-contract.cjs');
const {workspaceHash}=require('./controller.cjs');
const byteLength=value=>new TextEncoder().encode(value).length;
const PILOT_SUITE='pagination-zero';
const PILOT_CHECK_IDS=Object.freeze(['zero-preserved','empty-preserved','undefined-absent','null-absent','string-preserved','limit-preserved']);
const UNAVAILABLE_REASONS=Object.freeze(['not-qualified','unsupported-suite','runtime-unavailable','protocol-invalid','cleanup-uncertain','aborted','expired','browser-setup-unavailable']);
const fail=()=>{throw Error('public-check-contract-rejected');};
const text=(x,n)=>typeof x==='string'&&x.length>0&&byteLength(x)<=n;
const canonicalHash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
function dataFields(value,keys){
 if(!value||typeof value!=='object'||Array.isArray(value))fail();
 const proto=Object.getPrototypeOf(value);if(proto!==Object.prototype&&proto!==null)fail();
 const d=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(d).length!==keys.length||!keys.every(k=>Object.hasOwn(d,k)&&Object.hasOwn(d[k],'value')))fail();
 return Object.fromEntries(keys.map(k=>[k,d[k].value]));
}
function denseArray(value,max){
 if(!Array.isArray(value))fail();const d=Object.getOwnPropertyDescriptors(value),n=d.length?.value;
 if(!Number.isSafeInteger(n)||n<0||n>max||Reflect.ownKeys(d).length!==n+1)fail();
 const out=[];for(let i=0;i<n;i++){const item=d[String(i)];if(!item||!Object.hasOwn(item,'value'))fail();out.push(item.value);}return out;
}
function bindingData(binding){
 const b=dataFields(binding,['ticketId','suiteId','workspaceHash']);
 if(!text(b.ticketId,200)||!text(b.suiteId,120)||!canonicalHash(b.workspaceHash))fail();return b;
}
function parsePublicCheckOutcome(value,binding,files){
 const b=bindingData(binding);
 // Do not read a getter (or infer a program failure) to choose a protocol branch.
 const descriptor=value&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,'status'):null;
 if(!descriptor||!Object.hasOwn(descriptor,'value'))fail();
 const status=descriptor.value;
 const x=dataFields(value,status==='candidate-verdict'?['status','ticketId','suiteId','workspaceHash','checks',...(b.suiteId===FUNCTION_SUITE?['observations']:[])]:
  status==='unavailable'?['status','ticketId','suiteId','workspaceHash','reason']:[]);
 if(x.ticketId!==b.ticketId||x.suiteId!==b.suiteId||x.workspaceHash!==b.workspaceHash)fail();
 if(status==='unavailable'){
  if(!UNAVAILABLE_REASONS.includes(x.reason))fail();return{status,...b,reason:x.reason};
 }
 if(status!=='candidate-verdict'||!SUPPORTED_SUITES.includes(b.suiteId))fail();
 let ids=b.suiteId===PILOT_SUITE?PILOT_CHECK_IDS:CONFIG_CHECK_IDS;
 if(b.suiteId===FUNCTION_SUITE){
  const captured=validateFunctionFiles(files);if(workspaceHash(captured)!==b.workspaceHash)fail();
  ids=checkIds(parseContractSource(captured[CONTRACT_PATH]));
 }
 const checks=denseArray(x.checks,ids.length).map(c=>{
  const check=dataFields(c,['id','ok']);
  if(!ids.includes(check.id)||typeof check.ok!=='boolean')fail();return check;
 });
 if(checks.length!==ids.length||new Set(checks.map(c=>c.id)).size!==ids.length)fail();
 let diagnostics;
 if(b.suiteId===FUNCTION_SUITE){
  // Regrade observed data independently against the exact admitted source and
  // contract. Diagnostic strings cannot add a passing check or change its IDs.
  diagnostics=inspectFunctionObservations(x.observations,files);
  if(diagnostics.reduce((n,d)=>n+byteLength(d.actualReturn??'')+byteLength(d.argumentsAfter??''),0)>LIMITS.observationBytes||
   diagnostics.some(d=>checks.find(c=>c.id===d.id)?.ok!==d.ok))fail();
 }
 return{status,...b,checks,...(diagnostics?{diagnostics}:{})};
}
module.exports={PILOT_SUITE,PILOT_CHECK_IDS,UNAVAILABLE_REASONS,parsePublicCheckOutcome,bindingData};
