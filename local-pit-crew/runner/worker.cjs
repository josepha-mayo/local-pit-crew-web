'use strict';
// Only trusted wrapper code runs in Node. Candidate strings enter QuickJS only.
const {parentPort, workerData} = require('node:worker_threads');
const {newQuickJSWASMModule, newVariant, RELEASE_SYNC} = require('quickjs-emscripten');
const {POLICY,CHECK_IDS,CONFIG_CHECK_IDS,validateInput} = require('./policy.cjs');
const {createPrimitiveCodec}=require('./primitive-codec.cjs');

async function execute(input,wasmModule) {
  const {suiteId,files} = validateInput(input),config=suiteId==='config-isolation';
  if(!(wasmModule instanceof WebAssembly.Module))throw Error('missing-trusted-interpreter');
  const wasm = await newQuickJSWASMModule(newVariant(RELEASE_SYNC,{wasmModule}));
  const runtime = wasm.newRuntime();
  runtime.setMemoryLimit(POLICY.guestMemoryBytes);
  runtime.setMaxStackSize(POLICY.guestStackBytes);
  const deadline = performance.now() + POLICY.guestExecutionMs;
  let interrupted = false, context, result;
  const handles = [];
  runtime.setInterruptHandler(() => {
    if (performance.now() > deadline) interrupted = true;
    return interrupted;
  });
  const keep = handle => { handles.push(handle); return handle; };
  const take = outcome => {
    if (outcome.error) {
      keep(outcome.error);
      throw Error(interrupted ? 'resource-limit' : 'guest-exception-or-engine-limit');
    }
    return keep(outcome.value);
  };
  try {
    context = runtime.newContext();
    const codec=createPrimitiveCodec(context,{keep,take});
    // These handles are captured before candidate code. Mutable guest intrinsics
    // cannot replace the host's own-property observation or expected values.
    const read = take(context.evalCode('(function(value,key){return value[key];})'));
    const own = take(context.evalCode('(function(){const has=Function.prototype.call.bind(Object.prototype.hasOwnProperty);return function(value,key){return has(value,key);};})()'));
    const configScenario=take(context.evalCode(`(function(api,index){
      if(index===0){api.makeConfig({retries:1});return api.makeConfig().retry.attempts;}
      if(index===1){const previous=api.makeConfig();previous.retry.delayMs=900;return api.makeConfig().retry.delayMs;}
      if(index===2)return api.makeConfig().retry!==api.makeConfig().retry;
      if(index===3)return api.makeConfig({retries:0}).retry.attempts;
      return api.makeConfig({timeoutMs:42}).timeoutMs;
    })`));
    const configLoader=take(context.evalCode(`(function(defaultsSource,source){
      const Compile=Function,defaults={exports:{}};
      Compile('module','exports',defaultsSource)(defaults,defaults.exports);
      const module={exports:{}};
      function require(spec){if(spec!=='./defaults'&&spec!=='./defaults.js')throw Error('import-disabled');return defaults.exports;}
      Compile('module','exports','require',source)(module,module.exports,require);return module.exports;
    })`));
    const paginationLoader = take(context.evalCode(`(function(adapterSource,source){
      const Compile=Function;
      const adapter={exports:{}};
      Compile('module','exports',adapterSource)(adapter,adapter.exports);
      const module={exports:{}};
      function require(spec){
        if(spec!=='./adapter'&&spec!=='./adapter.js')throw new Error('import-disabled');
        return adapter.exports;
      }
      Compile('module','exports','require',source)(module,module.exports,require);
      return module.exports;
    })`));
    const adapterSource = codec.fromString(files[config?'src/defaults.js':'src/adapter.js']);
    const candidateSource = codec.fromString(files[config?'src/config.js':'src/list.js']);
    const api = take(context.callFunction(config?configLoader:paginationLoader, context.undefined, adapterSource, candidateSource));
    const name = keep(context.newString(config?'makeConfig':'list'));
    const list = take(context.callFunction(read, context.undefined, api, name));
    if (context.typeof(list) !== 'function') throw Error('unsupported-export');
    const property = keep(context.newString('cursor'));
    const observations = [],checkIds=config?CONFIG_CHECK_IDS:CHECK_IDS;
    const observe=(id,observed)=>{
      const type=codec.typeOf(observed);let value={type};
      if(type==='number'){const number=context.getNumber(observed);value={type,value:String(number),negativeZero:Object.is(number,-0)};}
      else if(type==='boolean')value={type,value:context.getNumber(observed)===1};
      else if(type==='string'){
        const length=take(context.callFunction(read,context.undefined,observed,keep(context.newString('length'))));
        if(context.getNumber(length)>128)throw Error('oversized-observation');
        value={type,value:codec.toString(observed)};
      }
      return{id,kind:'property-value',value};
    };
    for (let i = 0; i < checkIds.length; i++) {
      if(config){
        const observed=take(context.callFunction(configScenario,context.undefined,api,keep(context.newNumber(i))));
        observations.push(observe(checkIds[i],observed));continue;
      }
      const cursor = i === 0 || i === 5 ? keep(context.newNumber(0)) : i === 1 ? keep(context.newString('')) :
        i === 2 ? context.undefined : i === 3 ? context.null : keep(context.newString('next-07'));
      const args = i === 5 ? [cursor, keep(context.newNumber(7))] : [cursor];
      const returned = take(context.callFunction(list, api, ...args));
      if (i === 2 || i === 3) {
        const present = take(context.callFunction(own, context.undefined, returned, property));
        if (context.typeof(present) !== 'boolean') throw Error('observation-protocol-failed');
        observations.push({id: CHECK_IDS[i], kind: 'own-property', present: context.getNumber(present) === 1});
        continue;
      }
      const key = i === 5 ? keep(context.newString('limit')) : property;
      const observed = take(context.callFunction(read, context.undefined, returned, key));
      observations.push(observe(CHECK_IDS[i],observed));
    }
    result = {status: 'observed', observations};
  } catch (error) {
    const allowed = ['resource-limit', 'guest-exception-or-engine-limit', 'unsupported-export', 'observation-protocol-failed', 'oversized-observation'];
    result = {status: allowed.includes(error.message) ? error.message : 'runtime-failed'};
  } finally {
    try {
      for (const handle of handles.reverse()) handle.dispose();
      context?.dispose(); runtime.dispose();
    } catch { result = {status: 'cleanup-uncertain'}; }
  }
  return result;
}

execute(workerData.input,workerData.wasmModule).then(result => {
  parentPort.postMessage(result); parentPort.close();
}).catch(() => {
  parentPort.postMessage({status: 'runtime-failed'}); parentPort.close();
});
