// Fixed application worker. Candidate text only reaches the QuickJS guest.
import {newQuickJSWASMModuleFromVariant,newVariant} from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import wasmUrl from '@jitl/quickjs-wasmfile-release-sync/wasm?url&no-inline';
import executor from '../runner/function-executor.cjs';
self.onmessage=async ({data})=>{
 self.onmessage=null;
 try{
  const wasm=await newQuickJSWASMModuleFromVariant(newVariant(variant,{
   wasmLocation:wasmUrl,wasmModule:data.wasmModule??undefined
  }));
  self.onmessage=({data})=>{
   self.onmessage=null;
   try{self.postMessage(executor.executeFunction(data,wasm));}
   catch{self.postMessage({status:'runtime-failed'});}
   finally{self.close();}
  };
  self.postMessage({status:'ready'});
 }catch{self.postMessage({status:'runtime-failed'});self.close();}
};
