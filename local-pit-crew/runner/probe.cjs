'use strict';
const path = require('node:path');
const {Worker} = require('node:worker_threads');
const {POLICY, data, validateInput, gradeObservations} = require('./policy.cjs');
const {validateMatrix,validateMatrixObservations}=require('./matrix-policy.cjs');
const {preparedModule,prepareModule}=require('./compiled-wasm.cjs');
const {FUNCTION_SUITE}=require('./function-contract.cjs');
let active = false;
async function runProbe(input, cases, {signal} = {}) {
  const snapshot = validateInput(input);
  if(cases!==null&&snapshot.suiteId!=='pagination-zero')throw Error('unsupported-matrix-suite');
  const matrix=cases===null?null:validateMatrix(cases);
  const base = {kind: 'experimental-quickjs-pilot', policy: POLICY.id, productionAdmitted: false, benchmarkEligible: false};
  if (signal?.aborted) return {...base, status: 'aborted', cleanupConfirmed: true, workerCreated: false};
  if (active) return {...base, status: 'busy', cleanupConfirmed: true, workerCreated: false};
  active = true;
  let worker, timer, abort;
  try {
    // Trusted interpreter preparation remains inside the container's unchanged
    // total deadline. The worker's existing two-second watchdog still covers
    // all worker startup, instantiation and candidate work.
    const wasmModule=preparedModule()??await prepareModule();
    if(signal?.aborted)return{...base,status:'aborted',cleanupConfirmed:true,workerCreated:false};
    return await new Promise(resolve => {
      let packet = null, reason = null, received = false;
      const stop = status => {
        if (!reason) reason = status;
        void worker.terminate().catch(() => { reason = 'cleanup-uncertain'; });
      };
      worker = new Worker(path.join(__dirname, matrix?'matrix-worker.cjs':snapshot.suiteId===FUNCTION_SUITE?'function-worker.cjs':'worker.cjs'), {
        workerData:{input:snapshot,cases:matrix,wasmModule}, stdin: false, stdout: true, stderr: true,
        // This is a JS-worker bound. It is NOT an OS process/VM memory limit.
        resourceLimits: {maxOldGenerationSizeMb: POLICY.workerOldGenerationMb,
          maxYoungGenerationSizeMb: POLICY.workerYoungGenerationMb, stackSizeMb: POLICY.workerStackMb}
      });
      worker.stdout.resume(); worker.stderr.resume();
      timer = setTimeout(() => stop('wall-limit'), POLICY.wallMs);
      abort = () => stop('aborted');
      signal?.addEventListener('abort', abort, {once: true});
      worker.on('message', message => {
        if (received) { stop('protocol-invalid'); return; }
        received = true; packet = message;
      });
      worker.on('error', () => { reason ??= 'worker-failed'; });
      worker.once('exit', code => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        let result = {...base, status: reason ?? 'runtime-failed', cleanupConfirmed: true, workerCreated: true};
        if (!reason && code === 0 && packet) {
          try {
            if (packet.status === 'observed') {
              const parsed = data(packet, ['status', 'observations']);
              result = matrix?{...result,status:'observed',observations:validateMatrixObservations(parsed.observations,matrix)}:
               {...result, status: 'observed', observations: parsed.observations, checks: gradeObservations(parsed.observations,snapshot.suiteId,snapshot.files)};
            } else {
              const parsed = data(packet, ['status']);
              if (['resource-limit', 'guest-exception-or-engine-limit', 'unsupported-export', 'oversized-observation', 'cleanup-uncertain', 'runtime-failed'].includes(parsed.status)) result.status = parsed.status;
            }
          } catch { result.status = 'protocol-invalid'; }
        }
        resolve(result);
      });
      if (signal?.aborted) abort();
    });
  } catch { return {...base, status: 'runtime-unavailable', cleanupConfirmed: !worker, workerCreated: !!worker}; }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); active = false; }
}
const runCandidateProbe=(input,options)=>runProbe(input,null,options);
const runObservationMatrix=(input,cases,options)=>runProbe(input,cases,options);
module.exports = {runCandidateProbe,runObservationMatrix};
