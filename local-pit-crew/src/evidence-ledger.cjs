'use strict';
// Supplied-record ledger, not attestation of record truth or a universal model ranking.
const finite=x=>Number.isFinite(x)&&x>=0;
const SUPPORTED_ARMS=new Set(['default','deterministic','nano-controller']);
const workspaceHash=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
function balancedSchedule(taskIds,arms=['default','deterministic','nano-controller']){
 if(!Array.isArray(taskIds)||!taskIds.length||new Set(taskIds).size!==taskIds.length||arms.length!==3||new Set(arms).size!==3)throw Error('invalid schedule inputs');
 const out=[];
 for(let rep=0;rep<3;rep++)for(let t=0;t<taskIds.length;t++)for(let position=0;position<3;position++)
  out.push({taskId:taskIds[t],repetition:rep+1,position:position+1,arm:arms[(rep+t+position)%3]});
 return out;
}
function evaluateRecord(r){
 if(!r||!SUPPORTED_ARMS.has(r.arm))return{taskVerified:false,profileEligible:false,reason:'unsupported arm'};
 if(r.kind!=='actual-inference')return{taskVerified:false,profileEligible:false,reason:'not actual inference evidence'};
 const names=['comparisonPlanId','machineAlias','modelDigest','modelQuant','engineVersion','effectiveTemplateHash','actualContext','harnessCommit','taskInitialHash','policyHash'];
 if(!r.pins||!names.every(k=>typeof r.pins[k]==='string'&&r.pins[k].length>0))return{taskVerified:false,profileEligible:false,reason:'missing pins'};
 const g=r.finalGrade;
 if(!g||g.kind!=='independent-heldout-final'||g.visibleToAgent!==false||g.feedbackUsedForSelection!==false||
  !workspaceHash(r.finalWorkspaceHash)||!workspaceHash(g.workspaceHash)||g.workspaceHash!==r.finalWorkspaceHash||!Array.isArray(g.checks)||!g.checks.length)return{taskVerified:false,profileEligible:false,reason:'missing uncontaminated final grade'};
 const passed=g.checks.every(c=>c.ok===true)&&r.scopeViolation===false&&r.timedOut===false;
 if(!passed)return{taskVerified:false,profileEligible:false,reason:'task failed'};
 const pending=[];
 if(r.localTransport?.remoteModel!==false)pending.push('remote or unknown model location');
 if(r.localTransport?.taskTrafficObserved!==true)pending.push('local traffic not verified');
 if(r.isolationVerified!==true)pending.push('isolation not verified');
 if(!finite(r.wallMs))pending.push('wall time not measured');
 if(!finite(r.resources?.combinedPeakRamBytes))pending.push('combined RAM not measured');
 if(typeof r.resources?.vramApplicable!=='boolean')pending.push('VRAM applicability unknown');
 if(r.resources?.vramApplicable===true&&!finite(r.resources.combinedPeakVramBytes))pending.push('combined VRAM not measured');
 if(!r.resources?.loadOrder)pending.push('load order not recorded');
 if(r.arm==='nano-controller'&&(!r.nano||!Number.isInteger(r.nano.actualCalls)||r.nano.actualCalls<1||
  r.nano.identityVerified!==true||r.nano.firebasePathVerified!==true||r.nano.taskTrafficObserved!==true))pending.push('Nano/Firebase execution or identity unverified');
 return{taskVerified:true,profileEligible:pending.length===0,reason:pending.join('; ')||'qualified for this measured task'};
}
function cohort(r){
 const p=r.pins??{};
 return JSON.stringify(['comparisonPlanId','machineAlias','modelDigest','modelQuant','engineVersion','effectiveTemplateHash','actualContext','harnessCommit','policyHash'].map(k=>p[k]??'unknown'));
}
function summarize(records){
 const cohorts=Object.create(null),rejected=[];
 for(const r of records){
  if(!r||!SUPPORTED_ARMS.has(r.arm)){
   rejected.push({taskId:typeof r?.taskId==='string'?r.taskId:null,reason:'unsupported arm'});
   continue;
  }
  const key=cohort(r);
  if(!Object.hasOwn(cohorts,key))cohorts[key]=Object.create(null);
  const arms=cohorts[key];
  if(!Object.hasOwn(arms,r.arm))arms[r.arm]={records:0,actualRecords:0,taskPasses:0,profileEligiblePasses:0,wallMs:[],excluded:[]};
  const a=arms[r.arm];
  a.records++;const v=evaluateRecord(r);
  if(r.kind==='actual-inference')a.actualRecords++;
  if(v.taskVerified)a.taskPasses++;
  if(v.profileEligible)a.profileEligiblePasses++;
  if(r.kind==='actual-inference'&&finite(r.wallMs))a.wallMs.push(r.wallMs);
  if(!v.profileEligible)a.excluded.push({taskId:r.taskId,reason:v.reason});
 }
 return{scope:'Supplied records only, grouped by configuration/machine. No universal ranking or extrapolation.',cohorts,rejected};
}
module.exports={balancedSchedule,evaluateRecord,summarize,cohort};
