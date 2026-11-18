'use strict';
// Pure data boundary shared by intake, the verifier and its independent grader.
// No source evaluation, I/O, model calls or caller-supplied test programs.
const FUNCTION_SUITE='json-function-v1',FUNCTION_ENTRY='src/function.js',CONTRACT_PATH='contract.json';
const CONTRACT_SCHEMA='local-pit-crew/function-contract/v1',TASK_SCHEMA='local-pit-crew/function-task/v1';
const LIMITS=Object.freeze({cases:8,args:8,depth:6,nodes:256,string:512,keys:32,contractBytes:5000,sourceBytes:6000,observationBytes:12000});
const size=x=>new TextEncoder().encode(x).length;
const fail=()=>{throw Error('invalid-function-contract');};
function fields(value,keys){
 if(!value||typeof value!=='object'||Array.isArray(value))fail();
 const proto=Object.getPrototypeOf(value),d=Object.getOwnPropertyDescriptors(value);
 if(proto!==Object.prototype&&proto!==null||Reflect.ownKeys(d).length!==keys.length||keys.some(k=>!Object.hasOwn(d,k)||!Object.hasOwn(d[k],'value')))fail();
 return Object.fromEntries(keys.map(k=>[k,d[k].value]));
}
function dense(value,max){
 if(!Array.isArray(value))fail();const d=Object.getOwnPropertyDescriptors(value),n=d.length?.value;
 if(!Number.isSafeInteger(n)||n<0||n>max||Reflect.ownKeys(d).length!==n+1)fail();
 const out=[];for(let i=0;i<n;i++){const p=d[String(i)];if(!p||!Object.hasOwn(p,'value'))fail();out.push(p.value);}return out;
}
function jsonValue(value,{allowNegativeZero=false}={}){
 const active=new WeakSet();let nodes=0;
 function copy(v,depth){
  if(++nodes>LIMITS.nodes||depth>LIMITS.depth)fail();
  if(v===null||typeof v==='boolean')return v;
  if(typeof v==='number'){if(!Number.isFinite(v)||!allowNegativeZero&&Object.is(v,-0))fail();return v;}
  if(typeof v==='string'){if(v.length>LIMITS.string)fail();return v;}
  if(!v||typeof v!=='object'||active.has(v))fail();active.add(v);let result;
  if(Array.isArray(v))result=dense(v,LIMITS.nodes).map(x=>copy(x,depth+1));
  else{
   const proto=Object.getPrototypeOf(v),d=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(d);
   if(proto!==Object.prototype&&proto!==null||keys.length>LIMITS.keys||keys.some(k=>typeof k!=='string'||k.length>80||['__proto__','constructor','prototype'].includes(k)||!Object.hasOwn(d[k],'value')||!d[k].enumerable))fail();
   result=Object.create(null);for(const key of keys.sort())result[key]=copy(d[key].value,depth+1);
  }
  active.delete(v);return result;
 }
 return copy(value,0);
}
function canonical(value){
 if(value===null)return'null';if(typeof value==='number')return Object.is(value,-0)?'-0':JSON.stringify(value);
 if(typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return'['+value.map(canonical).join(',')+']';
 return'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
function validateContract(value){
 const x=fields(value,['schema','exportName','cases']);
 if(x.schema!==CONTRACT_SCHEMA||typeof x.exportName!=='string'||!/^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(x.exportName)||['__proto__','constructor','prototype'].includes(x.exportName))fail();
 const cases=dense(x.cases,LIMITS.cases).map((c,i)=>{
  const row=fields(c,['id','label','args','expected']);
  if(row.id!=='case-'+String(i+1).padStart(2,'0')||typeof row.label!=='string'||!row.label.trim()||row.label.length>80)fail();
  return{id:row.id,label:row.label,args:jsonValue(dense(row.args,LIMITS.args)),expected:jsonValue(row.expected)};
 });
 if(!cases.length)fail();const result={schema:CONTRACT_SCHEMA,exportName:x.exportName,cases};
 if(size(JSON.stringify(result))>LIMITS.contractBytes)fail();return result;
}
function parseContractSource(source){
 if(typeof source!=='string'||size(source)>LIMITS.contractBytes)fail();let value;try{value=JSON.parse(source);}catch{fail();}return validateContract(value);
}
function checkIds(contract){return contract.cases.map((_,i)=>'case-'+String(i+1).padStart(2,'0'));}
function validateFunctionFiles(value){
 const files=fields(value,[FUNCTION_ENTRY,CONTRACT_PATH]);
 if(typeof files[FUNCTION_ENTRY]!=='string'||!files[FUNCTION_ENTRY].trim()||size(files[FUNCTION_ENTRY])>LIMITS.sourceBytes)fail();
 parseContractSource(files[CONTRACT_PATH]);return files;
}
function createFunctionTask(value){
 const x=fields(value,['schema','title','instructions','exportName','source','cases']);
 if(x.schema!==TASK_SCHEMA||typeof x.title!=='string'||!x.title.trim()||x.title.length>80||typeof x.instructions!=='string'||!x.instructions.trim()||size(x.instructions)>1000)fail();
 const declared=dense(x.cases,LIMITS.cases).map((c,i)=>({id:'case-'+String(i+1).padStart(2,'0'),...fields(c,['label','args','expected'])}));
 const contract=validateContract({schema:CONTRACT_SCHEMA,exportName:x.exportName,cases:declared});
 const files=validateFunctionFiles({[FUNCTION_ENTRY]:x.source,[CONTRACT_PATH]:JSON.stringify(contract)});
 const prompt='Repair the synchronous CommonJS export '+contract.exportName+' in '+FUNCTION_ENTRY+'. '+
  'Return the expected JSON value for each example in the read-only '+CONTRACT_PATH+' and preserve the JSON-visible input arguments. '+
  'Imports, asynchronous results and non-JSON return values are unsupported. Do not change the contract.\nUser requirement: '+x.instructions;
 // Reserve room for source identities, check feedback and lifecycle metadata.
 if(size(JSON.stringify({files,prompt}))+3500>16000)throw Error('function-context-budget-exceeded');
 const ids=checkIds(contract);
 return Object.freeze({id:FUNCTION_SUITE,title:x.title,instructions:x.instructions,prompt,files:Object.freeze(files),writable:Object.freeze([FUNCTION_ENTRY]),checkIds:Object.freeze(ids),
  checkLabels:Object.freeze(Object.fromEntries(ids.map((id,i)=>[id,contract.cases[i].label])))});
}
function inspectFunctionObservations(value,files){
 const source=validateFunctionFiles(files),contract=parseContractSource(source[CONTRACT_PATH]),ids=checkIds(contract);
 const observations=dense(value,ids.length);if(observations.length!==ids.length)fail();
 return observations.map((row,i)=>{
  const x=fields(row,['id','status','output','argsAfter']);
  if(x.id!==ids[i]||!['returned','threw','unserializable'].includes(x.status)||
   !(x.argsAfter===null||typeof x.argsAfter==='string')||!(x.output===null||typeof x.output==='string')||
   x.status==='returned'&&x.output===null||x.status!=='returned'&&x.output!==null)fail();
  const parse=raw=>{if(size(raw)>LIMITS.observationBytes)fail();let v;try{v=JSON.parse(raw);}catch{fail();}return jsonValue(v,{allowNegativeZero:true});};
  const returned=x.output===null?null:parse(x.output),after=x.argsAfter===null?null:parse(x.argsAfter);
  const returnMatches=x.status==='returned'&&canonical(returned)===canonical(contract.cases[i].expected);
  const inputPreserved=x.argsAfter!==null&&canonical(after)===canonical(contract.cases[i].args);
  return{id:ids[i],ok:returnMatches&&inputPreserved,status:x.status,returnMatches,inputPreserved,
   actualReturn:x.status==='returned'?canonical(returned):null,argumentsAfter:x.argsAfter===null?null:canonical(after)};
 });
}
function gradeFunctionObservations(value,files){return inspectFunctionObservations(value,files).map(({id,ok})=>({id,ok}));}
module.exports={FUNCTION_SUITE,FUNCTION_ENTRY,CONTRACT_PATH,CONTRACT_SCHEMA,TASK_SCHEMA,LIMITS,fields,dense,jsonValue,canonical,validateContract,parseContractSource,checkIds,validateFunctionFiles,createFunctionTask,gradeFunctionObservations,inspectFunctionObservations};
