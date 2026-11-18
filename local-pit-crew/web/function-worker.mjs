// Fixed application worker. Candidate text only reaches the QuickJS guest.
import {newQuickJSWASMModuleFromVariant,newVariant} from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import wasmUrl from '@jitl/quickjs-wasmfile-release-sync/wasm?url&no-inline';
import executor from '../runner/function-executor.cjs';
let started=false;
try{
 const wasm=await newQuickJSWASMModuleFromVariant(newVariant(variant,{wasmLocation:wasmUrl}));
 self.onmessage=({data})=>{
  if(started)return;started=true;
  try{self.postMessage(executor.executeFunction(data,wasm));}
  catch{self.postMessage({status:'runtime-failed'});}
  finally{self.close();}
 };
 self.postMessage({status:'ready'});
}catch{self.postMessage({status:'runtime-failed'});self.close();}
