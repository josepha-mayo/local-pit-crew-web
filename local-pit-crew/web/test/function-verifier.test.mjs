// Authored worker-event tests. Real browser execution is checked separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserFunctionVerifier} from '../function-verifier.mjs';
import contracts from '../../runner/function-contract.cjs';
import controller from '../../src/controller.cjs';
const task=()=>contracts.createFunctionTask({schema:contracts.TASK_SCHEMA,title:'Authored worker test',instructions:'Return zero.',exportName:'fn',source:'module.exports={fn:()=>0};',cases:[{label:'zero',args:[],expected:0}]});
function fixture(){
 const workers=[],timers=new Map();let serial=0;
 const env={Worker:class{},WebAssembly:{},setTimeout(fn,delay){const id=++serial;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);}};
 const runtime=createBrowserFunctionVerifier(env,()=>{const w={terminate(){this.terminated=true;},postMessage(data){this.input=structuredClone(data);},send(data){this.onmessage({data});}};workers.push(w);return w;});
 const ticket=()=>{const t=task();return{id:'authored-ticket',suiteId:t.id,workspaceHash:controller.workspaceHash(t.files),files:{...t.files}};};
 const result=()=>({status:'observed',observations:[{id:'case-01',status:'returned',output:'0',argsAfter:'[]'}]});
 return{runtime,workers,timers,ticket,result};
}
test('browser verifier captures exact files before preparation and independently grades observed data without claiming Docker qualification',async()=>{
 const f=fixture(),t=f.ticket(),pending=f.runtime.runPublicChecks(t);
 assert.equal(f.runtime.capabilityFor(t.suiteId).qualified,false);
 assert.deepEqual([...f.timers.values()].map(t=>t.delay),[15000]);
 t.files[contracts.FUNCTION_ENTRY]='module.exports={fn:()=>999};';
 f.workers[0].send({status:'ready'});
 assert.equal(f.workers[0].input.files[contracts.FUNCTION_ENTRY],task().files[contracts.FUNCTION_ENTRY]);
 assert.deepEqual([...f.timers.values()].map(t=>t.delay),[2000]);
 f.workers[0].send(f.result());const outcome=await pending;
 assert.equal(outcome.checks[0].ok,true);assert.equal(f.workers[0].terminated,true);assert.equal(f.timers.size,0);
});
test('browser verifier rejects self-reported passes, extra fields, incomplete observations and early observations',async()=>{
 for(const packet of [{status:'observed',checks:[{id:'case-01',ok:true}]},{status:'observed',observations:[]},{status:'ready',extra:true}]){
  const f=fixture(),pending=f.runtime.runPublicChecks(f.ticket());
  if(packet.status!=='ready')f.workers[0].send({status:'ready'});
  f.workers[0].send(packet);assert.equal((await pending).reason,'protocol-invalid');assert.equal(f.workers[0].terminated,true);
 }
 const f=fixture(),pending=f.runtime.runPublicChecks(f.ticket());f.workers[0].send(f.result());assert.equal((await pending).reason,'protocol-invalid');
});
test('outer deadlines and cancellation terminate only their owned worker; late events cannot complete or release a replacement',async()=>{
 const f=fixture(),abort=new AbortController(),first=f.runtime.runPublicChecks(f.ticket(),{signal:abort.signal});
 const old=f.workers[0];old.send({status:'ready'});abort.abort();assert.equal((await first).reason,'aborted');assert.equal(old.terminated,true);
 const next=f.runtime.runPublicChecks(f.ticket());const current=f.workers[1];
 old.send(f.result());assert.equal(current.terminated,undefined);
 assert.equal((await f.runtime.runPublicChecks(f.ticket())).reason,'runtime-unavailable');
 current.send({status:'ready'});[...f.timers.values()][0].fn();assert.equal((await next).reason,'expired');assert.equal(current.terminated,true);
 assert.equal(f.timers.size,0);
 const last=f.runtime.runPublicChecks(f.ticket());f.runtime.close();assert.equal((await last).reason,'aborted');assert.equal(f.runtime.capabilityFor(contracts.FUNCTION_SUITE).available,false);
});
test('unsupported browsers, stale workspace hashes and resource failures never fabricate failed cases',async()=>{
 const unsupported=createBrowserFunctionVerifier({});assert.equal(unsupported.capabilityFor(contracts.FUNCTION_SUITE).available,false);
 const f=fixture(),t=f.ticket();assert.equal((await f.runtime.runPublicChecks({...t,workspaceHash:'a'.repeat(64)})).reason,'protocol-invalid');assert.equal(f.workers.length,0);
 const pending=f.runtime.runPublicChecks(t);f.workers[0].send({status:'ready'});f.workers[0].send({status:'resource-limit'});
 const outcome=await pending;assert.equal(outcome.status,'unavailable');assert.equal(outcome.checks,undefined);
});
test('a setup deadline releases a worker before sending source and ignores its late readiness',async()=>{
 const f=fixture(),pending=f.runtime.runPublicChecks(f.ticket()),worker=f.workers[0];
 [...f.timers.values()][0].fn();
 assert.equal((await pending).reason,'browser-setup-unavailable');
 assert.equal(worker.terminated,true);
 worker.send({status:'ready'});
 assert.equal(worker.input,undefined);
});
test('uncertain worker termination cannot publish an observed pass or leave its caller waiting',async()=>{
 const f=fixture(),pending=f.runtime.runPublicChecks(f.ticket());
 f.workers[0].terminate=()=>{throw Error('authored termination failure');};
 f.workers[0].send({status:'ready'});f.workers[0].send(f.result());
 const result=await pending;assert.equal(result.reason,'cleanup-uncertain');assert.equal(result.checks,undefined);assert.equal(f.timers.size,0);
});
