'use strict';
// Bounded observation instructions, never expected answers or executable grader
// code. The independent evaluator keeps expectations outside the candidate VM.
const {data}=require('./policy.cjs');
function typed(value){
 const descriptor=value&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,'type'):null;
 if(!descriptor||!Object.hasOwn(descriptor,'value'))throw Error('invalid-matrix-value');
 const type=descriptor.value;
 if(type==='null'||type==='undefined'){data(value,['type']);return{type};}
 if(type==='string'||type==='boolean'){
  const x=data(value,['type','value']);
  if(typeof x.value!==type||(type==='string'&&x.value.length>128))throw Error('invalid-matrix-value');
  return{type,value:x.value};
 }
 if(type==='number'){
  const x=data(value,['type','value','negativeZero']);
  if(typeof x.value!=='string'||x.value.length>40||typeof x.negativeZero!=='boolean'||
   !(['NaN','Infinity','-Infinity'].includes(x.value)||(Number.isFinite(Number(x.value))&&String(Number(x.value))===x.value))||
   (x.negativeZero&&x.value!=='0'))throw Error('invalid-matrix-value');
  return{type,value:x.value,negativeZero:x.negativeZero};
 }
 throw Error('invalid-matrix-value');
}
function dense(array,max){
 if(!Array.isArray(array))throw Error('invalid-matrix-array');
 const d=Object.getOwnPropertyDescriptors(array),length=d.length?.value;
 if(!Number.isSafeInteger(length)||length<1||length>max||Reflect.ownKeys(d).length!==length+1)throw Error('invalid-matrix-array');
 return Array.from({length},(_,i)=>{if(!d[i]||!Object.hasOwn(d[i],'value'))throw Error('invalid-matrix-array');return d[i].value;});
}
function validateMatrix(cases){
 const out=dense(cases,24).map(item=>{
  const x=data(item,['id','cursor','limit','read']);
  if(typeof x.id!=='string'||!/^matrix-[a-z0-9-]{1,64}$/.test(x.id)||!['cursor','hasCursor','limit'].includes(x.read))throw Error('invalid-matrix-case');
  return{id:x.id,cursor:typed(x.cursor),limit:x.limit===null?null:typed(x.limit),read:x.read};
 });
 if(new Set(out.map(c=>c.id)).size!==out.length)throw Error('invalid-matrix-case');return out;
}
function validateMatrixObservations(observations,cases){
 const instructions=validateMatrix(cases),facts=dense(observations,24);
 if(facts.length!==instructions.length)throw Error('incomplete-matrix');
 return facts.map((fact,i)=>{
  const own=instructions[i].read==='hasCursor',x=data(fact,own?['id','kind','present']:['id','kind','value']);
  if(x.id!==instructions[i].id||x.kind!==(own?'own-property':'property-value'))throw Error('invalid-matrix-observation');
  if(own){if(typeof x.present!=='boolean')throw Error('invalid-matrix-observation');return x;}
  const type=Object.getOwnPropertyDescriptor(x.value??{},'type')?.value;
  if(['object','function','symbol','bigint'].includes(type))data(x.value,['type']);else typed(x.value);
  return x;
 });
}
module.exports={typed,validateMatrix,validateMatrixObservations};
