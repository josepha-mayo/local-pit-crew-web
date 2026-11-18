'use strict';
// Independent observation harness. No expected answers enter this worker or VM.
// Candidate source remains a string compiled only inside QuickJS/WASM.
const {parentPort,workerData}=require('node:worker_threads');
const {newQuickJSWASMModule,newVariant,RELEASE_SYNC}=require('quickjs-emscripten');
const {POLICY,data,validateInput}=require('./policy.cjs');
const {validateMatrix}=require('./matrix-policy.cjs');
const {createPrimitiveCodec}=require('./primitive-codec.cjs');
async function execute(packet,wasmModule){
 const x=data(packet,['input','cases']),{files}=validateInput(x.input),cases=validateMatrix(x.cases);
 if(x.input.suiteId!=='pagination-zero')throw Error('unsupported-matrix-suite');
 if(!(wasmModule instanceof WebAssembly.Module))throw Error('missing-trusted-interpreter');
 const wasm=await newQuickJSWASMModule(newVariant(RELEASE_SYNC,{wasmModule})),runtime=wasm.newRuntime(),handles=[];
 runtime.setMemoryLimit(POLICY.guestMemoryBytes);runtime.setMaxStackSize(POLICY.guestStackBytes);
 const deadline=performance.now()+POLICY.guestExecutionMs;let context,result,interrupted=false;
 runtime.setInterruptHandler(()=>interrupted||=performance.now()>deadline);
 const keep=h=>{handles.push(h);return h;};
 const take=outcome=>{if(outcome.error){keep(outcome.error);throw Error(interrupted?'resource-limit':'guest-exception-or-engine-limit');}return keep(outcome.value);};
 try{
  context=runtime.newContext();
  const codec=createPrimitiveCodec(context,{keep,take});
  const read=take(context.evalCode('(function(value,key){return value[key];})'));
  const own=take(context.evalCode('(function(){const has=Function.prototype.call.bind(Object.prototype.hasOwnProperty);return function(value,key){return has(value,key);};})()'));
  const loader=take(context.evalCode(`(function(adapterSource,source){
   const Compile=Function,adapter={exports:{}};
   Compile('module','exports',adapterSource)(adapter,adapter.exports);
   const module={exports:{}};
   function require(spec){if(spec!=='./adapter'&&spec!=='./adapter.js')throw Error('import-disabled');return adapter.exports;}
   Compile('module','exports','require',source)(module,module.exports,require);return module.exports;
  })`));
  const api=take(context.callFunction(loader,context.undefined,codec.fromString(files['src/adapter.js']),codec.fromString(files['src/list.js'])));
  const list=take(context.callFunction(read,context.undefined,api,keep(context.newString('list'))));
  if(context.typeof(list)!=='function')throw Error('unsupported-export');
  const make=value=>value.type==='null'?context.null:value.type==='undefined'?context.undefined:value.type==='boolean'?(value.value?context.true:context.false):
   value.type==='string'?codec.fromString(value.value):keep(context.newNumber(value.negativeZero?-0:Number(value.value)));
  const observations=[];
  for(const item of cases){
   const args=[make(item.cursor)];if(item.limit!==null)args.push(make(item.limit));
   const returned=take(context.callFunction(list,api,...args)),key=keep(context.newString(item.read==='limit'?'limit':'cursor'));
   if(item.read==='hasCursor'){
    const observed=take(context.callFunction(own,context.undefined,returned,key));
    if(context.typeof(observed)!=='boolean')throw Error('protocol-invalid');
    observations.push({id:item.id,kind:'own-property',present:context.getNumber(observed)===1});continue;
   }
   const observed=take(context.callFunction(read,context.undefined,returned,key)),type=codec.typeOf(observed);let value={type};
   if(type==='number'){const number=context.getNumber(observed);value={type,value:String(number),negativeZero:Object.is(number,-0)};}
   else if(type==='boolean')value={type,value:context.getNumber(observed)===1};
   else if(type==='string'){
    const length=take(context.callFunction(read,context.undefined,observed,keep(context.newString('length'))));
    if(context.getNumber(length)>128)throw Error('oversized-observation');value={type,value:codec.toString(observed)};
   }
   observations.push({id:item.id,kind:'property-value',value});
  }
  result={status:'observed',observations};
 }catch(error){
  const allowed=['resource-limit','guest-exception-or-engine-limit','unsupported-export','protocol-invalid','oversized-observation'];
  result={status:allowed.includes(error.message)?error.message:'runtime-failed'};
 }finally{
  try{for(const handle of handles.reverse())handle.dispose();context?.dispose();runtime.dispose();}catch{result={status:'cleanup-uncertain'};}
 }
 return result;
}
execute({input:workerData.input,cases:workerData.cases},workerData.wasmModule).then(result=>{parentPort.postMessage(result);parentPort.close();}).catch(()=>{parentPort.postMessage({status:'runtime-failed'});parentPort.close();});
