'use strict';
const fs=require('node:fs');
const {createHash}=require('node:crypto');
const {parseFunctionReplay,prepareReplayComparison,prepareSourceComparison,MAX_REPLAY_BYTES}=require('../local-pit-crew/src/function-replay.cjs');
const {workspaceHash}=require('../local-pit-crew/src/controller.cjs');
const {comparePublicChecks,changedWhileFailing}=require('../local-pit-crew/src/public-check-changes.cjs');
const {FUNCTION_SUITE,FUNCTION_ENTRY,LIMITS,validateFunctionFiles,inspectFunctionObservations}=require('../local-pit-crew/runner/function-contract.cjs');
const {runCandidateProbe}=require('../local-pit-crew/runner/probe.cjs');
const USAGE='npm run replay:function -- BASELINE.replay.json [--against CANDIDATE.replay.json | --source FUNCTION.js | --compare-source FUNCTION.js] [--junit NEW_REPORT.xml]';
async function checkFiles(files,{captureDiagnostics=false}={}){
 const result=await runCandidateProbe({suiteId:FUNCTION_SUITE,files});
 const observed=result.status==='observed'&&result.cleanupConfirmed===true;
 const checks=observed?result.checks.map(({id,ok})=>({id,ok})):[];
 const report={schema:'local-pit-crew/function-replay-result/v1',status:observed?'checked':'unavailable',
  files:Object.entries(files).map(([path,content])=>({path,sha256:createHash('sha256').update(content).digest('hex')})),
  checks,passed:checks.filter(c=>c.ok).length,total:checks.length,modelCalls:0,
  verification:{boundary:'node-worker-quickjs',qualifiedDocker:false,cleanupConfirmed:result.cleanupConfirmed===true},
  heldOutCorrectness:false};
 return{report,diagnostics:observed&&captureDiagnostics?inspectFunctionObservations(result.observations,files):[]};
}
async function replay(text){return (await checkFiles(parseFunctionReplay(text))).report;}
async function compareReplays(baselineText,candidateText){
 return compareVersions(prepareReplayComparison(baselineText,candidateText));
}
async function compareVersions({baselineFiles,candidateFiles}){
 const before=await checkFiles(baselineFiles,{captureDiagnostics:true}),after=await checkFiles(candidateFiles,{captureDiagnostics:true});
 const baseline=before.report,candidate=after.report;
 const comparison=comparePublicChecks({workspaceHash:workspaceHash(baselineFiles),checks:baseline.checks},
  {workspaceHash:workspaceHash(candidateFiles),checks:candidate.checks});
 if(comparison)comparison.changedFailures=before.diagnostics.filter((row,index)=>changedWhileFailing(row,after.diagnostics[index])).map(({id})=>id);
 return{schema:'local-pit-crew/function-replay-comparison/v1',status:comparison?'checked':'unavailable',
  baseline,candidate,comparison,modelCalls:0};
}
function readBoundedUtf8(file,maxBytes,{preserveBOM=false}={}){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NONBLOCK??0));
 try{
  const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>maxBytes)throw Error('invalid-replay-input');
  const bytes=Buffer.alloc(maxBytes+1);let length=0,read;
  while(length<bytes.length&&(read=fs.readSync(fd,bytes,length,bytes.length-length,null))>0)length+=read;
  if(length>maxBytes)throw Error('invalid-replay-input');
  return new TextDecoder('utf-8',{fatal:true,ignoreBOM:preserveBOM}).decode(bytes.subarray(0,length));
 }finally{fs.closeSync(fd);}
}
function writeJUnit(file,result){
 // Fixed check IDs and bounded status messages keep private case data out of CI.
 // This is a report of fresh observations, not a signature or imported verdict.
 const xml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
 const checked=result?.status==='checked',checks=checked?result.checks:[],tests=checked?checks.length:1;
 const failures=checks.filter(c=>!c.ok).length,errors=checked?0:1;
 const contract=result?.files.find(f=>f.path==='contract.json')?.sha256,suffix=contract?'.'+contract:'';
 const counts=`tests="${tests}" failures="${failures}" errors="${errors}" skipped="0"`;
 const properties=[['status',checked?'checked':result?'unavailable':'invalid-or-unavailable'],['modelCalls',0],['heldOutCorrectness',false],
  ...(result?[['verification.boundary',result.verification.boundary],['verification.qualifiedDocker',false],['verification.cleanupConfirmed',result.verification.cleanupConfirmed],...result.files.map(f=>[f.path+'.sha256',f.sha256])]:[])];
 const cases=checked?checks.map(c=>`    <testcase classname="local-pit-crew.function${suffix}" name="${xml(c.id)}">${c.ok?'':'<failure message="Fixed example failed">Return value and input-preservation requirements were not both satisfied.</failure>'}</testcase>`):
  [`    <testcase classname="local-pit-crew.replay${suffix}" name="verification"><error message="Replay invalid or execution unavailable">No candidate verdict is available. No example results were fabricated.</error></testcase>`];
 const report=['<?xml version="1.0" encoding="UTF-8"?>',`<testsuites ${counts}>`,`  <testsuite name="Local Pit Crew function replay" ${counts}>`,'    <properties>',
  ...properties.map(([name,value])=>`      <property name="${xml(name)}" value="${xml(value)}"/>`),'    </properties>',...cases,'  </testsuite>','</testsuites>',''].join('\n');
 fs.writeFileSync(file,report,{flag:'wx',mode:0o600});
}
async function main(argv){
 const [input,...args]=argv,options=new Map();
 if(!input||args.length%2)throw Error('invalid-arguments');
 for(let i=0;i<args.length;i+=2){
  const [flag,file]=[args[i],args[i+1]];
  if(!['--against','--source','--compare-source','--junit'].includes(flag)||!file||file.startsWith('--')||options.has(flag))throw Error('invalid-arguments');
  options.set(flag,file);
 }
 const report=options.get('--junit'),against=options.get('--against'),source=options.get('--source'),compareSource=options.get('--compare-source');
 if([against,source,compareSource].filter(Boolean).length>1)throw Error('invalid-arguments');
 const comparing=!!(against||compareSource);
 if(report&&fs.existsSync(report))throw Error('report-already-exists');
 let result;
 try{
  const baseline=readBoundedUtf8(input,MAX_REPLAY_BYTES);
  if(against)result=await compareReplays(baseline,readBoundedUtf8(against,MAX_REPLAY_BYTES));
  else if(compareSource)result=await compareVersions(prepareSourceComparison(baseline,
   readBoundedUtf8(compareSource,LIMITS.sourceBytes,{preserveBOM:true})));
  else if(source){
   const files=parseFunctionReplay(baseline);
   files[FUNCTION_ENTRY]=readBoundedUtf8(source,LIMITS.sourceBytes,{preserveBOM:true});
   result=(await checkFiles(validateFunctionFiles(files))).report;
  }else result=await replay(baseline);
 }
 catch(error){if(report)writeJUnit(report,null);throw error;}
 const candidate=comparing?result.candidate:result;
 if(report)writeJUnit(report,result.status==='checked'||!comparing?candidate:null);
 console.log(JSON.stringify(result,null,2));
 return result.status!=='checked'?2:candidate.checks.every(c=>c.ok)?0:1;
}
if(require.main===module)main(process.argv.slice(2)).then(code=>{process.exitCode=code;}).catch(error=>{
 const message=error?.message==='different-contracts'?'The replay contracts differ. Compare two source versions with byte-identical contracts.':
  error?.message==='unchanged-source'?'The source is identical in both versions. Compare two distinct versions.':
  'Replay invalid, execution unavailable or report could not be written.';
 console.error(message+' Usage: '+USAGE);process.exitCode=2;
});
module.exports={replay,compareReplays,main};
