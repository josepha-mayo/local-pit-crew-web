'use strict';
// Compile only the pinned interpreter bytes. No candidate source or mutable
// runtime/Memory is shared; each worker instantiates its own fresh module.
const fs=require('node:fs');
let compiled=null,pending=null;
function preparedModule(){return compiled;}
function prepareModule(){
 if(compiled)return Promise.resolve(compiled);
 pending??=WebAssembly.compile(fs.readFileSync(require.resolve('@jitl/quickjs-wasmfile-release-sync/wasm')))
  .then(module=>{compiled=module;return module;});
 return pending;
}
module.exports={preparedModule,prepareModule};
