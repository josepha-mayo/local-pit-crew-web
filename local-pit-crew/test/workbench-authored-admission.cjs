'use strict';
// TEST-ONLY dependency composition of a fixed checked-in authored target.
// vm.Script executes that authored bridge, never model/user/returned source; it is NOT isolation.
// Production launcher/server never import this file. No export/cache/global resolver is mutated.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),Module=require('node:module');
const contract=require('../src/public-verifier-contract.cjs');
const bridgePath=path.join(__dirname,'..','ui','workbench-bridge.cjs');
const productionRequire=Module.createRequire(bridgePath);
function authoredAdmission(registration){
 const run=registration?.runPublicChecks;
 if(typeof run!=='function')return contract.createVerifierAdmission();
 const runFacts=run.bind(registration);
 return Object.freeze({
  capabilityFor(suiteId){
   return Object.freeze({available:suiteId===contract.PILOT_SUITE,admissionKind:'authored-test-facts',
    qualified:false,benchmarkEligible:false,reason:suiteId===contract.PILOT_SUITE?null:'unsupported-suite'});
  },
  async runPublicChecks(ticket,options){
   // This callback supplies authored facts only. It must never execute ticket.files.
   const result=await runFacts(structuredClone(ticket),options);
   if(result&&typeof result==='object'&&Object.hasOwn(result,'status'))return result;
   const keys=result&&typeof result==='object'?Object.keys(result):[];
   if(keys.length!==3||!['suiteId','workspaceHash','checks'].every(k=>Object.hasOwn(result,k)))return result;
   return{status:'candidate-verdict',ticketId:ticket.id,suiteId:result.suiteId,workspaceHash:result.workspaceHash,checks:structuredClone(result.checks)};
  }
 });
}
const mockContract=Object.freeze({...contract,createVerifierAdmission:authoredAdmission});
const localRequire=specifier=>specifier==='../src/public-verifier-contract.cjs'?mockContract:productionRequire(specifier);
// No caller can supply the path, source or require hook.
const source=fs.readFileSync(bridgePath,'utf8'),target={exports:{}};
const wrapper=new vm.Script(Module.wrap(source),{filename:bridgePath+':authored-test-composition'}).runInThisContext();
wrapper(target.exports,localRequire,target,bridgePath,path.dirname(bridgePath));
module.exports=target.exports;
