'use strict';
// Compare accepted public verdicts only. This neither runs checks nor admits a verifier.
function comparePublicChecks(before,after){
 const valid=v=>v&&typeof v.workspaceHash==='string'&&/^[a-f0-9]{64}$/.test(v.workspaceHash)&&Array.isArray(v.checks)&&v.checks.length>0&&
  v.checks.every(c=>c&&typeof c.id==='string'&&c.id.length>0&&c.id.length<=120&&typeof c.ok==='boolean')&&new Set(v.checks.map(c=>c.id)).size===v.checks.length;
 if(!valid(before)||!valid(after)||before.workspaceHash===after.workspaceHash||before.checks.length!==after.checks.length)return null;
 const previous=new Map(before.checks.map(c=>[c.id,c.ok]));if(after.checks.some(c=>!previous.has(c.id)))return null;
 return{beforeWorkspaceHash:before.workspaceHash,afterWorkspaceHash:after.workspaceHash,
  beforePassed:before.checks.filter(c=>c.ok).length,afterPassed:after.checks.filter(c=>c.ok).length,total:after.checks.length,
  regressed:after.checks.filter(c=>previous.get(c.id)&&!c.ok).map(c=>c.id),repaired:after.checks.filter(c=>!previous.get(c.id)&&c.ok).map(c=>c.id)};
}
function changedWhileFailing(before,after){
 return !before.ok&&!after.ok&&(before.status!==after.status||before.actualReturn!==after.actualReturn||
  before.argumentsAfter!==after.argumentsAfter);
}
module.exports={comparePublicChecks,changedWhileFailing};
