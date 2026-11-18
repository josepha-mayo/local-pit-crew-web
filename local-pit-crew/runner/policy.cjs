'use strict';
const crypto = require('node:crypto');
const {FUNCTION_SUITE,validateFunctionFiles,gradeFunctionObservations}=require('./function-contract.cjs');
const ADAPTER = "function fetchPage(params){return {...params};}\nmodule.exports={fetchPage};\n";
const CONFIG_DEFAULTS = "module.exports={timeoutMs:500,retry:{attempts:3,delayMs:50}};\n";
const CHECK_IDS = Object.freeze(['zero-preserved', 'empty-preserved', 'undefined-absent', 'null-absent', 'string-preserved', 'limit-preserved']);
const CONFIG_CHECK_IDS=Object.freeze(['custom-default-isolation','returned-mutation-isolation','different-retry-reference','zero-retries','explicit-timeout']);
const SUPPORTED_SUITES=Object.freeze(['pagination-zero','config-isolation',FUNCTION_SUITE]);
const POLICY = Object.freeze({
  id: 'experimental-quickjs-repair-v4', quickjs: '0.32.0', enginePreparation:'parent-precompiled-module',
  sourceBytes: 24000, guestMemoryBytes: 8 * 1024 * 1024,
  guestStackBytes: 256 * 1024, guestExecutionMs: 250, wallMs: 2000,
  workerOldGenerationMb: 32, workerYoungGenerationMb: 8, workerStackMb: 2
});
const data = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid-pilot-input');
  const proto = Object.getPrototypeOf(value), fields = Object.getOwnPropertyDescriptors(value);
  if ((proto !== Object.prototype && proto !== null) || Reflect.ownKeys(fields).length !== keys.length ||
      keys.some(key => !Object.hasOwn(fields, key) || !Object.hasOwn(fields[key], 'value'))) throw Error('invalid-pilot-input');
  return Object.fromEntries(keys.map(key => [key, fields[key].value]));
};
function validateInput(input) {
  const {suiteId, files} = data(input, ['suiteId', 'files']);
  if(!SUPPORTED_SUITES.includes(suiteId))throw Error('unsupported-pilot-input');
  if(suiteId===FUNCTION_SUITE)return{suiteId,files:validateFunctionFiles(files)};
  const config=suiteId==='config-isolation',entry=config?'src/config.js':'src/list.js',dependency=config?'src/defaults.js':'src/adapter.js';
  const source = data(files, [entry,dependency]);
  if(source[dependency] !== (config?CONFIG_DEFAULTS:ADAPTER) ||
      typeof source[entry] !== 'string' || Buffer.byteLength(source[entry]) > POLICY.sourceBytes) throw Error('unsupported-pilot-input');
  return {suiteId, files: source};
}
function gradeConfigObservations(observations){
 if(!Array.isArray(observations)||observations.length!==CONFIG_CHECK_IDS.length)throw Error('invalid-pilot-observations');
 return observations.map((observation,index)=>{
  const x=data(observation,['id','kind','value']);
  if(x.id!==CONFIG_CHECK_IDS[index]||x.kind!=='property-value')throw Error('invalid-pilot-observations');
  const type=Object.getOwnPropertyDescriptor(x.value??{},'type')?.value;
  let value;
  if(type==='number'){
   value=data(x.value,['type','value','negativeZero']);
   if(typeof value.value!=='string'||value.value.length>40||typeof value.negativeZero!=='boolean')throw Error('invalid-pilot-observations');
  }else if(type==='boolean'){
   value=data(x.value,['type','value']);if(typeof value.value!=='boolean')throw Error('invalid-pilot-observations');
  }else if(type==='string'){
   value=data(x.value,['type','value']);if(typeof value.value!=='string'||value.value.length>128)throw Error('invalid-pilot-observations');
  }else{value=data(x.value,['type']);if(!['null','undefined','object','function','symbol','bigint'].includes(type))throw Error('invalid-pilot-observations');}
  const ok=index===2?type==='boolean'&&value.value===true:
   type==='number'&&!value.negativeZero&&value.value===String([3,50,null,0,42][index]);
  return{id:x.id,ok};
 });
}
function gradeObservations(observations,suiteId='pagination-zero',files) {
  if(suiteId===FUNCTION_SUITE)return gradeFunctionObservations(observations,files);
  if(suiteId==='config-isolation')return gradeConfigObservations(observations);
  if(suiteId!=='pagination-zero')throw Error('unsupported-pilot-input');
  if (!Array.isArray(observations) || observations.length !== CHECK_IDS.length) throw Error('invalid-pilot-observations');
  return observations.map((observation, index) => {
    if (index === 2 || index === 3) {
      const x = data(observation, ['id', 'kind', 'present']);
      if (x.id !== CHECK_IDS[index] || x.kind !== 'own-property' || typeof x.present !== 'boolean') throw Error('invalid-pilot-observations');
      return {id: x.id, ok: !x.present};
    }
    const x = data(observation, ['id', 'kind', 'value']);
    if (x.id !== CHECK_IDS[index] || x.kind !== 'property-value') throw Error('invalid-pilot-observations');
    const type = Object.getOwnPropertyDescriptor(x.value ?? {}, 'type')?.value;
    let value;
    if (type === 'string' || type === 'boolean') {
      value = data(x.value, ['type', 'value']);
      if (typeof value.value !== type || (type === 'string' && value.value.length > 128)) throw Error('invalid-pilot-observations');
    } else if (type === 'number') {
      value = data(x.value, ['type', 'value', 'negativeZero']);
      if (typeof value.value !== 'string' || value.value.length > 40 || typeof value.negativeZero !== 'boolean') throw Error('invalid-pilot-observations');
    } else {
      value = data(x.value, ['type']);
      if (!['null', 'undefined', 'object', 'function', 'symbol', 'bigint'].includes(type)) throw Error('invalid-pilot-observations');
    }
    const expected = index === 0 ? '0' : index === 1 ? '' : index === 4 ? 'next-07' : '7';
    return {id: x.id, ok: (index === 0 || index === 5)
      ? type === 'number' && value.value === expected && !value.negativeZero
      : type === 'string' && value.value === expected};
  });
}
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
module.exports = {ADAPTER,CONFIG_DEFAULTS,CHECK_IDS,CONFIG_CHECK_IDS,SUPPORTED_SUITES,POLICY,data,hash,validateInput,gradeObservations};
