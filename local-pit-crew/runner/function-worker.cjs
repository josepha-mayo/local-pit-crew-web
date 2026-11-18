'use strict';
// Node worker bootstraps only the trusted, parent-precompiled interpreter.
const {parentPort,workerData}=require('node:worker_threads');
const {newQuickJSWASMModule,newVariant,RELEASE_SYNC}=require('quickjs-emscripten');
const {validateInput}=require('./policy.cjs');
const {executeFunction}=require('./function-executor.cjs');
async function execute(input,wasmModule){
 validateInput(input);
 if(!(wasmModule instanceof WebAssembly.Module))throw Error('missing-trusted-interpreter');
 const wasm=await newQuickJSWASMModule(newVariant(RELEASE_SYNC,{wasmModule}));
 return executeFunction(input,wasm);
}
execute(workerData.input,workerData.wasmModule).then(result=>{parentPort.postMessage(result);parentPort.close();}).catch(()=>{parentPort.postMessage({status:'runtime-failed'});parentPort.close();});
