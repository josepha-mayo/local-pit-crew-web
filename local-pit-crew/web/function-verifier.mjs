import contracts from '../runner/function-contract.cjs';
import controller from '../src/controller.cjs';
import codec from '../src/public-check-codec.cjs';
const {FUNCTION_SUITE,validateFunctionFiles,gradeFunctionObservations}=contracts;
const {workspaceHash}=controller;
const failureStatuses=new Set(['resource-limit','guest-exception-or-engine-limit','unsupported-export','oversized-observation','cleanup-uncertain','runtime-failed']);
// Test injection supplies authored worker events only. Production uses the fixed
// bundled URL below; requests cannot choose a script URL, module or callback.
export function createBrowserFunctionVerifier(environment=globalThis,createWorker=()=>new Worker(new URL('./function-worker.mjs',import.meta.url),{type:'module'}),cancelInterpreterPreload){
 let active=null,closed=false;
 const schedule=environment.setTimeout?.bind(environment)??setTimeout,cancelTimer=environment.clearTimeout?.bind(environment)??clearTimeout;
 const supported=typeof environment.Worker==='function'&&typeof environment.WebAssembly==='object';
 const capabilityFor=suiteId=>Object.freeze({available:supported&&!closed&&suiteId===FUNCTION_SUITE,qualified:false,
  admissionKind:'browser-worker-quickjs',benchmarkEligible:false,reason:suiteId!==FUNCTION_SUITE?'unsupported-suite':closed||!supported?'runtime-unavailable':null});
 return Object.freeze({capabilityFor,
  close(){closed=true;cancelInterpreterPreload?.();active?.stop('aborted');},
  async runPublicChecks(ticket,{signal}={}){
   const t=contracts.fields(ticket,['id','suiteId','workspaceHash','files']);
   const binding={ticketId:t.id,suiteId:t.suiteId,workspaceHash:t.workspaceHash};
   codec.bindingData(binding);
   const unavailable=reason=>({status:'unavailable',...binding,reason});
   if(!capabilityFor(t.suiteId).available)return unavailable(capabilityFor(t.suiteId).reason);
   // Capture strings before any worker preparation wait. Caller mutation cannot
   // rebind a result or make the worker execute a different source/contract.
   const files=validateFunctionFiles(t.files);
   if(workspaceHash(files)!==t.workspaceHash)return unavailable('protocol-invalid');
   if(signal?.aborted)return unavailable('aborted');
   if(active)return unavailable('runtime-unavailable');
   return new Promise(resolve=>{
    let worker,timer,ready=false,settled=false;
    const owner={stop:reason=>finish(unavailable(reason))};active=owner;
    const abort=()=>owner.stop('aborted');
    function finish(result){
     if(settled)return;settled=true;cancelTimer(timer);signal?.removeEventListener('abort',abort);
     let cleanup=true;try{worker?.terminate();}catch{cleanup=false;}
     // Release the page's pending fetch too, so retry can start a fresh download.
     if(!ready)cancelInterpreterPreload?.();
     if(active===owner)active=null;resolve(cleanup?result:unavailable('cleanup-uncertain'));
    }
    try{
     worker=createWorker();
     timer=schedule(()=>owner.stop('browser-setup-unavailable'),15000);
     signal?.addEventListener('abort',abort,{once:true});
     worker.onerror=()=>owner.stop(ready?'runtime-unavailable':'browser-setup-unavailable');
     worker.onmessage=({data})=>{
      if(settled)return;
      try{
       const status=Object.getOwnPropertyDescriptor(data??{},'status');
       if(!status||!Object.hasOwn(status,'value'))throw Error('invalid-worker-result');
       if(!ready&&status.value==='ready'){
        contracts.fields(data,['status']);ready=true;cancelTimer(timer);
        timer=schedule(()=>owner.stop('expired'),2000);
        worker.postMessage({suiteId:FUNCTION_SUITE,files});return;
       }
       if(status.value==='observed'&&ready){
        contracts.fields(data,['status','observations']);
        const outcome={status:'candidate-verdict',...binding,checks:gradeFunctionObservations(data.observations,files),observations:data.observations};
        codec.parsePublicCheckOutcome(outcome,binding,files);finish(outcome);return;
       }
       contracts.fields(data,['status']);
       if(!ready){
        owner.stop(status.value==='runtime-failed'?'browser-setup-unavailable':'protocol-invalid');
        return;
       }
       owner.stop(failureStatuses.has(status.value)?'runtime-unavailable':'protocol-invalid');
      }catch{owner.stop('protocol-invalid');}
     };
     if(signal?.aborted)abort();
    }catch{owner.stop(ready?'runtime-unavailable':'browser-setup-unavailable');}
   });
  }
 });
}
