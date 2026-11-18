'use strict';
// Only the Node entrypoint can resolve a runtime-qualified Docker admission.
const {resolveDockerAdmission}=require('../runner/docker/admission.cjs');
const {SUPPORTED_SUITES}=require('../runner/policy.cjs');
const {PILOT_SUITE,PILOT_CHECK_IDS,UNAVAILABLE_REASONS,parsePublicCheckOutcome}=require('./public-check-codec.cjs');
const {bindingData}=require('./public-check-codec.cjs');
function createVerifierAdmission(claimedRegistration){
 const admitted=resolveDockerAdmission(claimedRegistration);
 if(admitted)return admitted;
 // Ignore supplied callbacks/hashes/booleans/status/tokens. Importing this
 // resolver never builds, qualifies or executes a candidate.
 return Object.freeze({
  capabilityFor(suiteId){
   return Object.freeze({available:false,admissionKind:'unavailable',qualified:false,benchmarkEligible:false,
    reason:SUPPORTED_SUITES.includes(suiteId)?'not-qualified':'unsupported-suite'});
  },
  async runPublicChecks(ticket){
   const b=bindingData({ticketId:ticket?.id,suiteId:ticket?.suiteId,workspaceHash:ticket?.workspaceHash});
   return{status:'unavailable',...b,reason:SUPPORTED_SUITES.includes(b.suiteId)?'not-qualified':'unsupported-suite'};
  }
 });
}
module.exports={PILOT_SUITE,PILOT_CHECK_IDS,UNAVAILABLE_REASONS,parsePublicCheckOutcome,createVerifierAdmission};
