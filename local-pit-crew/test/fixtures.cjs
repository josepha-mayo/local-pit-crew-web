'use strict';
// Authored reference fixtures ONLY. The runner accepts named baseline/correction/trap variants,
// not arbitrary source. node:vm is NOT a security sandbox and must not receive model code.
const vm=require('node:vm');
const assert=require('node:assert/strict');
function loadAuthored(files,entry){
 const cache=new Map();
 function load(id){
  if(!Object.hasOwn(files,id))throw Error('unknown authored module');
  if(cache.has(id))return cache.get(id).exports;
  const module={exports:{}};cache.set(id,module);
  const localRequire=spec=>{
   if(!spec.startsWith('./'))throw Error('external module not provided');
   const base=id.includes('/')?id.slice(0,id.lastIndexOf('/')+1):'';
   return load(base+spec.slice(2)+(spec.endsWith('.js')?'':'.js'));
  };
  // Only the immutable authored strings below reach this call.
  const fn=vm.runInNewContext('(function(module,exports,require){'+files[id]+'\n})',{}, {timeout:500});
  fn(module,module.exports,localRequire);
  return module.exports;
 }
 return load(entry);
}
const {definitions,getTasks}=require('../src/reference-catalog.cjs').createCatalog(assert);
async function runAuthoredChecks(id,variant){
 const t=definitions.find(t=>t.id===id);
 if(!t||!(variant==='baseline'||variant==='corrected'||variant==='regression-trap'&&t.regressionTrap))throw Error('reference runner refuses arbitrary source/variant');
 const files=variant==='baseline'?t.files:{...t.files,...(variant==='regression-trap'?t.regressionTrap:t.correction)};
 const checks=await t.checks(loadAuthored(files,t.entry));
 return{taskId:id,variant,checks,pass:checks.every(c=>c.ok),scope:'authored reference programs only'};
}
module.exports={getTasks,runAuthoredChecks};
