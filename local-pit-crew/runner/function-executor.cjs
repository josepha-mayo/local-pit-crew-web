'use strict';
// Same guest executor for Node workers and browser workers. No host callbacks,
// filesystem, network, Node VM or browser-global access enters the guest.
const {FUNCTION_SUITE,FUNCTION_ENTRY,CONTRACT_PATH,fields,validateFunctionFiles,parseContractSource,checkIds,LIMITS}=require('./function-contract.cjs');
const {FUNCTION_LOADER_SOURCE,FUNCTION_OBSERVER_SOURCE}=require('./function-guest.cjs');
const {createPrimitiveCodec}=require('./primitive-codec.cjs');
const FUNCTION_LIMITS=Object.freeze({guestMemoryBytes:8*1024*1024,guestStackBytes:256*1024,guestExecutionMs:250});
function executeFunction(input,wasm){
 const x=fields(input,['suiteId','files']);if(x.suiteId!==FUNCTION_SUITE)throw Error('unsupported-function-suite');
 const files=validateFunctionFiles(x.files),contract=parseContractSource(files[CONTRACT_PATH]),runtime=wasm.newRuntime();
 runtime.setMemoryLimit(FUNCTION_LIMITS.guestMemoryBytes);runtime.setMaxStackSize(FUNCTION_LIMITS.guestStackBytes);
 const deadline=performance.now()+FUNCTION_LIMITS.guestExecutionMs;let interrupted=false,context,result;const handles=[];
 runtime.setInterruptHandler(()=>{if(performance.now()>deadline)interrupted=true;return interrupted;});
 const keep=h=>{handles.push(h);return h;},take=x=>{if(x.error){keep(x.error);throw Error(interrupted?'resource-limit':'guest-exception-or-engine-limit');}return keep(x.value);};
 try{
  context=runtime.newContext();const codec=createPrimitiveCodec(context,{keep,take});
  const observer=take(context.evalCode(FUNCTION_OBSERVER_SOURCE)),loader=take(context.evalCode(FUNCTION_LOADER_SOURCE));
  const read=take(context.evalCode('(function(api,name){return api[name];})')),length=take(context.evalCode('(function(value){return value.length;})'));
  const api=take(context.callFunction(loader,context.undefined,codec.fromString(files[FUNCTION_ENTRY])));
  const fn=take(context.callFunction(read,context.undefined,api,codec.fromString(contract.exportName)));
  if(context.typeof(fn)!=='function')throw Error('unsupported-export');
  const observations=[],ids=checkIds(contract);
  for(let i=0;i<contract.cases.length;i++){
   // The expected value and contract object remain in this trusted host.
   const observed=take(context.callFunction(observer,context.undefined,fn,codec.fromString(JSON.stringify(contract.cases[i].args))));
   const n=take(context.callFunction(length,context.undefined,observed));if(context.getNumber(n)>LIMITS.observationBytes)throw Error('oversized-observation');
   const value=JSON.parse(codec.toString(observed));observations.push({id:ids[i],...value});
   if(new TextEncoder().encode(JSON.stringify(observations)).length>LIMITS.observationBytes)throw Error('oversized-observation');
  }
  if(interrupted)throw Error('resource-limit');result={status:'observed',observations};
 }catch(error){
  const allowed=['resource-limit','guest-exception-or-engine-limit','unsupported-export','oversized-observation'];result={status:allowed.includes(error.message)?error.message:'runtime-failed'};
 }finally{
  try{for(const handle of handles.reverse())handle.dispose();context?.dispose();runtime.dispose();}catch{result={status:'cleanup-uncertain'};}
 }
 return result;
}
module.exports={executeFunction,FUNCTION_LIMITS};
