'use strict';
// A portable data envelope. Hash agreement binds bytes; it is not a signature
// and never imports an earlier verdict. Replaying requires fresh execution.
const {createHash}=require('node:crypto');
const {fields,dense,validateFunctionFiles,validateFunctionExample,validateContract,parseContractSource,createFunctionTask,TASK_SCHEMA,FUNCTION_ENTRY,CONTRACT_PATH}=require('../runner/function-contract.cjs');
const REPLAY_SCHEMA='local-pit-crew/function-replay/v1',CONTEXT_REPLAY_SCHEMA='local-pit-crew/function-replay/v2',MAX_REPLAY_BYTES=80000;
const hash=s=>createHash('sha256').update(s).digest('hex');
const withoutId=({id,...example})=>example;
function validateContext(value){
 const context=fields(value,['title','instructions']);
 if(typeof context.title!=='string'||!context.title.trim()||context.title.length>80||typeof context.instructions!=='string'||!context.instructions.trim()||new TextEncoder().encode(context.instructions).length>1000)throw Error('invalid-replay-context');
 return context;
}
function createFunctionReplay(files,context=null){
 const validated=validateFunctionFiles(files);
 return{schema:context===null?REPLAY_SCHEMA:CONTEXT_REPLAY_SCHEMA,...(context===null?{}:{context:validateContext(context)}),files:[FUNCTION_ENTRY,CONTRACT_PATH].map(path=>({path,sha256:hash(validated[path]),content:validated[path]}))};
}
function parseReplay(text){
 if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_REPLAY_BYTES)throw Error('invalid-function-replay');
 let value;try{value=JSON.parse(text);}catch{throw Error('invalid-function-replay');}
 const modern=value?.schema===CONTEXT_REPLAY_SCHEMA,packet=fields(value,modern?['schema','context','files']:['schema','files']);
 if(packet.schema!==REPLAY_SCHEMA&&!modern)throw Error('invalid-function-replay');
 const context=modern?validateContext(packet.context):null;
 const rows=dense(packet.files,2);if(rows.length!==2)throw Error('invalid-function-replay');
 const files={};
 for(let i=0;i<2;i++){
  const row=fields(rows[i],['path','sha256','content']);
  if(row.path!==[FUNCTION_ENTRY,CONTRACT_PATH][i]||typeof row.content!=='string'||typeof row.sha256!=='string'||!/^[a-f0-9]{64}$/.test(row.sha256)||hash(row.content)!==row.sha256)throw Error('invalid-function-replay');
  files[row.path]=row.content;
 }
 return{files:validateFunctionFiles(files),context};
}
function parseFunctionReplay(text){return parseReplay(text).files;}
function prepareReplayComparison(baselineText,candidateText){
 const {files:baselineFiles,context}=parseReplay(baselineText),candidateFiles=parseFunctionReplay(candidateText);
 if(baselineFiles[CONTRACT_PATH]!==candidateFiles[CONTRACT_PATH])throw Error('different-contracts');
 return prepareFileComparison(baselineFiles,candidateFiles,context);
}
function prepareSourceComparison(baselineText,source){
 const {files:baselineFiles,context}=parseReplay(baselineText);
 const candidateFiles=validateFunctionFiles({...baselineFiles,[FUNCTION_ENTRY]:source});
 return prepareFileComparison(baselineFiles,candidateFiles,context);
}
function prepareFileComparison(baselineFiles,candidateFiles,context){
 if(baselineFiles[FUNCTION_ENTRY]===candidateFiles[FUNCTION_ENTRY])throw Error('unchanged-source');
 return{baselineFiles,candidateFiles,context};
}
function prepareFunctionReplay(text,example){
 const {files,context}=parseReplay(text);
 let contract=parseContractSource(files[CONTRACT_PATH]);
 if(example!==undefined){
  const row=validateFunctionExample(example);
  const id='case-'+String(contract.cases.length+1).padStart(2,'0');
  contract=validateContract({...contract,cases:[...contract.cases,{id,...row}]});
 }
 return{spec:{schema:TASK_SCHEMA,title:context?.title??'Reopened '+contract.exportName,instructions:context?.instructions??'',exportName:contract.exportName,source:files[FUNCTION_ENTRY],cases:contract.cases.map(withoutId)},contextRestored:context!==null};
}
function createFunctionChallenge(parent,example){
 if(parent?.mode!=='function-contract'||parent.snapshot?.publicChecksCurrent!==true||parent.snapshot.pending||!parent.checkedReplay||!parent.checkedFunction)throw Error('checked-parent-required');
 const {files,context}=parseReplay(JSON.stringify(parent.checkedReplay)),contract=parseContractSource(files[CONTRACT_PATH]),count=contract.cases.length;
 if(!context||count>=8||parent.checkedFunction.sha256!==hash(files[FUNCTION_ENTRY])||parent.checkedFunction.content!==files[FUNCTION_ENTRY]||
  !Array.isArray(parent.checks)||parent.checks.length!==count||new Set(parent.checks.map(c=>c.id)).size!==count||!parent.checks.every(c=>c.ok===true&&contract.cases.some(e=>e.id===c.id))||
  !Array.isArray(parent.snapshot.manifest)||parent.snapshot.manifest.length!==2||!Object.entries(files).every(([path,content])=>parent.snapshot.manifest.some(m=>m.path===path&&m.sha256===hash(content))))throw Error('checked-parent-required');
 const row=validateFunctionExample(example);
 const task=createFunctionTask({schema:TASK_SCHEMA,...context,exportName:contract.exportName,source:files[FUNCTION_ENTRY],cases:[...contract.cases.map(withoutId),row]});
 return Object.freeze({...task,challengeParent:Object.freeze({sourceSha256:hash(files[FUNCTION_ENTRY]),contractSha256:hash(files[CONTRACT_PATH]),caseCount:count})});
}
module.exports={REPLAY_SCHEMA,CONTEXT_REPLAY_SCHEMA,MAX_REPLAY_BYTES,createFunctionReplay,parseFunctionReplay,prepareReplayComparison,prepareSourceComparison,prepareFunctionReplay,createFunctionChallenge};
